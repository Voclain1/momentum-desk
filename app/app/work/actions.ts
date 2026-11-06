"use server";

import { revalidatePath } from "next/cache";
import { addActivity, getActivity, removeActivity, updateActivity } from "@/lib/activities/service";
import { AuthorizationError, type Permission } from "@/lib/auth/authorization";
import { listTeam } from "@/lib/auth/team";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { type Parent, parentOf } from "@/lib/records/parent";
import { createTask, getTask, removeTask, setTaskCompleted } from "@/lib/tasks/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant, type Tenant } from "@/lib/tenant/server";

export type FormState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; fields?: Record<string, string> };

/** Notes and tasks inherit their record's permission (docs/authorization.md). */
function permissionFor(parent: Parent | null): Permission {
  if (!parent) return "workspace:read";
  return parent.type === "lead" ? "sales:write" : "customers:write";
}

function pathFor(parent: Parent | null) {
  if (!parent) return "/app/tasks";
  return parent.type === "lead" ? `/app/leads/${parent.id}` : `/app/customers/${parent.id}`;
}

function refresh(parent: Parent | null) {
  revalidatePath(pathFor(parent));
  revalidatePath("/app/tasks");
  revalidatePath("/app");
}

/**
 * Checks the workspace and the parent's permission on the server, then maps
 * domain errors to form state. `parent` comes from the server (a bound
 * argument or the stored record), never from the submitted form.
 */
async function write(
  parent: Parent | null | ((tenant: Tenant) => Promise<Parent | null>),
  work: (tenant: Tenant, parent: Parent | null) => Promise<FormState>,
): Promise<FormState> {
  const tenant = await requireTenant("workspace:read");
  try {
    const resolved = typeof parent === "function" ? await parent(tenant) : parent;
    if (!tenant.can(permissionFor(resolved))) throw new AuthorizationError(403);
    const state = await work(tenant, resolved);
    refresh(resolved);
    return state;
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: "Your role cannot do this here." };
    if (error instanceof InputValidationError) {
      return { status: "error", message: "Some fields need fixing.", fields: { ...error.fields } };
    }
    if (error instanceof RecordConflictError || error instanceof RecordNotFoundError) {
      return { status: "error", message: error.message };
    }
    throw error;
  }
}

const actorOf = (tenant: Tenant) => ({
  organizationId: tenant.organization.id,
  userId: tenant.user.id,
  timezone: tenant.organization.timezone,
});

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

export async function addActivityAction(parent: Parent, _: FormState, form: FormData): Promise<FormState> {
  return write(parent, async (tenant) => {
    await addActivity(tenantData, actorOf(tenant), parent, {
      kind: field(form, "kind"),
      body: field(form, "body"),
      occurredAt: field(form, "occurredAt"),
    });
    return { status: "saved", message: "Added to the timeline." };
  });
}

const activityParent = (id: string) => async (tenant: Tenant) =>
  parentOf(await getActivity(tenantData, tenant.organization.id, id));

export async function updateActivityAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  return write(activityParent(id), async (tenant) => {
    await updateActivity(tenantData, actorOf(tenant), id, {
      kind: field(form, "kind"),
      body: field(form, "body"),
      occurredAt: field(form, "occurredAt"),
    });
    return { status: "saved", message: "Saved." };
  });
}

export async function removeActivityAction(id: string): Promise<FormState> {
  return write(activityParent(id), async (tenant) => {
    await removeActivity(tenantData, actorOf(tenant), id, tenant.can("members:manage"));
    return { status: "saved", message: "Removed." };
  });
}

export async function createTaskAction(parent: Parent | null, _: FormState, form: FormData): Promise<FormState> {
  return write(parent, async (tenant) => {
    const memberIds = new Set((await listTeam(tenant.organization.id)).map((member) => member.userId));
    await createTask(tenantData, actorOf(tenant), parent, {
      title: field(form, "title"),
      dueOn: field(form, "dueOn"),
      assigneeUserId: field(form, "assigneeUserId"),
      notes: field(form, "notes"),
    }, { memberIds });
    return { status: "saved", message: "Task added." };
  });
}

const taskParent = (id: string) => async (tenant: Tenant) => parentOf(await getTask(tenantData, tenant.organization.id, id));

export async function setTaskCompletedAction(id: string, completed: boolean): Promise<FormState> {
  return write(taskParent(id), async (tenant) => {
    await setTaskCompleted(tenantData, actorOf(tenant), id, completed);
    return { status: "saved", message: completed ? "Task done." : "Task reopened." };
  });
}

export async function removeTaskAction(id: string): Promise<FormState> {
  return write(taskParent(id), async (tenant) => {
    await removeTask(tenantData, actorOf(tenant), id);
    return { status: "saved", message: "Task removed." };
  });
}
