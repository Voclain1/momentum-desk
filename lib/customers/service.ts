import type { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { TenantData, TenantDb } from "@/lib/tenant/core";
import { contactInputSchema, type CustomerInput, customerInputSchema, fieldErrors } from "./schema";

/**
 * Customers and contacts (spec §7.3). Services receive TenantData, which only
 * offers workspace-scoped access, so every call is scoped by construction; every write is audited in the same transaction.
 * Callers pass ids from requireTenant(), never from the request, and check
 * customers:read / customers:write first.
 *
 * Audit entries name the fields that changed, not their values: a "person"
 * customer's details are personal data, and the record itself holds them.
 */

export interface Actor {
  organizationId: string;
  userId: string;
}

export const PAGE_SIZE = 25;
export const SORTS = ["name", "recent", "created"] as const;
export type CustomerSort = (typeof SORTS)[number];

export interface CustomerQuery {
  q?: string;
  type?: "organization" | "person";
  archived?: boolean;
  sort?: CustomerSort;
  page?: number;
}

const ORDER: Record<CustomerSort, Prisma.CustomerOrderByWithRelationInput[]> = {
  name: [{ displayName: "asc" }, { id: "asc" }],
  recent: [{ updatedAt: "desc" }, { id: "desc" }],
  created: [{ createdAt: "desc" }, { id: "desc" }],
};

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new InputValidationError(fieldErrors(result.error));
  return result.data;
}

function changedFields(before: Record<string, unknown>, after: CustomerInput): string[] {
  return (Object.keys(after) as (keyof CustomerInput)[]).filter(
    (field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null),
  );
}

export async function listCustomers(data: TenantData, organizationId: string, query: CustomerQuery = {}) {
  const tenant = data.scoped(organizationId);
  const q = query.q?.trim().slice(0, 100);
  const where: Prisma.CustomerWhereInput = {
    archivedAt: query.archived ? { not: null } : null,
    ...(query.type ? { type: query.type } : {}),
    ...(q
      ? {
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            { legalName: { contains: q, mode: "insensitive" } },
            { email: { contains: q.toLowerCase() } },
            { taxId: { contains: q, mode: "insensitive" } },
            { tags: { has: q } },
            { contacts: { some: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q.toLowerCase() } }] } } },
          ],
        }
      : {}),
  };
  const total = await tenant.customer.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(query.page ?? 1) || 1), pageCount);
  const items = await tenant.customer.findMany({
    where,
    orderBy: ORDER[query.sort ?? "name"],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: { contacts: { where: { isPrimary: true }, take: 1 } },
  });
  return { items, total, page, pageCount };
}

export async function getCustomer(data: TenantData, organizationId: string, id: string) {
  const customer = await data.scoped(organizationId).customer.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      createdBy: { select: { name: true } },
      // Leads converted into or linked to this customer (spec §7.2).
      leads: {
        orderBy: { convertedAt: "desc" },
        select: { id: true, contactName: true, companyName: true, convertedAt: true, stage: { select: { name: true } } },
      },
    },
  });
  if (!customer) throw new RecordNotFoundError("Customer");
  return customer;
}

export async function createCustomer(data: TenantData, actor: Actor, input: unknown) {
  const values = parse(customerInputSchema, input);
  return data.transaction(actor.organizationId, async (tenant) => {
    const customer = await tenant.customer.create({ data: { ...values, createdById: actor.userId } });
    await recordAudit(tenant, {
      action: "customer.created",
      actorUserId: actor.userId,
      targetType: "customer",
      targetId: customer.id,
      metadata: { type: customer.type },
    });
    return customer;
  });
}

/** Saves an edit made from version `expectedVersion`; a stale version is a conflict. */
export async function updateCustomer(data: TenantData, actor: Actor, id: string, expectedVersion: number, input: unknown) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new InputValidationError({ version: "is invalid" });
  }
  const values = parse(customerInputSchema, input);
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.customer.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Customer");
    if (current.version !== expectedVersion) throw new RecordConflictError("This customer");
    const fields = changedFields(current, values);
    if (fields.length === 0) return current;

    // Compare-and-set: of two concurrent saves, only one matches the version.
    const { count } = await tenant.customer.updateMany({
      where: { id, version: expectedVersion },
      data: { ...values, version: { increment: 1 } },
    });
    if (count !== 1) throw new RecordConflictError("This customer");
    await recordAudit(tenant, {
      action: "customer.updated",
      actorUserId: actor.userId,
      targetType: "customer",
      targetId: id,
      metadata: { changedFields: fields, version: expectedVersion + 1 },
    });
    return (await tenant.customer.findUnique({ where: { id } }))!;
  });
}

/** Archiving hides a customer from lists and keeps all of its history. */
export async function setCustomerArchived(data: TenantData, actor: Actor, id: string, archived: boolean) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.customer.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Customer");
    if (Boolean(current.archivedAt) === archived) return current;
    const customer = await tenant.customer.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } },
    });
    await recordAudit(tenant, {
      action: archived ? "customer.archived" : "customer.restored",
      actorUserId: actor.userId,
      targetType: "customer",
      targetId: id,
    });
    return customer;
  });
}

async function requireCustomer(tenant: TenantDb, customerId: string) {
  const customer = await tenant.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) throw new RecordNotFoundError("Customer");
}

/** Makes `contactId` the only primary contact, or clears primaries before a new one. */
async function clearPrimary(tenant: TenantDb, customerId: string) {
  await tenant.contact.updateMany({ where: { customerId, isPrimary: true }, data: { isPrimary: false } });
}

export async function addContact(data: TenantData, actor: Actor, customerId: string, input: unknown) {
  const values = parse(contactInputSchema, input);
  return data.transaction(actor.organizationId, async (tenant) => {
    await requireCustomer(tenant, customerId);
    // The first contact is primary unless another already is.
    const hasPrimary = (await tenant.contact.count({ where: { customerId, isPrimary: true } })) > 0;
    if (values.isPrimary) await clearPrimary(tenant, customerId);
    const contact = await tenant.contact.create({
      data: { ...values, customerId, isPrimary: values.isPrimary || !hasPrimary },
    });
    await recordAudit(tenant, {
      action: "contact.added",
      actorUserId: actor.userId,
      targetType: "contact",
      targetId: contact.id,
      metadata: { customerId },
    });
    return contact;
  });
}

export async function updateContact(data: TenantData, actor: Actor, contactId: string, input: unknown) {
  const values = parse(contactInputSchema, input);
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.contact.findUnique({ where: { id: contactId } });
    if (!current) throw new RecordNotFoundError("Contact");
    if (values.isPrimary && !current.isPrimary) await clearPrimary(tenant, current.customerId);
    const contact = await tenant.contact.update({ where: { id: contactId }, data: values });
    await recordAudit(tenant, {
      action: "contact.updated",
      actorUserId: actor.userId,
      targetType: "contact",
      targetId: contactId,
      metadata: { customerId: current.customerId },
    });
    return contact;
  });
}

export async function removeContact(data: TenantData, actor: Actor, contactId: string) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.contact.findUnique({ where: { id: contactId } });
    if (!current) throw new RecordNotFoundError("Contact");
    await tenant.contact.delete({ where: { id: contactId } });
    // Keep a primary contact while any contact remains.
    if (current.isPrimary) {
      const next = await tenant.contact.findFirst({ where: { customerId: current.customerId }, orderBy: { createdAt: "asc" } });
      if (next) await tenant.contact.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await recordAudit(tenant, {
      action: "contact.removed",
      actorUserId: actor.userId,
      targetType: "contact",
      targetId: contactId,
      metadata: { customerId: current.customerId },
    });
  });
}
