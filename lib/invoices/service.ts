import type { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { addDays, dateValue } from "@/lib/dates";
import { allocateNumber, documentNumbering, updateDocumentNumbering } from "@/lib/documents/numbering";
import { resolveDocument, snapshotOf } from "@/lib/documents/resolve";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import type { Invoice, Prisma } from "@/lib/generated/prisma/client";
import type { TenantData } from "@/lib/tenant/core";
import { fieldErrors } from "@/lib/validation/fields";
import { convertedDraftSchema, invoiceInputSchema, reasonSchema } from "./schema";

/**
 * Invoices (spec §7.6, decisions D30–D33). Drafts change freely and have no
 * number; issuing assigns the next number in the same transaction and fixes
 * the content (invoice_guard trigger). What is paid is kept by the database
 * from payment allocations (lib/payments); the status people see is derived.
 *
 * Callers check invoices:read / invoices:write, invoices:void to void, and
 * settings:write for numbering.
 */

export interface Actor {
  organizationId: string;
  userId: string;
}

export type InvoiceStatus = "draft" | "issued" | "viewed" | "partially_paid" | "paid" | "overdue" | "disputed" | "void";

/** The status people see, derived from the facts (D32); `today` is in the workspace's timezone. */
export function invoiceStatus(
  invoice: Pick<Invoice, "status" | "totalMinor" | "paidMinor" | "dueOn" | "viewedAt" | "disputedAt">,
  today: string,
): InvoiceStatus {
  if (invoice.status === "void") return "void";
  if (invoice.status === "draft") return "draft";
  if (invoice.paidMinor >= invoice.totalMinor) return "paid";
  if (invoice.disputedAt) return "disputed";
  if (invoice.dueOn < dateValue(today)) return "overdue";
  if (invoice.paidMinor > 0n) return "partially_paid";
  return invoice.viewedAt ? "viewed" : "issued";
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

export const invoiceNumbering = (data: TenantData, organizationId: string) => documentNumbering(data, organizationId, "invoice");
export const updateInvoiceNumbering = (data: TenantData, actor: Actor, input: unknown) =>
  updateDocumentNumbering(data, actor, "invoice", input);

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 25;
export const INVOICE_FILTERS = ["open", "draft", "unpaid", "overdue", "paid", "void", "all"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];

export interface InvoiceQuery {
  q?: string;
  status?: InvoiceFilter;
  customerId?: string;
  page?: number;
}

function filterWhere(filter: InvoiceFilter, today: string): Prisma.InvoiceWhereInput {
  switch (filter) {
    case "open":
      return { OR: [{ status: "draft" }, { status: "issued", outstandingMinor: { gt: 0 } }] };
    case "draft":
      return { status: "draft" };
    case "unpaid":
      return { status: "issued", outstandingMinor: { gt: 0 } };
    case "overdue":
      return { status: "issued", outstandingMinor: { gt: 0 }, dueOn: { lt: dateValue(today) } };
    case "paid":
      return { status: "issued", outstandingMinor: 0 };
    case "void":
      return { status: "void" };
    case "all":
      return {};
  }
}

export async function listInvoices(data: TenantData, organizationId: string, query: InvoiceQuery, today: string) {
  const tenant = data.scoped(organizationId);
  const q = query.q?.trim().slice(0, 100);
  const where: Prisma.InvoiceWhereInput = {
    AND: [
      filterWhere(query.status ?? "open", today),
      query.customerId ? { customerId: query.customerId } : {},
      q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { customer: { displayName: { contains: q, mode: "insensitive" } } },
              { recipientName: { contains: q, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };
  const total = await tenant.invoice.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(query.page ?? 1) || 1), pageCount);
  const items = await tenant.invoice.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: { customer: { select: { id: true, displayName: true } } },
  });
  return { items, total, page, pageCount };
}

export async function getInvoice(data: TenantData, organizationId: string, id: string) {
  const invoice = await data.scoped(organizationId).invoice.findUnique({
    where: { id },
    include: {
      items: { orderBy: { position: "asc" } },
      customer: { include: { contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] } } },
      lead: { select: { id: true, contactName: true, companyName: true } },
      quote: { select: { id: true, number: true, revision: true } },
      createdBy: { select: { name: true } },
      voidedBy: { select: { name: true } },
      allocations: {
        orderBy: { createdAt: "asc" },
        include: { payment: { include: { recordedBy: { select: { name: true } }, voidedBy: { select: { name: true } } } } },
      },
    },
  });
  if (!invoice) throw new RecordNotFoundError("Invoice");
  return invoice;
}

/** The invoice made from a quote, if any (D33). */
export async function invoiceForQuote(data: TenantData, organizationId: string, quoteId: string) {
  return data.scoped(organizationId).invoice.findFirst({ where: { quoteId }, select: { id: true, number: true, status: true } });
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new InputValidationError(fieldErrors(result.error as z.ZodError));
  return result.data;
}

