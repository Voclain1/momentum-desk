import { createHash } from "node:crypto";
import type { DbClient } from "@/lib/db/client";

/**
 * Fixed-window rate limits for public and costly endpoints (spec §12),
 * counted in PostgreSQL so they hold across restarts and processes. A
 * bucket's key is a SHA-256 of the scope and subject (an IP address or a
 * user id): addresses themselves are never stored.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets. */
  retryAfter: number;
}

export interface RateLimiter {
  hit(scope: string, subject: string, limit: number, windowSeconds: number, now?: Date): Promise<RateLimitResult>;
}

export function createRateLimiter(db: DbClient): RateLimiter {
  return {
    async hit(scope, subject, limit, windowSeconds, now = new Date()) {
      const windowMs = windowSeconds * 1000;
      const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
      const key = createHash("sha256").update(`${scope}\u0000${subject}`).digest("hex");
      const [row] = await db.$queryRaw<{ count: number }[]>`
        INSERT INTO "rateLimitBucket" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE WHEN "rateLimitBucket"."windowStart" = EXCLUDED."windowStart" THEN "rateLimitBucket"."count" + 1 ELSE 1 END,
          "windowStart" = EXCLUDED."windowStart"
        RETURNING "count"`;
      // Now and then, clear buckets no window still uses.
      if (Math.random() < 0.01) {
        await db.$executeRaw`DELETE FROM "rateLimitBucket" WHERE "windowStart" < ${new Date(now.getTime() - 86_400_000)}`;
      }
      return { allowed: row.count <= limit, retryAfter: Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000) };
    },
  };
}

/**
 * The client's address. Behind Caddy (deploy/Caddyfile) X-Forwarded-For is
 * set by the proxy from the connection, not taken from the client.
 */
export function clientAddress(headers: { get(name: string): string | null }): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

/** Limits per scope: [requests, window in seconds]. */
export const LIMITS = {
  /** Opening public quote and invoice pages and PDFs, per address. */
  documentView: [60, 60],
  /** Starting an online payment, per address. */
  checkout: [10, 600],
  /** A customer stopping reminders, per address. */
  stopReminders: [10, 3600],
  /** Asking for a quote acceptance code (an email), per address; each quote has its own limit too. */
  acceptanceCode: [10, 600],
  /** Momentum AI requests, per person; the workspace's monthly limit applies as well. */
  ai: [20, 600],
} as const satisfies Record<string, readonly [number, number]>;
