import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { dateValue, todayIn } from "@/lib/dates";
import type { Invoice, PaymentAttempt, ProviderConnection } from "@/lib/generated/prisma/client";
import type { TenantData, TenantDb } from "@/lib/tenant/core";
import type { PublicLink } from "@/lib/tenant/public";
import { credentialsOf } from "./connections";
import { refreshRefund } from "./refunds";
import { type Http, type PaymentProvider, ProviderError, type ProviderPayment, providerFor, WebhookSignatureError } from "./providers";

/**
 * Online payment of an invoice through the workspace's own provider account
 * (spec §6, decisions D19, D35, D36):
 *
 * 1. The customer, on the invoice's public page, starts a payment attempt for
 *    what is owed now; the provider's checkout takes the money.
 * 2. The provider's signed webhook, or our server asking the provider's API
 *    when the customer returns, triggers reconciliation. A browser redirect
 *    alone never records anything.
 * 3. Reconciliation reads the payment from the provider's API, checks the
 *    reference, currency and amount, and records it once (unique provider
 *    reference). It allocates up to what the invoice still owes; any excess
 *    stays on the payment as unallocated, flagged for refund.
 */

export interface OnlineDeps {
  data: TenantData;
  links: {
    invoiceLink(token: string): Promise<(PublicLink & { invoiceId: string }) | null>;
    providerConnection(id: string): Promise<Pick<ProviderConnection, "id" | "organizationId" | "provider" | "secretKeyEnc" | "webhookSecretEnc" | "disconnectedAt"> | null>;
  };
  secretsKey: string | undefined;
  http: Http;
  now?: () => Date;
}

export interface PayOption {
  connectionId: string;
  provider: string;
  name: string;
  /** Paystack needs an email; the page asks for one when the invoice has none. */
  needsEmail: boolean;
}

function canPay(invoice: Invoice) {
  return invoice.status === "issued" && invoice.totalMinor > invoice.paidMinor && !invoice.disputedAt;
}

async function optionsFor(tenant: TenantDb, invoice: Invoice): Promise<PayOption[]> {
  if (!canPay(invoice)) return [];
  const owed = invoice.totalMinor - invoice.paidMinor;
  const connections = await tenant.providerConnection.findMany({ where: { disconnectedAt: null }, orderBy: { createdAt: "asc" } });
  return connections.flatMap((connection) => {
    const provider = providerFor(connection.provider);
    if (!provider || !connection.currencies.includes(invoice.currency) || !provider.canCharge(owed, invoice.currency)) return [];
    return [{ connectionId: connection.id, provider: provider.key, name: provider.name, needsEmail: provider.key === "paystack" && !invoice.recipientEmail }];
  });
}

/** How the customer can pay this invoice online, if at all. */
export async function payOptions(deps: Pick<OnlineDeps, "data" | "links">, token: string): Promise<PayOption[]> {
  const link = await deps.links.invoiceLink(token);
  if (!link || link.revokedAt) return [];
  return deps.data.transaction(link.organizationId, async (tenant) => {
    const invoice = await tenant.invoice.findUnique({ where: { id: link.invoiceId } });
    return invoice ? optionsFor(tenant, invoice) : [];
  });
}

export type CheckoutResult = { ok: true; url: string } | { ok: false; message: string };

/**
 * Starts paying an invoice: an attempt for what is owed now, then the
 * provider's checkout. Returns where to send the customer.
 */