export async function createInvoice(data: TenantData, actor: Actor, input: unknown) {
  const values = parse(invoiceInputSchema, input);
  return data.transaction(actor.organizationId, async (tenant) => {
    const resolved = await resolveDocument(tenant, values);
    const invoice = await tenant.invoice.create({
      data: { ...resolved.quote, issuedOn: values.issuedOn, dueOn: values.dueOn, createdById: actor.userId },
    });
    await tenant.invoiceItem.createMany({ data: resolved.items.map((item) => ({ ...item, invoiceId: invoice.id })) });
    await recordAudit(tenant, {
      action: "invoice.created",
      actorUserId: actor.userId,
      targetType: "invoice",
      targetId: invoice.id,
      metadata: { customerId: invoice.customerId, currency: invoice.currency, quoteId: null },
    });
    return invoice;
  });
}

/**
 * A draft invoice from an accepted quote: lines, totals and terms copied
 * verbatim, never recalculated (D33). At most one per quote.
 */
export async function createInvoiceFromQuote(data: TenantData, actor: Actor, quoteId: string, { today, dueInDays = 14 }: { today: string; dueInDays?: number }) {
  try {
    return await data.transaction(actor.organizationId, async (tenant) => {
      const quote = await tenant.quote.findUnique({ where: { id: quoteId }, include: { items: { orderBy: { position: "asc" } } } });
      if (!quote) throw new RecordNotFoundError("Quote");
      if (quote.status !== "accepted") throw new RecordConflictError("Only an accepted quote can be invoiced, so this quote");
      const existing = await tenant.invoice.findFirst({ where: { quoteId } });
      if (existing) throw new RecordConflictError("This quote was already invoiced, so it");
      const invoice = await tenant.invoice.create({
        data: {
          customerId: quote.customerId,
          leadId: quote.leadId,
          quoteId: quote.id,
          currency: quote.currency,
          taxMode: quote.taxMode,
          issuedOn: dateValue(today),
          dueOn: dateValue(addDays(today, dueInDays)),
          recipientName: quote.recipientName,
          recipientEmail: quote.recipientEmail,
          customerSnapshot: quote.customerSnapshot as Prisma.InputJsonValue,
          notes: quote.notes,
          terms: quote.terms,
          subtotalMinor: quote.subtotalMinor,
          discountMinor: quote.discountMinor,
          taxMinor: quote.taxMinor,
          totalMinor: quote.totalMinor,
          taxLines: quote.taxLines as Prisma.InputJsonValue,
          createdById: actor.userId,
        },
      });
      await tenant.invoiceItem.createMany({
        data: quote.items.map((item) => ({
          invoiceId: invoice.id,
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
      await recordAudit(tenant, {
        action: "invoice.created",
        actorUserId: actor.userId,
        targetType: "invoice",
        targetId: invoice.id,
        metadata: { customerId: invoice.customerId, currency: invoice.currency, quoteId: quote.id },
      });
      return invoice;
    });
  } catch (error) {
    // Two people converting at once: the unique key lets only one through.
    if ((error as { code?: string }).code === "P2002") throw new RecordConflictError("This quote was already invoiced, so it");
    throw error;
  }
}

/** Saves a draft edited from `expectedVersion`. A draft from a quote keeps its lines and amounts. */
export async function updateDraft(data: TenantData, actor: Actor, id: string, expectedVersion: number, input: unknown) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.invoice.findUnique({ where: { id }, include: { items: true, customer: { include: { contacts: true } } } });
    if (!current) throw new RecordNotFoundError("Invoice");
    if (current.status !== "draft") throw new RecordConflictError("This invoice was issued, so it");
    if (current.version !== expectedVersion) throw new RecordConflictError("This invoice");

    let changes: Prisma.InvoiceUncheckedUpdateInput;
    let items: Omit<Prisma.InvoiceItemUncheckedCreateInput, "organizationId">[] | null = null;
    if (current.quoteId) {
      const values = parse(convertedDraftSchema, input);
      const contact = values.recipientContactId ? current.customer.contacts.find((c) => c.id === values.recipientContactId) : undefined;
      if (values.recipientContactId && !contact) throw new InputValidationError({ recipientContactId: "is not a contact of this customer" });
      changes = {
        issuedOn: values.issuedOn,
        dueOn: values.dueOn,
        notes: values.notes,
        terms: values.terms,
        recipientName: contact?.name ?? current.customer.displayName,
        recipientEmail: contact?.email ?? current.customer.email,
      };
    } else {
      const values = parse(invoiceInputSchema, input);
      const resolved = await resolveDocument(tenant, values, current.items);
      changes = { ...resolved.quote, issuedOn: values.issuedOn, dueOn: values.dueOn };
      items = resolved.items.map((item) => ({ ...item, invoiceId: id }));
    }
    const { count } = await tenant.invoice.updateMany({
      where: { id, version: expectedVersion, status: "draft" },
      data: { ...changes, version: { increment: 1 } } as Prisma.InvoiceUpdateManyMutationInput,
    });
    if (count !== 1) throw new RecordConflictError("This invoice");
    if (items) {
      await tenant.invoiceItem.deleteMany({ where: { invoiceId: id } });
      await tenant.invoiceItem.createMany({ data: items });
    }
    await recordAudit(tenant, { action: "invoice.updated", actorUserId: actor.userId, targetType: "invoice", targetId: id });
    return tenant.invoice.findUniqueOrThrow({ where: { id } });
  });
}

export async function deleteDraft(data: TenantData, actor: Actor, id: string) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.invoice.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Invoice");
    if (current.status !== "draft") throw new RecordConflictError("This invoice was issued, so it");
    await tenant.invoice.delete({ where: { id } });
    await recordAudit(tenant, {
      action: "invoice.deleted",
      actorUserId: actor.userId,
      targetType: "invoice",
      targetId: id,
      metadata: { quoteId: current.quoteId },
    });
  });
}

