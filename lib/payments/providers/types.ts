/**
 * Payment providers as adapters (spec §6, decisions D19, D35, D36). Core code
 * talks only to this interface; provider-specific shapes stay in the adapter.
 * Amounts are integer minor units of the ISO 4217 currency, as everywhere in
 * MomentumDesk; each adapter converts to its provider's convention.
 */

export const PROVIDER_KEYS = ["paystack", "stripe", "bachs"] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];

/** A workspace's own credentials, decrypted only for the call. */
export interface ProviderCredentials {
  secretKey: string;
  /** Stripe and Bachs sign webhooks with a separate secret; Paystack uses the secret key. */
  webhookSecret: string | null;
}

export type Http = (url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string }) => Promise<{
  status: number;
  json(): Promise<unknown>;
}>;

export interface CheckoutRequest {
  /** Our payment attempt id: the provider echoes it back. */
  reference: string;
  amountMinor: bigint;
  currency: string;
  email: string | null;
  description: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  url: string;
  /** The provider's id for the checkout (session or transaction reference). */
  sessionId: string;
}

export type ProviderPaymentStatus = "succeeded" | "pending" | "failed";

/** What the provider says happened, read by our server from its API. */
export interface ProviderPayment {
  status: ProviderPaymentStatus;
  /** Our attempt reference as the provider recorded it. */
  reference: string | null;
  /** The provider's unique id for the money movement; one payment per id. */
  providerReference: string;
  amountMinor: bigint;
  currency: string;
  method: "card" | "bank_transfer" | "mobile_money" | "other";
}

/** A verified webhook, reduced to what reconciliation needs. */
export interface ProviderWebhook {
  /** Unique per delivery source, so a repeat is recognised. */
  eventId: string;
  type: string;
  /** Our attempt reference or the provider's session id, to find the attempt. */
  reference: string | null;
  sessionId: string | null;
}

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

export class WebhookSignatureError extends Error {
  constructor(message = "Webhook signature is not valid") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

export interface PaymentProvider {
  key: ProviderKey;
  name: string;
  /** Currencies this adapter can charge in (a workspace may enable fewer). */
  currencies: readonly string[];
  /** Whether the amount can be charged as-is (e.g. Stripe needs 3-decimal amounts in tens). */
  canCharge(amountMinor: bigint, currency: string): boolean;
  /** "test" or "live", from the key's form, where the provider shows it. */
  modeOf(secretKey: string): "test" | "live" | "unknown";
  createCheckout(credentials: ProviderCredentials, request: CheckoutRequest, http: Http): Promise<CheckoutResult>;
  /** Looks the payment up on the provider's API by our reference or its session id. */
  fetchPayment(credentials: ProviderCredentials, lookup: { reference: string; sessionId: string | null }, http: Http): Promise<ProviderPayment | null>;
  /** Verifies the signature on the raw body; throws WebhookSignatureError if it does not match. */
  verifyWebhook(credentials: ProviderCredentials, rawBody: string, headers: Headers, now: Date): ProviderWebhook;
}

/** Constant-time comparison of hex strings. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || !/^[0-9a-f]*$/i.test(a) || !/^[0-9a-f]*$/i.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function readJson(response: { status: number; json(): Promise<unknown> }, provider: string): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ProviderError(`${provider} returned an unreadable response`, response.status);
  }
  if (response.status >= 400) {
    const message = (body as { message?: string; error?: { message?: string } })?.error?.message ?? (body as { message?: string })?.message;
    throw new ProviderError(`${provider} refused the request${message ? `: ${message}` : ""}`, response.status);
  }
  return (body ?? {}) as Record<string, unknown>;
}
