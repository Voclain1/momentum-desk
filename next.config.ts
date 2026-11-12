import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { parseEnv } from "./lib/env";

// Fail fast on a misconfigured environment when `next dev`/`next build` starts.
parseEnv(process.env);

const nextConfig: NextConfig = {
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
