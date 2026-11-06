import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/observability/sentry-options";

// Browser error monitoring. Session replay is deliberately not enabled:
// screens contain customer and financial data.
Sentry.init(sentryOptions());

/** Links slow or failing pages to the navigation that led to them. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
