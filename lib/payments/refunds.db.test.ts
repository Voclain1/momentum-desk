import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCustomer } from "@/lib/customers/service";
import { InputValidationError, RecordConflictError } from "@/lib/errors";
import { createInvoice, getInvoice, invoiceStatus, issueInvoice } from "@/lib/invoices/service";
import { createInvoiceLink } from "@/lib/invoices/sharing";
import { createTenantData } from "@/lib/tenant/core";
import { createPublicLinks } from "@/lib/tenant/public";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { connectProvider } from "./connections";
import { handleWebhook, onlineActivity, startCheckout } from "./online";
import type { Http } from "./providers";
import { refreshRefund, refundPayment } from "./refunds";
import { recordPayment, voidPayment } from "./service";

const db = createTestDb();
const data = createTenantData(db);
const links = createPublicLinks(db);
const secretsKey = randomBytes(32).toString("base64");
const KEY = "sk_test_refunds123";
const now = new Date("2026-11-13T10:00:00Z");

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

/** A scriptable Paystack: transactions to verify, refunds that start pending and can be resolved. */
function fakePaystack() {
  const transactions = new Map<string, { status: string; amount: number; currency: string; id: number }>();
  const refunds = new Map<string, string>();
  let refuse = false;
  let nextRefund = 1;
  const http: Http = async (url, init) => {
    if (url.endsWith("/transaction/initialize")) {
      const body = JSON.parse(init.body!);
      return { status: 200, json: async () => ({ data: { authorization_url: "https://pay.test", reference: body.reference } }) };
    }
    const verify = /\/transaction\/verify\/(.+)$/.exec(url);
    if (verify) {
      const tx = transactions.get(decodeURIComponent(verify[1]))!;
      return { status: 200, json: async () => ({ data: { ...tx, reference: decodeURIComponent(verify[1]), channel: "card" } }) };
    }
    if (url.endsWith("/refund") && init.method === "POST") {
      if (refuse) return { status: 400, json: async () => ({ message: "Transaction has been fully reversed" }) };
      const id = String(nextRefund++);
      refunds.set(id, "pending");
      return { status: 200, json: async () => ({ data: { id: Number(id), status: "pending" } }) };
    }
    const refund = /\/refund\/(.+)$/.exec(url);
    if (refund) return { status: 200, json: async () => ({ data: { id: Number(refund[1]), status: refunds.get(refund[1]) } }) };
    return { status: 404, json: async () => ({}) };
  };
  return { http, transactions, refunds, setRefuse: (value: boolean) => (refuse = value) };
}

const fake = fakePaystack();
const deps = () => ({ data, links, secretsKey, http: fake.http, now: () => now });
const tz = async () => "Africa/Lagos";
const locale = { locale: "en-NG" };

