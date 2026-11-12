import type { Metadata } from "next";
import Link from "next/link";
import { addDays, todayIn } from "@/lib/dates";
import { RecordNotFoundError } from "@/lib/errors";
import { leadName } from "@/lib/leads/labels";
import { getLead } from "@/lib/leads/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../../_components/no-access";
import { createQuoteAction } from "../actions";
import { builderOptions } from "../page-data";
import { newLine } from "../builder-values";
import { QuoteBuilder } from "../quote-builder";

export const metadata: Metadata = { title: "New quote — MomentumDesk" };

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function NewQuotePage({ searchParams }: PageProps<"/app/quotes/new">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("quotes:write")) return <NoAccess title="New quote" />;
  const params = await searchParams;
  const { organization } = tenant;
  const options = await builderOptions(organization.id);

  // From a lead: quote its customer, keeping the link (spec §7.2 → §7.5).
  let lead: Awaited<ReturnType<typeof getLead>> | null = null;
  const leadId = one(params.lead);
  if (leadId && tenant.can("sales:read")) {
    try {
      lead = await getLead(tenantData, organization.id, leadId);
    } catch (error) {
      if (!(error instanceof RecordNotFoundError)) throw error;
    }
  }
  if (lead && !lead.customerId) {
    return (
      <>
        <header className="topbar"><div><p><Link href="/app/quotes" className="crumb">QUOTES</Link></p><h1>New quote</h1></div></header>
        <section className="panel no-access" role="note">
          <strong>Convert this lead to a customer first.</strong>
          <p>
            Quotes are addressed to customers. Open <Link href={`/app/leads/${lead.id}`}>{leadName(lead)}</Link> and use
            &ldquo;Convert to customer&rdquo;; the quote will stay linked to the lead.
          </p>
        </section>
      </>
    );
  }
  const customerId = lead?.customerId ?? one(params.customer) ?? "";
  const customer = options.customers.find((c) => c.id === customerId);
  const today = todayIn(organization.timezone);

  return (
    <>
      <header className="topbar">
        <div>
          <p><Link href="/app/quotes" className="crumb">QUOTES</Link>{lead ? ` · FOR LEAD ${leadName(lead).toUpperCase()}` : ""}</p>
          <h1>New quote</h1>
        </div>
      </header>
      <section className="settings-page">
        <div className="panel settings-panel wide">
          <QuoteBuilder
            action={createQuoteAction}
            options={options}
            locale={organization.locale}
            submitLabel="Save draft"
            initial={{
              customerId: customer?.id ?? "",
              recipientContactId: customer?.contacts[0]?.id ?? "",
              leadId: lead?.id ?? "",
              currency: customer?.preferredCurrency ?? organization.defaultInvoiceCurrency ?? organization.baseCurrency,
              taxMode: "exclusive",
              issuedOn: today,
              endsOn: addDays(today, 30),
              notes: "",
              terms: "",
              lines: [newLine()],
            }}
          />
        </div>
      </section>
    </>
  );
}
