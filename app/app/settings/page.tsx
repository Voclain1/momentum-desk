import type { Metadata } from "next";
import { formatPercent } from "@/lib/catalogue/schema";
import { listTaxRates } from "@/lib/catalogue/service";
import { settingsOptions } from "@/lib/organizations/options";
import { invoiceNumbering } from "@/lib/invoices/service";
import { invoiceSettings } from "@/lib/invoices/settings";
import { quoteNumbering } from "@/lib/quotes/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { SettingsForm } from "./settings-form";
import { updateInvoiceNumberingAction, updateInvoiceSettingsAction } from "../invoices/actions";
import { updateNumberingAction } from "../quotes/actions";
import { InvoiceSettingsPanel } from "./invoice-settings";
import { QuoteNumbering } from "./quote-numbering";
import { TaxRates } from "./tax-rates";

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
        <InvoiceSettingsPanel
          canEdit={canEdit}
          action={updateInvoiceSettingsAction}
          initial={{ paymentInstructions: invoiceDefaults.paymentInstructions ?? "", defaultDueDays: invoiceDefaults.defaultDueDays }}
        />
      </section>
    </>
  );
}
