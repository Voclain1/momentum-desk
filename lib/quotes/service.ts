import type { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { dateValue } from "@/lib/dates";
import { calculateDocument, CalculationError, type Discount, HUNDRED_PERCENT, type LineInput as CalcLine, parseScaled } from "@/lib/documents/calc";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import type { Prisma, Quote } from "@/lib/generated/prisma/client";
import { fromDecimalString, InvalidAmountError } from "@/lib/money";
import type { TenantData, TenantDb } from "@/lib/tenant/core";
import { fieldErrors } from "@/lib/validation/fields";
import { lineInputSchema, numberingInputSchema, quoteInputSchema, type QuoteInput } from "./schema";

/**
 * Quotes (spec §7.5). Each row is one revision; revisions share a number.
 * Only drafts change: sending fixes the snapshot, and the database refuses
 * any later change to a sent quote's content (quote_guard trigger).
 *
 * Callers check quotes:read / quotes:write (settings:write for numbering).
 * Every write is audited in its transaction, without amounts or text.
 */

export interface Actor {
  organizationId: string;
  userId: string;
}

/** "YYYY-MM-DD" in the workspace's timezone. */
export interface Today {
  today: string;
}

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "superseded";
/** What people see: a sent quote shows as viewed or expired when it is. */
export type DisplayStatus = QuoteStatus | "viewed" | "expired";

export function displayStatus(quote: Pick<Quote, "status" | "viewedAt" | "expiresOn">, today: string): DisplayStatus {
  if (quote.status !== "sent") return quote.status as QuoteStatus;
  if (quote.expiresOn < dateValue(today)) return "expired";
  return quote.viewedAt ? "viewed" : "sent";
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

const DEFAULT_NUMBERING = { prefix: "Q-", nextNumber: 1, padding: 4 };

export async function quoteNumbering(data: TenantData, organizationId: string) {
  const row = await data.scoped(organizationId).documentSequence.findFirst({ where: { kind: "quote" } });
  return row ? { prefix: row.prefix, nextNumber: row.nextNumber, padding: row.padding } : DEFAULT_NUMBERING;
}

export async function updateQuoteNumbering(data: TenantData, actor: Actor, input: unknown) {
  const result = numberingInputSchema.safeParse(input);
  if (!result.success) throw new InputValidationError(fieldErrors(result.error));
  const values = result.data;
  await data.transaction(actor.organizationId, async (tenant) => {
    const existing = await tenant.documentSequence.findFirst({ where: { kind: "quote" } });
    if (existing) await tenant.documentSequence.updateMany({ where: { kind: "quote" }, data: values });
    else await tenant.documentSequence.create({ data: { kind: "quote", ...values } });
    await recordAudit(tenant, {
      action: "quote.numbering_updated",
      actorUserId: actor.userId,
      targetType: "organization",
      targetId: actor.organizationId,
      metadata: { ...values },
    });
  });
}

const format = (n: { prefix: string; padding: number }, value: number) => `${n.prefix}${String(value).padStart(n.padding, "0")}`;

/**
 * The next free quote number. Compare-and-set on the sequence, so concurrent
 * quotes never share a number; numbers already used (e.g. after the sequence
 * was moved back) are skipped.
 */
async function allocateNumber(tenant: TenantDb): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    let row = await tenant.documentSequence.findFirst({ where: { kind: "quote" } });
    if (!row) {
      await tenant.documentSequence.createMany({ data: [{ kind: "quote", ...DEFAULT_NUMBERING }], skipDuplicates: true });
      row = await tenant.documentSequence.findFirstOrThrow({ where: { kind: "quote" } });
    }
    const { count } = await tenant.documentSequence.updateMany({
      where: { kind: "quote", nextNumber: row.nextNumber },
      data: { nextNumber: { increment: 1 } },
    });
    if (count !== 1) continue;
    const number = format(row, row.nextNumber);
    if (!(await tenant.quote.findFirst({ where: { number }, select: { id: true } }))) return number;
  }
  throw new RecordConflictError("Quote numbering");
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 25;
export const STATUS_FILTERS = ["open", "draft", "sent", "accepted", "rejected", "all"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export interface QuoteQuery {
  q?: string;
  status?: StatusFilter;
  customerId?: string;
  page?: number;
}

const STATUS_WHERE: Record<StatusFilter, Prisma.QuoteWhereInput> = {
  open: { status: { in: ["draft", "sent"] } },
  draft: { status: "draft" },
  sent: { status: "sent" },
  accepted: { status: "accepted" },
  rejected: { status: "rejected" },
  // Superseded revisions are reached from their quote's history.
  all: { status: { not: "superseded" } },
};

export async function listQuotes(data: TenantData, organizationId: string, query: QuoteQuery = {}) {
  const tenant = data.scoped(organizationId);
  const q = query.q?.trim().slice(0, 100);
  const where: Prisma.QuoteWhereInput = {
    ...STATUS_WHERE[query.status ?? "open"],
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { customer: { displayName: { contains: q, mode: "insensitive" } } },
            { recipientName: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const total = await tenant.quote.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(query.page ?? 1) || 1), pageCount);
  const items = await tenant.quote.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: { customer: { select: { id: true, displayName: true } } },
  });
  return { items, total, page, pageCount };
}

