import type { TenantDb } from "@/lib/tenant/core";

/**
 * Product analytics (spec §17, decision D41). Events are written in the same
 * transaction as the change they describe, so there is never an event
 * without the change, and they hold ids only. Firsts (a quote's first view,
 * an invoice becoming overdue) happen once per record; the rest once per
 * causing record (each payment, each reminder).
 */

export const EVENT_NAMES = [
  "lead_created", "lead_qualified", "opportunity_won", "quote_created", "quote_sent", "quote_viewed", "quote_accepted",
  "invoice_created", "invoice_sent", "invoice_viewed", "payment_started", "payment_completed", "invoice_overdue",
  "reminder_sent", "overdue_invoice_paid",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];
type EntityType = "lead" | "quote" | "invoice" | "payment" | "paymentAttempt" | "reminder";

export async function track(
  tenant: TenantDb,
  name: EventName,
  event: { entityType: EntityType; entityId: string; userId?: string | null; once?: boolean; key?: string; at?: Date },
) {
  await tenant.productEvent.createMany({
    data: [{
      name, entityType: event.entityType, entityId: event.entityId, userId: event.userId ?? null,
      dedupeKey: event.once === false ? `${name}:${event.key ?? event.entityId}` : `${name}:${event.entityId}`,
      ...(event.at ? { occurredAt: event.at } : {}),
    }],
    skipDuplicates: true,
  });
}

/** Lead stages that mean the lead was qualified (default pipeline keys). */
const QUALIFIED_STAGES = new Set(["qualified", "proposal"]);

/**
 * Events that follow from audited changes (called by recordAudit, in its
 * transaction). Views, checkout starts, overdue invoices and reminders are
 * tracked where they happen.
 */
export async function trackAudited(
  tenant: TenantDb,
  entry: { action: string; actorUserId: string | null; targetId?: string; metadata?: Record<string, unknown> },
) {
  const id = entry.targetId;
  if (!id) return;
  const userId = entry.actorUserId;
  const meta = entry.metadata ?? {};
  switch (entry.action) {
    case "lead.created":
      return track(tenant, "lead_created", { entityType: "lead", entityId: id, userId });
    case "lead.stage_changed":
      if (QUALIFIED_STAGES.has(String(meta.to)) || meta.toKind === "won") await track(tenant, "lead_qualified", { entityType: "lead", entityId: id, userId });
      if (meta.toKind === "won") await track(tenant, "opportunity_won", { entityType: "lead", entityId: id, userId });
      return;
    case "quote.created":
      return track(tenant, "quote_created", { entityType: "quote", entityId: id, userId });
    case "quote.sent":
      return track(tenant, "quote_sent", { entityType: "quote", entityId: id, userId });
    case "quote.accepted":
      return track(tenant, "quote_accepted", { entityType: "quote", entityId: id, userId });
    case "invoice.created":
      return track(tenant, "invoice_created", { entityType: "invoice", entityId: id, userId });
    case "invoice.emailed":
    case "invoice.link_created":
      return track(tenant, "invoice_sent", { entityType: "invoice", entityId: id, userId });
    case "payment.recorded": {
      await track(tenant, "payment_completed", { entityType: "payment", entityId: id, userId });
      const invoiceId = typeof meta.invoiceId === "string" ? meta.invoiceId : null;
      if (!invoiceId) return;
      const invoice = await tenant.invoice.findUnique({ where: { id: invoiceId }, select: { outstandingMinor: true } });
      const wasOverdue = await tenant.productEvent.count({ where: { name: "invoice_overdue", entityId: invoiceId } });
      if (invoice && invoice.outstandingMinor === 0n && wasOverdue > 0) {
        await track(tenant, "overdue_invoice_paid", { entityType: "invoice", entityId: invoiceId, userId });
      }
      return;
    }
  }
}
