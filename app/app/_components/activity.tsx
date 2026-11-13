import type { AuditAction } from "@/lib/audit";
import type { Tenant } from "@/lib/tenant/server";

export const LABELS: Record<AuditAction, string> = {
  "organization.created": "created the workspace",
  "organization.updated": "updated workspace settings",
  "member.added": "added a member",
  "member.role_updated": "changed a member's role",
  "member.removed": "removed a member",
  "invitation.created": "sent an invitation",
  "invitation.canceled": "cancelled an invitation",
  "invitation.accepted": "accepted an invitation",
  "invitation.rejected": "declined an invitation",
  "customer.created": "added a customer",
  "customer.updated": "updated a customer",
  "customer.archived": "archived a customer",
  "customer.restored": "restored a customer",
  "contact.added": "added a contact",
  "contact.updated": "updated a contact",
  "contact.removed": "removed a contact",
  "lead.created": "added a lead",
  "lead.updated": "updated a lead",
  "lead.stage_changed": "moved a lead",
  "lead.archived": "archived a lead",
  "lead.restored": "restored a lead",
  "lead.converted": "converted a lead to a customer",
  "customer.imported": "imported customers",
  "lead.imported": "imported leads",
  "activity.updated": "edited a note",
  "activity.removed": "removed a note",
  "task.created": "added a task",
  "task.updated": "updated a task",
  "task.completed": "completed a task",
  "task.reopened": "reopened a task",
  "task.removed": "removed a task",
  "tax_rate.created": "added a tax rate",
  "tax_rate.updated": "changed a tax rate",
  "tax_rate.archived": "archived a tax rate",
  "tax_rate.restored": "restored a tax rate",
  "product.created": "added a product",
  "product.updated": "updated a product",
  "product.deactivated": "deactivated a product",
  "product.reactivated": "reactivated a product",
  "quote.created": "created a quote",
  "quote.updated": "edited a draft quote",
  "quote.deleted": "deleted a draft quote",
  "quote.sent": "sent a quote",
  "quote.revised": "started a quote revision",
  "quote.duplicated": "duplicated a quote",
  "quote.numbering_updated": "changed quote numbering",
  "quote.link_created": "created a quote link",
  "quote.links_revoked": "revoked quote links",
  "quote.emailed": "emailed a quote",
  "quote.accepted": "accepted a quote",
  "quote.rejected": "declined a quote",
  "invoice.numbering_updated": "changed invoice numbering",
  "invoice.created": "created a draft invoice",
  "invoice.updated": "edited a draft invoice",
  "invoice.deleted": "deleted a draft invoice",
  "invoice.issued": "issued an invoice",
  "invoice.voided": "voided an invoice",
  "invoice.disputed": "marked an invoice disputed",
  "invoice.dispute_resolved": "resolved an invoice dispute",
  "payment.recorded": "recorded a payment",
  "payment.voided": "voided a payment",
  "invoice.settings_updated": "changed invoice settings",
  "invoice.link_created": "created an invoice link",
  "invoice.links_revoked": "revoked invoice links",
  "invoice.emailed": "emailed an invoice",
  "provider.connected": "connected a payment provider",
  "provider.disconnected": "disconnected a payment provider",
  "payment.refunded": "refunded a payment",
  "refund.succeeded": "confirmed a refund",
  "refund.failed": "reported a failed refund",
  "job.retried": "retried failed background work",
  "fx.rate_added": "added an exchange rate",
  "collection.updated": "updated collection of an invoice",
  "collection.note_added": "added a collection note",
  "promise.added": "recorded a promise to pay",
  "promise.cancelled": "cancelled a promise to pay",
  "promise.resolved": "closed a promise to pay",
  "reminders.settings_updated": "changed payment reminders",
  "reminders.opted_out": "stopped payment reminders for a customer",
  "reminders.opted_in": "restarted payment reminders for a customer",
  "ai.settings_updated": "changed the Momentum AI settings",
  "collection.message_sent": "emailed a customer about an invoice",
};

/** Latest audit entries for the current workspace, read through the tenant guard. */
export async function RecentActivity({ tenant }: { tenant: Tenant }) {
  const entries = await tenant.db.auditLog.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 5,
    include: { actor: { select: { name: true } } },
  });
  const { locale, timezone } = tenant.organization;
  const time = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });

  return (
    <section className="panel activity" aria-labelledby="activity-heading">
      <div className="panel-heading">
        <div>
          <h3 id="activity-heading">Recent activity</h3>
          <p>Workspace audit trail · times in {timezone.replaceAll("_", " ")}</p>
        </div>
      </div>
      <ol>
        {entries.map((entry) => (
          <li key={entry.id}>
            <span>
              <strong>{entry.actor?.name ?? (entry.action === "quote.accepted" || entry.action === "quote.rejected" ? "A customer" : entry.action === "payment.recorded" || entry.action === "reminders.opted_out" ? "A customer" : entry.action.startsWith("refund.") ? "The payment provider" : "System")}</strong>{" "}
              {LABELS[entry.action as AuditAction] ?? entry.action}
            </span>
            <time dateTime={entry.createdAt.toISOString()}>{time.format(entry.createdAt)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
