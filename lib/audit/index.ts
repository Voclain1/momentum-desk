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
  | "invitation.rejected"
  | "customer.created"
  | "customer.updated"
  | "customer.archived"
  | "customer.restored"
  | "contact.added"
  | "contact.updated"
  | "contact.removed"
  | "lead.created"
  | "lead.updated"
  | "lead.stage_changed"
  | "lead.archived"
  | "lead.restored"
  | "lead.converted"
  | "customer.imported"
  | "lead.imported"
  | "activity.updated"
  | "activity.removed"
  | "task.created"
  | "task.updated"
  | "task.completed"
  | "task.reopened"
  | "task.removed"
  | "tax_rate.created"
  | "tax_rate.updated"
  | "tax_rate.archived"
  | "tax_rate.restored"
  | "product.created"
  | "product.updated"
  | "product.deactivated"
  | "product.reactivated"
  | "quote.created"
  | "quote.updated"
  | "quote.deleted"
  | "quote.sent"
  | "quote.revised"
  | "quote.duplicated"
  | "quote.numbering_updated"
  | "quote.link_created"
  | "quote.links_revoked"
  | "quote.emailed"
  | "quote.accepted"
  | "quote.rejected"
  | "invoice.numbering_updated"
  | "invoice.created"
  | "invoice.updated"
  | "invoice.deleted"
  | "invoice.issued"
  | "invoice.voided"
  | "invoice.disputed"
  | "invoice.dispute_resolved"
  | "payment.recorded"
  | "payment.voided"
  | "invoice.settings_updated"
  | "invoice.link_created"
  | "invoice.links_revoked"
  | "invoice.emailed"
  | "provider.connected"
  | "provider.disconnected"
  | "payment.refunded"
  | "refund.succeeded"
  | "refund.failed";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface AuditEntry {
  action: AuditAction;
  /** The signed-in user who acted. Null for system actions. */
  actorUserId: string | null;
  targetType?: "organization" | "member" | "invitation" | "customer" | "contact" | "lead" | "activity" | "task" | "tax_rate" | "product" | "quote" | "invoice" | "payment" | "provider";
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
