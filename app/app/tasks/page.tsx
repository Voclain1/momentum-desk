import type { Metadata } from "next";
import Link from "next/link";
import { listTeam } from "@/lib/auth/team";
import { todayIn } from "@/lib/dates";
import { listTasks, type TaskQuery } from "@/lib/tasks/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { formatTasks } from "../work/format";
import { NewTaskForm, TaskList } from "../work/tasks-panel";

export const metadata: Metadata = { title: "Tasks — MomentumDesk" };

const SCOPES = { mine: "Mine", unassigned: "Unassigned", all: "Everyone's" } as const;

export default async function TasksPage({ searchParams }: PageProps<"/app/tasks">) {
  const tenant = await requireTenant("workspace:read");
  const { organization, user } = tenant;
  const params = await searchParams;
  const scope = (Object.keys(SCOPES) as (keyof typeof SCOPES)[]).find((key) => key === params.scope) ?? "mine";
  const status: NonNullable<TaskQuery["status"]> = params.status === "done" ? "done" : "open";
  const today = todayIn(organization.timezone);
  const visibility = { leads: tenant.can("sales:read"), customers: tenant.can("customers:read") };

  const [{ tasks, buckets }, team] = await Promise.all([
    listTasks(tenantData, { organizationId: organization.id, userId: user.id }, { scope, status }, today, visibility),
    listTeam(organization.id),
  ]);
  const format = (list: typeof tasks) =>
    formatTasks(list, {
      locale: organization.locale,
      timezone: organization.timezone,
      today,
      showRecord: true,
      // A task inherits its record's permission; standalone tasks belong to everyone.
      canWrite: (task) =>
        task.leadId ? tenant.can("sales:write") : task.customerId ? tenant.can("customers:write") : true,
    });
  const href = (changes: Record<string, string>) => {
    const next = new URLSearchParams({ scope, status, ...changes });
    if (next.get("scope") === "mine") next.delete("scope");
    if (next.get("status") === "open") next.delete("status");
    return next.size ? `/app/tasks?${next}` : "/app/tasks";
  };
  const groups = [
    ["Overdue", buckets.overdue],
    ["Today", buckets.today],
    ["Next 7 days", buckets.upcoming],
    ["Later", buckets.later],
    ["No due date", buckets.noDate],
  ] as const;

  return (
    <>
      <header className="topbar">
        <div>
          <p>WORK</p>
          <h1>Tasks</h1>
        </div>
      </header>
      <nav className="tabs" aria-label="Whose tasks">
        {(Object.keys(SCOPES) as (keyof typeof SCOPES)[]).map((key) => (
          <Link key={key} href={href({ scope: key })} aria-current={key === scope ? "page" : undefined}>{SCOPES[key]}</Link>
        ))}
        <span className="tabs-spacer" />
        <Link href={href({ status: status === "open" ? "done" : "open" })}>{status === "open" ? "Show done" : "Show open"}</Link>
      </nav>
      <section className="panel" aria-label="Add a standalone task">
        <NewTaskForm parent={null} members={team.map(({ userId, name }) => ({ userId, name }))} defaultAssignee={user.id} />
      </section>
      {status === "done" ? (
        <section className="panel task-group" aria-label="Done">
          <div className="panel-heading"><div><h3>Done</h3><p>Most recent first</p></div></div>
          <TaskList tasks={format(tasks)} empty="Nothing completed yet." />
        </section>
      ) : (
        groups.map(([label, list]) =>
          list.length || label === "Today" ? (
            <section key={label} className="panel task-group" aria-label={label}>
              <div className="panel-heading"><div><h3>{label} <span className="count">{list.length}</span></h3></div></div>
              <TaskList tasks={format(list)} empty="Nothing due today." />
            </section>
          ) : null,
        )
      )}
      <p className="record-meta">Due dates use {organization.timezone.replaceAll("_", " ")}. Email reminders come later; for now, tasks show here and on the dashboard.</p>
    </>
  );
}
