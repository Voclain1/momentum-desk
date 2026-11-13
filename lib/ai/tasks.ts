import { z } from "zod";
import { dateValue } from "@/lib/dates";
import { dateText } from "@/lib/documents/present";
import { RecordNotFoundError } from "@/lib/errors";
import { formatMoney, money } from "@/lib/money";
import { BUCKETS, openReceivables } from "@/lib/receivables/service";
import { type AiActor, type AiDeps, runAiTask } from "./service";

/**
 * The Momentum AI tasks (spec §7.8). Each gathers facts from records the
 * caller may read (the server action checks the permission), leaves out
 * contact details the AI does not need, and returns a draft or suggestion
 * for a person to edit. None of them sends or saves anything.
 */

export interface Context {
  today: string;
  locale: string;
  seller: string;
}

const clip = (text: string | null | undefined, max: number) => {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
};
const amount = (minor: bigint, currency: string, locale: string) => formatMoney(money(minor, currency), locale);
const day = (date: Date, locale: string) => `${dateText(date, locale)} (${date.toISOString().slice(0, 10)})`;
const line = (label: string, value: string | null | undefined) => (value ? `${label}: ${value}` : null);
const lines = (...items: (string | null | false)[]) => items.filter(Boolean).join("\n");

// Lead summary, next action and follow-up draft --------------------------------

const leadAssistOutput = z.strictObject({
  summary: z.string().min(1).max(1500),
  nextAction: z.strictObject({
    action: z.enum(["call", "email", "meeting", "send_quote", "follow_up_later", "close_as_lost"]),
    timing: z.enum(["today", "this_week", "next_week", "later"]),
    reason: z.string().min(1).max(500),
  }),
  followUp: z.strictObject({ subject: z.string().min(1).max(150), body: z.string().min(1).max(3000) }),
});
export type LeadAssist = z.infer<typeof leadAssistOutput>;

export async function leadAssist(deps: AiDeps, actor: AiActor, leadId: string, context: Context): Promise<LeadAssist> {
  const tenant = deps.data.scoped(actor.organizationId);
  const lead = await tenant.lead.findUnique({ where: { id: leadId }, include: { stage: true, owner: { select: { name: true } } } });
  if (!lead) throw new RecordNotFoundError("Lead");
  const [activities, tasks] = await Promise.all([
    tenant.activity.findMany({ where: { leadId }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 20 }),
    tenant.task.findMany({ where: { leadId, completedAt: null }, orderBy: { dueOn: "asc" }, take: 10 }),
  ]);
  const { locale } = context;
  const facts = lines(
    `Today: ${day(dateValue(context.today), locale)}`,
    `Business: ${context.seller}`,
    line("Contact", lead.contactName),
    line("Company", lead.companyName),
    `Pipeline stage: ${lead.stage.name} (${lead.stage.kind === "open" ? "open" : lead.stage.kind})`,
    line("Source", lead.source),
    line("Owner", lead.owner?.name),
    lead.estimatedValueMinor !== null && lead.currency ? `Estimated value: ${amount(lead.estimatedValueMinor, lead.currency, locale)}` : "Estimated value: not recorded",
    line("What they need", clip(lead.summary, 1000)),
    line("Notes", clip(lead.notes, 1500)),
    lead.nextFollowUpOn ? `Next follow-up planned: ${day(lead.nextFollowUpOn, locale)}` : "Next follow-up: none planned",
    lead.tags.length ? `Tags: ${lead.tags.join(", ")}` : null,
    lead.lostReason ? `Lost reason: ${clip(lead.lostReason, 300)}` : null,
    `In this stage since: ${day(lead.stageChangedAt, locale)}`,
    "Open tasks:",
    ...(tasks.length ? tasks.map((t) => `- ${clip(t.title, 200)}${t.dueOn ? ` (due ${day(t.dueOn, locale)})` : ""}`) : ["- none"]),
    "Timeline, newest first:",
    ...(activities.length ? activities.map((a) => `- ${day(a.occurredAt, locale)} ${a.kind}: ${clip(a.body, 600)}`) : ["- nothing logged yet"]),
  );
  return runAiTask(deps, actor, {
    task: "lead.assist",
    targetType: "lead",
    targetId: lead.id,
    facts,
    instructions: `Help the person who owns this lead.
1. summary: what is known about this lead and where things stand, in 2 to 5 sentences.
2. nextAction: the most useful next step, when, and why, based on the facts.
3. followUp: a short, friendly follow-up email to the contact from the business, with a subject. Sign off with the business's name only. Do not promise prices, discounts, dates or anything else not in the facts; where a detail is needed but unknown, write it as [to confirm].`,
    output: leadAssistOutput,
    texts: (out) => [out.summary, out.nextAction.reason, out.followUp.subject, out.followUp.body],
  });
}

