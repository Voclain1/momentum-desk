import { recordAudit } from "@/lib/audit";
import { AuthorizationError, hasPermission } from "@/lib/auth/authorization";
import type { DbClient } from "@/lib/db/client";
import { Prisma } from "@/lib/generated/prisma/client";
import { tenantInTransaction } from "@/lib/tenant/core";

/**
 * Closing a workspace (decision D25). An owner asks; the workspace keeps
 * working for 30 days so anyone can export it, and any owner can cancel.
 * Then the worker deletes the workspace and everything in it (backups
 * expire on their own schedule, docs/runbooks.md). Owners only
 * (ownership:manage), re-checked inside the transaction.
 */

export const CLOSURE_GRACE_DAYS = 30;

async function asOwner<T>(db: DbClient, organizationId: string, userId: string, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(
    async (tx) => {
      const membership = await tx.member.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { role: true } });
      if (!membership || !hasPermission(membership.role, "ownership:manage")) throw new AuthorizationError(403);
      return work(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function requestClosure(db: DbClient, { organizationId, userId }: { organizationId: string; userId: string }, now: Date = new Date()) {
  const deleteAfter = new Date(now.getTime() + CLOSURE_GRACE_DAYS * 86_400_000);
  return asOwner(db, organizationId, userId, async (tx) => {
    const { count } = await tx.organization.updateMany({
      where: { id: organizationId, closureRequestedAt: null },
      data: { closureRequestedAt: now, deleteAfter },
    });
    if (count === 1) {
      await recordAudit(await tenantInTransaction(tx, organizationId), {
        action: "workspace.closure_requested", actorUserId: userId, targetType: "organization", targetId: organizationId,
        metadata: { deleteAfter: deleteAfter.toISOString() },
      });
    }
    return (await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { deleteAfter: true } })).deleteAfter!;
  });
}

export async function cancelClosure(db: DbClient, { organizationId, userId }: { organizationId: string; userId: string }) {
  return asOwner(db, organizationId, userId, async (tx) => {
    const { count } = await tx.organization.updateMany({
      where: { id: organizationId, closureRequestedAt: { not: null } },
      data: { closureRequestedAt: null, deleteAfter: null },
    });
    if (count === 1) {
      await recordAudit(await tenantInTransaction(tx, organizationId), {
        action: "workspace.closure_cancelled", actorUserId: userId, targetType: "organization", targetId: organizationId,
      });
    }
  });
}

/** Deletes workspaces whose grace period has passed (the worker, each scheduling tick). Returns how many. */
export async function purgeClosedWorkspaces(db: DbClient, now: Date = new Date()) {
  const due = await db.organization.findMany({ where: { deleteAfter: { lte: now } }, select: { id: true } });
  for (const { id } of due) {
    // Every workspace table references the organization with ON DELETE CASCADE.
    await db.organization.deleteMany({ where: { id, deleteAfter: { lte: now } } });
  }
  return due.length;
}
