import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { dateValue } from "@/lib/dates";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { convertMinor, rateFor, type RateUsed } from "@/lib/fx/rates";
import { fromDecimalString, InvalidAmountError } from "@/lib/money";
import type { TenantData, TenantDb } from "@/lib/tenant/core";
import { calendarDate, text } from "@/lib/validation/fields";

/**
 * Receivables and collections (spec §7.7). What is owed comes from the
 * invoices themselves (outstanding = total − valid payments, kept by the
 * database); this module adds ageing, base-currency totals with the rate
 * used, and how each invoice is being collected. Callers check
 * collections:read / collections:write.
 */

export interface Actor {
  organizationId: string;
  userId: string;
}

export const BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type Bucket = (typeof BUCKETS)[number];

const DAY = 86_400_000;

export function daysOverdue(dueOn: Date, today: string) {
  return Math.max(0, Math.round((dateValue(today).getTime() - dueOn.getTime()) / DAY));
}

export function bucketOf(dueOn: Date, today: string): Bucket {
  const days = daysOverdue(dueOn, today);
  if (days === 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

type Totals = Record<Bucket, bigint> & { total: bigint };
const emptyTotals = (): Totals => ({ current: 0n, "1-30": 0n, "31-60": 0n, "61-90": 0n, "90+": 0n, total: 0n });

export interface AgingReport {
  today: string;
  baseCurrency: string;
  /** Per invoice currency, never added across currencies (spec §5.5). */
  byCurrency: { currency: string; invoices: number; totals: Totals }[];
  /** Converted into the base currency where a rate exists. */
  inBase: { totals: Totals; complete: boolean; missing: string[]; rates: ({ currency: string } & Omit<RateUsed, "rateScaled">)[] };
}

/** Open (issued, owing) invoices with their collection state, oldest due first. */
export async function openReceivables(data: TenantData, organizationId: string, today: string, filter: { ownerUserId?: string; bucket?: Bucket } = {}) {
  const tenant = data.scoped(organizationId);
  const invoices = await tenant.invoice.findMany({
    where: { status: "issued", outstandingMinor: { gt: 0 } },
    orderBy: [{ dueOn: "asc" }, { id: "asc" }],
    include: {
      customer: { select: { id: true, displayName: true } },
      collection: { include: { owner: { select: { name: true } } } },
      promises: { where: { status: "open" }, orderBy: { promisedOn: "asc" }, take: 1 },
    },
  });
  return invoices
    .map((invoice) => ({ ...invoice, bucket: bucketOf(invoice.dueOn, today), daysOverdue: daysOverdue(invoice.dueOn, today) }))
    .filter((row) => (filter.bucket ? row.bucket === filter.bucket : true))
    .filter((row) => (filter.ownerUserId ? row.collection?.ownerUserId === filter.ownerUserId : true));
}

export async function agingReport(data: TenantData, organizationId: string, { today, baseCurrency }: { today: string; baseCurrency: string }): Promise<AgingReport> {
  const rows = await openReceivables(data, organizationId, today);
  const byCurrency = new Map<string, { invoices: number; totals: Totals }>();
  for (const row of rows) {
    const entry = byCurrency.get(row.currency) ?? { invoices: 0, totals: emptyTotals() };
    entry.invoices++;
    entry.totals[row.bucket] += row.outstandingMinor;
    entry.totals.total += row.outstandingMinor;
    byCurrency.set(row.currency, entry);
  }
  const inBase = { totals: emptyTotals(), complete: true, missing: [] as string[], rates: [] as AgingReport["inBase"]["rates"] };
  const tenant = data.scoped(organizationId);
  for (const [currency, entry] of [...byCurrency].sort(([a], [b]) => a.localeCompare(b))) {
    if (currency === baseCurrency) {
      for (const key of [...BUCKETS, "total"] as const) inBase.totals[key] += entry.totals[key];
      continue;
    }
    const rate = await rateFor(tenant, baseCurrency, currency, dateValue(today));
    if (!rate) {
      inBase.complete = false;
      inBase.missing.push(currency);
      continue;
    }
    const { rateScaled, ...shown } = rate;
    inBase.rates.push({ currency, ...shown });
    // Each bucket converted once; the total is their sum, so the report adds up.
    for (const key of BUCKETS) {
      const converted = convertMinor(entry.totals[key], currency, baseCurrency, rateScaled);
      inBase.totals[key] += converted;
      inBase.totals.total += converted;
    }
  }
  return {
    today,
    baseCurrency,
    byCurrency: [...byCurrency].map(([currency, entry]) => ({ currency, ...entry })).sort((a, b) => a.currency.localeCompare(b.currency)),
    inBase,
  };
}

// ---------------------------------------------------------------------------
// Collecting an invoice
// ---------------------------------------------------------------------------

async function issuedInvoice(tenant: TenantDb, invoiceId: string) {
  const invoice = await tenant.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new RecordNotFoundError("Invoice");
  if (invoice.status !== "issued") throw new RecordConflictError("Only an issued invoice is collected, so this one");
  return invoice;
}

/** The invoice's collection record, created on first use. */
async function collectionOf(tenant: TenantDb, invoiceId: string) {
  await tenant.invoiceCollection.createMany({ data: [{ invoiceId }], skipDuplicates: true });
  return tenant.invoiceCollection.findFirstOrThrow({ where: { invoiceId } });
}

export async function getCollection(data: TenantData, organizationId: string, invoiceId: string) {
  const tenant = data.scoped(organizationId);
  const [collection, promises, notes] = await Promise.all([
    tenant.invoiceCollection.findFirst({ where: { invoiceId }, include: { owner: { select: { name: true } } } }),
    tenant.promiseToPay.findMany({ where: { invoiceId }, orderBy: { createdAt: "desc" }, include: { takenBy: { select: { name: true } } } }),
    tenant.collectionNote.findMany({ where: { invoiceId }, orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } }),
  ]);
  return { collection, promises, notes };
}

const updateSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("owner"), ownerUserId: z.string().trim().max(64).transform((v) => v || null) }),
  z.strictObject({ action: z.literal("escalate"), note: z.string().trim().min(3, { error: "is required" }).max(1000) }),
  z.strictObject({ action: z.literal("pause"), until: calendarDate.pipe(z.date({ error: "is required" })), reason: z.string().trim().min(3, { error: "is required" }).max(500) }),
  z.strictObject({ action: z.literal("resume") }),
]);

