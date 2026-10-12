/**
 * Returns `next` only if it is a same-site path, otherwise `fallback`.
 * Stops "?next=https://evil.example" style open redirects after sign-in.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  // Reject control characters, which some browsers strip before navigating.
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const url = new URL(next, "https://momentumdesk.invalid");
    if (url.origin !== "https://momentumdesk.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
