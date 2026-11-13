import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCustomer } from "@/lib/customers/service";
import { InputValidationError, RecordConflictError } from "@/lib/errors";
import { createInvoice, getInvoice, invoiceStatus, issueInvoice, setDisputed } from "@/lib/invoices/service";
import { createInvoiceLink } from "@/lib/invoices/sharing";
import { createTenantData } from "@/lib/tenant/core";
import { createPublicLinks } from "@/lib/tenant/public";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { connectProvider, disconnectProvider, listConnections } from "./connections";
import { confirmReturn, handleWebhook, onlineActivity, payOptions, startCheckout } from "./online";
import type { Http } from "./providers";

const db = createTestDb();
const data = createTenantData(db);
const links = createPublicLinks(db);
const secretsKey = randomBytes(32).toString("base64");
const PAYSTACK_KEY = "sk_test_paystack123";
const STRIPE_WHSEC = "whsec_test_123";
let now = new Date("2026-11-12T10:00:00Z");

beforeEach(async () => {
  now = new Date("2026-11-12T10:00:00Z");
  await resetDatabase();
});
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

/** A scriptable provider API: what each transaction looks like when our server asks. */
function fakeProviders() {
  const transactions = new Map<string, { status: string; amount: number; currency: string; id: number }>();
  const sessions = new Map<string, { payment_status: string; amount_total: number; currency: string; reference: string; intent: string }>();
  let down = false;
  const http: Http = async (url, init) => {
    if (down) return { status: 500, json: async () => ({ message: "Provider unavailable" }) };
    if (url.endsWith("/transaction/initialize")) {
      const body = JSON.parse(init.body!);
      return { status: 200, json: async () => ({ data: { authorization_url: `https://checkout.paystack.test/${body.reference}`, reference: body.reference } }) };
    }
    const verify = /\/transaction\/verify\/(.+)$/.exec(url);
    if (verify) {
      const tx = transactions.get(decodeURIComponent(verify[1]));
      if (!tx) return { status: 404, json: async () => ({ message: "Not found" }) };
      return { status: 200, json: async () => ({ data: { ...tx, reference: decodeURIComponent(verify[1]), channel: "card" } }) };
    }
    if (url.endsWith("/checkout/sessions")) {
      const params = new URLSearchParams(init.body);
      const id = `cs_test_${params.get("client_reference_id")}`;
      return { status: 200, json: async () => ({ id, url: `https://checkout.stripe.test/${id}` }) };
    }
    const session = /\/checkout\/sessions\/(.+)$/.exec(url);
    if (session) {
      const s = sessions.get(decodeURIComponent(session[1]));
      if (!s) return { status: 404, json: async () => ({}) };
      return {
        status: 200,
        json: async () => ({ id: session[1], payment_status: s.payment_status, status: "complete", amount_total: s.amount_total, currency: s.currency, client_reference_id: s.reference, payment_intent: s.intent }),
      };
    }
    return { status: 404, json: async () => ({}) };
  };
  return { http, transactions, sessions, setDown: (value: boolean) => (down = value) };
}

const paystackWebhook = (reference: string, id: number, event = "charge.success") => {
  const body = JSON.stringify({ event, data: { id, reference } });
  return { body, headers: new Headers({ "x-paystack-signature": createHmac("sha512", PAYSTACK_KEY).update(body).digest("hex") }) };
};
const stripeWebhook = (eventId: string, sessionId: string, reference: string) => {
  const body = JSON.stringify({ id: eventId, type: "checkout.session.completed", data: { object: { id: sessionId, client_reference_id: reference } } });
  const t = Math.floor(now.getTime() / 1000);
  return { body, headers: new Headers({ "stripe-signature": `t=${t},v1=${createHmac("sha256", STRIPE_WHSEC).update(`${t}.${body}`).digest("hex")}` }) };
};

