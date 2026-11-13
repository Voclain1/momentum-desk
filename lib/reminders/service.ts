import { randomBytes } from "node:crypto";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { addDays, dateValue } from "@/lib/dates";
import type { EmailSender } from "@/lib/email";
import { InputValidationError, RecordNotFoundError } from "@/lib/errors";
import type { Invoice } from "@/lib/generated/prisma/client";
import { invoicePath } from "@/lib/invoices/sharing";
import { enqueue } from "@/lib/jobs/queue";
import { formatMoney, money } from "@/lib/money";
import type { TenantData, TenantDb } from "@/lib/tenant/core";
import { hashToken } from "@/lib/tenant/public";

/**
 * Payment reminders (spec §7.7). Once a day the worker plans at most one
 * reminder per open invoice: the latest step that has come due, skipping
 * earlier ones rather than sending a backlog. Each reminder is checked again
 * just before it is sent, so a payment, void, dispute, pause, promise,
 * escalation or opt-out in between stops it, and it always states what is
 * owed at that moment. Every step is recorded once: sent or skipped with
 * the reason. Wording is fixed and factual; there is a minimum gap between
 * reminders. Off until an owner turns reminders on.
 */

export const DEFAULT_STEPS = [
  { offsetDays: -3, tone: "friendly" },
  { offsetDays: 1, tone: "friendly" },
  { offsetDays: 7, tone: "firm" },
  { offsetDays: 14, tone: "firm" },
  { offsetDays: 30, tone: "final" },
] as const;

export type Tone = "friendly" | "firm" | "final";

export type StopReason = "not_issued" | "paid" | "disputed" | "paused" | "escalated" | "promise" | "opted_out" | "no_email" | "disabled";

export const STOP_LABELS: Record<StopReason, string> = {
  not_issued: "the invoice is no longer issued",
  paid: "it was paid",
  disputed: "it is disputed",
  paused: "reminders are paused",
  escalated: "it was escalated to a person",
  promise: "the customer promised to pay",
  opted_out: "the customer opted out of reminders",
  no_email: "there is no email to send to",
  disabled: "reminders are turned off",
};

async function ensureSteps(tenant: TenantDb) {
  if ((await tenant.reminderStep.count()) > 0) return;
  await tenant.reminderStep.createMany({ data: DEFAULT_STEPS.map((step) => ({ ...step })), skipDuplicates: true });
}

export async function reminderSettings(data: TenantData, organizationId: string) {
  return data.transaction(organizationId, async (tenant) => {
    await ensureSteps(tenant);
    const settings = await tenant.invoiceSettings.findFirst();
    const steps = await tenant.reminderStep.findMany({ orderBy: { offsetDays: "asc" } });
    return { enabled: settings?.remindersEnabled ?? false, minGapDays: settings?.reminderMinGapDays ?? 3, steps };
  });
}

const settingsSchema = z.strictObject({
  enabled: z.boolean(),
  minGapDays: z.coerce.number({ error: "must be a whole number" }).int({ error: "must be a whole number" }).min(1).max(30, { error: "must be 30 or less" }),
});

/** Turns reminders on or off and sets the minimum gap (settings:write). */
export async function updateReminderSettings(data: TenantData, actor: { organizationId: string; userId: string }, input: unknown) {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) throw new InputValidationError(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  await data.transaction(actor.organizationId, async (tenant) => {
    await ensureSteps(tenant);
    const values = { remindersEnabled: parsed.data.enabled, reminderMinGapDays: parsed.data.minGapDays };
    if (await tenant.invoiceSettings.findFirst()) await tenant.invoiceSettings.updateMany({ where: {}, data: values });
    else await tenant.invoiceSettings.create({ data: values });
    await recordAudit(tenant, {
      action: "reminders.settings_updated",
      actorUserId: actor.userId,
      targetType: "organization",
      targetId: actor.organizationId,
      metadata: { enabled: parsed.data.enabled, minGapDays: parsed.data.minGapDays },
    });
  });
}

