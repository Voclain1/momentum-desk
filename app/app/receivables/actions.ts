"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError, type Permission } from "@/lib/auth/authorization";
import { listTeam } from "@/lib/auth/team";
import { todayIn } from "@/lib/dates";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { addManualRate } from "@/lib/fx/rates";
import { retryDeadJob } from "@/lib/jobs/admin";
import { addCollectionNote, addPromise, cancelPromise, updateCollection } from "@/lib/receivables/service";
import { setRemindersOptOut, updateReminderSettings } from "@/lib/reminders/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";

export type FormState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; fields?: Record<string, string> };

interface Context {
  actor: { organizationId: string; userId: string };
  today: string;
  baseCurrency: string;
}

async function write(permission: Permission, work: (context: Context) => Promise<FormState>): Promise<FormState> {
  let tenant;
  try {
    tenant = await requireTenant(permission);
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: "Your role cannot do this." };
    throw error;
  }
  try {
    return await work({
      actor: { organizationId: tenant.organization.id, userId: tenant.user.id },
      today: todayIn(tenant.organization.timezone),
      baseCurrency: tenant.organization.baseCurrency,
    });
  } catch (error) {
    if (error instanceof InputValidationError) return { status: "error", message: "Some fields need fixing.", fields: { ...error.fields } };
    if (error instanceof RecordConflictError || error instanceof RecordNotFoundError) return { status: "error", message: error.message };
    throw error;
  }
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "");

function refresh(invoiceId?: string) {
  revalidatePath("/app/receivables");
  if (invoiceId) revalidatePath(`/app/invoices/${invoiceId}`);
}

/** Owner, escalate, pause, resume: one form, the action named in the form. */
export async function updateCollectionAction(invoiceId: string, _: FormState, form: FormData): Promise<FormState> {
  return write("collections:write", async ({ actor, today }) => {
    const action = text(form, "action");
    const memberIds = new Set((await listTeam(actor.organizationId)).map((m) => m.userId));
    const input =
      action === "owner"
        ? { action, ownerUserId: text(form, "ownerUserId") }
        : action === "escalate"
          ? { action, note: text(form, "note") }
          : action === "pause"
            ? { action, until: text(form, "until"), reason: text(form, "reason") }
            : { action };
    await updateCollection(tenantData, actor, invoiceId, input, { today, memberIds });
    refresh(invoiceId);
    return { status: "saved", message: { owner: "Owner saved.", escalate: "Escalated.", pause: "Reminders paused.", resume: "Collection resumed." }[action] ?? "Saved." };
  });
}

export async function addPromiseAction(invoiceId: string, _: FormState, form: FormData): Promise<FormState> {
  return write("collections:write", async ({ actor, today }) => {
    await addPromise(tenantData, actor, invoiceId, { amount: text(form, "amount"), promisedOn: text(form, "promisedOn"), note: text(form, "note") }, { today });
    refresh(invoiceId);
    return { status: "saved", message: "Promise recorded; reminders wait for it." };
  });
}

export async function cancelPromiseAction(promiseId: string, invoiceId: string): Promise<FormState> {
  return write("collections:write", async ({ actor }) => {
    await cancelPromise(tenantData, actor, promiseId);
    refresh(invoiceId);
    return { status: "saved", message: "Promise cancelled." };
  });
}

export async function addNoteAction(invoiceId: string, _: FormState, form: FormData): Promise<FormState> {
  return write("collections:write", async ({ actor }) => {
    await addCollectionNote(tenantData, actor, invoiceId, text(form, "body"));
    refresh(invoiceId);
    return { status: "saved", message: "Note added." };
  });
}

export async function updateReminderSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  return write("settings:write", async ({ actor }) => {
    await updateReminderSettings(tenantData, actor, { enabled: form.get("enabled") === "on", minGapDays: text(form, "minGapDays") });
    revalidatePath("/app/settings");
    return { status: "saved", message: "Reminder settings saved." };
  });
}

export async function addRateAction(_: FormState, form: FormData): Promise<FormState> {
  return write("settings:write", async ({ actor, today, baseCurrency }) => {
    await addManualRate(tenantData, actor, baseCurrency, { quote: text(form, "quote"), rate: text(form, "rate"), effectiveOn: text(form, "effectiveOn") }, today);
    revalidatePath("/app/settings");
    revalidatePath("/app/receivables");
    return { status: "saved", message: "Rate added." };
  });
}

export async function setOptOutAction(customerId: string, optedOut: boolean): Promise<FormState> {
  return write("customers:write", async ({ actor }) => {
    await setRemindersOptOut(tenantData, actor.organizationId, customerId, optedOut, "staff", actor.userId);
    revalidatePath(`/app/customers/${customerId}`);
    return { status: "saved", message: optedOut ? "Reminders stopped for this customer." : "Reminders restarted for this customer." };
  });
}

export async function retryJobAction(jobId: string): Promise<FormState> {
  return write("settings:write", async ({ actor }) => {
    await retryDeadJob(tenantData, actor, jobId);
    revalidatePath("/app/settings");
    return { status: "saved", message: "Queued again." };
  });
}
