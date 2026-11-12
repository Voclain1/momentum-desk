import { z } from "zod";
import { currencyCode } from "@/lib/organizations/settings";
import { MAX_LINES, TAX_MODES } from "@/lib/quotes/schema";
import { calendarDate, optional, text } from "@/lib/validation/fields";

/** Invoice input from the builder (spec §7.6); amounts are parsed exactly by lib/documents/resolve. */

const id = optional(z.string().trim().min(1).max(64));
const date = calendarDate.pipe(z.date({ error: "is required" }));
const datesInOrder = (value: { issuedOn: Date; dueOn: Date }, ctx: z.RefinementCtx) => {
  if (value.dueOn < value.issuedOn) ctx.addIssue({ code: "custom", path: ["dueOn"], message: "cannot be before the issue date" });
};

export const invoiceInputSchema = z
  .strictObject({
    customerId: z.string().trim().min(1, { error: "is required" }).max(64),
    leadId: id,
    recipientContactId: id,
    currency: currencyCode,
    taxMode: z.enum(TAX_MODES, { error: "must be exclusive or inclusive" }),
    issuedOn: date,
    dueOn: date,
    notes: text(5000),
    terms: text(5000),
    lines: z
      .array(z.unknown())
      .min(1, { error: "needs at least one line" })
      .max(MAX_LINES, { error: `can have at most ${MAX_LINES} lines` }),
  })
  .superRefine(datesInOrder);

export type InvoiceInput = z.output<typeof invoiceInputSchema>;

/** A draft from an accepted quote keeps its lines and amounts (D33); only these change. */
export const convertedDraftSchema = z
  .strictObject({
    recipientContactId: id,
    issuedOn: date,
    dueOn: date,
    notes: text(5000),
    terms: text(5000),
  })
  .superRefine(datesInOrder);

export const reasonSchema = z.string().trim().min(3, { error: "is required" }).max(500, { error: "must be at most 500 characters" });
