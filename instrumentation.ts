import * as Sentry from "@sentry/nextjs";
import { initSentry } from "@/lib/observability/sentry";

/** Starts error monitoring when a server instance starts (Node.js or edge). */
export function register() {
  initSentry();
}

/** Reports errors thrown while rendering or handling a request on the server. */
export const onRequestError = Sentry.captureRequestError;
