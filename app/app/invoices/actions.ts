"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthorizationError, type Permission } from "@/lib/auth/authorization";
import { todayIn } from "@/lib/dates";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import {
  createInvoice,
  createInvoiceFromQuote,
  deleteDraft,
  issueInvoice,
  setDisputed,
  updateDraft,
  updateInvoiceNumbering,
  voidInvoice,
} from "@/lib/invoices/service";
import { invoiceSettings, updateInvoiceSettings } from "@/lib/invoices/settings";
import { createInvoiceLink, emailInvoice, invoicePath, revokeInvoiceLinks } from "@/lib/invoices/sharing";
import { EmailNotConfiguredError } from "@/lib/email";
import { emailSender, publicOrigin } from "@/lib/email/server";
import { recordPayment, voidPayment } from "@/lib/payments/service";
import { refreshRefund, refundPayment } from "@/lib/payments/refunds";
import { onlineDeps } from "@/lib/payments/server";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";

export type FormState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; fields?: Record<string, string> };

interface Context {
  actor: { organizationId: string; userId: string };
  today: string;
  locale: string;
}

const DENIED: Partial<Record<Permission, string>> = {
  "invoices:write": "Your role cannot change invoices.",
  "invoices:void": "Only owners and admins can void invoices.",
  "payments:record": "Your role cannot record payments.",
  "payments:refund": "Only owners and admins can refund payments.",
  "settings:write": "Only owners and admins can change this.",
};

/** Permission check on the server, then domain errors mapped to form state. */
async function write(permission: Permission, work: (context: Context) => Promise<FormState>): Promise<FormState> {
  let tenant;
  try {
    tenant = await requireTenant(permission);
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: DENIED[permission] ?? "Not allowed." };
    throw error;
  }
  try {
    return await work({
      actor: { organizationId: tenant.organization.id, userId: tenant.user.id },
      today: todayIn(tenant.organization.timezone),
      locale: tenant.organization.locale,
    });
  } catch (error) {
    if (error instanceof InputValidationError) return { status: "error", message: "Some fields need fixing.", fields: { ...error.fields } };
    if (error instanceof RecordConflictError || error instanceof RecordNotFoundError) return { status: "error", message: error.message };
    throw error;
  }
}

function invoiceInput(form: FormData): unknown {
  try {
    return JSON.parse(String(form.get("quote") ?? "{}"));
  } catch {
    return {};
  }
}

function refresh(id?: string) {
  revalidatePath("/app/invoices");
  if (id) revalidatePath(`/app/invoices/${id}`);
}

export async function createInvoiceAction(_: FormState, form: FormData): Promise<FormState> {
  let id: string | undefined;
  const state = await write("invoices:write", async ({ actor }) => {
    id = (await createInvoice(tenantData, actor, invoiceInput(form))).id;
    refresh();
    return { status: "saved", message: "Draft saved." };
  });
  if (id) redirect(`/app/invoices/${id}`);
  return state;
}

export async function updateDraftAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  return write("invoices:write", async ({ actor }) => {
    await updateDraft(tenantData, actor, id, Number(form.get("version")), invoiceInput(form));
    refresh(id);
    return { status: "saved", message: "Draft saved." };
  });
}

/** For a draft made from a quote: only dates, recipient, notes and terms (D33). */
export async function updateConvertedDraftAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  return write("invoices:write", async ({ actor }) => {
    const text = (name: string) => String(form.get(name) ?? "");
    await updateDraft(tenantData, actor, id, Number(form.get("version")), {
      recipientContactId: text("recipientContactId"),
      issuedOn: text("issuedOn"),
      dueOn: text("dueOn"),
      notes: text("notes"),
      terms: text("terms"),
    });
    refresh(id);
    return { status: "saved", message: "Draft saved." };
  });
}

export async function invoiceQuoteAction(quoteId: string): Promise<FormState> {
  let to: string | undefined;
  const state = await write("invoices:write", async ({ actor, today }) => {
    const { defaultDueDays } = await invoiceSettings(tenantData, actor.organizationId);
    to = `/app/invoices/${(await createInvoiceFromQuote(tenantData, actor, quoteId, { today, dueInDays: defaultDueDays })).id}`;
    refresh();
    revalidatePath(`/app/quotes/${quoteId}`);
    return { status: "saved", message: "Invoice drafted." };
  });
  if (to) redirect(to);
  return state;
}

export async function issueInvoiceAction(id: string, version: number): Promise<FormState> {
  return write("invoices:write", async ({ actor }) => {
    const { paymentInstructions } = await invoiceSettings(tenantData, actor.organizationId);
    const invoice = await issueInvoice(tenantData, actor, id, version, { paymentInstructions });
    refresh(id);
    return { status: "saved", message: `Issued as ${invoice.number}.` };
  });
}

export async function deleteDraftAction(id: string): Promise<FormState> {
  let done = false;
  const state = await write("invoices:write", async ({ actor }) => {
    await deleteDraft(tenantData, actor, id);
    refresh();
    done = true;
    return { status: "saved", message: "Draft deleted." };
  });
  if (done) redirect("/app/invoices");
  return state;
}

