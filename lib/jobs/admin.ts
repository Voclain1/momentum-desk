import { recordAudit } from "@/lib/audit";
import { RecordNotFoundError } from "@/lib/errors";
import type { TenantData } from "@/lib/tenant/core";

/** A workspace's failed background work, for owners and admins (settings:write). */
export async function deadJobs(data: TenantData, organizationId: string) {
  return data.scoped(organizationId).job.findMany({ where: { status: "dead" }, orderBy: { finishedAt: "desc" }, take: 50 });
}

/** Puts a dead job back in the queue for a fresh set of attempts (manual recovery, spec §11). */
export async function retryDeadJob(data: TenantData, actor: { organizationId: string; userId: string }, jobId: string) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const { count } = await tenant.job.updateMany({
      where: { id: jobId, status: "dead" },
      data: { status: "queued", attempts: 0, runAt: new Date(), finishedAt: null, lockedAt: null, lockedBy: null },
    });
    if (count !== 1) throw new RecordNotFoundError("Failed job");
    await recordAudit(tenant, { action: "job.retried", actorUserId: actor.userId, targetType: "organization", targetId: actor.organizationId, metadata: { jobId } });
  });
}
