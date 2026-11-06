import { z } from "zod";
import { fromDecimalString, InvalidAmountError } from "@/lib/money";
import { currencyCode } from "@/lib/organizations/settings";
import { blankToNull, email, optional, phone, tags, text } from "@/lib/validation/fields";

export { fieldErrors } from "@/lib/validation/fields";

/** Where a lead came from. Stored as the key; labels live in the UI. */
export const LEAD_SOURCES = ["website", "referral", "phone", "email", "walk_in", "social", "event", "partner", "other"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/** A calendar date, "YYYY-MM-DD", that exists (no 31 February). */
const calendarDate = optional(
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "must be a date" })
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
    }, { error: "must be a real date" })
    .transform((value) => new Date(`${value}T00:00:00Z`)),
);

/**
 * Lead input from a form (spec §7.2). The estimated value arrives as a
 * decimal string in major units ("1500.50") with its currency, and leaves as
 * exact minor units (spec §5.3): never a float, never without its currency,
 * never with more decimals than the currency allows.
 */
export const leadInputSchema = z
  .strictObject({
    contactName: text(200),
    companyName: text(200),
    email,
    phone,
    source: optional(z.enum(LEAD_SOURCES, { error: "must be one of the listed sources" })),
    ownerUserId: optional(z.string().trim().min(1).max(64)),
    stageId: z.string().trim().min(1, { error: "is required" }).max(64),
    estimatedValue: z.preprocess(blankToNull, z.string().trim().max(30).nullable().default(null)),
    currency: optional(currencyCode),
    summary: text(2000),
    nextFollowUpOn: calendarDate,
    tags,
    notes: text(5000),
    lostReason: text(500),
  })
  .superRefine((lead, ctx) => {
    if (!lead.contactName && !lead.companyName) {
      ctx.addIssue({ code: "custom", path: ["contactName"], message: "or a company name is required" });
    }
    if (lead.estimatedValue !== null && lead.currency === null) {
      ctx.addIssue({ code: "custom", path: ["currency"], message: "is required with an estimated value" });
    }
  })
  .transform((lead, ctx) => {
    const { estimatedValue, currency, ...rest } = lead;
    if (estimatedValue === null || currency === null) {
      return { ...rest, estimatedValueMinor: null, currency: null };
    }
    try {
      const amount = fromDecimalString(estimatedValue.replaceAll(",", ""), currency);
      if (amount.amountMinor < BigInt(0)) {
        ctx.addIssue({ code: "custom", path: ["estimatedValue"], message: "cannot be negative" });
        return z.NEVER;
      }
      return { ...rest, estimatedValueMinor: amount.amountMinor, currency: amount.currency };
    } catch (error) {
      if (!(error instanceof InvalidAmountError)) throw error;
      ctx.addIssue({
        code: "custom",
        path: ["estimatedValue"],
        message: /decimal place/.test(error.message)
          ? `has too many decimal places for ${currency}`
          : "must be an amount such as 1500 or 1500.50",
      });
      return z.NEVER;
    }
  });

export type LeadInput = z.output<typeof leadInputSchema>;