export async function voidInvoiceAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  return write("invoices:void", async ({ actor }) => {
    await voidInvoice(tenantData, actor, id, String(form.get("reason") ?? ""));
    refresh(id);
    return { status: "saved", message: "Invoice voided." };
  });
}

export async function disputeAction(id: string, _: FormState, form: FormData): Promise<FormState> {
  return write("invoices:write", async ({ actor }) => {
    await setDisputed(tenantData, actor, id, String(form.get("reason") ?? ""));
    refresh(id);
    return { status: "saved", message: "Marked as disputed." };
  });
}

export async function resolveDisputeAction(id: string): Promise<FormState> {
  return write("invoices:write", async ({ actor }) => {
    await setDisputed(tenantData, actor, id, null);
    refresh(id);
    return { status: "saved", message: "Dispute resolved." };
  });
}

export async function recordPaymentAction(invoiceId: string, _: FormState, form: FormData): Promise<FormState> {
  return write("payments:record", async ({ actor, today, locale }) => {
    const text = (name: string) => String(form.get(name) ?? "");
    await recordPayment(
      tenantData,
      actor,
      invoiceId,
      { amount: text("amount"), method: text("method"), receivedOn: text("receivedOn"), reference: text("reference"), note: text("note") },
      { today, locale },
    );
    refresh(invoiceId);
    return { status: "saved", message: "Payment recorded." };
  });
}

export async function voidPaymentAction(paymentId: string, invoiceId: string, _: FormState, form: FormData): Promise<FormState> {
  return write("payments:record", async ({ actor }) => {
    await voidPayment(tenantData, actor, paymentId, String(form.get("reason") ?? ""));
    refresh(invoiceId);
    return { status: "saved", message: "Payment voided." };
  });
}

export async function updateInvoiceNumberingAction(_: FormState, form: FormData): Promise<FormState> {
  return write("settings:write", async ({ actor }) => {
    await updateInvoiceNumbering(tenantData, actor, {
      prefix: String(form.get("prefix") ?? ""),
      nextNumber: String(form.get("nextNumber") ?? ""),
      padding: String(form.get("padding") ?? ""),
    });
    revalidatePath("/app/settings");
    return { status: "saved", message: "Invoice numbering saved." };
  });
}

export async function updateInvoiceSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  return write("settings:write", async ({ actor }) => {
    await updateInvoiceSettings(tenantData, actor, {
      paymentInstructions: String(form.get("paymentInstructions") ?? ""),
      defaultDueDays: String(form.get("defaultDueDays") ?? ""),
    });
    revalidatePath("/app/settings");
    return { status: "saved", message: "Invoice settings saved." };
  });
}

export type ShareState = FormState | { status: "link"; message: string; url: string };

async function origin() {
  const h = await headers();
  return publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost"}`);
}

export async function createInvoiceLinkAction(id: string): Promise<ShareState> {
  let url = "";
  const state = await write("invoices:write", async ({ actor }) => {
    const { token } = await createInvoiceLink(tenantData, actor, id);
    url = new URL(invoicePath(token), await origin()).toString();
    refresh(id);
    return { status: "saved", message: "Link created." };
  });
  return state.status === "saved" ? { status: "link", message: "Copy this link now: it is shown only once.", url } : state;
}

export async function emailInvoiceAction(id: string, seller: string): Promise<ShareState> {
  return write("invoices:write", async ({ actor, locale }) => {
    try {
      const { sentTo } = await emailInvoice(tenantData, actor, id, { appUrl: await origin(), seller, locale, email: emailSender });
      refresh(id);
      return { status: "saved", message: `Invoice emailed to ${sentTo}.` };
    } catch (error) {
      if (error instanceof EmailNotConfiguredError) {
        return { status: "error", message: "Email is not set up for this workspace yet. Create a link and send it yourself." };
      }
      throw error;
    }
  });
}

export async function revokeInvoiceLinksAction(id: string): Promise<ShareState> {
  return write("invoices:write", async ({ actor }) => {
    const { revoked } = await revokeInvoiceLinks(tenantData, actor, id);
    refresh(id);
    return { status: "saved", message: revoked ? `${revoked} ${revoked === 1 ? "link" : "links"} revoked.` : "No active links." };
  });
}

export async function refundPaymentAction(paymentId: string, invoiceId: string, _: FormState, form: FormData): Promise<FormState> {
  return write("payments:refund", async ({ actor, locale }) => {
    const refund = await refundPayment(
      onlineDeps,
      actor,
      paymentId,
      { amount: String(form.get("amount") ?? ""), reason: String(form.get("reason") ?? ""), method: String(form.get("method") ?? "manual") },
      { locale },
    );
    refresh(invoiceId);
    return {
      status: "saved",
      message: refund.status === "pending" ? "Refund requested; the provider is processing it." : "Refund recorded.",
    };
  });
}

export async function refreshRefundAction(refundId: string, invoiceId: string): Promise<FormState> {
  return write("payments:refund", async ({ actor }) => {
    const refund = await refreshRefund(onlineDeps, actor.organizationId, refundId);
    refresh(invoiceId);
    return { status: "saved", message: refund?.status === "pending" ? "Still processing at the provider." : `Refund ${refund?.status}.` };
  });
}