/**
 * Changes how an invoice is collected: owner (a current member), escalate
 * to a person with a note, pause reminders until a date with a reason, or
 * resume. Audited.
 */
export async function updateCollection(
  data: TenantData,
  actor: Actor,
  invoiceId: string,
  input: unknown,
  { today, memberIds }: { today: string; memberIds: ReadonlySet<string> },
) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw new InputValidationError(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? "action"), i.message])));
  const change = parsed.data;
  if (change.action === "owner" && change.ownerUserId && !memberIds.has(change.ownerUserId)) {
    throw new InputValidationError({ ownerUserId: "must be a member of this workspace" });
  }
  if (change.action === "pause" && change.until <= dateValue(today)) throw new InputValidationError({ until: "must be after today" });
  return data.transaction(actor.organizationId, async (tenant) => {
    await issuedInvoice(tenant, invoiceId);
    const current = await collectionOf(tenant, invoiceId);
    const next =
      change.action === "owner"
        ? { ownerUserId: change.ownerUserId }
        : change.action === "escalate"
          ? { status: "escalated", escalatedAt: new Date(), escalationNote: change.note, pausedUntil: null, pauseReason: null }
          : change.action === "pause"
            ? { status: "paused", pausedUntil: change.until, pauseReason: change.reason }
            : { status: "open", pausedUntil: null, pauseReason: null };
    await tenant.invoiceCollection.updateMany({ where: { id: current.id }, data: { ...next, version: { increment: 1 } } });
    await recordAudit(tenant, {
      action: "collection.updated",
      actorUserId: actor.userId,
      targetType: "invoice",
      targetId: invoiceId,
      metadata: { change: change.action, ...(change.action === "pause" ? { until: change.until.toISOString().slice(0, 10) } : {}) },
    });
    return tenant.invoiceCollection.findFirstOrThrow({ where: { id: current.id } });
  });
}

const promiseSchema = z.strictObject({
  amount: z.string().trim().min(1, { error: "is required" }).max(30),
  promisedOn: calendarDate.pipe(z.date({ error: "is required" })),
  note: text(500),
});

