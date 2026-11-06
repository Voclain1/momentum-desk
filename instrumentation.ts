import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/observability/sentry-options";

/** Starts error monitoring when a server instance starts (Node.js or edge). */
export function register() {
  Sentry.init(sentryOptions());
}

/** Reports errors thrown while rendering or handling a request on the server. */
export const onRequestError = Sentry.captureRequestError;
