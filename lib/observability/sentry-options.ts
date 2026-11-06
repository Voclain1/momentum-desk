import { scrubEvent } from "./scrub";

/**
 * Shared Sentry settings for the server, edge and browser (decision D8).
 * Sentry is off unless NEXT_PUBLIC_SENTRY_DSN is set. A DSN only allows
 * sending events to the project, so it is safe in the browser bundle.
 */
export function sentryOptions() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;
  return {
    dsn,
    enabled: Boolean(dsn),
    // "production" or "preview" on Vercel, so the two never mix in Sentry.
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV,
    // Never attach IP addresses, cookies or request bodies by default.
    sendDefaultPii: false,
    // A tenth of requests are traced for performance; errors are always sent.
    tracesSampleRate: 0.1,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  };
}
