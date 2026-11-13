import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordNotFoundError } from "@/lib/errors";
import { leadName } from "@/lib/leads/labels";
import { conversionCandidates } from "@/lib/leads/conversion";
import { getLead } from "@/lib/leads/service";
import { money, toDecimalString } from "@/lib/money";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { ArchiveButton } from "../../customers/[id]/customer-panels";
import { PossibleDuplicates } from "../../_components/duplicates";
import { NoAccess } from "../../_components/no-access";
import { RecordWork } from "../../work/record-work";
import { convertLeadAction, setLeadArchivedAction, updateLeadAction } from "../actions";
import { LeadForm } from "../lead-form";
import { leadFormData } from "../page-data";
import { ConversionPanel } from "./conversion-panel";
import { aiAvailable } from "@/lib/ai/server";
import { leadAssistAction, logLeadActivityAction } from "../../ai/actions";
import { LeadAssistPanel } from "../../ai/panels";

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
  const [options, found] = await Promise.all([leadFormData(organization.id), conversionCandidates(tenantData, organization.id, lead.id)]);
  const canEdit = tenant.can("sales:write");
  const canSeeCustomers = tenant.can("customers:read");
  // Customers only for members who may open them; never the lead's own customer.
  const duplicates = found.filter((d) => (d.type === "lead" || canSeeCustomers) && d.id !== lead.customerId);
  const reasons = (list: string[]) => list.map((reason) => `same ${reason}`).join(", ");
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
            {lead.customerId && tenant.can("quotes:write") ? (
              <Link href={`/app/quotes/new?lead=${lead.id}`} className="new-button link-as-button">＋ New quote</Link>
            ) : null}
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
      <section className="customer-layout">
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
        <div className="record-side">
          <ConversionPanel
            action={convertLeadAction.bind(null, lead.id)}
            canConvert={canEdit && tenant.can("customers:write")}
            converted={
              lead.customer && canSeeCustomers
                ? { ...lead.customer, on: lead.convertedAt ? date.format(lead.convertedAt) : "" }
                : null
            }
            candidates={duplicates
              .filter((d) => d.type === "customer")
              .map((d) => ({ id: d.id, label: d.label, reasons: reasons(d.reasons) }))}
          />
          <PossibleDuplicates duplicates={duplicates} />
        </div>
      </section>
      {canEdit && (await aiAvailable(tenant.organization.id)) ? (
        <LeadAssistPanel
          assist={leadAssistAction.bind(null, lead.id)}
          log={logLeadActivityAction.bind(null, lead.id)}
          contactEmail={lead.email}
        />
      ) : null}
      <RecordWork tenant={tenant} parent={{ type: "lead", id: lead.id }} canWrite={canEdit} />
    </>
  );
}
