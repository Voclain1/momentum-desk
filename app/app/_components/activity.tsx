import type { AuditAction } from "@/lib/audit";
import type { Tenant } from "@/lib/tenant/server";

const LABELS: Record<AuditAction, string> = {
  "organization.created": "created the workspace",
  "organization.updated": "updated workspace settings",
  "member.added": "added a member",
  "member.role_updated": "changed a member's role",
  "member.removed": "removed a member",
  "invitation.created": "sent an invitation",
  "invitation.canceled": "cancelled an invitation",
  "invitation.accepted": "accepted an invitation",
  "invitation.rejected": "declined an invitation",
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
