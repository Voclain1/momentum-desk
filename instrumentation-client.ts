import * as Sentry from "@sentry/nextjs";
import { initSentry } from "@/lib/observability/sentry";

// Browser error monitoring. Session replay is deliberately not enabled:
// screens contain customer and financial data.
initSentry();

/** Links slow or failing pages to the navigation that led to them. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
