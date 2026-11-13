"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { addActivity } from "@/lib/activities/service";
import { aiDeps } from "@/lib/ai/server";
import { AiTaskError, updateAiSettings } from "@/lib/ai/service";
import {
  collectionsDraft, type CollectionsDraft, DRAFT_TONES, leadAssist, type LeadAssist, quoteAssist, type QuoteSuggestion,
  receivablesSummary, type ReceivablesSummary,
} from "@/lib/ai/tasks";
import { AuthorizationError, type Permission } from "@/lib/auth/authorization";
import { todayIn } from "@/lib/dates";
import { emailSender, publicOrigin } from "@/lib/email/server";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { sendCollectionMessage } from "@/lib/receivables/messages";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";

/**
 * Momentum AI actions (spec §7.8). Each checks the permission of the work it
 * helps with, then returns a draft or suggestion. Nothing is sent or saved
 * until a person does it with the separate actions below.
 */

export type AiResult<T> = { status: "ok"; result: T } | { status: "error"; message: string; fields?: Record<string, string> };

interface Context {
  actor: { organizationId: string; userId: string; timezone: string };
  context: { today: string; locale: string; seller: string };
}

async function run<T>(permission: Permission, work: (c: Context) => Promise<T>): Promise<AiResult<T>> {
  let tenant;
  try {
    tenant = await requireTenant(permission);
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: "Your role cannot do this." };
    throw error;
  }
  const { organization } = tenant;
  try {
    const result = await work({
      actor: { organizationId: organization.id, userId: tenant.user.id, timezone: organization.timezone },
      context: { today: todayIn(organization.timezone), locale: organization.locale, seller: organization.name },
    });
    return { status: "ok", result };
  } catch (error) {
    if (error instanceof AiTaskError) return { status: "error", message: error.message };
    if (error instanceof InputValidationError) return { status: "error", message: "Some fields need fixing.", fields: { ...error.fields } };
    if (error instanceof RecordConflictError || error instanceof RecordNotFoundError) return { status: "error", message: error.message };
    throw error;
  }
}

export async function leadAssistAction(leadId: string): Promise<AiResult<LeadAssist>> {
  return run("sales:write", ({ actor, context }) => leadAssist(aiDeps, actor, leadId, context));
}

/** Saves a person's (possibly edited) text on the lead's timeline: a note, or an email they sent themselves. */
export async function logLeadActivityAction(leadId: string, kind: "note" | "email", body: string): Promise<AiResult<null>> {
  return run("sales:write", async ({ actor }) => {
    await addActivity(tenantData, actor, { type: "lead", id: leadId }, { kind, body });
    revalidatePath(`/app/leads/${leadId}`);
    return null;
  });
}

export async function quoteAssistAction(request: string, currency: string): Promise<AiResult<QuoteSuggestion>> {
  return run("quotes:write", async ({ actor, context }) => {
    if (request.trim().length < 10) throw new InputValidationError({ request: "describe what the customer asked for" });
    if (!/^[A-Z]{3}$/.test(currency)) throw new InputValidationError({ currency: "choose a currency first" });
    return quoteAssist(aiDeps, actor, { request, currency }, context);
  });
}

export async function collectionsDraftAction(invoiceId: string, tone: string): Promise<AiResult<CollectionsDraft>> {
  return run("collections:write", ({ actor, context }) =>
    collectionsDraft(aiDeps, actor, invoiceId, (DRAFT_TONES as readonly string[]).includes(tone) ? (tone as (typeof DRAFT_TONES)[number]) : "friendly", context),
  );
}

export async function sendCollectionMessageAction(invoiceId: string, message: { subject: string; body: string; aiDrafted: boolean }): Promise<AiResult<{ sentTo: string }>> {
  return run("collections:write", async ({ actor }) => {
    const h = await headers();
    const appUrl = publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost"}`);
    const sent = await sendCollectionMessage(tenantData, actor, invoiceId, message, { email: emailSender, appUrl });
    revalidatePath(`/app/invoices/${invoiceId}`);
    return sent;
  });
}

export async function receivablesSummaryAction(): Promise<AiResult<ReceivablesSummary>> {
  return run("collections:read", ({ actor, context }) => receivablesSummary(aiDeps, actor, context));
}

export type SettingsState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string; fields?: Record<string, string> };

export async function updateAiSettingsAction(_: SettingsState, form: FormData): Promise<SettingsState> {
  const result = await run("settings:write", async ({ actor }) => {
    await updateAiSettings(tenantData, actor, { enabled: form.get("enabled") === "on", monthlyLimit: String(form.get("monthlyLimit") ?? "") }, aiDeps.serverLimit);
    revalidatePath("/app/settings");
    return null;
  });
  return result.status === "ok" ? { status: "saved", message: "AI settings saved." } : result;
}
