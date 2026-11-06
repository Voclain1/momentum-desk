import * as Sentry from "@sentry/nextjs";
import { scrubText } from "./scrub";
import { sentryOptions } from "./sentry-options";

/**
 * Starts Sentry with MomentumDesk's options (server, edge and browser).
 * Besides the event and span scrubbers, it scrubs the trace context Sentry
 * attaches to every envelope and outgoing request, which carries the trace's
 * name and is built before any other hook runs.
 */
export function initSentry(overrides: Parameters<typeof Sentry.init>[0] = {}) {
  const client = Sentry.init({ ...sentryOptions(), ...overrides });
  client?.on("createDsc", (dsc) => {
    if (dsc.transaction) dsc.transaction = scrubText(dsc.transaction);
  });
  return client;
}
