"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthorizationError, type Permission } from "@/lib/auth/authorization";
import { todayIn } from "@/lib/dates";
import { EmailNotConfiguredError } from "@/lib/email";
import { emailSender, publicOrigin } from "@/lib/email/server";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import {
  createQuote,
  deleteDraft,
  duplicateQuote,
  reviseQuote,
  sendQuote,
  updateDraft,
  updateQuoteNumbering,
} from "@/lib/quotes/service";
import { createShareLink, emailQuote, quotePath, revokeShareLinks } from "@/lib/quotes/sharing";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";

export type FormState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; fields?: Record<string, string> };

interface Context {
  actor: { organizationId: string; userId: string };
  today: string;
}

/** Permission check on the server, then domain errors mapped to form state. */
async function write(work: (context: Context) => Promise<FormState>, permission: Permission = "quotes:write"): Promise<FormState> {
  let tenant;
  try {
    tenant = await requireTenant(permission);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { status: "error", message: permission === "quotes:write" ? "Your role cannot change quotes." : "Only owners and admins can change this." };
    }
    throw error;
  }
  try {
    return await work({
      actor: { organizationId: tenant.organization.id, userId: tenant.user.id },
      today: todayIn(tenant.organization.timezone),
    });
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

/** The builder posts its state as one JSON field; the service validates every part. */
function quoteInput(form: FormData): unknown {
  try {
    return JSON.parse(String(form.get("quote") ?? "{}"));
  } catch {
    return {};
  }
}

function refresh(id?: string) {
  revalidatePath("/app/quotes");
  if (id) revalidatePath(`/app/quotes/${id}`);
}

export async function createQuoteAction(_: FormState, form: FormData): Promise<FormState> {
  let id: string | undefined;
  const state = await write(async ({ actor }) => {
    id = (await createQuote(tenantData, actor, quoteInput(form))).id;
    refresh();
    return { status: "saved", message: "Draft saved." };
  });
  if (id) redirect(`/app/quotes/${id}`);
  return state;
}

export async function updateDraftAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  return write(async ({ actor }) => {
    await updateDraft(tenantData, actor, id, Number(form.get("version")), quoteInput(form));
    refresh(id);
    return { status: "saved", message: "Draft saved." };
  });
}

export async function sendQuoteAction(id: string, version: number): Promise<FormState> {
  return write(async ({ actor, today }) => {
    await sendQuote(tenantData, actor, id, version, { today });
    refresh(id);
    return { status: "saved", message: "Quote marked as sent." };
  });
}

export async function deleteDraftAction(id: string): Promise<FormState> {
  let to: string | undefined;
  const state = await write(async ({ actor }) => {
    const { previousId } = await deleteDraft(tenantData, actor, id);
    refresh();
    to = previousId ? `/app/quotes/${previousId}` : "/app/quotes";
    return { status: "saved", message: "Draft deleted." };
  });
  if (to) redirect(to);
  return state;
}

export async function reviseQuoteAction(id: string): Promise<FormState> {
  let to: string | undefined;
  const state = await write(async ({ actor, today }) => {
    to = `/app/quotes/${(await reviseQuote(tenantData, actor, id, { today })).id}`;
    refresh(id);
    return { status: "saved", message: "Revision started." };
  });
  if (to) redirect(to);
  return state;
}

export async function duplicateQuoteAction(id: string): Promise<FormState> {
  let to: string | undefined;
  const state = await write(async ({ actor, today }) => {
    to = `/app/quotes/${(await duplicateQuote(tenantData, actor, id, { today })).id}`;
    refresh();
    return { status: "saved", message: "Quote duplicated." };
  });
  if (to) redirect(to);
  return state;
}

export async function updateNumberingAction(_: FormState, form: FormData): Promise<FormState> {
  return write(async ({ actor }) => {
    await updateQuoteNumbering(tenantData, actor, {
      prefix: String(form.get("prefix") ?? ""),
      nextNumber: String(form.get("nextNumber") ?? ""),
      padding: String(form.get("padding") ?? ""),
    });
    revalidatePath("/app/settings");
    return { status: "saved", message: "Quote numbering saved." };
  }, "settings:write");
}

export type ShareState = FormState | { status: "link"; message: string; url: string };

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  return publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${host}`);
}

/** A new share link, returned once: only its hash is stored (decision D16). */
export async function createLinkAction(id: string): Promise<ShareState> {
  let url = "";
  const state = await write(async ({ actor }) => {
    const { token } = await createShareLink(tenantData, actor, id);
    url = new URL(quotePath(token), await origin()).toString();
    refresh(id);
    return { status: "saved", message: "Link created." };
  });
  return state.status === "saved" ? { status: "link", message: "Copy this link now: it is shown only once.", url } : state;
}

export async function emailQuoteAction(id: string, seller: string): Promise<ShareState> {
  return write(async ({ actor }) => {
    try {
      const { sentTo } = await emailQuote(tenantData, actor, id, { appUrl: await origin(), seller, email: emailSender });
      refresh(id);
      return { status: "saved", message: `Quote emailed to ${sentTo}.` };
    } catch (error) {
      if (error instanceof EmailNotConfiguredError) {
        return { status: "error", message: "Email is not set up for this workspace yet. Create a link and send it yourself." };
      }
      throw error;
    }
  });
}

export async function revokeLinksAction(id: string): Promise<ShareState> {
  return write(async ({ actor }) => {
    const { revoked } = await revokeShareLinks(tenantData, actor, id);
    refresh(id);
    return { status: "saved", message: revoked ? `${revoked} ${revoked === 1 ? "link" : "links"} revoked.` : "No active links." };
  });
}
