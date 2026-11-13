import { createHmac } from "node:crypto";
import { fromDecimalString, money, toDecimalString } from "@/lib/money";
import { type PaymentProvider, readJson, safeEqualHex, WebhookSignatureError } from "./types";

/**
 * Bachs (decision D19): cards priced in USD, African mobile money, bank
 * transfer and stablecoins. TO CONFIRM IN THE BACHS SANDBOX before live use:
 * this adapter follows Bachs's published quickstart and third-party SDKs,
 * because the official reference could not be read from the build
 * environment. In particular: the ad-hoc "pricing" block (decimal amount in
 * major units), the session fields read back, and the webhook signature
 * (X-Bachs-Signature-V2 "t=…,v1=…", HMAC-SHA256 of "t.body", 5-minute
 * window). Reconciliation records nothing unless the amount, currency and
 * reference read back from Bachs match the attempt, so a mismatch here is
 * refused rather than mis-recorded.
 */

const API = { live: "https://api.bachs.io/v1", test: "https://sandbox-api.bachs.io/v1" };
const TOLERANCE_SECONDS = 300;

const base = (secretKey: string) => (bachs.modeOf(secretKey) === "live" ? API.live : API.test);

export const bachs: PaymentProvider = {
  key: "bachs",
  name: "Bachs",
  currencies: ["USD", "NGN", "GHS", "KES", "UGX", "XAF", "XOF", "RWF", "ZMW", "TZS"],
  canCharge: (amountMinor, currency) => amountMinor > 0n && bachs.currencies.includes(currency),
  modeOf: (secretKey) => (/_live_/.test(secretKey) ? "live" : /_test_|_sandbox_/.test(secretKey) ? "test" : "unknown"),

  async createCheckout({ secretKey }, request, http) {
    const body = await readJson(
      await http(`${base(secretKey)}/checkout-sessions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json", "Idempotency-Key": request.reference },
        body: JSON.stringify({
          pricing: { currency: request.currency, amount: toDecimalString(money(request.amountMinor, request.currency)), description: request.description },
          customer: request.email ? { email: request.email } : undefined,
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
          reference: request.reference,
          metadata: { momentumdesk_reference: request.reference },
        }),
      }),
      "Bachs",
    );
    const data = (body.data ?? body) as { id?: string; checkout_url?: string; url?: string };
    const url = data.checkout_url ?? data.url;
    if (!url || !data.id) throw new Error("Bachs did not return a checkout link");
    return { url, sessionId: data.id };
  },

  async fetchPayment({ secretKey }, { sessionId }, http) {
    if (!sessionId) return null;
    const response = await http(`${base(secretKey)}/checkout-sessions/${encodeURIComponent(sessionId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (response.status === 404) return null;
    const body = await readJson(response, "Bachs");
    const data = (body.data ?? body) as {
      id?: string; status?: string; payment_id?: string; reference?: string; metadata?: Record<string, string>;
      amount?: string | number; currency?: string; payment_method?: string;
    };
    const currency = String(data.currency ?? "").toUpperCase();
    let amountMinor = 0n;
    try {
      amountMinor = fromDecimalString(String(data.amount ?? "0"), currency).amountMinor;
    } catch {
      amountMinor = -1n; // unreadable: reconciliation will refuse it as a mismatch
    }
    const status = ["succeeded", "paid", "completed"].includes(data.status ?? "") ? "succeeded" : ["failed", "expired", "cancelled"].includes(data.status ?? "") ? "failed" : "pending";
    return {
      status,
      reference: data.metadata?.momentumdesk_reference ?? data.reference ?? null,
      providerReference: `bachs:${data.payment_id ?? data.id}`,
      amountMinor,
      currency,
      method: data.payment_method === "mobile_money" ? "mobile_money" : data.payment_method === "bank_transfer" ? "bank_transfer" : data.payment_method === "card" ? "card" : "other",
    };
  },

  verifyWebhook({ webhookSecret }, rawBody, headers, now) {
    if (!webhookSecret) throw new WebhookSignatureError("Bachs webhook secret is not set");
    const header = headers.get("x-bachs-signature-v2");
    let timestamp: string | undefined;
    let signatures: string[] = [];
    if (header) {
      const parts = header.split(",").map((part) => part.split("=") as [string, string]);
      timestamp = parts.find(([k]) => k === "t")?.[1];
      signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
    } else {
      timestamp = headers.get("x-bachs-timestamp") ?? undefined;
      signatures = [headers.get("x-bachs-signature") ?? ""];
    }
    if (!timestamp || !signatures[0]) throw new WebhookSignatureError();
    if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) throw new WebhookSignatureError("Webhook timestamp is too old");
    const expected = createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
    if (!signatures.some((signature) => safeEqualHex(signature, expected))) throw new WebhookSignatureError();
    const event = JSON.parse(rawBody) as { id?: string; type?: string; event?: string; data?: { id?: string; checkout_session_id?: string; reference?: string; metadata?: Record<string, string> } };
    return {
      eventId: event.id ?? `${event.type ?? event.event}:${event.data?.id}`,
      type: event.type ?? event.event ?? "unknown",
      reference: event.data?.metadata?.momentumdesk_reference ?? event.data?.reference ?? null,
      sessionId: event.data?.checkout_session_id ?? event.data?.id ?? null,
    };
  },
};
