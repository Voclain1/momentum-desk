import type { Metadata } from "next";
import Link from "next/link";
import { todayIn } from "@/lib/dates";
import { formatMoney, money } from "@/lib/money";
import { displayStatus, listQuotes, STATUS_FILTERS, type StatusFilter } from "@/lib/quotes/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../_components/no-access";
import { STATUS_LABELS } from "./labels";

export const metadata: Metadata = { title: "Quotes — MomentumDesk" };

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
const FILTER_LABELS: Record<StatusFilter, string> = {
  open: "Open (draft and sent)", draft: "Drafts", sent: "Sent", accepted: "Accepted", rejected: "Rejected", all: "All",
};

export default async function QuotesPage({ searchParams }: PageProps<"/app/quotes">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("quotes:read")) return <NoAccess title="Quotes" />;
  const params = await searchParams;
  const status = STATUS_FILTERS.includes(one(params.status) as StatusFilter) ? (one(params.status) as StatusFilter) : "open";
  const query = { q: one(params.q), status, page: Number(one(params.page) ?? 1) };
  const { organization } = tenant;
  const { items, total, page, pageCount } = await listQuotes(tenantData, organization.id, query);
  const today = todayIn(organization.timezone);
  const date = new Intl.DateTimeFormat(organization.locale, { dateStyle: "medium", timeZone: "UTC" });

  const href = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ q: query.q, status, page, ...changes })) {
      if (value !== undefined && value !== "" && !(key === "status" && value === "open") && !(key === "page" && value === 1)) next.set(key, String(value));
    }
    const search = next.toString();
    return search ? `/app/quotes?${search}` : "/app/quotes";
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p>QUOTES</p>
          <h1>Quotes</h1>
        </div>
        {tenant.can("quotes:write") ? (
          <div className="header-actions">
            <Link href="/app/quotes/new" className="new-button link-as-button"><span aria-hidden>＋</span> New quote</Link>
          </div>
        ) : null}
      </header>
      <form className="list-filters" role="search" action="/app/quotes">
        <input type="search" name="q" defaultValue={query.q} placeholder="Search number, customer or recipient" aria-label="Search quotes" />
        <select name="status" defaultValue={status} aria-label="Status">
          {STATUS_FILTERS.map((value) => <option key={value} value={value}>{FILTER_LABELS[value]}</option>)}
        </select>
        <button type="submit" className="new-button">Filter</button>
      </form>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>{total === 1 ? "1 quote" : `${total} quotes`}</h3>
            <p>Totals are in each quote&apos;s own currency.</p>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="team-empty">{query.q || status !== "open" ? "No quotes match these filters." : "No open quotes."}</p>
        ) : (
          <table className="team-table">
            <thead>
              <tr><th>Quote</th><th>Customer</th><th>Status</th><th>Valid until</th><th className="num">Total</th></tr>
            </thead>
            <tbody>
              {items.map((quote) => {
                const shown = displayStatus(quote, today);
                return (
                  <tr key={quote.id}>
                    <td>
                      <Link href={`/app/quotes/${quote.id}`} className="row-link"><strong>{quote.number}</strong></Link>
                      {quote.revision > 1 ? <small>Revision {quote.revision}</small> : null}
                    </td>
                    <td>{quote.customer.displayName}</td>
                    <td><span className={`status-pill ${shown}`}>{STATUS_LABELS[shown]}</span></td>
                    <td>{date.format(quote.expiresOn)}</td>
                    <td className="num">{formatMoney(money(quote.totalMinor, quote.currency), organization.locale)}</td>
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
