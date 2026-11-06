"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthorizationError } from "@/lib/auth/authorization";
import { listTeam } from "@/lib/auth/team";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { createLead, moveLead, setLeadArchived, updateLead } from "@/lib/leads/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";

export type FormState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; fields?: Record<string, string> };

const LEAD_FIELDS = [
  "contactName", "companyName", "email", "phone", "source", "ownerUserId", "stageId",
  "estimatedValue", "currency", "summary", "nextFollowUpOn", "tags", "notes", "lostReason",
] as const;

function leadInput(form: FormData) {
  return Object.fromEntries(LEAD_FIELDS.map((field) => [field, String(form.get(field) ?? "")]));
}

type Actor = { organizationId: string; userId: string };

/** Permission check on the server, then domain errors mapped to form state. */
async function write(work: (actor: Actor, memberIds: Set<string>) => Promise<FormState>): Promise<FormState> {
  let tenant;
  try {
    tenant = await requireTenant("sales:write");
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: "Your role cannot change leads." };
    throw error;
  }
  try {
    const memberIds = new Set((await listTeam(tenant.organization.id)).map((member) => member.userId));
    return await work({ organizationId: tenant.organization.id, userId: tenant.user.id }, memberIds);
  } catch (error) {
    if (error instanceof InputValidationError) {
      return { status: "error", message: "Some fields need fixing.", fields: { ...error.fields } };
    }
    if (error instanceof RecordConflictError || error instanceof RecordNotFoundError) {
      return { status: "error", message: error.message };
    }
    throw error;
  }
}

function refresh(id?: string) {
  revalidatePath("/app/leads");
  revalidatePath("/app/pipeline");
  if (id) revalidatePath(`/app/leads/${id}`);
}

export async function createLeadAction(_: FormState, form: FormData): Promise<FormState> {
  let id: string | undefined;
  const state = await write(async (actor, memberIds) => {
    id = (await createLead(tenantData, actor, leadInput(form), { memberIds })).id;
    refresh();
    return { status: "saved", message: "Lead added." };
  });
  if (id) redirect(`/app/leads/${id}`);
  return state;
}

export async function updateLeadAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  return write(async (actor, memberIds) => {
    await updateLead(tenantData, actor, id, Number(form.get("version")), leadInput(form), { memberIds });
    refresh(id);
    return { status: "saved", message: "Lead saved." };
  });
}

export async function moveLeadAction(id: string, stageId: string): Promise<FormState> {
  return write(async (actor) => {
    await moveLead(tenantData, actor, id, stageId);
    refresh(id);
    return { status: "saved", message: "Lead moved." };
  });
}

export async function setLeadArchivedAction(id: string, archived: boolean): Promise<FormState> {
  return write(async (actor) => {
    await setLeadArchived(tenantData, actor, id, archived);
    refresh(id);
    return { status: "saved", message: archived ? "Lead archived." : "Lead restored." };
  });
}
