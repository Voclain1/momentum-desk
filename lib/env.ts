import { z } from "zod";

/**
 * Server environment schema. Add every new variable here so a misconfigured
 * deployment fails at startup rather than at first use. Secrets stay
 * server-side: never prefix them with NEXT_PUBLIC_.
 *
 * Build-only variables (SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT for
 * source map upload) are read by next.config.ts and are optional.
 */
const envSchema = z
  .object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Public origin of the app, e.g. https://momentumdesk.app. */
  APP_URL: z.url().optional(),
  /**
   * PostgreSQL connection string. On Neon use the pooled connection string
   * for the app; `prisma migrate` works with either.
   */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgres:// or postgresql:// URL" }),
  /**
   * Signs and encrypts session cookies and tokens. Generate with
   * `openssl rand -base64 32`; use a different value per environment.
   */
  BETTER_AUTH_SECRET: z.string().min(32, { error: "must be at least 32 characters" }),
  /**
   * Sentry project DSN (decision D8). Not a secret: it only allows sending
   * events, and the browser needs it. Unset turns error monitoring off.
   */
  NEXT_PUBLIC_SENTRY_DSN: z.url({ protocol: /^https$/, error: "must be an https:// Sentry DSN" }).optional(),
  /** Resend API key (decision D17). Without it, production cannot send email. */
  RESEND_API_KEY: z.string().startsWith("re_", { error: 'must be a Resend API key starting with "re_"' }).optional(),
  /** Sender, e.g. "MomentumDesk <no-reply@momentumdesk.app>", on a domain verified in Resend. */
  EMAIL_FROM: z
    .string()
    .regex(/^(?:[^<>]+<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/, {
      error: 'must be an address or "Name <address>"',
    })
    .optional(),
  /**
   * End-to-end tests only: write emails to this file (one JSON object per
   * line) instead of sending them, so a test can read a link or code. Refused
   * unless APP_URL is localhost, so it can never divert production email.
   */
  EMAIL_TEST_OUTBOX: z.string().optional(),
  /** Open Exchange Rates app id for daily exchange rates (D38). Optional: staff can enter rates. */
  FX_PROVIDER_KEY: z.string().min(10).optional(),
  /**
   * End-to-end tests only: send payment provider API calls to this local
   * stand-in instead of the real providers. Refused unless APP_URL is localhost.
   */
  PAYMENTS_TEST_API: z.url().optional(),
  /**
   * Encrypts payment providers' secret keys at rest (decision D35): 32
   * random bytes, base64 (`openssl rand -base64 32`). Required to connect a
   * provider; changing it makes stored provider keys unreadable.
   */
  PROVIDER_SECRETS_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === 32, { error: "must be 32 bytes, base64 (openssl rand -base64 32)" })
    .optional(),
})
  .refine((env) => !env.RESEND_API_KEY === !env.EMAIL_FROM, {
    error: "RESEND_API_KEY and EMAIL_FROM must be set together",
    path: ["EMAIL_FROM"],
  })
  .refine((env) => !env.EMAIL_TEST_OUTBOX || isLocalUrl(env.APP_URL), {
    error: "is only allowed when APP_URL is a localhost address",
    path: ["EMAIL_TEST_OUTBOX"],
  })
  .refine((env) => !env.PAYMENTS_TEST_API || (isLocalUrl(env.APP_URL) && isLocalUrl(env.PAYMENTS_TEST_API)), {
    error: "is only allowed for a localhost app and a localhost stand-in",
    path: ["PAYMENTS_TEST_API"],
  });

/** Whether a URL points at this machine (http://localhost:3000, http://127.0.0.1). */
export function isLocalUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment variables:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "InvalidEnvironmentError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings as unset so `FOO=` in a .env file means "not provided".
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new InvalidEnvironmentError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return result.data;
}
