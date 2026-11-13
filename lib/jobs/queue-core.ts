import type { DbClient } from "@/lib/db/client";
import type { Job } from "@/lib/generated/prisma/client";

/**
 * The worker's side of the queue (decision D18). Due jobs are claimed with
 * FOR UPDATE SKIP LOCKED, so several workers never take the same job; a job
 * whose worker died (locked for longer than LOCK_TIMEOUT) is claimed again.
 * Failures retry with exponential back-off; after the last attempt a job is
 * "dead" and waits for a person (retryDead). Only this file reads jobs
 * across workspaces, through the job_worker_access policy.
 */

export const LOCK_TIMEOUT_MINUTES = 10;

async function asWorker<T>(db: DbClient, work: (tx: Parameters<Parameters<DbClient["$transaction"]>[0]>[0]) => Promise<T>) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.job_worker', 'on', true)`;
    return work(tx);
  });
}

export async function claimJobs(db: DbClient, workerId: string, limit: number, now: Date): Promise<Job[]> {
  return asWorker(db, (tx) =>
    tx.$queryRaw<Job[]>`
      UPDATE "job" SET "status" = 'running', "lockedAt" = ${now}, "lockedBy" = ${workerId}, "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "job"
        WHERE ("status" = 'queued' AND "runAt" <= ${now})
           OR ("status" = 'running' AND "lockedAt" < ${new Date(now.getTime() - LOCK_TIMEOUT_MINUTES * 60_000)})
        ORDER BY "runAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
  );
}

export async function completeJob(db: DbClient, job: Job, now: Date) {
  await asWorker(db, (tx) =>
    tx.job.updateMany({ where: { id: job.id, lockedBy: job.lockedBy }, data: { status: "succeeded", finishedAt: now, lockedAt: null, lastError: null } }),
  );
}

/** Back-off: 1, 2, 4 … minutes, at most 6 hours. */
export const backoffMs = (attempts: number) => Math.min(2 ** Math.max(0, attempts - 1), 360) * 60_000;

export async function failJob(db: DbClient, job: Job, error: unknown, now: Date) {
  const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 1000);
  const dead = job.attempts >= job.maxAttempts;
  await asWorker(db, (tx) =>
    tx.job.updateMany({
      where: { id: job.id, lockedBy: job.lockedBy },
      data: dead
        ? { status: "dead", finishedAt: now, lockedAt: null, lastError: message }
        : { status: "queued", runAt: new Date(now.getTime() + backoffMs(job.attempts)), lockedAt: null, lastError: message },
    }),
  );
  return dead ? "dead" : "retry";
}

/** Every workspace, for daily scheduling (the organization table is not tenant data). */
export async function organizationIds(db: DbClient): Promise<string[]> {
  return (await db.organization.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } })).map((o) => o.id);
}
