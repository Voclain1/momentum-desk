import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { dateValue } from "@/lib/dates";
import { divRound, formatScaled, parseScaled } from "@/lib/documents/calc";
import { InputValidationError } from "@/lib/errors";
import { currencyExponent, isCurrencyCode } from "@/lib/money";
import type { TenantData, TenantDb } from "@/lib/tenant/core";
import { calendarDate } from "@/lib/validation/fields";

/**
 * Exchange rates for base-currency reporting (spec §5.4–5.5, decision D38).
 * A rate says 1 unit of `quote` is worth `rate` units of `base`. Rates come
 * from the rate provider or from owners and admins; a staff rate wins on the
 * same date. Conversion is exact integer arithmetic, rounded half away from
 * zero once, to the base currency's minor unit. A missing rate is reported
 * as missing: nothing is converted with a guess. Documents keep their own
 * currency and amounts; conversion is for reports only.
 */

export const RATE_DECIMALS = 12;
const SCALE = 10n ** BigInt(RATE_DECIMALS);
/** A rate older than this (before the date it is used for) is shown as stale. */
export const STALE_AFTER_DAYS = 7;

/** "1580.25" → scaled integer (×10¹²); null if not a positive decimal with at most 12 places. */
export function parseRate(value: string): bigint | null {
  const scaled = parseScaled(value.trim(), RATE_DECIMALS);
  return scaled !== null && scaled > 0n ? scaled : null;
}

export const formatRate = (scaled: bigint) => formatScaled(scaled, RATE_DECIMALS);

/** Converts minor units of `from` into minor units of `to` at a scaled rate (1 `from` = rate `to`). */
export function convertMinor(amountMinor: bigint, from: string, to: string, rateScaled: bigint): bigint {
  if (!isCurrencyCode(from) || !isCurrencyCode(to)) throw new Error("Unknown currency");
  const up = 10n ** BigInt(currencyExponent(to));
  const down = 10n ** BigInt(currencyExponent(from));
  return divRound(amountMinor * rateScaled * up, SCALE * down);
}

export interface RateUsed {
  rateScaled: bigint;
  rate: string;
  source: string;
  effectiveOn: Date;
  /** Older than STALE_AFTER_DAYS before the date asked for. */
  stale: boolean;
}

/** The rate to use on `on`: the latest on or before it, a staff rate first on the same day. */
export async function rateFor(tenant: TenantDb, base: string, quote: string, on: Date): Promise<RateUsed | null> {
  const candidates = await tenant.exchangeRate.findMany({
    where: { base, quote, effectiveOn: { lte: on } },
    orderBy: [{ effectiveOn: "desc" }, { createdAt: "desc" }],
    take: 10,
  });
  if (!candidates.length) return null;
  const day = candidates[0].effectiveOn.getTime();
  const sameDay = candidates.filter((c) => c.effectiveOn.getTime() === day);
  const chosen = sameDay.find((c) => c.source === "manual") ?? sameDay[0];
  const rateScaled = parseRate(chosen.rate.toFixed(RATE_DECIMALS))!;
  return {
    rateScaled,
    rate: formatRate(rateScaled),
    source: chosen.source,
    effectiveOn: chosen.effectiveOn,
    stale: on.getTime() - chosen.effectiveOn.getTime() > STALE_AFTER_DAYS * 86_400_000,
  };
}

const manualSchema = z.strictObject({
  quote: z.string().refine(isCurrencyCode, { error: "must be a supported ISO 4217 currency code" }),
  rate: z.string().trim().min(1, { error: "is required" }).max(40),
  effectiveOn: calendarDate.pipe(z.date({ error: "is required" })),
});

/** A rate entered by an owner or admin (settings:write); it wins over the provider's on that date. */
export async function addManualRate(data: TenantData, actor: { organizationId: string; userId: string }, base: string, input: unknown, today: string) {
  const parsed = manualSchema.safeParse(input);
  if (!parsed.success) throw new InputValidationError(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const { quote, rate, effectiveOn } = parsed.data;
  const errors: Record<string, string> = {};
  const scaled = parseRate(rate.replaceAll(",", ""));
  if (scaled === null) errors.rate = "must be a positive number with up to 12 decimal places";
  if (quote === base) errors.quote = "must differ from the base currency";
  if (effectiveOn > dateValue(today)) errors.effectiveOn = "cannot be in the future";
  if (Object.keys(errors).length) throw new InputValidationError(errors);
  return data.transaction(actor.organizationId, async (tenant) => {
    const existing = await tenant.exchangeRate.findFirst({ where: { base, quote, effectiveOn, source: "manual" } });
    if (existing) throw new InputValidationError({ effectiveOn: "already has a rate you entered; add one for another date" });
    const row = await tenant.exchangeRate.create({
      data: { base, quote, rate: formatRate(scaled!), source: "manual", effectiveOn, enteredById: actor.userId },
    });
    await recordAudit(tenant, {
      action: "fx.rate_added",
      actorUserId: actor.userId,
      targetType: "organization",
      targetId: actor.organizationId,
      metadata: { base, quote, rate: formatRate(scaled!), effectiveOn: effectiveOn.toISOString().slice(0, 10) },
    });
    return row;
  });
}

export async function listRates(data: TenantData, organizationId: string, base: string) {
  return data.scoped(organizationId).exchangeRate.findMany({
    where: { base },
    orderBy: [{ effectiveOn: "desc" }, { quote: "asc" }],
    take: 60,
    include: { enteredBy: { select: { name: true } } },
  });
}
