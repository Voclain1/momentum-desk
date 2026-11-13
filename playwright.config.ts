import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Same env files as Next.js, Vitest and the Prisma CLI. Values already set win.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
/** Read by e2e/outbox.ts. */
export const EMAIL_OUTBOX = `${process.cwd()}/e2e/.outbox/emails.jsonl`;
/** Local stand-in for payment providers (e2e/mock-providers.mjs). */
const MOCK_PROVIDERS = "http://localhost:3200";
/** A fixed key for encrypting test provider keys; never used outside tests. */
const TEST_PROVIDER_SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");

/**
 * End-to-end tests run the production build against TEST_DATABASE_URL, the
 * same disposable database as `pnpm test:db`. CI builds first; locally the
 * web server command builds too.
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Use a preinstalled Chromium when one is provided (e.g. cloud dev boxes).
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: [
    {
      command: "node e2e/mock-providers.mjs",
      url: `${MOCK_PROVIDERS}/health`,
      reuseExistingServer: false,
    },
    {
      command: process.env.CI
        ? `pnpm start --port ${PORT}`
        : `pnpm build && pnpm start --port ${PORT}`,
      url: baseURL,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
        APP_URL: baseURL,
        // Emails go to this file so tests can read links and codes (lib/email).
        EMAIL_TEST_OUTBOX: EMAIL_OUTBOX,
        // Provider API calls go to the local stand-in (lib/payments/http.ts).
        PAYMENTS_TEST_API: MOCK_PROVIDERS,
        PROVIDER_SECRETS_KEY: TEST_PROVIDER_SECRETS_KEY,
      },
    },
  ],
});
