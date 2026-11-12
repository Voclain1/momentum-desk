import { createHmac } from "node:crypto";
import {
  type PaymentProvider,
  type ProviderPayment,
  readJson,
  safeEqualHex,
  WebhookSignatureError,
} from "./types";

/**
 * Paystack (decision D19): Nigeria, Ghana, Kenya, South Africa. Amounts are
 * in the currency's subunit (kobo, pesewas, cents), which for these
 * currencies equals our minor units. Webhooks carry x-paystack-signature, an
 * HMAC-SHA512 of the raw body keyed with the secret key. Every webhook is
 * confirmed by GET /transaction/verify before anything is recorded.
 */

const API = "https://api.paystack.co";

const METHODS: Record<string, ProviderPayment["method"]> = {
  card: "card", bank: "bank_transfer", bank_transfer: "bank_transfer", ussd: "bank_transfer",
  mobile_money: "mobile_money", qr: "other", eft: "bank_transfer",
};

export const paystack: PaymentProvider = {
  key: "paystack",
  name: "Paystack",
  // XOF (Côte d'Ivoire) and EGP are left out until confirmed in a Paystack sandbox.
  currencies: ["NGN", "GHS", "KES", "ZAR", "USD"],
  canCharge: (amountMinor, currency) => amountMinor > 0n && paystack.currencies.includes(currency),
  modeOf: (secretKey) => (secretKey.startsWith("sk_live_") ? "live" : secretKey.startsWith("sk_test_") ? "test" : "unknown"),

  async createCheckout({ secretKey }, request, http) {
    // Paystack needs an email for every transaction.
    if (!request.email) throw new Error("Paystack needs the payer's email address");
    const body = await readJson(
      await http(`${API}/transaction/initialize`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: request.email,
          amount: request.amountMinor.toString(),
          currency: request.currency,
          reference: request.reference,
          callback_url: request.successUrl,
          metadata: { momentumdesk_reference: request.reference, cancel_action: request.cancelUrl },
        }),
      }),
      "Paystack",
    );
    const data = body.data as { authorization_url?: string; reference?: string } | undefined;
    if (!data?.authorization_url) throw new Error("Paystack did not return a checkout link");
    return { url: data.authorization_url, sessionId: data.reference ?? request.reference };
  },

  async fetchPayment({ secretKey }, { reference }, http) {
    const response = await http(`${API}/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (response.status === 404) return null;
    const body = await readJson(response, "Paystack");
    const data = body.data as { status?: string; reference?: string; id?: number | string; amount?: number | string; currency?: string; channel?: string } | undefined;
    if (!data) return null;
    const status = data.status === "success" ? "succeeded" : ["failed", "abandoned", "reversed"].includes(data.status ?? "") ? "failed" : "pending";
    return {
      status,
      reference: data.reference ?? null,
      providerReference: `paystack:${data.id ?? data.reference}`,
      amountMinor: BigInt(data.amount ?? 0),
      currency: (data.currency ?? "").toUpperCase(),
      method: METHODS[data.channel ?? ""] ?? "other",
    };
  },

  verifyWebhook({ secretKey }, rawBody, headers) {
    const signature = headers.get("x-paystack-signature") ?? "";
    const expected = createHmac("sha512", secretKey).update(rawBody, "utf8").digest("hex");
    if (!safeEqualHex(signature, expected)) throw new WebhookSignatureError();
    const event = JSON.parse(rawBody) as { event?: string; data?: { id?: number | string; reference?: string } };
    const reference = event.data?.reference ?? null;
    return {
      // Paystack sends no event id; the transaction id and event type identify a delivery.
      eventId: `${event.event ?? "unknown"}:${event.data?.id ?? reference ?? "none"}`,
      type: event.event ?? "unknown",
      reference,
      sessionId: reference,
    };
  },
};
