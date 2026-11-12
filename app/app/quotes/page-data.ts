import { listProducts, listTaxRates } from "@/lib/catalogue/service";
import { formatPercent } from "@/lib/catalogue/schema";
import { customerChoices } from "@/lib/customers/service";
import { money, toDecimalString } from "@/lib/money";
import { settingsOptions } from "@/lib/organizations/options";
import { tenantData } from "@/lib/tenant";
import type { BuilderOptions } from "./quote-builder";

/** What the builder offers: customers, active products with their prices, active tax rates, currencies. */
export async function builderOptions(organizationId: string, keep: { taxRates?: { id: string; name: string; milliPercent: number }[] } = {}): Promise<BuilderOptions> {
  const [customers, rates] = await Promise.all([customerChoices(tenantData, organizationId), listTaxRates(tenantData, organizationId)]);
  const products = [];
  for (let page = 1; ; page++) {
    const result = await listProducts(tenantData, organizationId, { page });
    products.push(...result.items);
    if (page >= result.pageCount) break;
  }
  const taxRates = rates.map((rate) => ({ id: rate.id, name: rate.name, milliPercent: rate.milliPercent }));
  // Rates archived since they were put on this draft stay selectable on it.
  for (const rate of keep.taxRates ?? []) if (!taxRates.some((r) => r.id === rate.id)) taxRates.push(rate);
  return {
    customers: customers.map((c) => ({
      id: c.id, name: c.displayName, email: c.email, preferredCurrency: c.preferredCurrency,
      contacts: c.contacts.map((contact) => ({ id: contact.id, name: contact.name, email: contact.email })),
    })),
    products: products.map((p) => ({
      id: p.id, name: p.name, description: p.description, unit: p.unit, taxRateId: p.taxRateId,
      prices: Object.fromEntries(p.prices.map((price) => [price.currency, toDecimalString(money(price.unitPriceMinor, price.currency))])),
    })),
    taxRates: taxRates.map((rate) => ({ ...rate, label: `${rate.name} (${formatPercent(rate.milliPercent)}%)` })),
    currencies: settingsOptions().currencies,
  };
}
