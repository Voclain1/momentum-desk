import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { dateValue } from "@/lib/dates";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { formatMoney, fromDecimalString, InvalidAmountError, money } from "@/lib/money";
import type { TenantData } from "@/lib/tenant/core";
import { calendarDate, fieldErrors, text } from "@/lib/validation/fields";

/**
 * Manual payments (decision D32): recorded in the invoice's currency against
 * one invoice, never more than it still owes. The database keeps the
 * invoice's paid amount from the allocations and refuses an overpayment,
 * a currency or customer mismatch, or a payment to a draft or void invoice.
 * Payments are never deleted: a mistake is voided with a reason.
 *
 * Callers check payments:record (and payments:read to list).
 */

export interface Actor {
  organizationId: string;
  userId: string;
}

export const PAYMENT_METHODS = ["bank_transfer", "cash", "card", "mobile_money", "cheque", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const paymentSchema = z.strictObject({
  amount: z.string().trim().min(1, { error: "is required" }).max(30),
  method: z.enum(PAYMENT_METHODS, { error: "must be one of the listed methods" }),
  receivedOn: calendarDate.pipe(z.date({ error: "is required" })),
  reference: text(200),
  note: text(1000),
});

const reasonSchema = z.string().trim().min(3, { error: "is required" }).max(500, { error: "must be at most 500 characters" });

/** Records money received against an issued invoice. `today` bounds the date (no future payments). */
export async function recordPayment(data: TenantData, actor: Actor, invoiceId: string, input: unknown, { today, locale }: { today: string; locale: string }) {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) throw new InputValidationError(fieldErrors(parsed.error));
  const values = parsed.data;
  if (values.receivedOn > dateValue(today)) throw new InputValidationError({ receivedOn: "cannot be in the future" });

  return data.transaction(actor.organizationId, async (tenant) => {
    const invoice = await tenant.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new RecordNotFoundError("Invoice");
    if (invoice.status !== "issued") {
      throw new RecordConflictError(invoice.status === "void" ? "This invoice is void, so it" : "This invoice is still a draft, so it");
    }
    let amountMinor: bigint;
    try {
      amountMinor = fromDecimalString(values.amount.replaceAll(",", ""), invoice.currency).amountMinor;
    } catch (error) {
      if (!(error instanceof InvalidAmountError)) throw error;
      throw new InputValidationError({
        amount: /decimal place/.test(error.message) ? `has too many decimal places for ${invoice.currency}` : "must be an amount such as 1500 or 1500.50",
      });
    }
    if (amountMinor <= 0n) throw new InputValidationError({ amount: "must be more than zero" });
    const outstanding = invoice.totalMinor - invoice.paidMinor;
    if (amountMinor > outstanding) {
      throw new InputValidationError({
        amount: `is more than the ${formatMoney(money(outstanding, invoice.currency), locale)} still owed`,
      });
    }

    const payment = await tenant.payment.create({
      data: {
        customerId: invoice.customerId,
        currency: invoice.currency,
        amountMinor,
        method: values.method,
        receivedOn: values.receivedOn,
        reference: values.reference,
        note: values.note,
        recordedById: actor.userId,
      },
    });
    await tenant.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId, amountMinor } });
    await recordAudit(tenant, {
      action: "payment.recorded",
      actorUserId: actor.userId,
      targetType: "payment",
      targetId: payment.id,
      metadata: { invoiceId, number: invoice.number, method: values.method, currency: invoice.currency, amountMinor: amountMinor.toString() },
    });
    return payment;
  });
}

/** Voids a payment recorded by mistake; its allocations are voided with it and the balance returns. */
export async function voidPayment(data: TenantData, actor: Actor, paymentId: string, reason: unknown) {
  const why = reasonSchema.safeParse(reason);
  if (!why.success) throw new InputValidationError({ reason: why.error.issues[0].message });
  return data.transaction(actor.organizationId, async (tenant) => {
    const payment = await tenant.payment.findUnique({ where: { id: paymentId }, include: { allocations: true } });
    if (!payment) throw new RecordNotFoundError("Payment");
    if (payment.voidedAt) throw new RecordConflictError("This payment is already void, so it");
    const { count } = await tenant.payment.updateMany({
      where: { id: paymentId, voidedAt: null },
      data: { voidedAt: new Date(), voidReason: why.data, voidedById: actor.userId },
    });
    if (count !== 1) throw new RecordConflictError("This payment");
    await recordAudit(tenant, {
      action: "payment.voided",
      actorUserId: actor.userId,
      targetType: "payment",
      targetId: paymentId,
      metadata: { invoiceIds: payment.allocations.map((a) => a.invoiceId), currency: payment.currency, amountMinor: payment.amountMinor.toString() },
    });
    return tenant.payment.findUniqueOrThrow({ where: { id: paymentId } });
  });
}
