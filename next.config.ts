import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { parseEnv } from "./lib/env";

// Fail fast on a misconfigured environment when `next dev`/`next build` starts.
const env = parseEnv(process.env);

/** Sent with every response (spec §12). HSTS only when the app is served over HTTPS. */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // No other site may frame MomentumDesk (clickjacking); no plugins; no <base> tricks.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  ...(env.APP_URL?.startsWith("https://") ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // PDF routes read the embedded fonts from disk (lib/documents/quote-pdf.ts).
  outputFileTracingIncludes: {
    "/app/quotes/\\[id\\]/pdf": ["./lib/documents/fonts/**/*"],
    "/q/\\[token\\]/pdf": ["./lib/documents/fonts/**/*"],
    "/app/invoices/\\[id\\]/pdf": ["./lib/documents/fonts/**/*"],
    "/i/\\[token\\]/pdf": ["./lib/documents/fonts/**/*"],
  },
  experimental: {
    // CSV imports accept files up to 1 MB (lib/transfer); leave room for
    // the multipart overhead around the file.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

// Error monitoring (decision D8). Source maps are uploaded only when
// SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are set at build time;
// without them the build still succeeds and Sentry shows minified traces.
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    // Upload maps to Sentry, then delete them so they are not served publicly.
    deleteSourcemapsAfterUpload: true,
  },
});
