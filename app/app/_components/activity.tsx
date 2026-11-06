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
  "activity.updated": "edited a note",
  "activity.removed": "removed a note",
  "task.created": "added a task",
  "task.updated": "updated a task",
  "task.completed": "completed a task",
  "task.reopened": "reopened a task",
  "task.removed": "removed a task",
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
              <strong>{entry.actor?.name ?? "System"}</strong>{" "}
              {LABELS[entry.action as AuditAction] ?? entry.action}
            </span>
            <time dateTime={entry.createdAt.toISOString()}>{time.format(entry.createdAt)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
