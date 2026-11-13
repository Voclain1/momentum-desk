import type { DbClient } from "@/lib/db/client";
import { todayIn } from "@/lib/dates";
import type { Job } from "@/lib/generated/prisma/client";
import type { TenantData } from "@/lib/tenant/core";
import { claimJobs, completeJob, failJob, organizationIds } from "./queue-core";
import { enqueue } from "./queue";

/**
 * The background worker (decision D18): runs due jobs, and once a day per
 * workspace (in its own timezone) enqueues the daily jobs. Handlers must be
 * idempotent: a job can run again after a crash or a retry.
 */

export interface JobContext {
  data: TenantData;
  job: Job;
  now: Date;
}

export type JobHandler = (context: JobContext) => Promise<void>;

export interface WorkerDeps {
  db: DbClient;
  data: TenantData;
  handlers: Record<string, JobHandler>;
  /** Job kinds enqueued once a day for every workspace. */
  daily: string[];
  workerId: string;
  now?: () => Date;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}

export class UnknownJobError extends Error {
  constructor(kind: string) {
    super(`No handler for job kind "${kind}"`);
    this.name = "UnknownJobError";
  }
}

/** Runs up to `limit` due jobs once. */
export async function runDueJobs(deps: WorkerDeps, limit = 10) {
  const now = deps.now?.() ?? new Date();
  const jobs = await claimJobs(deps.db, deps.workerId, limit, now);
  const result = { ran: jobs.length, succeeded: 0, retried: 0, dead: 0 };
  for (const job of jobs) {
    try {
      // A job reclaimed after its worker died may already be over its attempts.
      if (job.attempts > job.maxAttempts) throw new Error("Too many attempts (the previous worker stopped during this job)");
      const handler = deps.handlers[job.kind];
      if (!handler) throw new UnknownJobError(job.kind);
      await handler({ data: deps.data, job, now: deps.now?.() ?? new Date() });
      await completeJob(deps.db, job, deps.now?.() ?? new Date());
      result.succeeded++;
    } catch (error) {
      const outcome = await failJob(deps.db, job, error, deps.now?.() ?? new Date());
      result[outcome === "dead" ? "dead" : "retried"]++;
      deps.log?.(`job ${outcome}`, { jobId: job.id, kind: job.kind, attempts: job.attempts, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/** Enqueues today's daily jobs for every workspace; safe to call as often as wanted. */
export async function scheduleDaily(deps: WorkerDeps) {
  const now = deps.now?.() ?? new Date();
  let enqueued = 0;
  for (const organizationId of await organizationIds(deps.db)) {
    await deps.data.transaction(organizationId, async (tenant) => {
      // The day in the workspace's own timezone, so a daily job runs once per local day.
      const timezone = (await deps.db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }))?.timezone ?? "UTC";
      const day = todayIn(timezone, now);
      for (const kind of deps.daily) {
        await enqueue(tenant, { kind, key: day, payload: { day }, runAt: now });
        enqueued++;
      }
    });
  }
  return enqueued;
}

/** Runs until `signal` aborts: schedule, then drain due jobs, then wait. */
export async function runWorker(deps: WorkerDeps, { intervalMs = 15_000, signal }: { intervalMs?: number; signal: AbortSignal }) {
  let lastSchedule = 0;
  while (!signal.aborted) {
    try {
      if (Date.now() - lastSchedule > 5 * 60_000) {
        await scheduleDaily(deps);
        lastSchedule = Date.now();
      }
      let batch;
      do {
        batch = await runDueJobs(deps);
      } while (batch.ran > 0 && !signal.aborted);
    } catch (error) {
      deps.log?.("worker tick failed", { error: error instanceof Error ? error.message : String(error) });
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      signal.addEventListener("abort", () => (clearTimeout(timer), resolve(undefined)), { once: true });
    });
  }
}
