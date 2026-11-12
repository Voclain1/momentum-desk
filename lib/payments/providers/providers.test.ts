import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bachs } from "./bachs";
import { paystack } from "./paystack";
import { stripe } from "./stripe";
import { type Http, WebhookSignatureError } from "./types";

/** A fake provider API that records requests and answers from a script. */
function fakeHttp(answer: (url: string, body: string | undefined) => { status: number; body: unknown }) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const http: Http = async (url, init) => {
    calls.push({ url, ...init });
    const { status, body } = answer(url, init.body);
    return { status, json: async () => body };
  };
  return { http, calls };
}

const request = {
  reference: "att_123", amountMinor: 37000000n, currency: "NGN", email: "chidi@okafor.ng",
  description: "Invoice INV-0001", successUrl: "https://app.test/i/tok?paid=1", cancelUrl: "https://app.test/i/tok",
};
const now = new Date("2026-11-12T10:00:00Z");
const t = String(Math.floor(now.getTime() / 1000));

describe("Paystack", () => {
  const creds = { secretKey: "sk_test_abc", webhookSecret: null };

  it("initialises a transaction in subunits with our reference", async () => {
    const { http, calls } = fakeHttp(() => ({ status: 200, body: { status: true, data: { authorization_url: "https://checkout.paystack.com/x", reference: "att_123" } } }));
    expect(await paystack.createCheckout(creds, request, http)).toEqual({ url: "https://checkout.paystack.com/x", sessionId: "att_123" });
    expect(calls[0].url).toBe("https://api.paystack.co/transaction/initialize");
    expect(calls[0].headers.Authorization).toBe("Bearer sk_test_abc");
    expect(JSON.parse(calls[0].body!)).toMatchObject({ email: "chidi@okafor.ng", amount: "37000000", currency: "NGN", reference: "att_123" });
    await expect(paystack.createCheckout(creds, { ...request, email: null }, http)).rejects.toThrow(/email/);
  });

  it("reads a verified transaction and refuses on API errors", async () => {
    const { http } = fakeHttp(() => ({
      status: 200,
      body: { data: { status: "success", reference: "att_123", id: 99, amount: 37000000, currency: "NGN", channel: "bank_transfer" } },
    }));
    expect(await paystack.fetchPayment(creds, { reference: "att_123", sessionId: null }, http)).toEqual({
      status: "succeeded", reference: "att_123", providerReference: "paystack:99", amountMinor: 37000000n, currency: "NGN", method: "bank_transfer",
    });
    const failing = fakeHttp(() => ({ status: 401, body: { message: "Invalid key" } }));
    await expect(paystack.fetchPayment(creds, { reference: "x", sessionId: null }, failing.http)).rejects.toThrow("Paystack refused the request: Invalid key");
    expect(paystack.modeOf("sk_live_1")).toBe("live");
    expect(paystack.canCharge(1n, "GBP")).toBe(false);
  });

  it("accepts only an HMAC-SHA512 of the exact body with the secret key", () => {
    const body = JSON.stringify({ event: "charge.success", data: { id: 99, reference: "att_123" } });
    const sign = (key: string, text: string) => createHmac("sha512", key).update(text).digest("hex");
    expect(paystack.verifyWebhook(creds, body, new Headers({ "x-paystack-signature": sign("sk_test_abc", body) }), now)).toEqual({
      eventId: "charge.success:99", type: "charge.success", reference: "att_123", sessionId: "att_123",
    });
    for (const headers of [
      new Headers({ "x-paystack-signature": sign("sk_test_other", body) }),
      new Headers({ "x-paystack-signature": sign("sk_test_abc", body + " ") }),
      new Headers(),
    ]) {
      expect(() => paystack.verifyWebhook(creds, body, headers, now)).toThrow(WebhookSignatureError);
    }
  });
});

