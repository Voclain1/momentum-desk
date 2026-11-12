import { getTimeline } from "@/lib/activities/service";
import { listTeam } from "@/lib/auth/team";
import { todayIn, utcToZonedTime } from "@/lib/dates";
import { listStages } from "@/lib/leads/service";
import type { Parent } from "@/lib/records/parent";
import { tasksFor } from "@/lib/tasks/service";
import { tenantData } from "@/lib/tenant";
import type { Tenant } from "@/lib/tenant/server";
import { describeEvent } from "./describe";
import { formatTasks } from "./format";
import { NewTaskForm, TaskList } from "./tasks-panel";
import { TimelinePanel } from "./timeline-panel";

/** Timeline and tasks for one lead or customer. The caller has checked read access. */
export async function RecordWork({ tenant, parent, canWrite }: { tenant: Tenant; parent: Parent; canWrite: boolean }) {
  const { organization, user } = tenant;
  const [timeline, tasks, team, stages] = await Promise.all([
    getTimeline(tenantData, organization.id, parent),
    tasksFor(tenantData, organization.id, parent),
    listTeam(organization.id),
    parent.type === "lead" ? listStages(tenantData, organization.id) : Promise.resolve([]),
  ]);
  const stageNames = new Map(stages.map((stage) => [stage.key, stage.name]));
  const when = new Intl.DateTimeFormat(organization.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: organization.timezone,
  });
  const today = todayIn(organization.timezone);

  return (
    <div className="record-work">
      <section className="panel tasks-panel" aria-label="Tasks">
        <div className="panel-heading">
          <div>
            <h3>Tasks</h3>
            <p>Follow-ups for this {parent.type}.</p>
          </div>
        </div>
        {canWrite ? (
          <NewTaskForm parent={parent} members={team.map(({ userId, name }) => ({ userId, name }))} defaultAssignee={user.id} />
        ) : null}
        <TaskList
          empty="No tasks."
          tasks={formatTasks(tasks, {
            locale: organization.locale,
            timezone: organization.timezone,
            today,
            canWrite: () => canWrite,
            showRecord: false,
          })}
        />
      </section>
      <TimelinePanel
        parent={parent}
        canWrite={canWrite}
        nowLocal={utcToZonedTime(new Date(), organization.timezone)}
        items={timeline.map((entry) =>
          entry.type === "activity"
            ? {
                type: "activity" as const,
                id: entry.id,
                when: when.format(entry.at),
                occurredAtLocal: utcToZonedTime(entry.at, organization.timezone),
                kind: entry.kind,
                body: entry.body,
                authorName: entry.authorName ?? "Former member",
                edited: entry.edited,
                canEdit: entry.authorUserId === user.id,
                canRemove: entry.authorUserId === user.id || tenant.can("members:manage"),
              }
            : {
                type: "event" as const,
                id: entry.id,
                when: when.format(entry.at),
                text: describeEvent(entry.action, entry.metadata, stageNames),
                actorName: entry.actorName ?? "System",
              },
        )}
      />
    </div>
  );
}
