import Link from "next/link";
import { todayIn } from "@/lib/dates";
import { myTaskCounts } from "@/lib/tasks/service";
import { tenantData } from "@/lib/tenant";
import type { Tenant } from "@/lib/tenant/server";

/** The viewer's tasks overdue and due today, on the dashboard. */
export async function MyTasks({ tenant }: { tenant: Tenant }) {
  const { overdue, dueToday } = await myTaskCounts(
    tenantData,
    { organizationId: tenant.organization.id, userId: tenant.user.id },
    todayIn(tenant.organization.timezone),
    { leads: tenant.can("sales:read"), customers: tenant.can("customers:read") },
  );
  return (
    <section className="panel my-tasks" aria-label="Your tasks">
      <div className="panel-heading">
        <div>
          <h3>Your tasks</h3>
          <p>{overdue || dueToday ? "Assigned to you" : "Nothing due today"}</p>
        </div>
        <Link href="/app/tasks" className="link-button">Open tasks →</Link>
      </div>
      <div className="my-tasks-counts">
        <Link href="/app/tasks" className={overdue ? "overdue" : undefined}><strong>{overdue}</strong> overdue</Link>
        <Link href="/app/tasks"><strong>{dueToday}</strong> due today</Link>
      </div>
    </section>
  );
}