async function setup() {
  const organizationId = randomUUID();
  await db.organization.create({
    data: {
      id: organizationId, name: "Sun Power", slug: `sun-${organizationId.slice(0, 8)}`,
      baseCurrency: "NGN", countryCode: "NG", locale: "en-NG", timezone: "Africa/Lagos", defaultLanguage: "en",
    },
  });
  const userId = randomUUID();
  await db.user.create({ data: { id: userId, name: "Ada", email: `${userId}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId, userId, role: "owner" } });
  const actor = { organizationId, userId };
  const customer = await createCustomer(data, actor, { type: "organization", displayName: "Okafor Farms", email: "pay@okafor.ng" });
  const draft = await createInvoice(data, actor, {
    customerId: customer.id, currency: "NGN", taxMode: "exclusive", issuedOn: "2026-11-13", dueOn: "2026-11-30",
    lines: [{ description: "Panels", quantity: "1", unitPrice: "100000" }],
  });
  const invoice = await issueInvoice(data, actor, draft.id, 1);
  return { actor, invoice };
}

/** Pays the invoice online `times` times, each confirmed by webhook. */
async function payOnline(s: Awaited<ReturnType<typeof setup>>, times = 1) {
  const { id: connectionId } = await connectProvider(data, s.actor, { provider: "paystack", secretKey: KEY, currencies: ["NGN"] }, { secretsKey });
  const { token } = await createInvoiceLink(data, s.actor, s.invoice.id);
  for (let i = 0; i < times; i++) await startCheckout(deps(), token, { connectionId }, { origin: "https://app.test" });
  const attempts = (await onlineActivity(data, s.actor.organizationId, s.invoice.id)).attempts;
  for (const [index, attempt] of attempts.entries()) {
    fake.transactions.set(attempt.id, { status: "success", amount: 10000000, currency: "NGN", id: 100 + index });
    const body = JSON.stringify({ event: "charge.success", data: { id: 100 + index, reference: attempt.id } });
    await handleWebhook(deps(), "paystack", connectionId, body, new Headers({ "x-paystack-signature": createHmac("sha512", KEY).update(body).digest("hex") }), tz);
  }
  const payments = await data.scoped(s.actor.organizationId).payment.findMany({ orderBy: { createdAt: "asc" } });
  return { connectionId, payments };
}

const refundWebhook = (refundId: string) => {
  const body = JSON.stringify({ event: "refund.failed", data: { id: Number(refundId) } });
  return { body, headers: new Headers({ "x-paystack-signature": createHmac("sha512", KEY).update(body).digest("hex") }) };
};

const fields = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof InputValidationError) return error.fields;
    throw error;
  }
  throw new Error("expected a validation error");
};

describe("refunds", () => {
  it("records a manual refund, which reopens what the invoice owes", async () => {
    const s = await setup();
    const payment = await recordPayment(data, s.actor, s.invoice.id, { amount: "100000", method: "bank_transfer", receivedOn: "2026-11-13" }, { today: "2026-11-13", locale: "en-NG" });
    expect(invoiceStatus(await getInvoice(data, s.actor.organizationId, s.invoice.id), "2026-11-13")).toBe("paid");

    const refund = await refundPayment(deps(), s.actor, payment.id, { amount: "25,000", reason: "Two panels returned", method: "manual" }, locale);
    expect(refund).toMatchObject({ status: "succeeded", amountMinor: 2500000n, allocationReducedMinor: 2500000n, method: "manual" });
    const invoice = await getInvoice(data, s.actor.organizationId, s.invoice.id);
    expect([invoice.paidMinor, invoiceStatus(invoice, "2026-11-13")]).toEqual([7500000n, "partially_paid"]);

    expect(await fields(refundPayment(deps(), s.actor, payment.id, { amount: "75000.01", reason: "Too much", method: "manual" }, locale))).toEqual({
      amount: "is more than the ₦75,000.00 left to refund",
    });
    expect(await fields(refundPayment(deps(), s.actor, payment.id, { amount: "1", reason: "Card", method: "provider" }, locale))).toEqual({
      method: "is not available for this payment; record a refund made another way",
    });
    expect(await fields(refundPayment(deps(), s.actor, payment.id, { amount: "1", reason: "", method: "manual" }, locale))).toEqual({ reason: "is required" });
    // A refunded payment was real money: it cannot be voided as a mistake.
    await expect(voidPayment(data, s.actor, payment.id, "Recorded twice")).rejects.toThrow(/has refunds/);
    // The database refuses refunds beyond the payment, and allocating refunded money.
    const tenant = data.scoped(s.actor.organizationId);
    await expect(
      tenant.refund.create({ data: { paymentId: payment.id, amountMinor: 7500001n, currency: "NGN", method: "manual", status: "succeeded", completedAt: now, reason: "Direct" } }),
    ).rejects.toThrow(/exceed what is left/);
    await expect(tenant.refund.update({ where: { id: refund.id }, data: { amountMinor: 1n } })).rejects.toThrow(/pending to succeeded or failed/);
  });

  it("refunds a double payment's excess through Paystack without touching the invoice", async () => {
    const s = await setup();
    const { payments } = await payOnline(s, 2);
    const excess = payments[1];
    const refund = await refundPayment(deps(), s.actor, excess.id, { amount: "100000", reason: "Paid twice", method: "provider" }, locale);
    expect(refund).toMatchObject({ status: "pending", providerReference: "paystack:1", allocationReducedMinor: 0n });
    expect((await onlineActivity(data, s.actor.organizationId, s.invoice.id)).unallocated).toEqual([]);
    fake.refunds.set("1", "processed");
    expect(await refreshRefund(deps(), s.actor.organizationId, refund.id)).toMatchObject({ status: "succeeded", completedAt: now });
    expect(invoiceStatus(await getInvoice(data, s.actor.organizationId, s.invoice.id), "2026-11-13")).toBe("paid");
  });

  it("gives the amounts back when the provider refuses or later fails the refund", async () => {
    const s = await setup();
    const { connectionId, payments } = await payOnline(s);
    fake.setRefuse(true);
    await expect(refundPayment(deps(), s.actor, payments[0].id, { amount: "40000", reason: "Partial return", method: "provider" }, locale)).rejects.toThrow(
      RecordConflictError,
    );
    fake.setRefuse(false);
    let invoice = await getInvoice(data, s.actor.organizationId, s.invoice.id);
    expect(invoiceStatus(invoice, "2026-11-13")).toBe("paid");

    const refund = await refundPayment(deps(), s.actor, payments[0].id, { amount: "40000", reason: "Partial return", method: "provider" }, locale);
    invoice = await getInvoice(data, s.actor.organizationId, s.invoice.id);
    expect([refund.status, invoice.paidMinor]).toEqual(["pending", 6000000n]);

    // The provider later reports the refund failed: the payment counts in full again.
    fake.refunds.set(refund.providerReference!.replace("paystack:", ""), "failed");
    const hook = refundWebhook(refund.providerReference!.replace("paystack:", ""));
    expect(await handleWebhook(deps(), "paystack", connectionId, hook.body, hook.headers, tz)).toEqual({ status: 200, outcome: "failed" });
    invoice = await getInvoice(data, s.actor.organizationId, s.invoice.id);
    expect([invoice.paidMinor, invoiceStatus(invoice, "2026-11-13")]).toEqual([10000000n, "paid"]);
    expect(await handleWebhook(deps(), "paystack", connectionId, hook.body, hook.headers, tz)).toEqual({ status: 200, outcome: "duplicate" });

    const unknown = refundWebhook("999");
    expect(await handleWebhook(deps(), "paystack", connectionId, unknown.body, unknown.headers, tz)).toEqual({ status: 200, outcome: "ignored" });
    const refunds = await data.scoped(s.actor.organizationId).refund.findMany({ orderBy: { createdAt: "asc" } });
    expect(refunds.map((r) => r.status)).toEqual(["failed", "failed"]);
  });
});