async function setup(currency = "NGN", unitPrice = "100000") {
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
    customerId: customer.id, currency, taxMode: "exclusive", issuedOn: "2026-11-12", dueOn: "2026-11-30",
    lines: [{ description: "Panels", quantity: "1", unitPrice }],
  });
  const invoice = await issueInvoice(data, actor, draft.id, 1);
  const { token } = await createInvoiceLink(data, actor, invoice.id);
  return { actor, invoice, token };
}

const fake = fakeProviders();
const deps = () => ({ data, links, secretsKey, http: fake.http, now: () => now });
const tz = async () => "Africa/Lagos";
const origin = { origin: "https://app.test" };

async function connectPaystack(actor: { organizationId: string; userId: string }) {
  return connectProvider(data, actor, { provider: "paystack", secretKey: PAYSTACK_KEY, currencies: ["NGN", "USD"] }, { secretsKey });
}

describe("provider connections", () => {
  it("stores keys encrypted, shows only a hint, and allows one active connection per provider", async () => {
    const { actor } = await setup();
    const { id } = await connectPaystack(actor);
    const [row] = await data.scoped(actor.organizationId).providerConnection.findMany();
    expect(row.secretKeyEnc).not.toContain(PAYSTACK_KEY);
    expect(row).toMatchObject({ mode: "test", keyHint: "sk_test_…k123", currencies: ["NGN", "USD"] });
    expect(await listConnections(data, actor.organizationId)).toEqual([
      expect.objectContaining({ id, provider: "paystack", keyHint: "sk_test_…k123", hasWebhookSecret: false }),
    ]);
    expect(JSON.stringify(await listConnections(data, actor.organizationId))).not.toContain("secretKeyEnc");
    await expect(connectPaystack(actor)).rejects.toThrow(RecordConflictError);

    const invalid = async (input: Record<string, unknown>) => {
      try {
        await connectProvider(data, actor, input, { secretsKey });
      } catch (error) {
        if (error instanceof InputValidationError) return error.fields;
        throw error;
      }
    };
    expect(await invalid({ provider: "stripe", secretKey: "not_a_stripe_key", currencies: ["NGN", "XYZ"] })).toEqual({
      secretKey: "does not look like a Stripe secret key",
      webhookSecret: "is required: Stripe signs webhooks with it",
      currencies: "Stripe cannot take XYZ",
    });
    await disconnectProvider(data, actor, id);
    expect(await listConnections(data, actor.organizationId)).toEqual([]);
    await expect(connectPaystack(actor)).resolves.toMatchObject({ id: expect.any(String) });
  });
});

