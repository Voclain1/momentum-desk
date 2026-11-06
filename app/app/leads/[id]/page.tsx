import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordNotFoundError } from "@/lib/errors";
import { leadName } from "@/lib/leads/labels";
import { getLead } from "@/lib/leads/service";
import { money, toDecimalString } from "@/lib/money";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { ArchiveButton } from "../../customers/[id]/customer-panels";
import { NoAccess } from "../../_components/no-access";
import { setLeadArchivedAction, updateLeadAction } from "../actions";
import { LeadForm } from "../lead-form";
import { leadFormData } from "../page-data";

export const metadata: Metadata = { title: "Lead — MomentumDesk" };

export default async function LeadPage({ params }: PageProps<"/app/leads/[id]">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("sales:read")) return <NoAccess title="Lead" />;
  const { id } = await params;
  const { organization } = tenant;

  let lead;
  try {
    lead = await getLead(tenantData, organization.id, id);
  } catch (error) {
    if (error instanceof RecordNotFoundError) notFound();
    throw error;
  }
  const options = await leadFormData(organization.id);
  const canEdit = tenant.can("sales:write");
  const date = new Intl.DateTimeFormat(organization.locale, { dateStyle: "medium", timeZone: organization.timezone });
  const blank = (value: string | null) => value ?? "";

  return (
    <>
      <header className="topbar">
        <div>
          <p>
            <Link href="/app/leads" className="crumb">LEADS</Link> · {lead.stage.name.toUpperCase()}
            {lead.archivedAt ? " · ARCHIVED" : ""}
          </p>
          <h1>{leadName(lead)}</h1>
        </div>
        {canEdit ? (
          <div className="header-actions">
            <ArchiveButton
              action={setLeadArchivedAction.bind(null, lead.id, !lead.archivedAt)}
              archived={Boolean(lead.archivedAt)}
              noun="lead"
            />
          </div>
        ) : null}
      </header>
      <p className="record-meta">
        Added {date.format(lead.createdAt)}
        {lead.createdBy ? ` by ${lead.createdBy.name}` : ""} · In {lead.stage.name} since {date.format(lead.stageChangedAt)}
        {lead.closedAt ? ` · Closed ${date.format(lead.closedAt)}` : ""}
      </p>
      <section className="settings-page">
        <div className="panel settings-panel wide">
          <LeadForm
            action={updateLeadAction.bind(null, lead.id)}
            version={lead.version}
            canEdit={canEdit}
            submitLabel="Save lead"
            {...options}
            initial={{
              contactName: blank(lead.contactName),
              companyName: blank(lead.companyName),
              email: blank(lead.email),
              phone: blank(lead.phone),
              source: blank(lead.source),
              ownerUserId: blank(lead.ownerUserId),
              stageId: lead.stageId,
              estimatedValue:
                lead.estimatedValueMinor !== null && lead.currency ? toDecimalString(money(lead.estimatedValueMinor, lead.currency)) : "",
              currency: lead.currency ?? organization.defaultInvoiceCurrency ?? organization.baseCurrency,
              summary: blank(lead.summary),
              nextFollowUpOn: lead.nextFollowUpOn?.toISOString().slice(0, 10) ?? "",
              tags: lead.tags.join(", "),
              notes: blank(lead.notes),
              lostReason: blank(lead.lostReason),
            }}
          />
        </div>
      </section>
    </>
  );
}