/** Why an invoice should not be reminded now, if anything (checked when planning and again when sending). */
async function stopReason(tenant: TenantDb, invoice: Invoice, today: string): Promise<StopReason | null> {
  if (invoice.status !== "issued") return "not_issued";
  if (invoice.paidMinor >= invoice.totalMinor) return "paid";
  if (invoice.disputedAt) return "disputed";
  if (!invoice.recipientEmail) return "no_email";
  const [settings, collection, promise, customer] = await Promise.all([
    tenant.invoiceSettings.findFirst(),
    tenant.invoiceCollection.findFirst({ where: { invoiceId: invoice.id } }),
    tenant.promiseToPay.findFirst({ where: { invoiceId: invoice.id, status: "open", promisedOn: { gte: dateValue(today) } } }),
    tenant.customer.findUnique({ where: { id: invoice.customerId }, select: { remindersOptedOutAt: true } }),
  ]);
  if (!settings?.remindersEnabled) return "disabled";
  if (collection?.status === "paused") return "paused";
  if (collection?.status === "escalated") return "escalated";
  if (promise) return "promise";
  if (customer?.remindersOptedOutAt) return "opted_out";
  return null;
}

/**
 * The daily plan (job "reminders.run"): for each open invoice, the latest
 * step now due gets a reminder queued (or skipped with the reason); earlier
 * due steps that were never sent are skipped as superseded. Idempotent.
 */
export async function planReminders(data: TenantData, organizationId: string, today: string, now: Date = new Date()) {
  return data.transaction(organizationId, async (tenant) => {
    const settings = await tenant.invoiceSettings.findFirst();
    if (!settings?.remindersEnabled) return { queued: 0, skipped: 0 };
    await ensureSteps(tenant);
    const steps = await tenant.reminderStep.findMany({ orderBy: { offsetDays: "asc" } });
    const invoices = await tenant.invoice.findMany({ where: { status: "issued", outstandingMinor: { gt: 0 } } });
    let queued = 0;
    let skipped = 0;
    for (const invoice of invoices) {
      const due = steps.filter((step) => addDays(invoice.dueOn.toISOString().slice(0, 10), step.offsetDays) <= today);
      if (!due.length) continue;
      const done = await tenant.reminderExecution.findMany({ where: { invoiceId: invoice.id } });
      const pending = due.filter((step) => !done.some((d) => d.offsetDays === step.offsetDays));
      if (!pending.length) continue;
      const latest = pending[pending.length - 1];
      for (const old of pending.slice(0, -1)) {
        await tenant.reminderExecution.createMany({
          data: [{ invoiceId: invoice.id, offsetDays: old.offsetDays, tone: old.tone, currency: invoice.currency, status: "skipped", reason: "superseded", completedAt: now }],
          skipDuplicates: true,
        });
        skipped++;
      }
      const reason = await stopReason(tenant, invoice, today);
      if (reason) {
        await tenant.reminderExecution.createMany({
          data: [{ invoiceId: invoice.id, offsetDays: latest.offsetDays, tone: latest.tone, currency: invoice.currency, status: "skipped", reason, completedAt: now }],
          skipDuplicates: true,
        });
        skipped++;
        continue;
      }
      // Frequency: wait (do not skip) while the last reminder is too recent.
      const lastSent = done.filter((d) => d.status === "sent").sort((a, b) => +b.completedAt! - +a.completedAt!)[0];
      if (lastSent && addDays(lastSent.completedAt!.toISOString().slice(0, 10), settings.reminderMinGapDays) > today) continue;
      const execution = await tenant.reminderExecution.create({
        data: { invoiceId: invoice.id, offsetDays: latest.offsetDays, tone: latest.tone, currency: invoice.currency },
      });
      await enqueue(tenant, { kind: "reminders.send", key: execution.id, payload: { executionId: execution.id }, runAt: now });
      queued++;
    }
    return { queued, skipped };
  });
}

export interface SendDeps {
  email: EmailSender;
  appUrl: string;
  seller: string;
  locale: string;
}

/** The fixed reminder wording for each tone: factual, polite, never threatening. */
export function reminderEmail(
  tone: Tone,
  facts: { seller: string; number: string; owed: string; due: string; daysOverdue: number; link: string; recipient: string | null },
) {
  const hello = `Hello${facts.recipient ? ` ${facts.recipient}` : ""},`;
  const lead =
    facts.daysOverdue < 0
      ? `This is a friendly reminder that invoice ${facts.number} from ${facts.seller} for ${facts.owed} is due on ${facts.due}.`
      : tone === "friendly"
        ? `Invoice ${facts.number} from ${facts.seller} was due on ${facts.due}, and ${facts.owed} is still outstanding.`
        : tone === "firm"
          ? `Invoice ${facts.number} from ${facts.seller} is ${facts.daysOverdue} days past its due date of ${facts.due}. ${facts.owed} is still outstanding; please arrange payment.`
          : `Invoice ${facts.number} from ${facts.seller} remains unpaid ${facts.daysOverdue} days after its due date of ${facts.due}. ${facts.owed} is outstanding. Please pay or contact ${facts.seller} to agree a plan.`;
  return {
    subject:
      facts.daysOverdue < 0 ? `Invoice ${facts.number} is due on ${facts.due}` : `Reminder: invoice ${facts.number}, ${facts.owed} outstanding`,
    text: [
      hello,
      "",
      lead,
      "",
      `View the invoice, pay or download it: ${facts.link}`,
      "",
      "If you have already paid, thank you, and please ignore this message. If something about the invoice is wrong, reply to let us know.",
      "You can stop these reminders from the invoice page.",
    ].join("\n"),
  };
}