describe("Stripe", () => {
  const creds = { secretKey: "sk_test_abc", webhookSecret: "whsec_test" };

  it("creates a Checkout Session in minor units, idempotently", async () => {
    const { http, calls } = fakeHttp(() => ({ status: 200, body: { id: "cs_test_1", url: "https://checkout.stripe.com/c/cs_test_1" } }));
    const result = await stripe.createCheckout(creds, { ...request, currency: "GBP", amountMinor: 150000n }, http);
    expect(result).toEqual({ url: "https://checkout.stripe.com/c/cs_test_1", sessionId: "cs_test_1" });
    const params = new URLSearchParams(calls[0].body);
    expect(calls[0].headers["Idempotency-Key"]).toBe("att_123");
    expect(Object.fromEntries(params)).toMatchObject({
      mode: "payment", "line_items[0][price_data][currency]": "gbp", "line_items[0][price_data][unit_amount]": "150000",
      client_reference_id: "att_123", customer_email: "chidi@okafor.ng",
    });
  });

  it("charges three-decimal currencies only in tens", () => {
    expect(stripe.canCharge(1230n, "KWD")).toBe(true);
    expect(stripe.canCharge(1235n, "KWD")).toBe(false);
    expect(stripe.canCharge(999n, "JPY")).toBe(true);
    expect(stripe.canCharge(0n, "USD")).toBe(false);
  });

  it("reads a paid session", async () => {
    const { http } = fakeHttp(() => ({
      status: 200,
      body: { id: "cs_1", payment_status: "paid", status: "complete", payment_intent: "pi_9", amount_total: 150000, currency: "gbp", client_reference_id: "att_123" },
    }));
    expect(await stripe.fetchPayment(creds, { reference: "att_123", sessionId: "cs_1" }, http)).toEqual({
      status: "succeeded", reference: "att_123", providerReference: "stripe:pi_9", amountMinor: 150000n, currency: "GBP", method: "card",
    });
  });

  it("verifies Stripe-Signature within five minutes", () => {
    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", client_reference_id: "att_123" } } });
    const sign = (secret: string, ts: string) => createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    const ok = new Headers({ "stripe-signature": `t=${t},v1=deadbeef,v1=${sign("whsec_test", t)}` });
    expect(stripe.verifyWebhook(creds, body, ok, now)).toEqual({ eventId: "evt_1", type: "checkout.session.completed", reference: "att_123", sessionId: "cs_1" });
    const old = String(Number(t) - 301);
    expect(() => stripe.verifyWebhook(creds, body, new Headers({ "stripe-signature": `t=${old},v1=${sign("whsec_test", old)}` }), now)).toThrow(/too old/);
    expect(() => stripe.verifyWebhook(creds, body, new Headers({ "stripe-signature": `t=${t},v1=${sign("whsec_other", t)}` }), now)).toThrow(WebhookSignatureError);
    expect(() => stripe.verifyWebhook({ ...creds, webhookSecret: null }, body, ok, now)).toThrow(/signing secret/);
  });
});

describe("Bachs (to confirm in sandbox)", () => {
  const creds = { secretKey: "bk_test_abc", webhookSecret: "bachs_whsec" };

  it("sends a decimal amount in major units and reads it back exactly", async () => {
    const { http, calls } = fakeHttp((url) =>
      url.endsWith("/checkout-sessions")
        ? { status: 200, body: { data: { id: "cs_b1", checkout_url: "https://checkout.bachs.io/cs_b1" } } }
        : { status: 200, body: { data: { id: "cs_b1", status: "succeeded", payment_id: "pay_7", amount: "1500.50", currency: "GHS", metadata: { momentumdesk_reference: "att_123" }, payment_method: "mobile_money" } } },
    );
    expect(await bachs.createCheckout(creds, { ...request, currency: "GHS", amountMinor: 150050n }, http)).toEqual({ url: "https://checkout.bachs.io/cs_b1", sessionId: "cs_b1" });
    expect(calls[0].url).toBe("https://sandbox-api.bachs.io/v1/checkout-sessions");
    expect(JSON.parse(calls[0].body!).pricing).toEqual({ currency: "GHS", amount: "1500.50", description: "Invoice INV-0001" });
    expect(await bachs.fetchPayment(creds, { reference: "att_123", sessionId: "cs_b1" }, http)).toEqual({
      status: "succeeded", reference: "att_123", providerReference: "bachs:pay_7", amountMinor: 150050n, currency: "GHS", method: "mobile_money",
    });
  });

  it("marks an unreadable amount so reconciliation refuses it", async () => {
    const { http } = fakeHttp(() => ({ status: 200, body: { id: "cs_b1", status: "succeeded", amount: "15.005", currency: "GHS" } }));
    expect((await bachs.fetchPayment(creds, { reference: "att_123", sessionId: "cs_b1" }, http))?.amountMinor).toBe(-1n);
  });

  it("verifies both signature header forms", () => {
    const body = JSON.stringify({ id: "evt_b1", type: "collection.succeeded", data: { id: "cs_b1", metadata: { momentumdesk_reference: "att_123" } } });
    const sig = createHmac("sha256", "bachs_whsec").update(`${t}.${body}`).digest("hex");
    expect(bachs.verifyWebhook(creds, body, new Headers({ "x-bachs-signature-v2": `t=${t},v1=${sig}` }), now)).toMatchObject({ eventId: "evt_b1", reference: "att_123" });
    expect(bachs.verifyWebhook(creds, body, new Headers({ "x-bachs-timestamp": t, "x-bachs-signature": sig }), now)).toMatchObject({ eventId: "evt_b1" });
    expect(() => bachs.verifyWebhook(creds, body, new Headers({ "x-bachs-signature-v2": `t=${t},v1=${"0".repeat(64)}` }), now)).toThrow(WebhookSignatureError);
  });
});
