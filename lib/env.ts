import { z } from "zod";

/**
 * Server environment schema. Add every new variable here so a misconfigured
 * deployment fails at startup rather than at first use. Secrets stay
 * server-side: never prefix them with NEXT_PUBLIC_.
 *
 * Variables for monitoring are added with the feature that uses them.
 */
const envSchema = z.object({
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
  /** Resend API key (decision D17). Without it, production cannot send email. */
  RESEND_API_KEY: z.string().startsWith("re_", { error: 'must be a Resend API key starting with "re_"' }).optional(),
  /** Sender, e.g. "MomentumDesk <no-reply@momentumdesk.app>", on a domain verified in Resend. */
  EMAIL_FROM: z
    .string()
    .regex(/^(?:[^<>]+<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/, {
      error: 'must be an address or "Name <address>"',
    })
    .optional(),
}).refine((env) => !env.RESEND_API_KEY === !env.EMAIL_FROM, {
  error: "RESEND_API_KEY and EMAIL_FROM must be set together",
  path: ["EMAIL_FROM"],
});

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