// ---------------------------------------------------------------------------
// Issuing, voiding and disputes
// ---------------------------------------------------------------------------

/**
 * Issues a draft: the next number (D30), the customer's billing details and
 * the payment instructions as they are now, and the content fixed for good.
 */
export async function issueInvoice(
  data: TenantData,
  actor: Actor,
  id: string,
  expectedVersion: number,
  { paymentInstructions = null }: { paymentInstructions?: string | null } = {},
) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.invoice.findUnique({ where: { id }, include: { customer: true, _count: { select: { items: true } } } });
    if (!current) throw new RecordNotFoundError("Invoice");
    if (current.status !== "draft") throw new RecordConflictError("This invoice was already issued, so it");
    if (current.version !== expectedVersion) throw new RecordConflictError("This invoice");
    const errors: Record<string, string> = {};
    if (current._count.items === 0) errors.lines = "needs at least one line";
    if (current.customer.archivedAt) errors.customerId = "is archived";
    if (Object.keys(errors).length) throw new InputValidationError(errors);

    const number = await allocateNumber(tenant, "invoice", async (candidate) =>
      Boolean(await tenant.invoice.findFirst({ where: { number: candidate }, select: { id: true } })),
    );
    const { count } = await tenant.invoice.updateMany({
      where: { id, version: expectedVersion, status: "draft" },
      data: {
        status: "issued",
        number,
        issuedAt: new Date(),
        customerSnapshot: snapshotOf(current.customer),
        paymentInstructions,
        version: { increment: 1 },
      },
    });
    if (count !== 1) throw new RecordConflictError("This invoice");
    await recordAudit(tenant, {
      action: "invoice.issued",
      actorUserId: actor.userId,
      targetType: "invoice",
      targetId: id,
      metadata: { number, currency: current.currency },
    });
    return tenant.invoice.findUniqueOrThrow({ where: { id } });
  });
}

/** Voids an issued invoice with a reason (D31). Payments must be voided first. */
export async function voidInvoice(data: TenantData, actor: Actor, id: string, reason: unknown) {
  const why = reasonSchema.safeParse(reason);
  if (!why.success) throw new InputValidationError({ reason: why.error.issues[0].message });
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.invoice.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Invoice");
    if (current.status !== "issued") {
      throw new RecordConflictError(current.status === "void" ? "This invoice is already void, so it" : "A draft is deleted, not voided, so this invoice");
    }
    if (current.paidMinor > 0n) throw new RecordConflictError("This invoice has payments; void them first, so it");
    const { count } = await tenant.invoice.updateMany({
      where: { id, status: "issued", paidMinor: 0 },
      data: { status: "void", voidedAt: new Date(), voidReason: why.data, voidedById: actor.userId, version: { increment: 1 } },
    });
    if (count !== 1) throw new RecordConflictError("This invoice");
    await recordAudit(tenant, {
      action: "invoice.voided",
      actorUserId: actor.userId,
      targetType: "invoice",
      targetId: id,
      metadata: { number: current.number },
    });
    return tenant.invoice.findUniqueOrThrow({ where: { id } });
  });
}

/** Marks an issued invoice disputed (with a reason) or clears the dispute (reason null). */
export async function setDisputed(data: TenantData, actor: Actor, id: string, reason: unknown | null) {
  let why: string | null = null;
  if (reason !== null) {
    const parsed = reasonSchema.safeParse(reason);
    if (!parsed.success) throw new InputValidationError({ reason: parsed.error.issues[0].message });
    why = parsed.data;
  }
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.invoice.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Invoice");
    if (current.status !== "issued") throw new RecordConflictError("Only an issued invoice can be disputed, so this one");
    await tenant.invoice.updateMany({
      where: { id, status: "issued" },
      data: { disputedAt: why ? new Date() : null, disputeReason: why, version: { increment: 1 } },
    });
    await recordAudit(tenant, {
      action: why ? "invoice.disputed" : "invoice.dispute_resolved",
      actorUserId: actor.userId,
      targetType: "invoice",
      targetId: id,
      metadata: { number: current.number },
    });
    return tenant.invoice.findUniqueOrThrow({ where: { id } });
  });
}

