"use server";

import { revalidatePath } from "next/cache";
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
import { recordPayment, voidPayment } from "@/lib/payments/service";
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
