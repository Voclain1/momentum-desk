import type { Prisma } from "@/lib/generated/prisma/client";
import type { Http } from "@/lib/payments/providers";
import type { TenantData } from "@/lib/tenant/core";
import { formatRate, parseRate } from "./rates";
import { divRound } from "@/lib/documents/calc";
import { dateValue } from "@/lib/dates";

/**
 * Daily exchange rates from a provider (decision D38). Open Exchange Rates
 * by default: rates per US dollar, from which any cross rate is derived
 * exactly from the published decimal strings (no floating point).
 */

export interface RateTable {
  /** Units of each currency per 1 US dollar, as decimal strings. */
  perUsd: Record<string, string>;
}

export const OPEN_EXCHANGE_RATES = "openexchangerates";

export async function fetchOpenExchangeRates(appId: string, http: Http): Promise<RateTable> {
  const response = await http(`https://openexchangerates.org/api/latest.json?app_id=${encodeURIComponent(appId)}`, { method: "GET", headers: {} });
  const body = (await response.json()) as { rates?: Record<string, number>; description?: string };
  if (response.status >= 400 || !body.rates) throw new Error(`Exchange rate provider refused the request${body.description ? `: ${body.description}` : ""}`);
  // JSON numbers read back as their shortest decimal form; exact enough for 12 places.
  return { perUsd: Object.fromEntries(Object.entries(body.rates).map(([code, value]) => [code, String(value)])) };
}

/** 1 `quote` in `base`, scaled ×10¹², from per-dollar rates; null if either is missing. */
export function crossRate(table: RateTable, base: string, quote: string): bigint | null {
  const toFixed = (value: string | undefined) => (value === undefined ? null : parseRate(Number(value).toFixed(12)));
  const perUsdBase = toFixed(table.perUsd[base]);
  const perUsdQuote = toFixed(table.perUsd[quote]);
  if (!perUsdBase || !perUsdQuote) return null;
  return divRound(perUsdBase * 10n ** 12n, perUsdQuote);
}

/**
 * Stores today's provider rates for the currencies a workspace has invoices
 * in (the fx.refresh job). Idempotent per day. Skips quietly when no
 * provider key is configured: staff rates still work.
 */
export async function refreshRates(
  data: TenantData,
  organizationId: string,
  { day, base, fetchTable }: { day: string; base: string; fetchTable: (() => Promise<RateTable>) | null },
) {
  if (!fetchTable) return { stored: 0, skipped: "no provider key" as const };
  const invoices = await data.scoped(organizationId).invoice.findMany({
    where: { status: "issued", currency: { not: base } },
    distinct: ["currency"],
    select: { currency: true },
  });
  if (!invoices.length) return { stored: 0 };
  const table = await fetchTable();
  const rows: Omit<Prisma.ExchangeRateCreateManyInput, "organizationId">[] = [];
  for (const { currency } of invoices) {
    const rate = crossRate(table, base, currency);
    if (rate) rows.push({ base, quote: currency, rate: formatRate(rate), source: OPEN_EXCHANGE_RATES, effectiveOn: dateValue(day) });
  }
  await data.transaction(organizationId, (tenant) =>
    tenant.exchangeRate.createMany({ data: rows, skipDuplicates: true }),
  );
  return { stored: rows.length };
}
