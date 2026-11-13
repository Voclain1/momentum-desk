import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import type { Refund } from "@/lib/generated/prisma/client";
import { formatMoney, fromDecimalString, InvalidAmountError, money } from "@/lib/money";
import type { TenantData, TenantDb } from "@/lib/tenant/core";
import { credentialsOf } from "./connections";
import { type Http, ProviderError, type ProviderRefund, providerFor } from "./providers";

/**
 * Refunds (decision D37). A refund first takes back a payment's unallocated
 * excess, then its allocation to the invoice, which then shows as owed again.
 * Through the provider's API (Paystack, Stripe) or recorded after the
 * business paid the customer back another way. The database refuses refunds
 * beyond what is left of the payment. Callers check payments:refund.
 */

export interface Actor {
  organizationId: string;
  userId: string;
}

export interface RefundDeps {
  data: TenantData;
  secretsKey: string | undefined;
  http: Http;
  now?: () => Date;
}

const refundSchema = z.strictObject({
  amount: z.string().trim().min(1, { error: "is required" }).max(30),
  reason: z.string().trim().min(3, { error: "is required" }).max(500, { error: "must be at most 500 characters" }),
  method: z.enum(["provider", "manual"], { error: "must be through the provider or recorded" }),
});

/** What is left of a payment to refund, and what of it is not allocated to an invoice. */
async function balances(tenant: TenantDb, paymentId: string) {
  const payment = await tenant.payment.findUnique({
    where: { id: paymentId },
    include: { allocations: { where: { voidedAt: null } }, refunds: { where: { status: { not: "failed" } } } },
  });
  if (!payment) throw new RecordNotFoundError("Payment");
  const refunded = payment.refunds.reduce((sum, r) => sum + r.amountMinor, 0n);
  const allocated = payment.allocations.reduce((sum, a) => sum + a.amountMinor, 0n);
  return { payment, refundable: payment.amountMinor - refunded, unallocated: payment.amountMinor - refunded - allocated };
}

/** Whether the payment can be refunded through its provider's API. */
export function canRefundThroughProvider(payment: { source: string; connectionId: string | null; providerReference: string | null }) {
  const provider = providerFor(payment.source);
  return Boolean(provider?.refund && payment.connectionId && payment.providerReference);
}

/** Takes `take` back from the payment's valid allocation, by voiding it and allocating the rest. */
async function shiftAllocation(tenant: TenantDb, paymentId: string, take: bigint) {
  const allocation = await tenant.paymentAllocation.findFirst({ where: { paymentId, voidedAt: null }, orderBy: { createdAt: "desc" } });
  if (!allocation) return null;
  await tenant.paymentAllocation.updateMany({ where: { id: allocation.id, voidedAt: null }, data: { voidedAt: new Date() } });
  const remaining = allocation.amountMinor - take;
  if (remaining > 0n) await tenant.paymentAllocation.create({ data: { paymentId, invoiceId: allocation.invoiceId, amountMinor: remaining } });
  return allocation.invoiceId;
}

export async function refundPayment(deps: RefundDeps, actor: Actor, paymentId: string, input: unknown, { locale }: { locale: string }) {
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) throw new InputValidationError(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const values = parsed.data;
  const now = deps.now?.() ?? new Date();

  // 1. Reserve the refund and take it off the invoice, in one transaction.
  const reserved = await deps.data.transaction(actor.organizationId, async (tenant) => {
    const { payment, refundable, unallocated } = await balances(tenant, paymentId);
    if (payment.voidedAt) throw new RecordConflictError("This payment is void, so it");
    let amountMinor: bigint;
    try {
      amountMinor = fromDecimalString(values.amount.replaceAll(",", ""), payment.currency).amountMinor;
    } catch (error) {
      if (!(error instanceof InvalidAmountError)) throw error;
      throw new InputValidationError({
        amount: /decimal place/.test(error.message) ? `has too many decimal places for ${payment.currency}` : "must be an amount such as 1500 or 1500.50",
      });
    }
    if (amountMinor <= 0n) throw new InputValidationError({ amount: "must be more than zero" });
    if (amountMinor > refundable) {
      throw new InputValidationError({ amount: `is more than the ${formatMoney(money(refundable, payment.currency), locale)} left to refund` });
    }
    if (values.method === "provider" && !canRefundThroughProvider(payment)) {
      throw new InputValidationError({ method: "is not available for this payment; record a refund made another way" });
    }
    const fromAllocation = amountMinor > unallocated ? amountMinor - (unallocated > 0n ? unallocated : 0n) : 0n;
    const refund = await tenant.refund.create({
      data: {
        paymentId,
        amountMinor,
        currency: payment.currency,
        method: values.method,
        status: values.method === "manual" ? "succeeded" : "pending",
        completedAt: values.method === "manual" ? now : null,
        reason: values.reason,
        allocationReducedMinor: fromAllocation,
        requestedById: actor.userId,
      },
    });
    if (fromAllocation > 0n) await shiftAllocation(tenant, paymentId, fromAllocation);
    await recordAudit(tenant, {
      action: "payment.refunded",
      actorUserId: actor.userId,
      targetType: "payment",
      targetId: paymentId,
      metadata: { refundId: refund.id, method: values.method, currency: payment.currency, amountMinor: amountMinor.toString(), fromInvoiceMinor: fromAllocation.toString() },
    });
    return { refund, payment };
  });
  if (values.method === "manual") return reserved.refund;

  // 2. Ask the provider; a refusal returns the amounts.
  const { refund, payment } = reserved;
  const provider = providerFor(payment.source)!;
  const connection = await deps.data.scoped(actor.organizationId).providerConnection.findUniqueOrThrow({ where: { id: payment.connectionId! } });
  let answer: ProviderRefund;
  try {
    answer = await provider.refund!(
      credentialsOf(connection, deps.secretsKey),
      { providerReference: payment.providerReference!, amountMinor: refund.amountMinor, currency: refund.currency, idempotencyKey: refund.id },
      deps.http,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 300) : "The provider refused the refund";
    await deps.data.transaction(actor.organizationId, (tenant) => settleRefund(tenant, refund.id, "failed", now, reason));
    if (error instanceof ProviderError || error instanceof Error) throw new RecordConflictError(`${provider.name} refused the refund (${reason}), so this payment`);
    throw error;
  }
  return deps.data.transaction(actor.organizationId, async (tenant) => {
    await tenant.refund.updateMany({ where: { id: refund.id, providerReference: null }, data: { providerReference: answer.refundReference } });
    if (answer.status !== "pending") await settleRefund(tenant, refund.id, answer.status, now);
    return tenant.refund.findUniqueOrThrow({ where: { id: refund.id } });
  });
}

