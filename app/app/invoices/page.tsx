import type { Metadata } from "next";
import Link from "next/link";
import { todayIn } from "@/lib/dates";
import { INVOICE_FILTERS, type InvoiceFilter, invoiceStatus, listInvoices } from "@/lib/invoices/service";
import { formatMoney, money } from "@/lib/money";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../_components/no-access";
import { INVOICE_STATUS_LABELS } from "./labels";

export const metadata: Metadata = { title: "Invoices — MomentumDesk" };

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
const FILTER_LABELS: Record<InvoiceFilter, string> = {
  open: "Open (drafts and unpaid)", draft: "Drafts", unpaid: "Unpaid", overdue: "Overdue", paid: "Paid", void: "Void", all: "All",
};

export default async function InvoicesPage({ searchParams }: PageProps<"/app/invoices">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("invoices:read")) return <NoAccess title="Invoices" />;
  const params = await searchParams;
  const status = INVOICE_FILTERS.includes(one(params.status) as InvoiceFilter) ? (one(params.status) as InvoiceFilter) : "open";
  const { organization } = tenant;
  const today = todayIn(organization.timezone);
  const query = { q: one(params.q), status, page: Number(one(params.page) ?? 1) };
  const { items, total, page, pageCount } = await listInvoices(tenantData, organization.id, query, today);
  const date = new Intl.DateTimeFormat(organization.locale, { dateStyle: "medium", timeZone: "UTC" });
  const show = (minor: bigint, currency: string) => formatMoney(money(minor, currency), organization.locale);

  const href = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: query.q, status, page, ...changes })) {
      if (value !== undefined && value !== "" && !(key === "status" && value === "open") && !(key === "page" && value === 1)) next.set(key, String(value));
    }
    const search = next.toString();
    return search ? `/app/invoices?${search}` : "/app/invoices";
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p>INVOICES</p>
          <h1>Invoices</h1>
        </div>
        {tenant.can("invoices:write") ? (
          <div className="header-actions">
            <Link href="/app/invoices/new" className="new-button link-as-button"><span aria-hidden>＋</span> New invoice</Link>
          </div>
        ) : null}
      </header>
      <form className="list-filters" role="search" action="/app/invoices">
        <input type="search" name="q" defaultValue={query.q} placeholder="Search number, customer or recipient" aria-label="Search invoices" />
        <select name="status" defaultValue={status} aria-label="Status">
          {INVOICE_FILTERS.map((value) => <option key={value} value={value}>{FILTER_LABELS[value]}</option>)}
        </select>
        <button type="submit" className="new-button">Filter</button>
      </form>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>{total === 1 ? "1 invoice" : `${total} invoices`}</h3>
            <p>Amounts are in each invoice&apos;s own currency, never added across currencies.</p>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="team-empty">{query.q || status !== "open" ? "No invoices match these filters." : "No open invoices."}</p>
        ) : (
          <table className="team-table">
            <thead>
              <tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Due</th><th className="num">Total</th><th className="num">Owed</th></tr>
            </thead>
            <tbody>
              {items.map((invoice) => {
                const shown = invoiceStatus(invoice, today);
                return (
                  <tr key={invoice.id}>
                    <td>
                      <Link href={`/app/invoices/${invoice.id}`} className="row-link"><strong>{invoice.number ?? "Draft"}</strong></Link>
                    </td>
                    <td>{invoice.customer.displayName}</td>
                    <td><span className={`status-pill ${shown}`}>{INVOICE_STATUS_LABELS[shown]}</span></td>
                    <td>{date.format(invoice.dueOn)}</td>
                    <td className="num">{show(invoice.totalMinor, invoice.currency)}</td>
                    <td className="num">{invoice.status === "issued" ? show(invoice.outstandingMinor, invoice.currency) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {pageCount > 1 ? (
          <nav className="pager" aria-label="Pages">
            {page > 1 ? <Link href={href({ page: page - 1 })}>← Previous</Link> : <span />}
            <span>Page {page} of {pageCount}</span>
            {page < pageCount ? <Link href={href({ page: page + 1 })}>Next →</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </>
  );
}