export async function startCheckout(
  deps: OnlineDeps,
  token: string,
  input: { connectionId: string; email?: string },
  { origin }: { origin: string },
): Promise<CheckoutResult> {
  const link = await deps.links.invoiceLink(token);
  if (!link || link.revokedAt) return { ok: false, message: "This link is not valid." };
  const prepared = await deps.data.transaction(link.organizationId, async (tenant) => {
    const invoice = await tenant.invoice.findUnique({ where: { id: link.invoiceId } });
    if (!invoice || !canPay(invoice)) return { error: "This invoice cannot be paid online now." } as const;
    const option = (await optionsFor(tenant, invoice)).find((o) => o.connectionId === input.connectionId);
    if (!option) return { error: "That payment method is not available for this invoice." } as const;
    const email = (invoice.recipientEmail ?? input.email ?? "").trim().toLowerCase() || null;
    if (option.needsEmail && !z.email().safeParse(email).success) return { error: "Enter your email address to pay with Paystack." } as const;
    const connection = await tenant.providerConnection.findUniqueOrThrow({ where: { id: input.connectionId } });
    const attempt = await tenant.paymentAttempt.create({
      data: {
        invoiceId: invoice.id,
        connectionId: connection.id,
        provider: connection.provider,
        amountMinor: invoice.totalMinor - invoice.paidMinor,
        currency: invoice.currency,
        payerEmail: email,
      },
    });
    return { invoice, connection, attempt } as const;
  });
  if ("error" in prepared) return { ok: false, message: prepared.error! };

  const { invoice, connection, attempt } = prepared;
  const provider = providerFor(connection.provider)!;
  const back = new URL(`/i/${token}`, origin);
  const success = new URL(`/i/${token}`, origin);
  success.searchParams.set("attempt", attempt.id);
  try {
    const checkout = await provider.createCheckout(
      credentialsOf(connection, deps.secretsKey),
      {
        reference: attempt.id,
        amountMinor: attempt.amountMinor,
        currency: attempt.currency,
        email: attempt.payerEmail,
        description: `Invoice ${invoice.number} from ${link.organization.name}`,
        successUrl: success.toString(),
        cancelUrl: back.toString(),
      },
      deps.http,
    );
    await deps.data.transaction(link.organizationId, (tenant) =>
      tenant.paymentAttempt.updateMany({ where: { id: attempt.id, status: "created" }, data: { status: "pending", sessionId: checkout.sessionId } }),
    );
    return { ok: true, url: checkout.url };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 300) : "Checkout could not start";
    await deps.data.transaction(link.organizationId, (tenant) =>
      tenant.paymentAttempt.updateMany({ where: { id: attempt.id }, data: { status: "failed", failureReason: reason } }),
    );
    return { ok: false, message: "The payment provider could not start the checkout. Please try again later." };
  }
}

export type ReconcileOutcome = "recorded" | "already_recorded" | "pending" | "failed" | "refused";

/**
 * Records what the provider's API says about an attempt (inside the caller's
 * tenant transaction). Idempotent: the same provider payment is recorded
 * once, however many webhooks or returns arrive.
 */
export async function reconcileAttempt(
  tenant: TenantDb,
  attempt: PaymentAttempt,
  payment: ProviderPayment | null,
  { now, timezone }: { now: Date; timezone: string },
): Promise<{ outcome: ReconcileOutcome; detail?: string }> {
  if (!payment || payment.status === "pending") return { outcome: "pending" };
  if (payment.status === "failed") {
    if (attempt.status !== "succeeded") {
      await tenant.paymentAttempt.updateMany({ where: { id: attempt.id, status: { not: "succeeded" } }, data: { status: "failed", failureReason: "The provider reports the payment failed" } });
    }
    return { outcome: "failed" };
  }
  // Only money that matches the attempt is recorded automatically (D36).
  const problems = [
    payment.reference !== null && payment.reference !== attempt.id && "reference",
    payment.currency !== attempt.currency && "currency",
    payment.amountMinor <= 0n && "amount",
  ].filter(Boolean);
  if (problems.length) {
    const detail = `Provider payment does not match the attempt (${problems.join(", ")})`;
    await tenant.paymentAttempt.updateMany({ where: { id: attempt.id, status: { not: "succeeded" } }, data: { failureReason: detail } });
    return { outcome: "refused", detail };
  }

  const existing = await tenant.payment.findFirst({ where: { providerReference: payment.providerReference } });
  if (existing) {
    await tenant.paymentAttempt.updateMany({ where: { id: attempt.id, paymentId: null }, data: { status: "succeeded", paymentId: existing.id } });
    return { outcome: "already_recorded" };
  }

  const invoice = await tenant.invoice.findUniqueOrThrow({ where: { id: attempt.invoiceId } });
  const recorded = await tenant.payment.create({
    data: {
      customerId: invoice.customerId,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      method: payment.method,
      source: attempt.provider,
      receivedOn: dateValue(todayIn(timezone, now)),
      reference: payment.providerReference.replace(/^[a-z]+:/, ""),
      connectionId: attempt.connectionId,
      providerReference: payment.providerReference,
      attemptId: attempt.id,
    },
  });
  const owed = invoice.status === "issued" ? invoice.totalMinor - invoice.paidMinor : 0n;
  const allocate = payment.amountMinor < owed ? payment.amountMinor : owed;
  if (allocate > 0n) {
    await tenant.paymentAllocation.create({ data: { paymentId: recorded.id, invoiceId: invoice.id, amountMinor: allocate } });
  }
  await tenant.paymentAttempt.updateMany({ where: { id: attempt.id }, data: { status: "succeeded", paymentId: recorded.id, failureReason: null } });
  const unallocated = payment.amountMinor - allocate;
  await recordAudit(tenant, {
    action: "payment.recorded",
    actorUserId: null,
    targetType: "payment",
    targetId: recorded.id,
    metadata: {
      invoiceId: invoice.id, number: invoice.number, source: attempt.provider, method: payment.method, currency: payment.currency,
      amountMinor: payment.amountMinor.toString(), unallocatedMinor: unallocated.toString(),
    },
  });
  return { outcome: "recorded", detail: unallocated > 0n ? `Received ${unallocated} more than was owed; kept unallocated for refund` : undefined };
}

