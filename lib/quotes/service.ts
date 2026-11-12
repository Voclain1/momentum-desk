import type { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { dateValue } from "@/lib/dates";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import type { Prisma, Quote } from "@/lib/generated/prisma/client";
import type { TenantData, TenantDb } from "@/lib/tenant/core";
import { fieldErrors } from "@/lib/validation/fields";
import { resolveDocument, snapshotOf } from "@/lib/documents/resolve";
import { allocateNumber as allocate, documentNumbering, updateDocumentNumbering } from "@/lib/documents/numbering";
import { quoteInputSchema, type QuoteInput } from "./schema";

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
// Numbering (lib/documents/numbering.ts)
// ---------------------------------------------------------------------------

export const quoteNumbering = (data: TenantData, organizationId: string) => documentNumbering(data, organizationId, "quote");
export const updateQuoteNumbering = (data: TenantData, actor: Actor, input: unknown) => updateDocumentNumbering(data, actor, "quote", input);
const allocateNumber = (tenant: TenantDb) =>
  allocate(tenant, "quote", async (number) => Boolean(await tenant.quote.findFirst({ where: { number }, select: { id: true } })));

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

function parse(input: unknown): QuoteInput {
  const result = quoteInputSchema.safeParse(input);
  if (!result.success) throw new InputValidationError(fieldErrors(result.error as z.ZodError));
  return result.data;
}

export async function createQuote(data: TenantData, actor: Actor, input: unknown) {
  const values = parse(input);
  return data.transaction(actor.organizationId, async (tenant) => {
    const resolved = await resolveDocument(tenant, values);
    const number = await allocateNumber(tenant);
    const quote = await tenant.quote.create({ data: { ...resolved.quote, issuedOn: values.issuedOn, expiresOn: values.expiresOn, number, createdById: actor.userId } });
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
    const resolved = await resolveDocument(tenant, values, current.items);
    const { count } = await tenant.quote.updateMany({
      where: { id, version: expectedVersion, status: "draft" },
      data: { ...resolved.quote, issuedOn: values.issuedOn, expiresOn: values.expiresOn, version: { increment: 1 } },
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
