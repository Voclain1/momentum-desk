import type { Metadata } from "next";
import { formatPercent } from "@/lib/catalogue/schema";
import { listTaxRates } from "@/lib/catalogue/service";
import { settingsOptions } from "@/lib/organizations/options";
import { headers } from "next/headers";
import { invoiceNumbering } from "@/lib/invoices/service";
import { listConnections } from "@/lib/payments/connections";
import { PROVIDERS } from "@/lib/payments/providers";
import { providerSecretsConfigured } from "@/lib/payments/server";
import { publicOrigin } from "@/lib/email/server";
import { invoiceSettings } from "@/lib/invoices/settings";
import { quoteNumbering } from "@/lib/quotes/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { SettingsForm } from "./settings-form";
import { updateInvoiceNumberingAction, updateInvoiceSettingsAction } from "../invoices/actions";
import { updateNumberingAction } from "../quotes/actions";
import { InvoiceSettingsPanel } from "./invoice-settings";
import { connectProviderAction, disconnectProviderAction } from "./provider-actions";
import { ProvidersPanel } from "./providers-panel";
import { QuoteNumbering } from "./quote-numbering";
import { TaxRates } from "./tax-rates";
import { FailedJobsPanel, RatesPanel, RemindersPanel } from "./collections-panels";
import { reminderSettings } from "@/lib/reminders/service";
import { listRates } from "@/lib/fx/rates";
import { deadJobs } from "@/lib/jobs/admin";
import { parseEnv } from "@/lib/env";
import { todayIn } from "@/lib/dates";

export const metadata: Metadata = { title: "Workspace settings — MomentumDesk" };

export default async function SettingsPage() {
  const tenant = await requireTenant("workspace:read");
  const { organization } = tenant;
  const canEdit = tenant.can("settings:write");
  const [taxRates, numbering, invoiceNumbers, invoiceDefaults] = await Promise.all([
    listTaxRates(tenantData, organization.id, { includeArchived: canEdit }),
    quoteNumbering(tenantData, organization.id),
    invoiceNumbering(tenantData, organization.id),
    invoiceSettings(tenantData, organization.id),
  ]);
  const [reminders, rates, failed] = await Promise.all([
    reminderSettings(tenantData, organization.id),
    listRates(tenantData, organization.id, organization.baseCurrency),
    canEdit ? deadJobs(tenantData, organization.id) : Promise.resolve([]),
  ]);
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const canSeeProviders = tenant.can("providers:manage");
  const connections = canSeeProviders ? await listConnections(tenantData, organization.id) : [];
  const h = await headers();
  const origin = publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost"}`);
  const NOTES: Record<string, string> = {
    paystack: "Businesses registered in Nigeria, Ghana, Kenya or South Africa. Uses your secret key to check webhooks.",
    stripe: "Businesses in the UK, US, EU and other Stripe countries. Card payments through Stripe Checkout.",
    bachs: "Cards (USD), African mobile money and more. Confirm in Bachs's sandbox before taking live payments.",
  };
  const baseCurrencyName =
    new Intl.DisplayNames(["en"], { type: "currency" }).of(organization.baseCurrency) ?? organization.baseCurrency;

  return (
    <>
      <header className="topbar">
        <div>
          <p>WORKSPACE</p>
          <h1>Settings</h1>
        </div>
      </header>
      <section className="settings-page">
        <div className="panel settings-panel">
          <div className="settings-locked">
            <span>Base currency</span>
            <strong>
              {baseCurrencyName} ({organization.baseCurrency})
            </strong>
            <small>
              Reports and dashboard totals use this currency. It is fixed once the workspace exists, so
              historical reports keep their meaning.
            </small>
          </div>
          {canEdit ? null : (
            <p className="settings-readonly" role="note">
              Only owners and admins can change these settings.
            </p>
          )}
          <SettingsForm
            canEdit={canEdit}
            version={organization.settingsVersion}
            initial={{
              name: organization.name,
              countryCode: organization.countryCode,
              locale: organization.locale,
              timezone: organization.timezone,
              defaultLanguage: organization.defaultLanguage,
              defaultInvoiceCurrency: organization.defaultInvoiceCurrency ?? "",
            }}
            {...settingsOptions()}
          />
        </div>
        <TaxRates
          canEdit={canEdit}
          rates={taxRates.map((rate) => ({
            id: rate.id, name: rate.name, rate: formatPercent(rate.milliPercent), archived: Boolean(rate.archivedAt),
          }))}
        />
        <QuoteNumbering initial={numbering} canEdit={canEdit} action={updateNumberingAction} />
        <QuoteNumbering initial={invoiceNumbers} canEdit={canEdit} action={updateInvoiceNumberingAction} noun="invoice" />
        {canSeeProviders ? (
          <ProvidersPanel
            canManage
            configured={providerSecretsConfigured}
            connect={connectProviderAction}
            disconnect={disconnectProviderAction}
            providers={Object.values(PROVIDERS).map((p) => ({
              key: p.key, name: p.name, currencies: [...p.currencies], needsWebhookSecret: p.key !== "paystack", note: NOTES[p.key],
            }))}
            connections={connections.map((c) => ({
              id: c.id, provider: c.provider, name: PROVIDERS[c.provider as keyof typeof PROVIDERS]?.name ?? c.provider,
              mode: c.mode, keyHint: c.keyHint, currencies: c.currencies,
              webhookUrl: new URL(`/api/webhooks/${c.provider}/${c.id}`, origin).toString(),
            }))}
          />
        ) : null}
        <InvoiceSettingsPanel
          canEdit={canEdit}
          action={updateInvoiceSettingsAction}
          initial={{ paymentInstructions: invoiceDefaults.paymentInstructions ?? "", defaultDueDays: invoiceDefaults.defaultDueDays }}
        />
        <RemindersPanel canEdit={canEdit} enabled={reminders.enabled} minGapDays={reminders.minGapDays} steps={reminders.steps.map((s) => ({ offsetDays: s.offsetDays, tone: s.tone }))} />
        <RatesPanel
          canEdit={canEdit}
          base={organization.baseCurrency}
          today={todayIn(organization.timezone)}
          providerConfigured={Boolean(parseEnv(process.env).FX_PROVIDER_KEY)}
          rates={rates.map((r) => ({
            id: r.id, quote: r.quote, rate: r.rate.toString(), effectiveOn: isoDay(r.effectiveOn), source: r.source, enteredBy: r.enteredBy?.name ?? null,
          }))}
        />
        <FailedJobsPanel jobs={failed.map((j) => ({ id: j.id, kind: j.kind, key: j.key, lastError: j.lastError, finishedAt: j.finishedAt ? j.finishedAt.toISOString().slice(0, 16).replace("T", " ") : null }))} />
      </section>
    </>
  );
}
