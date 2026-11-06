import { RecordNotFoundError } from "@/lib/errors";
import type { TenantDb } from "@/lib/tenant/core";

/** The lead or customer an activity or task is about. */
export type Parent = { type: "lead"; id: string } | { type: "customer"; id: string };

/** The foreign-key fields for a parent: exactly one is set. */
export function parentFields(parent: Parent) {
  return parent.type === "lead" ? { leadId: parent.id, customerId: null } : { leadId: null, customerId: parent.id };
}

/** The parent of a stored activity or task. */
export function parentOf(row: { leadId: string | null; customerId: string | null }): Parent | null {
  if (row.leadId) return { type: "lead", id: row.leadId };
  if (row.customerId) return { type: "customer", id: row.customerId };
  return null;
}

/** Fails like a missing record if the parent is not in this workspace. */
export async function requireParent(tenant: TenantDb, parent: Parent) {
  const found =
    parent.type === "lead"
      ? await tenant.lead.findUnique({ where: { id: parent.id }, select: { id: true } })
      : await tenant.customer.findUnique({ where: { id: parent.id }, select: { id: true } });
  if (!found) throw new RecordNotFoundError(parent.type === "lead" ? "Lead" : "Customer");
}
