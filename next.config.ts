import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { parseEnv } from "./lib/env";

// Fail fast on a misconfigured environment when `next dev`/`next build` starts.
parseEnv(process.env);

const nextConfig: NextConfig = {
  /* config options here */
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
