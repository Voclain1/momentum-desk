import type { TenantDb } from "@/lib/tenant/core";

/**
 * Audit trail for significant workspace actions (docs/product-spec.md §10,
 * §12). Entries are append-only in the database.
 *
 * Updates record the new values rather than a diff: the first entry for each
 * record (e.g. organization.created) holds the full starting state, so the
 * history of any field can be rebuilt from the sequence.
 */
export type AuditAction =
  | "organization.created"
  | "organization.updated"
  | "member.added"
  | "member.role_updated"
  | "member.removed"
  | "invitation.created"
  | "invitation.canceled"
  | "invitation.accepted"
  | "invitation.rejected";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface AuditEntry {
  action: AuditAction;
  /** The signed-in user who acted. Null for system actions. */
  actorUserId: string | null;
  targetType?: "organization" | "member" | "invitation";
  targetId?: string;
  /** Details of the change. Never passwords, tokens or full documents. */
  metadata?: { [key: string]: JsonValue };
}

export function recordAudit(tenant: TenantDb, entry: AuditEntry) {
  return tenant.auditLog.create({
    data: {
      action: entry.action,
      actorUserId: entry.actorUserId,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
    },
  });
}