/** Records a promise to pay; reminders wait for it (D: spec §7.7 "agreed arrangement"). */
export async function addPromise(data: TenantData, actor: Actor, invoiceId: string, input: unknown, { today }: { today: string }) {
  const parsed = promiseSchema.safeParse(input);
  if (!parsed.success) throw new InputValidationError(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const values = parsed.data;
  if (values.promisedOn < dateValue(today)) throw new InputValidationError({ promisedOn: "cannot be in the past" });
  return data.transaction(actor.organizationId, async (tenant) => {
    const invoice = await issuedInvoice(tenant, invoiceId);
    let amountMinor: bigint;
    try {
      amountMinor = fromDecimalString(values.amount.replaceAll(",", ""), invoice.currency).amountMinor;
    } catch (error) {
      if (!(error instanceof InvalidAmountError)) throw error;
      throw new InputValidationError({ amount: `must be an amount in ${invoice.currency}` });
    }
    const owed = invoice.totalMinor - invoice.paidMinor;
    if (amountMinor <= 0n || amountMinor > owed) throw new InputValidationError({ amount: "must be more than zero and no more than what is owed" });
    if (await tenant.promiseToPay.findFirst({ where: { invoiceId, status: "open" } })) {
      throw new RecordConflictError("This invoice already has an open promise; cancel it first, so it");
    }
    const promise = await tenant.promiseToPay.create({
      data: { invoiceId, promisedOn: values.promisedOn, amountMinor, currency: invoice.currency, paidAtStartMinor: invoice.paidMinor, note: values.note, takenById: actor.userId },
    });
    await recordAudit(tenant, {
      action: "promise.added",
      actorUserId: actor.userId,
      targetType: "invoice",
      targetId: invoiceId,
      metadata: { promisedOn: values.promisedOn.toISOString().slice(0, 10), currency: invoice.currency, amountMinor: amountMinor.toString() },
    });
    return promise;
  });
}

export async function cancelPromise(data: TenantData, actor: Actor, promiseId: string) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const promise = await tenant.promiseToPay.findUnique({ where: { id: promiseId } });
    if (!promise) throw new RecordNotFoundError("Promise");
    const { count } = await tenant.promiseToPay.updateMany({ where: { id: promiseId, status: "open" }, data: { status: "cancelled", resolvedAt: new Date() } });
    if (count !== 1) throw new RecordConflictError("This promise is already closed, so it");
    await recordAudit(tenant, { action: "promise.cancelled", actorUserId: actor.userId, targetType: "invoice", targetId: promise.invoiceId });
  });
}

export async function addCollectionNote(data: TenantData, actor: Actor, invoiceId: string, body: unknown) {
  const parsed = z.string().trim().min(1, { error: "is required" }).max(5000).safeParse(body);
  if (!parsed.success) throw new InputValidationError({ body: parsed.error.issues[0].message });
  return data.transaction(actor.organizationId, async (tenant) => {
    const invoice = await tenant.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new RecordNotFoundError("Invoice");
    const note = await tenant.collectionNote.create({ data: { invoiceId, body: parsed.data, authorUserId: actor.userId } });
    await recordAudit(tenant, { action: "collection.note_added", actorUserId: actor.userId, targetType: "invoice", targetId: invoiceId });
    return note;
  });
}

/**
 * The daily review (job "receivables.review"): promises whose date has passed
 * are kept if at least the promised amount was paid since (or the invoice is
 * settled), otherwise broken; pauses that have ended resume. Idempotent.
 */
export async function reviewReceivables(data: TenantData, organizationId: string, today: string) {
  return data.transaction(organizationId, async (tenant) => {
    const due = await tenant.promiseToPay.findMany({ where: { status: "open", promisedOn: { lt: dateValue(today) } }, include: { invoice: true } });
    let kept = 0;
    let broken = 0;
    for (const promise of due) {
      const settled = promise.invoice.status !== "issued" || promise.invoice.paidMinor >= promise.invoice.totalMinor;
      const ok = settled || promise.invoice.paidMinor - promise.paidAtStartMinor >= promise.amountMinor;
      await tenant.promiseToPay.updateMany({ where: { id: promise.id, status: "open" }, data: { status: ok ? "kept" : "broken", resolvedAt: new Date() } });
      await recordAudit(tenant, { action: "promise.resolved", actorUserId: null, targetType: "invoice", targetId: promise.invoiceId, metadata: { outcome: ok ? "kept" : "broken" } });
      if (ok) kept++;
      else broken++;
    }
    const { count: resumed } = await tenant.invoiceCollection.updateMany({
      where: { status: "paused", pausedUntil: { lte: dateValue(today) } },
      data: { status: "open", pausedUntil: null, pauseReason: null, version: { increment: 1 } },
    });
    return { kept, broken, resumed };
  });
}