export async function getQuote(data: TenantData, organizationId: string, id: string) {
  const tenant = data.scoped(organizationId);
  const quote = await tenant.quote.findUnique({
    where: { id },
    include: {
      items: { orderBy: { position: "asc" } },
      customer: { include: { contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] } } },
      lead: { select: { id: true, contactName: true, companyName: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!quote) throw new RecordNotFoundError("Quote");
  const revisions = await tenant.quote.findMany({
    where: { number: quote.number },
    orderBy: { revision: "desc" },
    select: { id: true, revision: true, status: true, sentAt: true, viewedAt: true, expiresOn: true, totalMinor: true, createdAt: true },
  });
  return { ...quote, revisions };
}

// ---------------------------------------------------------------------------
// Writing drafts
// ---------------------------------------------------------------------------

/** The customer's billing details, as copied onto a quote. */
function snapshotOf(customer: Prisma.CustomerGetPayload<object>) {
  return {
    name: customer.displayName,
    legalName: customer.legalName,
    taxId: customer.taxId,
    email: customer.email,
    phone: customer.phone,
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    city: customer.city,
    region: customer.region,
    postalCode: customer.postalCode,
    countryCode: customer.countryCode,
  };
}

type ExistingItems = { productId: string | null; taxRateId: string | null; taxName: string | null; taxMilliPercent: number | null }[];

interface ResolvedLine {
  productId: string | null;
  description: string;
  quantityMilli: bigint;
  unit: string | null;
  unitPriceMinor: bigint;
  discountKind: "none" | "percent" | "fixed";
  discountValue: bigint;
  tax: { taxRateId: string; taxName: string; taxMilliPercent: number } | null;
}

/**
 * Checks references and parses every line exactly in the quote's currency.
 * Errors are keyed "lines.N.field" (N from 1) for the builder.
 */
async function resolve(tenant: TenantDb, values: QuoteInput, existing: ExistingItems = []) {
  const errors: Record<string, string> = {};
  const customer = await tenant.customer.findUnique({ where: { id: values.customerId }, include: { contacts: true } });
  if (!customer) errors.customerId = "is not a customer of this workspace";
  else if (customer.archivedAt) errors.customerId = "is archived";

  if (values.leadId) {
    const lead = await tenant.lead.findUnique({ where: { id: values.leadId } });
    if (!lead) errors.leadId = "is not a lead of this workspace";
    else if (lead.customerId && lead.customerId !== values.customerId) errors.leadId = "belongs to another customer";
  }
  const contact = values.recipientContactId ? customer?.contacts.find((c) => c.id === values.recipientContactId) : undefined;
  if (values.recipientContactId && customer && !contact) errors.recipientContactId = "is not a contact of this customer";

  const [rates, products] = await Promise.all([
    tenant.taxRate.findMany({ where: { archivedAt: null } }),
    tenant.product.findMany({ where: { active: true }, select: { id: true } }),
  ]);
  const activeRates = new Map(rates.map((rate) => [rate.id, rate]));
  const knownProducts = new Set([...products.map((p) => p.id), ...existing.flatMap((i) => (i.productId ? [i.productId] : []))]);
  // A rate archived since it was put on this draft keeps its copied value.
  const keptRates = new Map(
    existing.flatMap((item) =>
      item.taxRateId && item.taxName !== null && item.taxMilliPercent !== null
        ? [[item.taxRateId, { name: item.taxName, milliPercent: item.taxMilliPercent }] as const]
        : [],
    ),
  );

  const lines: ResolvedLine[] = [];
  values.lines.forEach((raw, index) => {
    const at = (field: string) => `lines.${index + 1}.${field}`;
    const parsed = lineInputSchema.safeParse(raw);
    if (!parsed.success) {
      for (const [field, message] of Object.entries(fieldErrors(parsed.error as z.ZodError))) errors[at(field)] = message;
      return;
    }
    const line = parsed.data;
    const quantityMilli = parseScaled(line.quantity, 3);
    if (quantityMilli === null || quantityMilli <= 0n) errors[at("quantity")] = "must be a number above zero with up to 3 decimals";

    let unitPriceMinor: bigint | null = null;
    try {
      unitPriceMinor = fromDecimalString(line.unitPrice.replaceAll(",", ""), values.currency).amountMinor;
      if (unitPriceMinor < 0n) errors[at("unitPrice")] = "cannot be negative";
    } catch (error) {
      if (!(error instanceof InvalidAmountError)) throw error;
      errors[at("unitPrice")] = /decimal place/.test(error.message)
        ? `has too many decimal places for ${values.currency}`
        : "must be an amount such as 1500 or 1500.50";
    }

    let discountValue = 0n;
    if (line.discountKind === "percent") {
      const value = parseScaled(line.discount.replace(/%$/, ""), 3);
      if (value === null || value > HUNDRED_PERCENT) errors[at("discount")] = "must be a percentage from 0 to 100";
      else discountValue = value;
    } else if (line.discountKind === "fixed") {
      try {
        discountValue = fromDecimalString(line.discount.replaceAll(",", "") || "0", values.currency).amountMinor;
        if (discountValue < 0n) errors[at("discount")] = "cannot be negative";
      } catch (error) {
        if (!(error instanceof InvalidAmountError)) throw error;
        errors[at("discount")] = `must be an amount in ${values.currency}`;
      }
    }

    let tax: ResolvedLine["tax"] = null;
    if (line.taxRateId) {
      const rate = activeRates.get(line.taxRateId);
      const kept = keptRates.get(line.taxRateId);
      if (rate) tax = { taxRateId: rate.id, taxName: rate.name, taxMilliPercent: rate.milliPercent };
      else if (kept) tax = { taxRateId: line.taxRateId, taxName: kept.name, taxMilliPercent: kept.milliPercent };
      else errors[at("taxRateId")] = "is not an active tax rate";
    }
    if (line.productId && !knownProducts.has(line.productId)) errors[at("productId")] = "is not an active product";

    lines.push({
      productId: line.productId,
      description: line.description,
      quantityMilli: quantityMilli ?? 1n,
      unit: line.unit,
      unitPriceMinor: unitPriceMinor ?? 0n,
      discountKind: line.discountKind,
      discountValue,
      tax,
    });
  });

  let totals: ReturnType<typeof calculateDocument> | null = null;
  if (Object.keys(errors).length === 0) {
    const calcLines: CalcLine[] = lines.map((line) => ({
      quantityMilli: line.quantityMilli,
      unitPriceMinor: line.unitPriceMinor,
      discount: (line.discountKind === "none"
        ? { kind: "none" }
        : line.discountKind === "percent"
          ? { kind: "percent", milliPercent: line.discountValue }
          : { kind: "fixed", amountMinor: line.discountValue }) satisfies Discount,
      tax: line.tax ? { key: line.tax.taxRateId, name: line.tax.taxName, milliPercent: BigInt(line.tax.taxMilliPercent) } : null,
    }));
    try {
      totals = calculateDocument(calcLines, values.taxMode);
    } catch (error) {
      if (!(error instanceof CalculationError)) throw error;
      const match = /^Line (\d+): (.*)$/.exec(error.message);
      if (match && /discount/.test(match[2])) errors[`lines.${match[1]}.discount`] = match[2].replace(/^discount /, "");
      else errors.lines = error.message;
    }
  }
  if (Object.keys(errors).length || !customer || !totals) throw new InputValidationError(errors);

  return {
    quote: {
      customerId: customer.id,
      leadId: values.leadId,
      currency: values.currency,
      taxMode: values.taxMode,
      issuedOn: values.issuedOn,
      expiresOn: values.expiresOn,
      recipientName: contact?.name ?? customer.displayName,
      recipientEmail: contact?.email ?? customer.email,
      customerSnapshot: snapshotOf(customer),
      notes: values.notes,
      terms: values.terms,
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      taxLines: totals.taxes.map((t) => ({
        taxRateId: t.key, name: t.name, milliPercent: Number(t.milliPercent),
        baseMinor: t.baseMinor.toString(), taxMinor: t.taxMinor.toString(),
      })),
    },
    items: lines.map((line, index) => ({
      position: index + 1,
      productId: line.productId,
      description: line.description,
      quantityMilli: line.quantityMilli,
      unit: line.unit,
      unitPriceMinor: line.unitPriceMinor,
      discountKind: line.discountKind,
      discountValue: line.discountValue,
      taxRateId: line.tax?.taxRateId ?? null,
      taxName: line.tax?.taxName ?? null,
      taxMilliPercent: line.tax?.taxMilliPercent ?? null,
      grossMinor: totals.lines[index].grossMinor,
      discountMinor: totals.lines[index].discountMinor,
      netMinor: totals.lines[index].netMinor,
    })),
  };
}

function parse(input: unknown): QuoteInput {
  const result = quoteInputSchema.safeParse(input);
  if (!result.success) throw new InputValidationError(fieldErrors(result.error as z.ZodError));
  return result.data;
}

export async function createQuote(data: TenantData, actor: Actor, input: unknown) {
  const values = parse(input);
  return data.transaction(actor.organizationId, async (tenant) => {
    const resolved = await resolve(tenant, values);
    const number = await allocateNumber(tenant);
    const quote = await tenant.quote.create({ data: { ...resolved.quote, number, createdById: actor.userId } });
    await tenant.quoteItem.createMany({ data: resolved.items.map((item) => ({ ...item, quoteId: quote.id })) });
    await recordAudit(tenant, {
      action: "quote.created",
      actorUserId: actor.userId,
      targetType: "quote",
      targetId: quote.id,
      metadata: { number, customerId: quote.customerId, leadId: quote.leadId, currency: quote.currency },
    });
    return quote;
  });
}

/** Saves a draft edited from `expectedVersion`, replacing its lines. */
export async function updateDraft(data: TenantData, actor: Actor, id: string, expectedVersion: number, input: unknown) {
  const values = parse(input);
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.quote.findUnique({ where: { id }, include: { items: true } });
    if (!current) throw new RecordNotFoundError("Quote");
    if (current.status !== "draft") throw new RecordConflictError("This quote was sent, so it");
    if (current.version !== expectedVersion) throw new RecordConflictError("This quote");
    // A revision stays with its customer: it replaces an offer made to them.
    if (current.revision > 1 && values.customerId !== current.customerId) {
      throw new InputValidationError({ customerId: "cannot change on a revision" });
    }
    const resolved = await resolve(tenant, values, current.items);
    const { count } = await tenant.quote.updateMany({
      where: { id, version: expectedVersion, status: "draft" },
      data: { ...resolved.quote, version: { increment: 1 } },
    });
    if (count !== 1) throw new RecordConflictError("This quote");
    await tenant.quoteItem.deleteMany({ where: { quoteId: id } });
    await tenant.quoteItem.createMany({ data: resolved.items.map((item) => ({ ...item, quoteId: id })) });
    await recordAudit(tenant, { action: "quote.updated", actorUserId: actor.userId, targetType: "quote", targetId: id });
    return tenant.quote.findUniqueOrThrow({ where: { id } });
  });
}

