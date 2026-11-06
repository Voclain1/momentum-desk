import type { Metadata } from "next";
import Link from "next/link";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../../_components/no-access";
import { createLeadAction } from "../actions";
import { LeadForm } from "../lead-form";
import { leadFormData } from "../page-data";

export const metadata: Metadata = { title: "New lead — MomentumDesk" };

export default async function NewLeadPage({ searchParams }: PageProps<"/app/leads/new">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("sales:write")) return <NoAccess title="New lead" />;
  const { organization, user } = tenant;
  const options = await leadFormData(organization.id);
  const { stage } = await searchParams;
  const stageId = options.stages.some((s) => s.id === stage) ? String(stage) : options.stages[0].id;
  return (
    <>
      <header className="topbar">
        <div>
          <p><Link href="/app/leads" className="crumb">LEADS</Link></p>
          <h1>New lead</h1>
        </div>
      </header>
      <section className="settings-page">
        <div className="panel settings-panel wide">
          <LeadForm
            action={createLeadAction}
            canEdit
            submitLabel="Add lead"
            {...options}
            initial={{
              contactName: "", companyName: "", email: "", phone: "", source: "", ownerUserId: user.id, stageId,
              estimatedValue: "", currency: organization.defaultInvoiceCurrency ?? organization.baseCurrency,
              summary: "", nextFollowUpOn: "", tags: "", notes: "", lostReason: "",
            }}
          />
        </div>
      </section>
    </>
  );
}
