import { createHmac } from "node:crypto";
import { currencyExponent, isCurrencyCode } from "@/lib/money";
import { type PaymentProvider, readJson, safeEqualHex, WebhookSignatureError } from "./types";

/**
 * Stripe (decision D19): UK, US, EU and other direct-signup countries, with
 * Checkout Sessions. Amounts are in the smallest unit, which matches ISO 4217
 * minor units, except that Stripe charges three-decimal currencies only in
 * tens (the last digit must be 0). Webhooks carry Stripe-Signature
 * "t=…,v1=…", an HMAC-SHA256 of "t.body" with the endpoint's signing secret,
 * accepted within five minutes.
 */

const API = "https://api.stripe.com/v1";
const TOLERANCE_SECONDS = 300;

const form = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

export const stripe: PaymentProvider = {
  key: "stripe",
  name: "Stripe",
  currencies: [
    "USD", "GBP", "EUR", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN",
    "JPY", "SGD", "HKD", "AED", "INR", "ZAR", "KES", "NGN", "GHS", "MXN", "BRL", "KWD", "BHD", "OMR", "JOD",
  ].filter(isCurrencyCode),
  canCharge(amountMinor, currency) {
    if (amountMinor <= 0n || !stripe.currencies.includes(currency) || !isCurrencyCode(currency)) return false;
    return currencyExponent(currency) === 3 ? amountMinor % 10n === 0n : true;
  },
  modeOf: (secretKey) =>
    /^(sk|rk)_live_/.test(secretKey) ? "live" : /^(sk|rk)_test_/.test(secretKey) ? "test" : "unknown",

  async createCheckout({ secretKey }, request, http) {
    const body = await readJson(
      await http(`${API}/checkout/sessions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": request.reference },
        body: form({
          mode: "payment",
          "line_items[0][quantity]": "1",
          "line_items[0][price_data][currency]": request.currency.toLowerCase(),
          "line_items[0][price_data][unit_amount]": request.amountMinor.toString(),
          "line_items[0][price_data][product_data][name]": request.description,
          client_reference_id: request.reference,
          "metadata[momentumdesk_reference]": request.reference,
          "payment_intent_data[metadata][momentumdesk_reference]": request.reference,
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
          ...(request.email ? { customer_email: request.email } : {}),
        }),
      }),
      "Stripe",
    );
    if (typeof body.url !== "string" || typeof body.id !== "string") throw new Error("Stripe did not return a checkout link");
    return { url: body.url, sessionId: body.id };
  },

  async fetchPayment({ secretKey }, { sessionId }, http) {
    if (!sessionId) return null;
    const response = await http(`${API}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (response.status === 404) return null;
    const session = await readJson(response, "Stripe");
    const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
    const status = paid ? "succeeded" : session.status === "expired" ? "failed" : "pending";
    const intent = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent as { id?: string } | null)?.id;
    return {
      status,
      reference: (session.client_reference_id as string | null) ?? null,
      providerReference: `stripe:${intent ?? session.id}`,
      amountMinor: BigInt((session.amount_total as number | null) ?? 0),
      currency: String(session.currency ?? "").toUpperCase(),
      method: "card",
    };
  },

  verifyWebhook({ webhookSecret }, rawBody, headers, now) {
    if (!webhookSecret) throw new WebhookSignatureError("Stripe webhook signing secret is not set");
    const parts = (headers.get("stripe-signature") ?? "").split(",").map((part) => part.split("=") as [string, string]);
    const timestamp = parts.find(([k]) => k === "t")?.[1];
    const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
    if (!timestamp || signatures.length === 0) throw new WebhookSignatureError();
    if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) throw new WebhookSignatureError("Webhook timestamp is too old");
    const expected = createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
    if (!signatures.some((signature) => safeEqualHex(signature, expected))) throw new WebhookSignatureError();
    const event = JSON.parse(rawBody) as { id?: string; type?: string; data?: { object?: { id?: string; client_reference_id?: string | null; metadata?: Record<string, string> } } };
    const object = event.data?.object;
    return {
      eventId: event.id ?? "unknown",
      type: event.type ?? "unknown",
      reference: object?.client_reference_id ?? object?.metadata?.momentumdesk_reference ?? null,
      sessionId: object?.id?.startsWith("cs_") ? object.id : null,
    };
  },
};