describe("paying an invoice online", () => {
  it("records a webhook-confirmed payment exactly once, however often it is delivered (spec scenario 7)", async () => {
    const { actor, invoice, token } = await setup();
    const { id: connectionId } = await connectPaystack(actor);
    expect(await payOptions(deps(), token)).toEqual([{ connectionId, provider: "paystack", name: "Paystack", needsEmail: false }]);

    const started = await startCheckout(deps(), token, { connectionId }, origin);
    expect(started).toMatchObject({ ok: true, url: expect.stringMatching(/^https:\/\/checkout\.paystack\.test\//) });
    const [attempt] = (await onlineActivity(data, actor.organizationId, invoice.id)).attempts;
    expect(attempt).toMatchObject({ status: "pending", amountMinor: 10000000n, currency: "NGN", payerEmail: "pay@okafor.ng" });

    // The customer has not paid yet: a webhook changes nothing.
    fake.transactions.set(attempt.id, { status: "ongoing", amount: 10000000, currency: "NGN", id: 501 });
    const early = paystackWebhook(attempt.id, 501, "charge.pending");
    expect(await handleWebhook(deps(), "paystack", connectionId, early.body, early.headers, tz)).toEqual({ status: 200, outcome: "pending" });

    fake.transactions.set(attempt.id, { status: "success", amount: 10000000, currency: "NGN", id: 501 });
    const hook = paystackWebhook(attempt.id, 501);
    const results = await Promise.all(Array.from({ length: 5 }, () => handleWebhook(deps(), "paystack", connectionId, hook.body, hook.headers, tz)));
    expect(results.filter((r) => r.outcome === "recorded")).toHaveLength(1);
    expect(results.every((r) => r.status === 200)).toBe(true);

    const paid = await getInvoice(data, actor.organizationId, invoice.id);
    expect(invoiceStatus(paid, "2026-11-12")).toBe("paid");
    expect(paid.allocations).toHaveLength(1);
    expect(paid.allocations[0].payment).toMatchObject({ source: "paystack", providerReference: "paystack:501", amountMinor: 10000000n, method: "card" });
    expect(await data.scoped(actor.organizationId).payment.count()).toBe(1);
    // The customer returning afterwards finds it already recorded.
    expect(await confirmReturn(deps(), token, attempt.id)).toBe("already_recorded");
    expect(await payOptions(deps(), token)).toEqual([]);
  });

  it("records from the customer's return when the webhook is late, then ignores the webhook", async () => {
    const { actor, invoice, token } = await setup();
    const { id: connectionId } = await connectPaystack(actor);
    await startCheckout(deps(), token, { connectionId }, origin);
    const [attempt] = (await onlineActivity(data, actor.organizationId, invoice.id)).attempts;
    fake.transactions.set(attempt.id, { status: "success", amount: 4000000, currency: "NGN", id: 777 });
    expect(await confirmReturn(deps(), token, attempt.id)).toBe("recorded");
    const hook = paystackWebhook(attempt.id, 777);
    expect(await handleWebhook(deps(), "paystack", connectionId, hook.body, hook.headers, tz)).toEqual({ status: 200, outcome: "already_recorded" });
    const current = await getInvoice(data, actor.organizationId, invoice.id);
    expect([current.paidMinor, invoiceStatus(current, "2026-11-12")]).toEqual([4000000n, "partially_paid"]);
  });

  it("keeps money paid twice: the excess is unallocated, never hidden", async () => {
    const { actor, invoice, token } = await setup();
    const { id: connectionId } = await connectPaystack(actor);
    await startCheckout(deps(), token, { connectionId }, origin);
    await startCheckout(deps(), token, { connectionId }, origin);
    const attempts = (await onlineActivity(data, actor.organizationId, invoice.id)).attempts;
    for (const [index, attempt] of attempts.entries()) {
      fake.transactions.set(attempt.id, { status: "success", amount: 10000000, currency: "NGN", id: 900 + index });
      const hook = paystackWebhook(attempt.id, 900 + index);
      await handleWebhook(deps(), "paystack", connectionId, hook.body, hook.headers, tz);
    }
    const tenant = data.scoped(actor.organizationId);
    const payments = await tenant.payment.findMany({ include: { allocations: true }, orderBy: { createdAt: "asc" } });
    expect(payments.map((p) => [p.amountMinor, p.allocations.reduce((sum, a) => sum + a.amountMinor, 0n)])).toEqual([
      [10000000n, 10000000n],
      [10000000n, 0n],
    ]);
    expect((await getInvoice(data, actor.organizationId, invoice.id)).paidMinor).toBe(10000000n);
    const events = (await onlineActivity(data, actor.organizationId, invoice.id)).events;
    expect(events.some((e) => e.detail?.includes("kept unallocated for refund"))).toBe(true);
    // And the database refuses to allocate a payment beyond its amount.
    await expect(tenant.paymentAllocation.create({ data: { paymentId: payments[0].id, invoiceId: invoice.id, amountMinor: 1n } })).rejects.toThrow();
  });

  it("refuses forged, mismatched and unreadable events, and asks for a retry when the provider is down", async () => {
    const { actor, invoice, token } = await setup();
    const { id: connectionId } = await connectPaystack(actor);
    await startCheckout(deps(), token, { connectionId }, origin);
    const [attempt] = (await onlineActivity(data, actor.organizationId, invoice.id)).attempts;
    const hook = paystackWebhook(attempt.id, 42);

    expect(await handleWebhook(deps(), "paystack", connectionId, hook.body, new Headers({ "x-paystack-signature": "0".repeat(128) }), tz)).toEqual({
      status: 400, outcome: "rejected",
    });
    expect(await handleWebhook(deps(), "stripe", connectionId, hook.body, hook.headers, tz)).toEqual({ status: 404, outcome: "rejected" });
    expect(await handleWebhook(deps(), "paystack", randomUUID(), hook.body, hook.headers, tz)).toEqual({ status: 404, outcome: "rejected" });

    fake.transactions.set(attempt.id, { status: "success", amount: 10000000, currency: "USD", id: 42 });
    expect(await handleWebhook(deps(), "paystack", connectionId, hook.body, hook.headers, tz)).toEqual({ status: 200, outcome: "refused" });
    expect(await data.scoped(actor.organizationId).payment.count()).toBe(0);

    fake.setDown(true);
    const retry = paystackWebhook(attempt.id, 43);
    expect(await handleWebhook(deps(), "paystack", connectionId, retry.body, retry.headers, tz)).toEqual({ status: 503, outcome: "pending" });
    fake.setDown(false);
    fake.transactions.set(attempt.id, { status: "success", amount: 10000000, currency: "NGN", id: 43 });
    // Not stored while the provider was down, so the provider's retry is processed.
    expect(await handleWebhook(deps(), "paystack", connectionId, retry.body, retry.headers, tz)).toEqual({ status: 200, outcome: "recorded" });
  });

  it("works through Stripe Checkout, finding the attempt by session", async () => {
    const { actor, invoice, token } = await setup("GBP", "1500");
    const { id: connectionId } = await connectProvider(
      data, actor, { provider: "stripe", secretKey: "sk_test_stripe1", webhookSecret: STRIPE_WHSEC, currencies: ["GBP"] }, { secretsKey },
    );
    expect(await startCheckout(deps(), token, { connectionId }, origin)).toMatchObject({ ok: true });
    const [attempt] = (await onlineActivity(data, actor.organizationId, invoice.id)).attempts;
    expect(attempt.sessionId).toBe(`cs_test_${attempt.id}`);
    fake.sessions.set(attempt.sessionId!, { payment_status: "paid", amount_total: 150000, currency: "gbp", reference: attempt.id, intent: "pi_1" });
    const hook = stripeWebhook("evt_1", attempt.sessionId!, attempt.id);
    expect(await handleWebhook(deps(), "stripe", connectionId, hook.body, hook.headers, tz)).toEqual({ status: 200, outcome: "recorded" });
    expect(await handleWebhook(deps(), "stripe", connectionId, hook.body, hook.headers, tz)).toEqual({ status: 200, outcome: "duplicate" });
    expect(invoiceStatus(await getInvoice(data, actor.organizationId, invoice.id), "2026-11-12")).toBe("paid");
  });

  it("offers online payment only where it applies", async () => {
    const { actor, invoice, token } = await setup("KES", "500");
    const { id: connectionId } = await connectPaystack(actor); // NGN and USD only
    expect(await payOptions(deps(), token)).toEqual([]);
    expect(await startCheckout(deps(), token, { connectionId }, origin)).toEqual({ ok: false, message: "That payment method is not available for this invoice." });
    const other = await setup();
    await connectPaystack(other.actor);
    await setDisputed(data, other.actor, other.invoice.id, "Damaged goods");
    expect(await payOptions(deps(), other.token)).toEqual([]);
    // Another workspace's connection cannot be used for this invoice.
    const third = await setup();
    expect(await startCheckout(deps(), third.token, { connectionId }, origin)).toMatchObject({ ok: false });
    void invoice;
  });
});
