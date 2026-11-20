import type { Metadata } from "next";
import Link from "next/link";
import { formatMoney, money } from "@/lib/money";
import { PROVIDERS } from "@/lib/payments/providers";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { METHOD_LABELS } from "../invoices/labels";
import { NoAccess } from "../_components/no-access";

export const metadata: Metadata = { title: "Payments — MomentumDesk" };

const PAGE_SIZE = 50;

/** Every payment received, newest first, with the invoices it paid and any refunds. */
export default async function PaymentsPage({ searchParams }: PageProps<"/app/payments">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("payments:read")) return <NoAccess title="Payments" />;
  const requested = Number((await searchParams).page ?? 1);
  const page = Number.isInteger(requested) && requested > 0 ? requested : 1;
  const payments = await tenantData.scoped(tenant.organization.id).payment.findMany({
    orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
    include: {
      customer: { select: { id: true, displayName: true } },
      allocations: { where: { voidedAt: null }, include: { invoice: { select: { id: true, number: true } } } },
      refunds: { where: { status: { not: "failed" } }, select: { amountMinor: true } },
    },
  });
  const locale = tenant.organization.locale;
  const show = (minor: bigint, currency: string) => formatMoney(money(minor, currency), locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const more = payments.length > PAGE_SIZE;
  return (
    <>
      <header className="topbar"><div><p>CASH</p><h1>Payments</h1></div></header>
      <section className="panel" aria-label="Payments received">
        <div className="panel-heading"><div><h3>Payments received</h3><p>Newest first. Record a payment from its invoice.</p></div></div>
        {payments.length === 0 ? (
          <p className="form-hint attention-empty">No payments yet. They appear here when recorded on an invoice or paid online.</p>
        ) : (
          <table className="aging">
            <thead><tr><th>Received</th><th>Customer</th><th>Invoices</th><th>How</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {payments.slice(0, PAGE_SIZE).map((p) => {
                const refunded = p.refunds.reduce((n, r) => n + r.amountMinor, 0n);
                const provider = PROVIDERS[p.source as keyof typeof PROVIDERS]?.name;
                return (
                  <tr key={p.id} className={p.voidedAt ? "voided" : undefined}>
                    <td>{date.format(p.receivedOn)}</td>
                    <td><Link href={`/app/customers/${p.customer.id}`}>{p.customer.displayName}</Link></td>
                    <td>{p.allocations.length ? p.allocations.map((a, i) => <span key={a.id}>{i ? ", " : ""}<Link href={`/app/invoices/${a.invoice.id}`}>{a.invoice.number}</Link></span>) : "—"}</td>
                    <td>{provider ? `${provider} · ` : ""}{METHOD_LABELS[p.method as keyof typeof METHOD_LABELS] ?? p.method}{p.reference ? ` · ${p.reference}` : ""}</td>
                    <td className="num">
                      {p.voidedAt ? <s>{show(p.amountMinor, p.currency)}</s> : show(p.amountMinor, p.currency)}
                      {p.voidedAt ? <small> voided</small> : null}
                      {refunded > 0n ? <small> · {show(refunded, p.currency)} refunded</small> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <nav className="row-buttons" aria-label="Pages">
          {page > 1 ? <Link href={`/app/payments?page=${page - 1}`} className="link-button">← Newer</Link> : null}
          {more ? <Link href={`/app/payments?page=${page + 1}`} className="link-button">Older →</Link> : null}
        </nav>
      </section>
    </>
  );
}