export async function deleteDraft(data: TenantData, actor: Actor, id: string) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.quote.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Quote");
    if (current.status !== "draft") throw new RecordConflictError("This quote was sent, so it");
    await tenant.quote.delete({ where: { id } });
    await recordAudit(tenant, {
      action: "quote.deleted",
      actorUserId: actor.userId,
      targetType: "quote",
      targetId: id,
      metadata: { number: current.number, revision: current.revision },
    });
    return { previousId: current.previousId };
  });
}

/**
 * Sends a draft: refreshes and fixes the customer snapshot, and supersedes
 * the revision it replaces. Delivery (link and email) is added by the public
 * quote slice; this records the state change.
 */
export async function sendQuote(data: TenantData, actor: Actor, id: string, expectedVersion: number, { today }: Today) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.quote.findUnique({ where: { id }, include: { customer: true, _count: { select: { items: true } } } });
    if (!current) throw new RecordNotFoundError("Quote");
    if (current.status !== "draft") throw new RecordConflictError("This quote was already sent, so it");
    if (current.version !== expectedVersion) throw new RecordConflictError("This quote");
    const errors: Record<string, string> = {};
    if (current._count.items === 0) errors.lines = "needs at least one line";
    if (current.expiresOn < dateValue(today)) errors.expiresOn = "has passed; choose a later date";
    if (current.customer.archivedAt) errors.customerId = "is archived";
    if (Object.keys(errors).length) throw new InputValidationError(errors);

    if (current.previousId) {
      const previous = await tenant.quote.findUnique({ where: { id: current.previousId } });
      if (previous?.status === "accepted") throw new RecordConflictError("The previous revision was accepted, so this one");
      if (previous?.status === "sent") {
        await tenant.quote.updateMany({ where: { id: previous.id, status: "sent" }, data: { status: "superseded", version: { increment: 1 } } });
      }
    }
    const { count } = await tenant.quote.updateMany({
      where: { id, version: expectedVersion, status: "draft" },
      data: { status: "sent", sentAt: new Date(), customerSnapshot: snapshotOf(current.customer), version: { increment: 1 } },
    });
    if (count !== 1) throw new RecordConflictError("This quote");
    await recordAudit(tenant, {
      action: "quote.sent",
      actorUserId: actor.userId,
      targetType: "quote",
      targetId: id,
      metadata: { number: current.number, revision: current.revision, supersedes: current.previousId },
    });
    return tenant.quote.findUniqueOrThrow({ where: { id } });
  });
}