/**
 * Runs reconciliation in its own transaction. If the same provider payment is
 * being recorded at that very moment by another delivery, the unique key on
 * the provider reference stops the second insert; that is "already recorded".
 */
async function reconcileOnce(
  deps: OnlineDeps,
  organizationId: string,
  attemptId: string,
  payment: ProviderPayment | null,
  context: { now: Date; timezone: string },
): Promise<{ outcome: ReconcileOutcome; detail?: string }> {
  try {
    return await deps.data.transaction(organizationId, async (tenant) => {
      const attempt = await tenant.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      return reconcileAttempt(tenant, attempt, payment, context);
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    return { outcome: "already_recorded" };
  }
}

async function lookup(deps: OnlineDeps, connection: Pick<ProviderConnection, "provider" | "secretKeyEnc" | "webhookSecretEnc">, attempt: PaymentAttempt) {
  const provider = providerFor(connection.provider) as PaymentProvider;
  return provider.fetchPayment(credentialsOf(connection, deps.secretsKey), { reference: attempt.id, sessionId: attempt.sessionId }, deps.http);
}

/**
 * When the customer comes back from checkout: ask the provider's API (server
 * to server) about the attempt, so a missed webhook does not leave the
 * invoice unpaid. The redirect itself proves nothing.
 */
export async function confirmReturn(deps: OnlineDeps, token: string, attemptId: string): Promise<ReconcileOutcome | "invalid"> {
  const now = deps.now?.() ?? new Date();
  const link = await deps.links.invoiceLink(token);
  if (!link || link.revokedAt || !/^[0-9a-f-]{36}$/.test(attemptId)) return "invalid";
  const found = await deps.data.transaction(link.organizationId, async (tenant) => {
    const attempt = await tenant.paymentAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.invoiceId !== link.invoiceId) return null;
    const connection = await tenant.providerConnection.findUniqueOrThrow({ where: { id: attempt.connectionId } });
    return { attempt, connection };
  });
  if (!found) return "invalid";
  if (found.attempt.status === "succeeded") return "already_recorded";
  let payment: ProviderPayment | null;
  try {
    payment = await lookup(deps, found.connection, found.attempt);
  } catch (error) {
    if (error instanceof ProviderError) return "pending";
    throw error;
  }
  return (await reconcileOnce(deps, link.organizationId, attemptId, payment, { now, timezone: link.organization.timezone })).outcome;
}

export type WebhookResult = { status: 200 | 400 | 404 | 503; outcome: ReconcileOutcome | "duplicate" | "ignored" | "rejected" };

/**
 * A provider webhook for one connection. The signature is checked with the
 * connection's own secret over the raw body before anything is read; the
 * payment itself is then read back from the provider's API. Every event is
 * stored once; a repeat answers 200 without doing anything again.
 */
export async function handleWebhook(
  deps: OnlineDeps,
  providerKey: string,
  connectionId: string,
  rawBody: string,
  headers: Headers,
  timezoneOf: (organizationId: string) => Promise<string>,
): Promise<WebhookResult> {
  const now = deps.now?.() ?? new Date();
  const connection = await deps.links.providerConnection(connectionId);
  const provider = providerFor(providerKey);
  if (!connection || !provider || connection.provider !== providerKey) return { status: 404, outcome: "rejected" };

  let event;
  try {
    event = provider.verifyWebhook(credentialsOf(connection, deps.secretsKey), rawBody, headers, now);
  } catch (error) {
    if (error instanceof WebhookSignatureError || error instanceof SyntaxError) return { status: 400, outcome: "rejected" };
    throw error;
  }

  const found = await deps.data.transaction(connection.organizationId, async (tenant) => {
    const seen = await tenant.providerEvent.findFirst({ where: { connectionId, eventId: event.eventId } });
    if (seen) return { duplicate: true } as const;
    const attempt =
      (event.reference && /^[0-9a-f-]{36}$/.test(event.reference) ? await tenant.paymentAttempt.findUnique({ where: { id: event.reference } }) : null) ??
      (event.sessionId ? await tenant.paymentAttempt.findFirst({ where: { sessionId: event.sessionId, connectionId } }) : null);
    return { duplicate: false, attempt: attempt && attempt.connectionId === connectionId ? attempt : null } as const;
  });
  if (found.duplicate) return { status: 200, outcome: "duplicate" };

  const record = (outcome: string, detail?: string, attemptId?: string) =>
    deps.data.transaction(connection.organizationId, async (tenant) => {
      try {
        await tenant.providerEvent.create({
          data: { connectionId, provider: providerKey, eventId: event.eventId, type: event.type.slice(0, 100), attemptId, outcome, detail: detail?.slice(0, 500) },
        });
      } catch (error) {
        // The same event processed concurrently: the payment is unique anyway.
        if ((error as { code?: string }).code !== "P2002") throw error;
      }
    });

  // Refund events: ask the provider about the refund and settle it (D37).
  if (event.refundReference) {
    const refund = await deps.data.transaction(connection.organizationId, (tenant) =>
      tenant.refund.findFirst({ where: { providerReference: event.refundReference!, payment: { connectionId } } }),
    );
    if (!refund) {
      await record("ignored", "No refund made from MomentumDesk matches this event; record it on the invoice if it was made elsewhere");
      return { status: 200, outcome: "ignored" };
    }
    try {
      const settled = await refreshRefund(deps, connection.organizationId, refund.id);
      const outcome = settled?.status === "pending" ? "pending" : settled?.status === "failed" ? "failed" : "recorded";
      await record(outcome, `Refund ${settled?.status ?? "unknown"}`);
      return { status: 200, outcome };
    } catch (error) {
      if (error instanceof ProviderError) return { status: 503, outcome: "pending" };
      throw error;
    }
  }

  if (!found.attempt) {
    await record("ignored", "No payment attempt matches this event");
    return { status: 200, outcome: "ignored" };
  }
  let payment: ProviderPayment | null;
  try {
    payment = await lookup(deps, connection, found.attempt);
  } catch (error) {
    // The provider will retry the webhook; nothing is recorded yet.
    if (error instanceof ProviderError) return { status: 503, outcome: "pending" };
    throw error;
  }
  const timezone = await timezoneOf(connection.organizationId);
  const result = await reconcileOnce(deps, connection.organizationId, found.attempt.id, payment, { now, timezone });
  await record(result.outcome, result.detail, found.attempt.id);
  return { status: 200, outcome: result.outcome };
}

/** Attempts and provider events for an invoice, for the staff page. */
export async function onlineActivity(data: TenantData, organizationId: string, invoiceId: string) {
  const tenant = data.scoped(organizationId);
  const attempts = await tenant.paymentAttempt.findMany({ where: { invoiceId }, orderBy: { createdAt: "desc" }, take: 20 });
  const events = attempts.length
    ? await tenant.providerEvent.findMany({ where: { attemptId: { in: attempts.map((a) => a.id) } }, orderBy: { receivedAt: "desc" }, take: 50 })
    : [];
  const paymentIds = attempts.flatMap((a) => (a.paymentId ? [a.paymentId] : []));
  const payments = paymentIds.length
    ? await tenant.payment.findMany({
        where: { id: { in: paymentIds } },
        include: { allocations: { where: { voidedAt: null } }, refunds: { where: { status: { not: "failed" } } } },
      })
    : [];
  // Money received through an attempt beyond what was allocated or refunded: to refund (D36, D37).
  const unallocated = payments
    .filter((p) => !p.voidedAt)
    .map((p) => ({
      paymentId: p.id,
      source: p.source,
      currency: p.currency,
      amountMinor:
        p.amountMinor - p.allocations.reduce((sum, a) => sum + a.amountMinor, 0n) - p.refunds.reduce((sum, r) => sum + r.amountMinor, 0n),
    }))
    .filter((p) => p.amountMinor > 0n);
  return { attempts, events, unallocated };
}