// Quote assistance: lines from a customer's request -----------------------------

const quoteAssistOutput = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        productId: z.string().nullable(),
        description: z.string().min(1).max(500),
        quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
      }),
    )
    .max(20),
  questions: z.array(z.string().min(1).max(300)).max(5),
});
export type QuoteSuggestion = z.infer<typeof quoteAssistOutput>;

export async function quoteAssist(deps: AiDeps, actor: AiActor, input: { request: string; currency: string }, context: Context): Promise<QuoteSuggestion> {
  const request = clip(input.request, 4000);
  const products = await deps.data.scoped(actor.organizationId).product.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    take: 150,
    include: { prices: { where: { currency: input.currency } } },
  });
  const ids = new Set(products.map((p) => p.id));
  const facts = lines(
    `Business: ${context.seller}`,
    `Quote currency: ${input.currency}`,
    "The customer's request (their words):",
    request,
    "Catalogue (id | name | description | unit):",
    ...(products.length
      ? products.map((p) => `- ${p.id} | ${clip(p.name, 120)} | ${clip(p.description, 300) || "-"} | ${p.unit ?? "-"}`)
      : ["- the catalogue is empty"]),
  );
  return runAiTask(deps, actor, {
    task: "quote.assist",
    targetType: "quote",
    facts,
    instructions: `Propose quote lines for the customer's request.
- For each thing requested, use the catalogue item that matches (productId = its id) or, if none matches, productId null with a short description.
- quantity: the quantity the customer asked for, as digits; "1" if they did not say.
- Do not include prices: they come from the catalogue or are entered by the business.
- questions: anything the business should confirm with the customer before quoting (at most 5).`,
    output: quoteAssistOutput,
    // Quantities are checked separately below; descriptions and questions may only repeat figures from the facts.
    texts: (out) => [...out.lines.map((l) => l.description), ...out.questions],
    check: (out) => [
      ...out.lines.filter((l) => l.productId !== null && !ids.has(l.productId)).map((l) => `productId ${l.productId} is not in the catalogue`),
      ...out.lines
        .filter((l) => l.quantity !== "1" && !new RegExp(`(^|[^\\d.])${l.quantity.replace(".", "\\.")}([^\\d]|$)`).test(request))
        .map((l) => `quantity ${l.quantity} does not appear in the customer's request`),
    ],
  });
}

// Collections drafting -----------------------------------------------------------

const collectionsOutput = z.strictObject({ subject: z.string().min(1).max(150), body: z.string().min(1).max(3000) });
export type CollectionsDraft = z.infer<typeof collectionsOutput>;
export const DRAFT_TONES = ["friendly", "firm", "final"] as const;

