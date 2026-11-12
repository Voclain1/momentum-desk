import type { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { addDays, dateValue } from "@/lib/dates";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import { type Parent, parentFields, requireParent } from "@/lib/records/parent";
import type { TenantData } from "@/lib/tenant/core";
import { fieldErrors, type TaskInput, taskInputSchema } from "./schema";

/**
 * Tasks (spec §7.2 "tasks and reminders"), standalone or about one lead or
 * customer. Reminders are shown in the app (task list, dashboard); emailed
 * reminders need the background job service (D18).
 *
 * Callers check permissions: a task about a lead needs sales access, about a
 * customer customer access; a standalone task needs workspace access.
 */

export interface Actor {
  organizationId: string;
  userId: string;
}

export interface TaskContext {
  memberIds: ReadonlySet<string>;
}

/** Which linked tasks the viewer may see, from their role. */
export interface TaskVisibility {
  leads: boolean;
  customers: boolean;
}

function parse(input: unknown): TaskInput {
  const result = taskInputSchema.safeParse(input);
  if (!result.success) throw new InputValidationError(fieldErrors(result.error as z.ZodError));
  return result.data;
}

function checkAssignee(values: TaskInput, context: TaskContext, current?: string | null) {
  if (values.assigneeUserId && values.assigneeUserId !== current && !context.memberIds.has(values.assigneeUserId)) {
    throw new InputValidationError({ assigneeUserId: "must be a member of this workspace" });
  }
}

/** Standalone tasks, plus linked ones the viewer's role can see. */
export function visibleWhere(visibility: TaskVisibility): Prisma.TaskWhereInput {
  return {
    OR: [
      { leadId: null, customerId: null },
      ...(visibility.leads ? [{ leadId: { not: null } }] : []),
      ...(visibility.customers ? [{ customerId: { not: null } }] : []),
    ],
  };
}

const include = {
  assignee: { select: { name: true } },
  completedBy: { select: { name: true } },
  lead: { select: { id: true, contactName: true, companyName: true } },
  customer: { select: { id: true, displayName: true } },
} satisfies Prisma.TaskInclude;

export interface TaskQuery {
  /** "mine": assigned to the viewer. "unassigned". "all": every visible task. */
  scope?: "mine" | "unassigned" | "all";
  status?: "open" | "done";
}

/** Open tasks in buckets relative to today in the workspace's timezone. */
export async function listTasks(
  data: TenantData,
  actor: Actor,
  query: TaskQuery,
  today: string,
  visibility: TaskVisibility,
) {
  const tenant = data.scoped(actor.organizationId);
  const scope = query.scope ?? "mine";
  const where: Prisma.TaskWhereInput = {
    AND: [
      visibleWhere(visibility),
      scope === "mine" ? { assigneeUserId: actor.userId } : scope === "unassigned" ? { assigneeUserId: null } : {},
      query.status === "done" ? { completedAt: { not: null } } : { completedAt: null },
    ],
  };
  const tasks = await tenant.task.findMany({
    where,
    orderBy:
      query.status === "done"
        ? [{ completedAt: "desc" }, { id: "desc" }]
        : [{ dueOn: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 200,
    include,
  });
  const due = (task: { dueOn: Date | null }) => task.dueOn?.toISOString().slice(0, 10) ?? null;
  const weekEnd = addDays(today, 7);
  return {
    tasks,
    buckets: {
      overdue: tasks.filter((t) => !t.completedAt && due(t) !== null && due(t)! < today),
      today: tasks.filter((t) => !t.completedAt && due(t) === today),
      upcoming: tasks.filter((t) => !t.completedAt && due(t) !== null && due(t)! > today && due(t)! <= weekEnd),
      later: tasks.filter((t) => !t.completedAt && due(t) !== null && due(t)! > weekEnd),
      noDate: tasks.filter((t) => !t.completedAt && due(t) === null),
    },
  };
}

/** Counts for the dashboard: the viewer's open tasks overdue and due today. */
export async function myTaskCounts(data: TenantData, actor: Actor, today: string, visibility: TaskVisibility) {
  const tenant = data.scoped(actor.organizationId);
  const base = { AND: [visibleWhere(visibility), { assigneeUserId: actor.userId, completedAt: null }] };
  const [overdue, dueToday] = await Promise.all([
    tenant.task.count({ where: { AND: [base, { dueOn: { lt: dateValue(today) } }] } }),
    tenant.task.count({ where: { AND: [base, { dueOn: dateValue(today) }] } }),
  ]);
  return { overdue, dueToday };
}

/** Tasks about one record, open first. */
export async function tasksFor(data: TenantData, organizationId: string, parent: Parent) {
  return data.scoped(organizationId).task.findMany({
    where: parent.type === "lead" ? { leadId: parent.id } : { customerId: parent.id },
    orderBy: [{ completedAt: { sort: "desc", nulls: "first" } }, { dueOn: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 100,
    include,
  });
}

export async function getTask(data: TenantData, organizationId: string, id: string) {
  const task = await data.scoped(organizationId).task.findUnique({ where: { id }, include });
  if (!task) throw new RecordNotFoundError("Task");
  return task;
}

const audited = (task: { leadId: string | null; customerId: string | null }) => ({
  leadId: task.leadId,
  customerId: task.customerId,
});

export async function createTask(
  data: TenantData,
  actor: Actor,
  parent: Parent | null,
  input: unknown,
  context: TaskContext,
) {
  const values = parse(input);
  checkAssignee(values, context);
  return data.transaction(actor.organizationId, async (tenant) => {
    if (parent) await requireParent(tenant, parent);
    const task = await tenant.task.create({
      data: { ...values, ...(parent ? parentFields(parent) : {}), createdById: actor.userId },
    });
    await recordAudit(tenant, {
      action: "task.created",
      actorUserId: actor.userId,
      targetType: "task",
      targetId: task.id,
      metadata: audited(task),
    });
    return task;
  });
}

export async function updateTask(
  data: TenantData,
  actor: Actor,
  id: string,
  expectedVersion: number,
  input: unknown,
  context: TaskContext,
) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new InputValidationError({ version: "is invalid" });
  }
  const values = parse(input);
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.task.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Task");
    if (current.version !== expectedVersion) throw new RecordConflictError("This task");
    checkAssignee(values, context, current.assigneeUserId);
    const { count } = await tenant.task.updateMany({
      where: { id, version: expectedVersion },
      data: { ...values, version: { increment: 1 } },
    });
    if (count !== 1) throw new RecordConflictError("This task");
    await recordAudit(tenant, {
      action: "task.updated",
      actorUserId: actor.userId,
      targetType: "task",
      targetId: id,
      metadata: audited(current),
    });
    return (await tenant.task.findUnique({ where: { id } }))!;
  });
}

export async function setTaskCompleted(data: TenantData, actor: Actor, id: string, completed: boolean) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.task.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Task");
    if (Boolean(current.completedAt) === completed) return current;
    const task = await tenant.task.update({
      where: { id },
      data: completed
        ? { completedAt: new Date(), completedById: actor.userId, version: { increment: 1 } }
        : { completedAt: null, completedById: null, version: { increment: 1 } },
    });
    await recordAudit(tenant, {
      action: completed ? "task.completed" : "task.reopened",
      actorUserId: actor.userId,
      targetType: "task",
      targetId: id,
      metadata: audited(current),
    });
    return task;
  });
}

export async function removeTask(data: TenantData, actor: Actor, id: string) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.task.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Task");
    await tenant.task.delete({ where: { id } });
    await recordAudit(tenant, {
      action: "task.removed",
      actorUserId: actor.userId,
      targetType: "task",
      targetId: id,
      metadata: audited(current),
    });
  });
}
