import type { Metadata } from "next";
import Link from "next/link";
import { addDays, todayIn } from "@/lib/dates";
import { quotesReadyToInvoice } from "@/lib/invoices/service";
import { invoiceSettings } from "@/lib/invoices/settings";
import { formatMoney, money } from "@/lib/money";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { NoAccess } from "../../_components/no-access";
import { newLine } from "../../quotes/builder-values";
import { builderOptions } from "../../quotes/page-data";
import { QuoteBuilder } from "../../quotes/quote-builder";
import { createInvoiceAction, invoiceQuoteAction } from "../actions";
import { StepButton } from "../panels";

export const metadata: Metadata = { title: "New invoice — MomentumDesk" };

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function NewInvoicePage({ searchParams }: PageProps<"/app/invoices/new">) {
  const tenant = await requireTenant("workspace:read");
  if (!tenant.can("invoices:write")) return <NoAccess title="New invoice" />;
  const params = await searchParams;
  const { organization } = tenant;
  const [options, ready, settings] = await Promise.all([
    builderOptions(organization.id),
    quotesReadyToInvoice(tenantData, organization.id),
    invoiceSettings(tenantData, organization.id),
  ]);
  const customer = options.customers.find((c) => c.id === one(params.customer));
  const today = todayIn(organization.timezone);

  return (
    <>
      <header className="topbar">
        <div>
          <p><Link href="/app/invoices" className="crumb">INVOICES</Link></p>
          <h1>New invoice</h1>
        </div>
      </header>
      {ready.length ? (
        <section className="panel contacts-panel ready-quotes" aria-label="Accepted quotes to invoice">
          <div className="panel-heading">
            <div>
              <h3>Accepted quotes to invoice</h3>
              <p>The invoice copies the accepted lines and amounts exactly; they cannot be changed on it.</p>
            </div>
          </div>
          <ul className="contact-list">
            {ready.map((quote) => (
              <li key={quote.id}>
                <div>
                  <strong>{quote.number}{quote.revision > 1 ? ` rev ${quote.revision}` : ""} — {quote.customer.displayName}</strong>
                  <small>{formatMoney(money(quote.totalMinor, quote.currency), organization.locale)}</small>
                </div>
                <div className="row-buttons">
                  <StepButton action={invoiceQuoteAction.bind(null, quote.id)} label={`Invoice ${quote.number}`} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="settings-page">
        <div className="panel settings-panel wide">
          <h3>Or invoice directly</h3>
          <QuoteBuilder
            kind="invoice"
            action={createInvoiceAction}
            options={options}
            locale={organization.locale}
            submitLabel="Save draft"
            initial={{
              customerId: customer?.id ?? "",
              recipientContactId: customer?.contacts[0]?.id ?? "",
              leadId: "",
              currency: customer?.preferredCurrency ?? organization.defaultInvoiceCurrency ?? organization.baseCurrency,
              taxMode: "exclusive",
              issuedOn: today,
              endsOn: addDays(today, settings.defaultDueDays),
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
