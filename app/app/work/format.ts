import { leadName } from "@/lib/leads/labels";
import type { TaskItem } from "./tasks-panel";

interface StoredTask {
  id: string;
  title: string;
  dueOn: Date | null;
  completedAt: Date | null;
  leadId: string | null;
  customerId: string | null;
  assignee: { name: string } | null;
  assigneeUserId: string | null;
  completedBy: { name: string } | null;
  lead: { id: string; contactName: string | null; companyName: string | null } | null;
  customer: { id: string; displayName: string } | null;
}

/** Tasks for display: dates in the workspace's locale, "today" in its timezone. */
export function formatTasks(
  tasks: StoredTask[],
  options: {
    locale: string;
    timezone: string;
    today: string;
    canWrite: (task: StoredTask) => boolean;
    showRecord: boolean;
  },
): TaskItem[] {
  const day = new Intl.DateTimeFormat(options.locale, { dateStyle: "medium", timeZone: "UTC" });
  const instant = new Intl.DateTimeFormat(options.locale, { dateStyle: "medium", timeZone: options.timezone });
  return tasks.map((task) => {
    const due = task.dueOn?.toISOString().slice(0, 10) ?? null;
    return {
      id: task.id,
      title: task.title,
      due: task.dueOn ? day.format(task.dueOn) : null,
      overdue: !task.completedAt && due !== null && due < options.today,
      assigneeName: task.assignee?.name ?? (task.assigneeUserId ? "Former member" : null),
      completed: Boolean(task.completedAt),
      completedNote: task.completedAt
        ? `Done ${instant.format(task.completedAt)}${task.completedBy ? ` by ${task.completedBy.name}` : ""}`
        : null,
      record: !options.showRecord
        ? null
        : task.lead
          ? { label: leadName(task.lead), href: `/app/leads/${task.lead.id}` }
          : task.customer
            ? { label: task.customer.displayName, href: `/app/customers/${task.customer.id}` }
            : null,
      canWrite: options.canWrite(task),
    };
  });
}
