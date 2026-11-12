import type { Metadata } from "next";
import Link from "next/link";
import { listTeam } from "@/lib/auth/team";
import { todayIn } from "@/lib/dates";
import { leadName, SOURCE_LABELS } from "@/lib/leads/labels";
import { LEAD_SOURCES, type LeadSource } from "@/lib/leads/schema";
import { LEAD_SORTS, type LeadQuery, listLeads, listStages } from "@/lib/leads/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../_components/no-access";
import { formatValue } from "./page-data";

export const metadata: Metadata = { title: "Leads — MomentumDesk" };

const one = (value: string | string[] | undefined) => (typeof value === "string" && value ? value : undefined);
const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[]) =>
  allowed.includes(value as T) ? (value as T) : undefined;

export default async function LeadsPage({ searchParams }: PageProps<"/app/leads">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("sales:read")) return <NoAccess title="Leads" />;
  const { organization, user } = tenant;

  const params = await searchParams;
  const query: LeadQuery = {
    q: one(params.q),
    stageId: one(params.stage),
    owner: one(params.owner),
    source: oneOf(one(params.source), LEAD_SOURCES) as LeadSource | undefined,
    followUp: oneOf(one(params.followUp), ["overdue", "today", "week"] as const),
    status: oneOf(one(params.status), ["open", "won", "lost", "all"] as const) ?? "open",
    archived: one(params.archived) === "1",
    sort: oneOf(one(params.sort), LEAD_SORTS) ?? "recent",
    page: Number(one(params.page) ?? 1),
  };
  const today = todayIn(organization.timezone);
  const [{ items, total, page, pageCount }, stages, team] = await Promise.all([
    listLeads(tenantData, { organizationId: organization.id, userId: user.id }, query, today),
    listStages(tenantData, organization.id),
    listTeam(organization.id),
  ]);
  const date = new Intl.DateTimeFormat(organization.locale, { dateStyle: "medium", timeZone: "UTC" });

  const href = (changes: Record<string, string | number | undefined>) => {
    const merged: Record<string, string | number | undefined> = {
      q: query.q, stage: query.stageId, owner: query.owner, source: query.source, followUp: query.followUp,
      status: query.status === "open" ? undefined : query.status, archived: query.archived ? "1" : undefined,
      sort: query.sort === "recent" ? undefined : query.sort, page: page === 1 ? undefined : page, ...changes,
    };
    const search = new URLSearchParams(
      Object.entries(merged)
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([key, value]) => [key, String(value)]),
    ).toString();
    return search ? `/app/leads?${search}` : "/app/leads";
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p>SALES</p>
          <h1>{query.archived ? "Archived leads" : "Leads"}</h1>
        </div>
        <div className="header-actions">
          <Link href="/app/pipeline" className="icon-button text-button link-as-button">Board</Link>
          {tenant.can("data:export") ? (
            <>
              {/* A file download, not a page: a plain link. */}
              <a href="/app/leads/export" className="icon-button text-button link-as-button" download>Export</a>
              {tenant.can("sales:write") ? (
                <Link href="/app/import?type=leads" className="icon-button text-button link-as-button">Import</Link>
              ) : null}
            </>
          ) : null}
          {tenant.can("sales:write") ? (
            <Link href="/app/leads/new" className="new-button link-as-button">
              <span aria-hidden>＋</span> New lead
            </Link>
          ) : null}
        </div>
      </header>

      <form className="list-filters" role="search" action="/app/leads">
        <input type="search" name="q" defaultValue={query.q} placeholder="Search name, company, email, need or tag" aria-label="Search leads" />
        <select name="status" defaultValue={query.status} aria-label="Status">
          <option value="open">Open</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="all">All</option>
        </select>
        <select name="stage" defaultValue={query.stageId ?? ""} aria-label="Stage">
          <option value="">Any stage</option>
          {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </select>
        <select name="owner" defaultValue={query.owner ?? ""} aria-label="Owner">
          <option value="">Anyone</option>
          <option value="me">Me</option>
          <option value="unassigned">Unassigned</option>
          {team.filter((m) => m.userId !== user.id).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
        </select>
        <select name="followUp" defaultValue={query.followUp ?? ""} aria-label="Follow-up">
          <option value="">Any follow-up</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Next 7 days</option>
        </select>
        <select name="source" defaultValue={query.source ?? ""} aria-label="Source">
          <option value="">Any source</option>
          {LEAD_SOURCES.map((source) => <option key={source} value={source}>{SOURCE_LABELS[source]}</option>)}
        </select>
        <select name="sort" defaultValue={query.sort} aria-label="Sort">
          <option value="recent">Recently updated</option>
          <option value="followup">Follow-up date</option>
          <option value="created">Newest first</option>
        </select>
        {query.archived ? <input type="hidden" name="archived" value="1" /> : null}
        <button type="submit" className="new-button">Filter</button>
        <Link href={href({ archived: query.archived ? undefined : "1", page: undefined })} className="link-button">
          {query.archived ? "Show active" : "Show archived"}
        </Link>
      </form>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>{total === 1 ? "1 lead" : `${total} leads`}</h3>
            <p>Follow-up dates in {organization.timezone.replaceAll("_", " ")}</p>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="team-empty">No leads match these filters.</p>
        ) : (
          <table className="team-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Stage</th>
                <th>Value</th>
                <th>Owner</th>
                <th>Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {items.map((lead) => {
                const followUp = lead.nextFollowUpOn?.toISOString().slice(0, 10);
                const overdue = Boolean(followUp && followUp < today && lead.stage.kind === "open");
                return (
                  <tr key={lead.id}>
                    <td>
                      <Link href={`/app/leads/${lead.id}`} className="row-link"><strong>{leadName(lead)}</strong></Link>
                      <small>{[lead.source ? SOURCE_LABELS[lead.source as LeadSource] : null, lead.email].filter(Boolean).join(" · ")}</small>
                    </td>
                    <td><span className={`pill stage-${lead.stage.kind}`}>{lead.stage.name}</span></td>
                    <td>{formatValue(lead, organization.locale) ?? "—"}</td>
                    <td>{lead.owner?.name ?? (lead.ownerUserId ? "Former member" : "Unassigned")}</td>
                    <td className={overdue ? "overdue" : undefined}>
                      {lead.nextFollowUpOn ? date.format(lead.nextFollowUpOn) : "—"}
                      {overdue ? <small>Overdue</small> : null}
                    </td>
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
