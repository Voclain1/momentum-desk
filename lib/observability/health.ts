import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db";
import type { DbClient } from "@/lib/db/client";

const DATABASE_TIMEOUT_MS = 3_000;

export interface HealthReport {
  status: "ok" | "unavailable";
  checks: { database: "ok" | "error" };
  /** Deployed commit, to confirm which version is live. */
  version: string | null;
}

/**
 * For uptime monitoring and deploy checks. Reports only ok/error per
 * dependency: never error messages, hostnames or configuration.
 */
export async function checkHealth(client: DbClient = db): Promise<HealthReport> {
  let database: "ok" | "error" = "ok";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Database health check timed out")), DATABASE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    database = "error";
    Sentry.captureException(error, { tags: { check: "health.database" } });
  } finally {
    clearTimeout(timer);
  }
  return {
    status: database === "ok" ? "ok" : "unavailable",
    checks: { database },
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  };
}
