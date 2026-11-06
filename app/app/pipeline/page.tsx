import type { Metadata } from "next";
import Link from "next/link";
import { todayIn } from "@/lib/dates";
import { leadName } from "@/lib/leads/labels";
import { BOARD_CARD_LIMIT, getBoard } from "@/lib/leads/service";
import { formatMoney, money } from "@/lib/money";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../_components/no-access";
import { formatValue } from "../leads/page-data";
import { MoveSelect } from "./move-select";

export const metadata: Metadata = { title: "Pipeline — MomentumDesk" };

export default async function PipelinePage() {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("sales:read")) return <NoAccess title="Pipeline" />;
  const { organization } = tenant;
  const board = await getBoard(tenantData, organization.id);
  const canEdit = tenant.can("sales:write");
  const today = todayIn(organization.timezone);
  const date = new Intl.DateTimeFormat(organization.locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const stages = board.map(({ stage }) => ({ id: stage.id, name: stage.name }));

  return (
    <>
      <header className="topbar">
        <div>
          <p>SALES</p>
          <h1>Pipeline</h1>
        </div>
        <div className="header-actions">
          <Link href="/app/leads" className="icon-button text-button link-as-button">List</Link>
          {canEdit ? (
            <Link href="/app/leads/new" className="new-button link-as-button"><span aria-hidden>＋</span> New lead</Link>
          ) : null}
        </div>
      </header>
      <p className="record-meta">Totals are per currency: amounts in different currencies are never added together.</p>
      <section className="board" aria-label="Pipeline board">
        {board.map(({ stage, count, totals, leads }) => (
          <section key={stage.id} className={`board-column column-${stage.kind}`} aria-label={stage.name}>
            <header>
              <h3>{stage.name} <span>{count}</span></h3>
              <p className="column-totals">
                {totals.length
                  ? totals.map((total) => formatMoney(money(total.amountMinor, total.currency), organization.locale)).join(" · ")
                  : "No value"}
              </p>
            </header>
            <ol>
              {leads.map((lead) => {
                const name = leadName(lead);
                const followUp = lead.nextFollowUpOn?.toISOString().slice(0, 10);
                const overdue = Boolean(followUp && followUp < today && stage.kind === "open");
                return (
                  <li key={lead.id} className="lead-card">
                    <Link href={`/app/leads/${lead.id}`} className="row-link"><strong>{name}</strong></Link>
                    {formatValue(lead, organization.locale) ? <span className="card-value">{formatValue(lead, organization.locale)}</span> : null}
                    <small>
                      {lead.owner?.name ?? (lead.ownerUserId ? "Former member" : "Unassigned")}
                      {lead.nextFollowUpOn ? (
                        <span className={overdue ? "overdue" : undefined}> · {overdue ? "Overdue " : "Follow up "}{date.format(lead.nextFollowUpOn)}</span>
                      ) : null}
                    </small>
                    {canEdit ? <MoveSelect leadId={lead.id} leadName={name} stageId={stage.id} stages={stages} /> : null}
                  </li>
                );
              })}
            </ol>
            {count > leads.length ? (
              <p className="column-more">
                <Link href={`/app/leads?stage=${stage.id}&status=all`}>Showing {BOARD_CARD_LIMIT} of {count} · see all</Link>
              </p>
            ) : null}
            {canEdit && stage.kind === "open" ? (
              <p className="column-more"><Link href={`/app/leads/new?stage=${stage.id}`}>＋ Add lead</Link></p>
            ) : null}
          </section>
        ))}
      </section>
    </>
  );
}