/** Copies a quote's content and lines into a new draft. */
interface CopyTarget {
  number: string;
  revision?: number;
  previousId?: string;
  issuedOn: Date;
  expiresOn: Date;
  createdById: string;
}

async function copyInto(tenant: TenantDb, source: Quote & { items: Prisma.QuoteItemGetPayload<object>[] }, target: CopyTarget) {
  const quote = await tenant.quote.create({
    data: {
      customerId: source.customerId,
      leadId: source.leadId,
      currency: source.currency,
      taxMode: source.taxMode,
      recipientName: source.recipientName,
      recipientEmail: source.recipientEmail,
      customerSnapshot: source.customerSnapshot as Prisma.InputJsonValue,
      notes: source.notes,
      terms: source.terms,
      subtotalMinor: source.subtotalMinor,
      discountMinor: source.discountMinor,
      taxMinor: source.taxMinor,
      totalMinor: source.totalMinor,
      taxLines: source.taxLines as Prisma.InputJsonValue,
      ...target,
    },
  });
  await tenant.quoteItem.createMany({
    data: source.items.map((item) => ({
      quoteId: quote.id,
      position: item.position,
      productId: item.productId,
      description: item.description,
      quantityMilli: item.quantityMilli,
      unit: item.unit,
      unitPriceMinor: item.unitPriceMinor,
      discountKind: item.discountKind,
      discountValue: item.discountValue,
      taxRateId: item.taxRateId,
      taxName: item.taxName,
      taxMilliPercent: item.taxMilliPercent,
      grossMinor: item.grossMinor,
      discountMinor: item.discountMinor,
      netMinor: item.netMinor,
    })),
  });
  return quote;
}

