import type { Metadata } from "next";
import Link from "next/link";
import { todayIn } from "@/lib/dates";
import { formatMoney, money } from "@/lib/money";
import { agingReport, BUCKETS, type Bucket, openReceivables } from "@/lib/receivables/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../_components/no-access";
import { aiAvailable } from "@/lib/ai/server";
import { receivablesSummaryAction } from "../ai/actions";
import { ReceivablesSummaryPanel } from "../ai/panels";

export const metadata: Metadata = { title: "Collections — MomentumDesk" };

const BUCKET_LABELS: Record<Bucket, string> = {
  current: "Not yet due", "1-30": "1–30 days", "31-60": "31–60 days", "61-90": "61–90 days", "90+": "Over 90 days",
};
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function ReceivablesPage({ searchParams }: PageProps<"/app/receivables">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("collections:read")) return <NoAccess title="Collections" />;
  const params = await searchParams;
  const { organization } = tenant;
  const today = todayIn(organization.timezone);
  const bucket = BUCKETS.includes(one(params.bucket) as Bucket) ? (one(params.bucket) as Bucket) : undefined;
  const mine = one(params.owner) === "me";
  const [report, rows] = await Promise.all([
    agingReport(tenantData, organization.id, { today, baseCurrency: organization.baseCurrency }),
    openReceivables(tenantData, organization.id, today, { bucket, ownerUserId: mine ? tenant.user.id : undefined }),
  ]);
  const show = (minor: bigint, currency: string) => formatMoney(money(minor, currency), organization.locale);
  const date = new Intl.DateTimeFormat(organization.locale, { dateStyle: "medium", timeZone: "UTC" });

  return (
    <>
      <header className="topbar">
        <div>
          <p>COLLECTIONS</p>
          <h1>Receivables</h1>
        </div>
      </header>

      {(await aiAvailable(tenant.organization.id)) ? <ReceivablesSummaryPanel summarize={receivablesSummaryAction} /> : null}
      <section className="panel" aria-label="Ageing">
        <div className="panel-heading">
          <div>
            <h3>What customers owe, by age</h3>
            <p>Each currency on its own line; totals in {organization.baseCurrency} use the rates shown.</p>
          </div>
        </div>
        {report.byCurrency.length === 0 ? (
          <p className="team-empty">Nothing is owed. Every issued invoice is paid.</p>
        ) : (
          <table className="team-table aging">
            <thead>
              <tr>
                <th>Currency</th>
                {BUCKETS.map((b) => <th key={b} className="num">{BUCKET_LABELS[b]}</th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.byCurrency.map((row) => (
                <tr key={row.currency}>
                  <td>{row.currency} <small>{row.invoices} {row.invoices === 1 ? "invoice" : "invoices"}</small></td>
                  {BUCKETS.map((b) => <td key={b} className="num">{row.totals[b] ? show(row.totals[b], row.currency) : "—"}</td>)}
                  <td className="num"><strong>{show(row.totals.total, row.currency)}</strong></td>
                </tr>
              ))}
              <tr className="base-row">
                <td>
                  In {organization.baseCurrency}
                  {report.inBase.complete ? null : <small> incomplete</small>}
                </td>
                {BUCKETS.map((b) => <td key={b} className="num">{show(report.inBase.totals[b], organization.baseCurrency)}</td>)}
                <td className="num"><strong>{show(report.inBase.totals.total, organization.baseCurrency)}</strong></td>
              </tr>
            </tbody>
          </table>
        )}
        {report.inBase.rates.length || report.inBase.missing.length ? (
          <div className="rates-used">
            {report.inBase.rates.map((r) => (
              <p key={r.currency}>
                1 {r.currency} = {r.rate} {organization.baseCurrency} ({r.source === "manual" ? "entered by your team" : r.source}, {date.format(r.effectiveOn)})
                {r.stale ? <strong> · older than a week</strong> : null}
              </p>
            ))}
            {report.inBase.missing.length ? (
              <p role="note" className="settings-message error">
                No rate for {report.inBase.missing.join(", ")}: those amounts are left out of the {organization.baseCurrency} totals.
                {tenant.can("settings:write") ? <> Add a rate in <Link href="/app/settings">Settings</Link>.</> : null}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <form className="list-filters" role="search" action="/app/receivables">
        <select name="bucket" defaultValue={bucket ?? ""} aria-label="Age">
          <option value="">All ages</option>
          {BUCKETS.map((b) => <option key={b} value={b}>{BUCKET_LABELS[b]}</option>)}
        </select>
        <select name="owner" defaultValue={mine ? "me" : ""} aria-label="Owner">
          <option value="">Everyone&apos;s</option>
          <option value="me">Mine</option>
        </select>
        <button type="submit" className="new-button">Filter</button>
      </form>

      <section className="panel" aria-label="Open invoices">
        <div className="panel-heading">
          <div><h3>{rows.length === 1 ? "1 open invoice" : `${rows.length} open invoices`}</h3><p>Oldest due first.</p></div>
        </div>
        {rows.length === 0 ? (
          <p className="team-empty">No open invoices match.</p>
        ) : (
          <table className="team-table">
            <thead>
              <tr><th>Invoice</th><th>Customer</th><th>Due</th><th>Collection</th><th className="num">Owed</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><Link href={`/app/invoices/${row.id}`} className="row-link"><strong>{row.number}</strong></Link></td>
                  <td>{row.customer.displayName}</td>
                  <td>
                    {date.format(row.dueOn)}
                    <small>{row.daysOverdue ? `${row.daysOverdue} days overdue` : "not yet due"}</small>
                  </td>
                  <td>
                    {row.disputedAt ? <span className="status-pill disputed">Disputed</span> : null}
                    {row.collection?.status === "escalated" ? <span className="status-pill overdue">Escalated</span> : null}
                    {row.collection?.status === "paused" ? <span className="status-pill">Paused</span> : null}
                    {row.promises[0] ? <small>Promised {show(row.promises[0].amountMinor, row.currency)} by {date.format(row.promises[0].promisedOn)}</small> : null}
                    {row.collection?.owner ? <small>Owner: {row.collection.owner.name}</small> : null}
                  </td>
                  <td className="num">{show(row.outstandingMinor, row.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