export async function collectionsDraft(
  deps: AiDeps,
  actor: AiActor,
  invoiceId: string,
  tone: (typeof DRAFT_TONES)[number],
  context: Context,
): Promise<CollectionsDraft> {
  const tenant = deps.data.scoped(actor.organizationId);
  const invoice = await tenant.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: { select: { displayName: true } },
      collection: true,
      promises: { orderBy: { createdAt: "desc" }, take: 3 },
      collectionNotes: { orderBy: { createdAt: "desc" }, take: 5 },
      reminders: { where: { status: "sent" }, orderBy: { completedAt: "desc" }, take: 1 },
    },
  });
  if (!invoice || invoice.status !== "issued") throw new RecordNotFoundError("Invoice");
  const { locale } = context;
  const show = (minor: bigint) => amount(minor, invoice.currency, locale);
  const overdue = Math.round((dateValue(context.today).getTime() - invoice.dueOn.getTime()) / 86_400_000);
  const facts = lines(
    `Today: ${day(dateValue(context.today), locale)}`,
    `Business: ${context.seller}`,
    `Customer: ${invoice.customer.displayName}`,
    line("Addressed to", invoice.recipientName),
    `Invoice: ${invoice.number}`,
    `Issued: ${day(invoice.issuedOn, locale)}`,
    `Due: ${day(invoice.dueOn, locale)}`,
    overdue > 0 ? `Days past due: ${overdue}` : overdue === 0 ? "Due today" : `Due in ${-overdue} days`,
    `Invoice total: ${show(invoice.totalMinor)}`,
    `Paid so far: ${show(invoice.paidMinor)}`,
    `Outstanding: ${show(invoice.outstandingMinor)}`,
    invoice.disputedAt ? `Disputed: ${clip(invoice.disputeReason, 300)}` : null,
    invoice.collection?.status === "paused" ? `Collection paused: ${clip(invoice.collection.pauseReason, 300)}` : null,
    ...invoice.promises.map((p) => `Promise to pay ${show(p.amountMinor)} by ${day(p.promisedOn, locale)}: ${p.status}`),
    invoice.reminders[0]?.completedAt ? `Last automatic reminder: ${day(invoice.reminders[0].completedAt, locale)}` : null,
    ...invoice.collectionNotes.map((n) => `Internal note (${day(n.createdAt, locale)}): ${clip(n.body, 400)}`),
  );
  const tones = {
    friendly: "friendly and understanding, assuming it was overlooked",
    firm: "polite but firm, asking them to pay or say when they will",
    final: "a clear final request before the business escalates, still courteous and never threatening",
  };
  return runAiTask(deps, actor, {
    task: "collections.draft",
    targetType: "invoice",
    targetId: invoice.id,
    facts,
    instructions: `Draft an email from the business to the customer about this invoice. Tone: ${tones[tone]}.
State the outstanding amount and invoice number exactly as in the facts. Do not mention internal notes directly, interest, fees, legal action or anything not in the facts. Do not include a link: a link to view and pay the invoice is added under your message. Sign off with the business's name.`,
    output: collectionsOutput,
    texts: (out) => [out.subject, out.body],
    check: (out) => (out.body.includes(invoice.number!) || out.subject.includes(invoice.number!) ? [] : [`it must mention invoice ${invoice.number}`]),
  });
}

// Overdue accounts summary --------------------------------------------------------

const receivablesOutput = z.strictObject({
  summary: z.string().min(1).max(2000),
  priorities: z.array(z.strictObject({ invoiceNumber: z.string(), reason: z.string().min(1).max(400) })).max(5),
});
export type ReceivablesSummary = z.infer<typeof receivablesOutput>;

export async function receivablesSummary(deps: AiDeps, actor: AiActor, context: Context): Promise<ReceivablesSummary> {
  const rows = await openReceivables(deps.data, actor.organizationId, context.today);
  const { locale } = context;
  const totals = new Map<string, Record<string, bigint>>();
  for (const row of rows) {
    const entry = totals.get(row.currency) ?? Object.fromEntries(BUCKETS.map((b) => [b, 0n]));
    entry[row.bucket] += row.outstandingMinor;
    totals.set(row.currency, entry);
  }
  const overdue = rows.filter((r) => r.daysOverdue > 0).sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 20);
  const numbers = new Set(overdue.map((r) => r.number!));
  const facts = lines(
    `Today: ${day(dateValue(context.today), locale)}`,
    `Open invoices: ${rows.length}; overdue: ${rows.filter((r) => r.daysOverdue > 0).length}`,
    "Outstanding by currency and age (currencies are never added together):",
    ...[...totals].map(([currency, t]) => `- ${currency}: ${BUCKETS.map((b) => `${b === "current" ? "not yet due" : `${b} days`} ${amount(t[b], currency, locale)}`).join("; ")}`),
    "Most overdue invoices:",
    ...(overdue.length
      ? overdue.map((r) =>
          [
            `- ${r.number} | ${r.customer.displayName} | ${amount(r.outstandingMinor, r.currency, locale)} outstanding | ${r.daysOverdue} days overdue`,
            r.collection?.status && r.collection.status !== "open" ? ` | ${r.collection.status}` : "",
            r.collection?.owner ? ` | owner ${r.collection.owner.name}` : " | no owner",
            r.promises[0] ? ` | promised ${amount(r.promises[0].amountMinor, r.currency, locale)} by ${day(r.promises[0].promisedOn, locale)}` : "",
            r.disputedAt ? " | disputed" : "",
          ].join(""),
        )
      : ["- none"]),
  );
  return runAiTask(deps, actor, {
    task: "receivables.summary",
    facts,
    instructions: `Summarise the overdue accounts for the business's team in a short paragraph: how much is overdue in each currency and what stands out. Then list up to 5 invoices to act on first (by invoice number, from the list) with a one-line reason each. Never add currencies together.`,
    output: receivablesOutput,
    texts: (out) => [out.summary, ...out.priorities.map((p) => p.reason)],
    check: (out) => out.priorities.filter((p) => !numbers.has(p.invoiceNumber)).map((p) => `${p.invoiceNumber} is not one of the listed invoices`),
  });
}