/**
 * Starts the next revision of a sent or rejected quote as a draft. An
 * accepted quote is final; a quote has at most one draft revision at a time.
 */
export async function reviseQuote(data: TenantData, actor: Actor, id: string, { today }: Today) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const source = await tenant.quote.findUnique({ where: { id }, include: { items: { orderBy: { position: "asc" } } } });
    if (!source) throw new RecordNotFoundError("Quote");
    const latest = await tenant.quote.findFirst({ where: { number: source.number }, orderBy: { revision: "desc" } });
    if (latest!.id !== source.id) {
      throw new RecordConflictError(latest!.status === "draft" ? "A newer draft revision exists, so this quote" : "A newer revision exists, so this quote");
    }
    if (source.status === "draft") throw new RecordConflictError("This quote is still a draft, so it");
    if (source.status === "accepted") throw new RecordConflictError("This quote was accepted, so it");
    const validity = Math.max(0, Math.round((source.expiresOn.getTime() - source.issuedOn.getTime()) / 86_400_000));
    const issuedOn = dateValue(today);
    const quote = await copyInto(tenant, source, {
      number: source.number,
      revision: source.revision + 1,
      previousId: source.id,
      issuedOn,
      expiresOn: new Date(issuedOn.getTime() + validity * 86_400_000),
      createdById: actor.userId,
    });
    await recordAudit(tenant, {
      action: "quote.revised",
      actorUserId: actor.userId,
      targetType: "quote",
      targetId: quote.id,
      metadata: { number: quote.number, revision: quote.revision, previousId: source.id },
    });
    return quote;
  });
}

/** A new quote (new number, draft, dated today) with the same content. */
export async function duplicateQuote(data: TenantData, actor: Actor, id: string, { today }: Today) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const source = await tenant.quote.findUnique({ where: { id }, include: { items: { orderBy: { position: "asc" } } } });
    if (!source) throw new RecordNotFoundError("Quote");
    const number = await allocateNumber(tenant);
    const validity = Math.max(0, Math.round((source.expiresOn.getTime() - source.issuedOn.getTime()) / 86_400_000));
    const issuedOn = dateValue(today);
    const quote = await copyInto(tenant, source, {
      number,
      issuedOn,
      expiresOn: new Date(issuedOn.getTime() + validity * 86_400_000),
      createdById: actor.userId,
    });
    await recordAudit(tenant, {
      action: "quote.duplicated",
      actorUserId: actor.userId,
      targetType: "quote",
      targetId: quote.id,
      metadata: { number, sourceId: source.id },
    });
    return quote;
  });
}
