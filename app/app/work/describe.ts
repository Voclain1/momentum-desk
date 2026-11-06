import type { AuditAction } from "@/lib/audit";
import { LABELS } from "../_components/activity";

const FIELD_LABELS: Record<string, string> = {
  displayName: "name", legalName: "legal name", taxId: "tax ID", countryCode: "country", addressLine1: "address",
  addressLine2: "address", postalCode: "postal code", preferredLocale: "locale", preferredLanguage: "language",
  preferredCurrency: "preferred currency", contactName: "contact name", companyName: "company", ownerUserId: "owner",
  stageId: "stage", estimatedValueMinor: "estimated value", nextFollowUpOn: "follow-up date", lostReason: "lost reason",
};

function list(items: string[]): string {
  const unique = [...new Set(items)];
  return unique.length <= 1 ? (unique[0] ?? "") : `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

/**
 * A readable line for an audit event on a record's timeline. Stage moves name
 * the stages by their current names (the audit keeps stable keys); edits name
 * the fields, never their values.
 */
export function describeEvent(action: string, metadata: unknown, stageNames: Map<string, string>): string {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  if (action === "lead.stage_changed") {
    const name = (key: unknown) => stageNames.get(String(key)) ?? String(key);
    return `moved this lead from ${name(meta.from)} to ${name(meta.to)}`;
  }
  if ((action === "lead.updated" || action === "customer.updated") && Array.isArray(meta.changedFields)) {
    const fields = (meta.changedFields as string[]).filter((field) => field !== "stageId" && field !== "currency");
    if (fields.length) return `changed ${list(fields.map((field) => FIELD_LABELS[field] ?? field))}`;
  }
  return LABELS[action as AuditAction] ?? action;
}
