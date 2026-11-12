import { z } from "zod";
import { currencyCode } from "@/lib/organizations/settings";
import { calendarDate, optional, text } from "@/lib/validation/fields";

/**
 * Quote input from the builder (spec §7.5). Amounts and quantities arrive as
 * decimal strings and are parsed exactly by the service in the quote's
 * currency (decision D12); nothing here rounds.
 */

export const TAX_MODES = ["exclusive", "inclusive"] as const;
export const DISCOUNT_KINDS = ["none", "percent", "fixed"] as const;
export const MAX_LINES = 200;

const id = optional(z.string().trim().min(1).max(64));
const required = (what: z.ZodString) => what.trim().min(1, { error: "is required" });

export const lineInputSchema = z.strictObject({
  productId: id,
  description: required(z.string()).max(2000),
  quantity: required(z.string()).max(20),
  unit: text(30),
  unitPrice: required(z.string()).max(30),
  discountKind: z.enum(DISCOUNT_KINDS, { error: "must be none, percent or fixed" }).default("none"),
  discount: z.string().trim().max(30).default(""),
  taxRateId: id,
});

export type LineInput = z.output<typeof lineInputSchema>;

export const quoteInputSchema = z
  .strictObject({
    customerId: required(z.string()).max(64),
    leadId: id,
    recipientContactId: id,
    currency: currencyCode,
    taxMode: z.enum(TAX_MODES, { error: "must be exclusive or inclusive" }),
    issuedOn: calendarDate.pipe(z.date({ error: "is required" })),
    expiresOn: calendarDate.pipe(z.date({ error: "is required" })),
    notes: text(5000),
    terms: text(5000),
    lines: z
      .array(z.unknown())
      .min(1, { error: "needs at least one line" })
      .max(MAX_LINES, { error: `can have at most ${MAX_LINES} lines` }),
  })
  .superRefine((quote, ctx) => {
    if (quote.expiresOn < quote.issuedOn) {
      ctx.addIssue({ code: "custom", path: ["expiresOn"], message: "cannot be before the issue date" });
    }
  });

export type QuoteInput = z.output<typeof quoteInputSchema>;

export const numberingInputSchema = z.strictObject({
  prefix: z.string().max(12, { error: "must be at most 12 characters" }).regex(/^[A-Za-z0-9\-_/.# ]*$/, {
    error: "can use letters, digits, spaces and - _ / . #",
  }),
  nextNumber: z.coerce.number({ error: "must be a whole number" }).int({ error: "must be a whole number" }).min(1).max(999_999_999),
  padding: z.coerce.number({ error: "must be a whole number" }).int({ error: "must be a whole number" }).min(1).max(10),
});
