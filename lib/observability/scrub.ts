/**
 * Removes personal data and secrets from an error event before it leaves the
 * app (docs/product-spec.md §12). Applied to every Sentry event, on top of
 * Sentry's own `sendDefaultPii: false`.
 *
 * Kept: internal user and organization ids, which identify nobody outside
 * MomentumDesk and let support find the affected workspace.
 */

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
]);

/** Query parameters that carry one-time secrets (magic links, password resets, invitations). */
const SECRET_PARAMS = /([?&](?:token|code|callbackURL|invitationId|email)=)[^&#\s'"()]*/gi;
/** Path segments that are themselves secrets. */
const SECRET_PATHS = /(\/(?:reset-password|invite|magic-link\/verify|verify-email)\/)[^/?#\s'"()]+/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

export function scrubText(text: string): string {
  return text
    .replace(SECRET_PARAMS, "$1[redacted]")
    .replace(SECRET_PATHS, "$1[redacted]")
    .replace(EMAIL, "[email]")
    .replace(IPV4, "[ip]");
}

interface StackFrame {
  /** Local variable values captured by the Node SDK: may hold any data. */
  vars?: unknown;
  pre_context?: string[];
  context_line?: string;
  post_context?: string[];
}

interface ScrubbableEvent {
  message?: string;
  request?: {
    url?: string;
    query_string?: unknown;
    headers?: Record<string, string>;
    cookies?: unknown;
    data?: unknown;
  };
  user?: { id?: string | number; email?: string; ip_address?: string | null; username?: string; [key: string]: unknown };
  exception?: { values?: { value?: string; stacktrace?: { frames?: StackFrame[] } }[] };
  breadcrumbs?: { message?: string; data?: Record<string, unknown> }[];
}

export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.message) event.message = scrubText(event.message);

  if (event.request) {
    const { request } = event;
    if (request.url) request.url = scrubText(request.url);
    delete request.query_string;
    delete request.cookies;
    // Request bodies can hold passwords, emails and customer data.
    delete request.data;
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        if (SENSITIVE_HEADERS.has(name.toLowerCase())) delete request.headers[name];
      }
    }
  }

  if (event.user) event.user = event.user.id === undefined ? {} : { id: event.user.id };

  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = scrubText(value.value);
    for (const frame of value.stacktrace?.frames ?? []) {
      delete frame.vars;
      if (frame.context_line) frame.context_line = scrubText(frame.context_line);
      if (frame.pre_context) frame.pre_context = frame.pre_context.map(scrubText);
      if (frame.post_context) frame.post_context = frame.post_context.map(scrubText);
    }
  }

  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubText(crumb.message);
    if (crumb.data) {
      for (const key of ["url", "to", "from"]) {
        if (typeof crumb.data[key] === "string") crumb.data[key] = scrubText(crumb.data[key] as string);
      }
    }
  }
  return event;
}
