import * as Sentry from "@sentry/nextjs";
import { scrubText } from "./scrub";
import { sentryOptions } from "./sentry-options";

/**
 * Starts Sentry with MomentumDesk's options (server, edge and browser).
 * Besides the event and span scrubbers, it scrubs two things no other hook
 * sees: the trace context attached to every envelope and outgoing request
 * (it carries the trace's name), and release-health sessions (sent whenever
 * a release is set, as on Vercel), which carry the user's IP address.
 */
export function initSentry(overrides: Parameters<typeof Sentry.init>[0] = {}) {
  const client = Sentry.init({ ...sentryOptions(), ...overrides });
  client?.on("createDsc", (dsc) => {
    if (dsc.transaction) dsc.transaction = scrubText(dsc.transaction);
  });
  client?.on("beforeSendSession", (session) => {
    if ("aggregates" in session) {
      if (session.attrs) delete session.attrs.ip_address;
    } else {
      session.ipAddress = undefined;
      session.userAgent = undefined;
    }
  });
  return client;
}