/**
 * Settles a pending refund once (inside the caller's transaction). A failed
 * refund gives back what it took from the invoice, as far as the invoice
 * still owes it; the rest stays on the payment as unallocated.
 */
export async function settleRefund(tenant: TenantDb, refundId: string, status: "succeeded" | "failed", now: Date, failureReason?: string) {
  const refund = await tenant.refund.findUnique({ where: { id: refundId } });
  if (!refund || refund.status !== "pending") return refund;
  await tenant.refund.updateMany({
    where: { id: refundId, status: "pending" },
    data: { status, completedAt: now, failureReason: status === "failed" ? (failureReason ?? "The provider reports the refund failed") : null },
  });
  if (status === "failed" && refund.allocationReducedMinor > 0n) {
    const lastAllocation = await tenant.paymentAllocation.findFirst({ where: { paymentId: refund.paymentId }, orderBy: { createdAt: "desc" } });
    const invoice = lastAllocation ? await tenant.invoice.findUnique({ where: { id: lastAllocation.invoiceId } }) : null;
    if (invoice && invoice.status === "issued") {
      const owed = invoice.totalMinor - invoice.paidMinor;
      const giveBack = refund.allocationReducedMinor < owed ? refund.allocationReducedMinor : owed;
      if (giveBack > 0n) {
        const current = await tenant.paymentAllocation.findFirst({ where: { paymentId: refund.paymentId, voidedAt: null } });
        if (current) {
          await tenant.paymentAllocation.updateMany({ where: { id: current.id, voidedAt: null }, data: { voidedAt: now } });
          await tenant.paymentAllocation.create({ data: { paymentId: refund.paymentId, invoiceId: invoice.id, amountMinor: current.amountMinor + giveBack } });
        } else {
          await tenant.paymentAllocation.create({ data: { paymentId: refund.paymentId, invoiceId: invoice.id, amountMinor: giveBack } });
        }
      }
    }
  }
  await recordAudit(tenant, {
    action: status === "succeeded" ? "refund.succeeded" : "refund.failed",
    actorUserId: null,
    targetType: "payment",
    targetId: refund.paymentId,
    metadata: { refundId, amountMinor: refund.amountMinor.toString(), currency: refund.currency },
  });
  return tenant.refund.findUnique({ where: { id: refundId } });
}

/** Asks the provider about a pending refund (from a webhook or the staff page). */
export async function refreshRefund(deps: RefundDeps, organizationId: string, refundId: string): Promise<Refund | null> {
  const now = deps.now?.() ?? new Date();
  const tenant = deps.data.scoped(organizationId);
  const refund = await tenant.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
  if (!refund) throw new RecordNotFoundError("Refund");
  if (refund.status !== "pending" || !refund.providerReference || !refund.payment.connectionId) return refund;
  const provider = providerFor(refund.payment.source);
  if (!provider?.fetchRefund) return refund;
  const connection = await tenant.providerConnection.findUniqueOrThrow({ where: { id: refund.payment.connectionId } });
  const answer = await provider.fetchRefund(credentialsOf(connection, deps.secretsKey), refund.providerReference, deps.http);
  if (!answer || answer.status === "pending") return refund;
  return deps.data.transaction(organizationId, (t) => settleRefund(t, refundId, answer.status as "succeeded" | "failed", now));
}

/** Refunds of an invoice's payments, for the staff page. */
export async function refundsFor(data: TenantData, organizationId: string, paymentIds: string[]) {
  if (!paymentIds.length) return [];
  return data.scoped(organizationId).refund.findMany({
    where: { paymentId: { in: paymentIds } },
    orderBy: { createdAt: "desc" },
    include: { requestedBy: { select: { name: true } } },
  });
}
