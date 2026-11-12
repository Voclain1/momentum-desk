import { z } from "zod";
import { formatScaled, HUNDRED_PERCENT, parseScaled } from "@/lib/documents/calc";
import { fromDecimalString, InvalidAmountError } from "@/lib/money";
import { currencyCode } from "@/lib/organizations/settings";
import { optional, text } from "@/lib/validation/fields";

export { fieldErrors } from "@/lib/validation/fields";

/** "7.5" → 7500 thousandths of a percent; at most 3 decimals, 0–100 (D12). */
export const percent = z
  .string()
  .trim()
  .min(1, { error: "is required" })
  .transform((value, ctx) => {
    const scaled = parseScaled(value.replace(/%$/, "").trim(), 3);
    if (scaled === null || scaled > HUNDRED_PERCENT) {
      ctx.addIssue({ code: "custom", message: "must be a percentage from 0 to 100, with up to 3 decimals" });
      return z.NEVER;
    }
    return Number(scaled);
  });

export const formatPercent = (milliPercent: number | bigint) => formatScaled(BigInt(milliPercent), 3);

export const taxRateInputSchema = z.strictObject({
  name: z.string().trim().min(1, { error: "is required" }).max(100),
  rate: percent,
});

export type TaxRateInput = z.output<typeof taxRateInputSchema>;

const priceSchema = z
  .strictObject({ currency: currencyCode, unitPrice: z.string().trim().min(1, { error: "is required" }).max(30) })
  .transform((price, ctx) => {
    try {
      const amount = fromDecimalString(price.unitPrice.replaceAll(",", ""), price.currency);
      if (amount.amountMinor < 0n) {
        ctx.addIssue({ code: "custom", path: ["unitPrice"], message: "cannot be negative" });
        return z.NEVER;
      }
      return { currency: amount.currency as string, unitPriceMinor: amount.amountMinor };
    } catch (error) {
      if (!(error instanceof InvalidAmountError)) throw error;
      ctx.addIssue({
        code: "custom",
        path: ["unitPrice"],
        message: /decimal place/.test(error.message)
          ? `has too many decimal places for ${price.currency}`
          : "must be an amount such as 1500 or 1500.50",
      });
      return z.NEVER;
    }
  });

/** Product input (spec §7.4); prices are per currency, at most one each (D13). */
export const productInputSchema = z
  .strictObject({
    name: z.string().trim().min(1, { error: "is required" }).max(200),
    description: text(2000),
    sku: text(64),
    unit: text(30),
    category: text(100),
    taxRateId: optional(z.string().trim().min(1).max(64)),
    prices: z.array(priceSchema).max(30, { error: "at most 30 prices" }).default([]),
  })
  .superRefine((product, ctx) => {
    const seen = new Set<string>();
    for (const price of product.prices) {
      if (seen.has(price.currency)) ctx.addIssue({ code: "custom", path: ["prices"], message: `has ${price.currency} twice` });
      seen.add(price.currency);
    }
  });

export type ProductInput = z.output<typeof productInputSchema>;
