import { listTaxRates } from "@/lib/catalogue/service";
import { formatPercent } from "@/lib/catalogue/schema";
import { settingsOptions } from "@/lib/organizations/options";
import { tenantData } from "@/lib/tenant";

/** Choices for the product form: currencies and the workspace's active tax rates. */
export async function productFormData(organizationId: string, keepTaxRate?: { id: string; name: string; milliPercent: number } | null) {
  const rates = await listTaxRates(tenantData, organizationId);
  const options = rates.map((rate) => ({ value: rate.id, label: `${rate.name} (${formatPercent(rate.milliPercent)}%)` }));
  // An archived default stays selectable on the product that already uses it.
  if (keepTaxRate && !rates.some((rate) => rate.id === keepTaxRate.id)) {
    options.push({ value: keepTaxRate.id, label: `${keepTaxRate.name} (${formatPercent(keepTaxRate.milliPercent)}%, archived)` });
  }
  return { currencies: settingsOptions().currencies, taxRates: options };
}
