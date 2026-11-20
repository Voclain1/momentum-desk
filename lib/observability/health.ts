import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db";
import type { DbClient } from "@/lib/db/client";

const DATABASE_TIMEOUT_MS = 3_000;

/** A worker that has not been seen for this long is reported as stale (it beats every 15 seconds). */
export const WORKER_STALE_MS = 5 * 60_000;

export interface HealthReport {
  status: "ok" | "unavailable";
  /** worker: "missing" when no worker has ever run, "stale" when none has been seen recently. */
  checks: { database: "ok" | "error"; worker: "ok" | "stale" | "missing" | "unknown" };
  /** Deployed commit, to confirm which version is live. */
  version: string | null;
}

/**
 * For uptime monitoring and deploy checks. Reports only ok/error per
 * dependency: never error messages, hostnames or configuration.
 */
export async function checkHealth(client: DbClient = db, { strict = false, now = new Date() }: { strict?: boolean; now?: Date } = {}): Promise<HealthReport> {
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
  let worker: HealthReport["checks"]["worker"] = "unknown";
  if (database === "ok") {
    const latest = await client.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }).catch(() => null);
    worker = !latest ? "missing" : now.getTime() - latest.lastSeenAt.getTime() > WORKER_STALE_MS ? "stale" : "ok";
  }
  // Strict mode is for uptime monitors: the worker must be running too. The
  // container health check stays lenient so the web app is not restarted for it.
  const healthy = database === "ok" && (!strict || worker === "ok");
  return {
    status: healthy ? "ok" : "unavailable",
    checks: { database, worker },
    // Set by the image build (Dockerfile, APP_VERSION build argument).
    version: process.env.APP_VERSION?.slice(0, 7) || null,
  };
}
