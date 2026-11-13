import type { Prisma } from "@/lib/generated/prisma/client";
import type { TenantDb } from "@/lib/tenant/core";

/**
 * Enqueues background work inside the caller's tenant transaction (decision
 * D18): if the change that causes the job rolls back, so does the job, and a
 * committed change always has its job (a transactional outbox). The same
 * (kind, key) is enqueued once, so callers can enqueue freely.
 */
export async function enqueue(
  tenant: TenantDb,
  job: { kind: string; key: string; payload?: Prisma.InputJsonValue; runAt?: Date; maxAttempts?: number },
) {
  await tenant.job.createMany({
    data: [{ kind: job.kind, key: job.key, payload: job.payload ?? {}, runAt: job.runAt ?? new Date(), maxAttempts: job.maxAttempts ?? 5 }],
    skipDuplicates: true,
  });
}
