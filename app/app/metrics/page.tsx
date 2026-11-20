import type { Metadata } from "next";
import Link from "next/link";
import { ATTRIBUTION_DAYS, metrics } from "@/lib/analytics/metrics";
import { formatMoney, money } from "@/lib/money";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../_components/no-access";

export const metadata: Metadata = { title: "Metrics — MomentumDesk" };

const PERIODS = { "30": "Last 30 days", "90": "Last 90 days", "365": "Last 12 months" } as const;
const LABELS: Record<string, string> = {
  lead_created: "Leads created", lead_qualified: "Leads qualified", opportunity_won: "Opportunities won",
  quote_created: "Quotes created", quote_sent: "Quotes sent", quote_viewed: "Quotes viewed", quote_accepted: "Quotes accepted",
  invoice_created: "Invoices created", invoice_sent: "Invoices sent", invoice_viewed: "Invoices viewed",
  payment_started: "Online payments started", payment_completed: "Payments received", invoice_overdue: "Invoices became overdue",
  reminder_sent: "Reminders sent", overdue_invoice_paid: "Overdue invoices paid",
};

const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
const days = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)} days`);

/** Spec §17 metrics, from the workspace's own product events (decision D41). */
export default async function MetricsPage({ searchParams }: PageProps<"/app/metrics">) {
  const tenant = await requireTenant("workspace:read");
  const sales = tenant.can("sales:read");
  const finance = tenant.can("invoices:read");
  if (!sales && !finance) return <NoAccess title="Metrics" />;
  const requested = (await searchParams).days;
  const period = typeof requested === "string" && requested in PERIODS ? (requested as keyof typeof PERIODS) : "90";
  const to = new Date();
  const from = new Date(to.getTime() - Number(period) * 86_400_000);
  const m = await metrics(tenantData, tenant.organization.id, { from, to });
  const locale = tenant.organization.locale;
  const visible = Object.entries(m.counts).filter(([name]) =>
    name.startsWith("lead") || name === "opportunity_won" || name.startsWith("quote") ? sales : finance,
  );

  return (
    <>
      <header className="topbar">
        <div><p>WORKSPACE</p><h1>Metrics</h1></div>
        <nav className="row-buttons" aria-label="Period">
          {Object.entries(PERIODS).map(([value, label]) => (
            <Link key={value} href={`/app/metrics?days=${value}`} className={value === period ? "new-button link-as-button" : "link-button"} aria-current={value === period ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <section className="panel contacts-panel" aria-label="Conversion">
        <div className="panel-heading"><div><h3>Conversion</h3><p>{PERIODS[period]}. Each rate follows the records that started in the period.</p></div></div>
        <ul className="contact-list">
          {sales ? (
            <>
              <li><div><strong>Lead to quote: {percent(m.leadToQuote.rate)}</strong><small>{m.leadToQuote.quoted} of {m.leadToQuote.leads} new leads got a quote · average {days(m.leadToQuote.averageDays)}</small></div></li>
              <li><div><strong>Quote acceptance: {percent(m.quoteAcceptance.rate)}</strong><small>{m.quoteAcceptance.accepted} of {m.quoteAcceptance.sent} quotes sent were accepted</small></div></li>
            </>
          ) : null}
          {finance ? (
            <>
              <li><div><strong>Quote to payment: {percent(m.quoteToPayment.rate)}</strong><small>{m.quoteToPayment.paid} of {m.quoteToPayment.accepted} accepted quotes are invoiced and paid in full</small></div></li>
              <li><div><strong>Time to payment: {days(m.timeToPayment.averageDays)}</strong><small>From issue to the last payment, over {m.timeToPayment.paidInvoices} invoices sent and paid in full</small></div></li>
              <li>
                <div>
                  <strong>Reminders followed by payment: {percent(m.reminders.rate)}</strong>
                  <small>
                    {m.reminders.followedByPayment} of {m.reminders.sent} reminders · collected within {ATTRIBUTION_DAYS} days after a reminder:{" "}
                    {m.reminders.collected.length ? m.reminders.collected.map((c) => formatMoney(money(c.amountMinor, c.currency), locale)).join(", ") : "nothing yet"}
                  </small>
                  <small>A payment counts if it arrived within {ATTRIBUTION_DAYS} days after a reminder. It may have been coming anyway: this shows timing, not cause.</small>
                </div>
              </li>
              <li><div><strong>Outstanding receivables</strong><small>By currency and age, with base-currency totals: <Link href="/app/receivables">Collections</Link></small></div></li>
            </>
          ) : null}
        </ul>
      </section>
      <section className="panel" aria-label="Events">
        <div className="panel-heading"><div><h3>What happened</h3><p>{PERIODS[period]}.</p></div></div>
        <table className="aging">
          <thead><tr><th>Event</th><th className="num">Count</th></tr></thead>
          <tbody>
            {visible.map(([name, count]) => <tr key={name}><td>{LABELS[name] ?? name}</td><td className="num">{count}</td></tr>)}
          </tbody>
        </table>
      </section>
    </>
  );
}