/**
 * Sends one queued reminder (job "reminders.send"), after checking again
 * that it should still go out. Records what was owed when it was sent. A
 * failed email rolls everything back so the job retries.
 */
export async function sendReminder(data: TenantData, organizationId: string, executionId: string, today: string, deps: SendDeps, now: Date = new Date()) {
  const token = randomBytes(32).toString("base64url");
  return data.transaction(organizationId, async (tenant) => {
    const execution = await tenant.reminderExecution.findUnique({ where: { id: executionId } });
    if (!execution) throw new RecordNotFoundError("Reminder");
    if (execution.status !== "queued") return execution.status;
    const invoice = await tenant.invoice.findUniqueOrThrow({ where: { id: execution.invoiceId } });
    const reason = await stopReason(tenant, invoice, today);
    if (reason) {
      await tenant.reminderExecution.updateMany({ where: { id: executionId, status: "queued" }, data: { status: "skipped", reason, completedAt: now } });
      return "skipped";
    }
    const owedMinor = invoice.totalMinor - invoice.paidMinor;
    await tenant.invoiceLink.create({ data: { invoiceId: invoice.id, tokenHash: hashToken(token) } });
    const { count } = await tenant.reminderExecution.updateMany({
      where: { id: executionId, status: "queued" },
      data: { status: "sent", amountMinor: owedMinor, sentTo: invoice.recipientEmail, completedAt: now },
    });
    if (count !== 1) return "already";
    const message = reminderEmail(execution.tone as Tone, {
      seller: deps.seller,
      number: invoice.number!,
      owed: formatMoney(money(owedMinor, invoice.currency), deps.locale),
      due: new Intl.DateTimeFormat(deps.locale, { dateStyle: "long", timeZone: "UTC" }).format(invoice.dueOn),
      daysOverdue: Math.round((dateValue(today).getTime() - invoice.dueOn.getTime()) / 86_400_000),
      link: new URL(invoicePath(token), deps.appUrl).toString(),
      recipient: invoice.recipientName,
    });
    await deps.email.send({ to: invoice.recipientEmail!, ...message, idempotencyKey: `reminder-${executionId}` });
    return "sent";
  });
}

/** Stops reminders for a customer (by the customer, from an invoice link; or by staff). */
export async function setRemindersOptOut(data: TenantData, organizationId: string, customerId: string, optedOut: boolean, by: "customer" | "staff", actorUserId: string | null) {
  return data.transaction(organizationId, async (tenant) => {
    const { count } = await tenant.customer.updateMany({
      where: { id: customerId },
      data: optedOut ? { remindersOptedOutAt: new Date(), remindersOptOutBy: by } : { remindersOptedOutAt: null, remindersOptOutBy: null },
    });
    if (count !== 1) throw new RecordNotFoundError("Customer");
    await recordAudit(tenant, {
      action: optedOut ? "reminders.opted_out" : "reminders.opted_in",
      actorUserId,
      targetType: "customer",
      targetId: customerId,
      metadata: { by },
    });
  });
}

/** A customer stops reminders from an invoice's public page. */
export async function optOutFromInvoiceLink(
  deps: { data: TenantData; links: { invoiceLink(token: string): Promise<{ organizationId: string; invoiceId: string; revokedAt: Date | null } | null> } },
  token: string,
) {
  const link = await deps.links.invoiceLink(token);
  if (!link || link.revokedAt) return false;
  const invoice = await deps.data.scoped(link.organizationId).invoice.findUnique({ where: { id: link.invoiceId }, select: { customerId: true } });
  if (!invoice) return false;
  await setRemindersOptOut(deps.data, link.organizationId, invoice.customerId, true, "customer", null);
  return true;
}

export async function remindersFor(data: TenantData, organizationId: string, invoiceId: string) {
  return data.scoped(organizationId).reminderExecution.findMany({ where: { invoiceId }, orderBy: { createdAt: "desc" } });
}
