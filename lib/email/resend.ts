import type { EmailMessage, EmailSender } from "./index";

/**
 * Sends email through Resend's HTTP API (decision D17). Plain fetch, no SDK.
 * The sending domain must be verified in Resend for `from` to be accepted.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export class EmailDeliveryError extends Error {
  constructor(readonly status: number | null, detail: string) {
    // Never includes the API key or the recipient.
    super(`Email delivery failed (${status ?? "no response"}): ${detail}`);
    this.name = "EmailDeliveryError";
  }
}

export interface ResendOptions {
  apiKey: string;
  /** e.g. "MomentumDesk <no-reply@momentumdesk.app>" */
  from: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export function createResendEmailSender({ apiKey, from, fetch: doFetch = fetch }: ResendOptions): EmailSender {
  return {
    async send({ to, subject, text, idempotencyKey }: EmailMessage) {
      let response: Response;
      try {
        response = await doFetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            // Resend ignores a repeat of the same key for 24 hours.
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          },
          body: JSON.stringify({ from, to: [to], subject, text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "network error";
        throw new EmailDeliveryError(null, reason);
      }
      if (!response.ok) {
        // Resend errors look like { name, message }; keep only the name.
        const body = (await response.json().catch(() => null)) as { name?: unknown } | null;
        const name = typeof body?.name === "string" ? body.name : "unknown_error";
        throw new EmailDeliveryError(response.status, name);
      }
    },
  };
}
