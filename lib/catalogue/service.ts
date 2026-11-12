import type { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { TenantData, TenantDb } from "@/lib/tenant/core";
import { fieldErrors, productInputSchema, type ProductInput, taxRateInputSchema } from "./schema";

/**
 * Tax rates and the product/service catalogue (spec §7.4, decisions D13 and
 * D14). Callers check catalogue:read, catalogue:write (products) or
 * settings:write (tax rates). Every write is audited in its transaction, by
 * field name only.
 *
 * Documents copy what they use from here, so nothing in this module can
 * change an existing quote or invoice.
 */

export interface Actor {
  organizationId: string;
  userId: string;
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new InputValidationError(fieldErrors(result.error));
  return result.data;
}

// ---------------------------------------------------------------------------
// Tax rates
// ---------------------------------------------------------------------------

export async function listTaxRates(data: TenantData, organizationId: string, { includeArchived = false } = {}) {
  return data.scoped(organizationId).taxRate.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
  });
}

export async function createTaxRate(data: TenantData, actor: Actor, input: unknown) {
  const { name, rate } = parse(taxRateInputSchema, input);
  return data.transaction(actor.organizationId, async (tenant) => {
    const taxRate = await tenant.taxRate.create({ data: { name, milliPercent: rate } });
    await recordAudit(tenant, {
      action: "tax_rate.created",
      actorUserId: actor.userId,
      targetType: "tax_rate",
      targetId: taxRate.id,
      metadata: { milliPercent: rate },
    });
    return taxRate;
  });
}

/** Renames or re-rates. Existing documents keep the name and rate they copied. */
export async function updateTaxRate(data: TenantData, actor: Actor, id: string, input: unknown) {
  const { name, rate } = parse(taxRateInputSchema, input);
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.taxRate.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Tax rate");
    const changed = [current.name !== name && "name", current.milliPercent !== rate && "rate"].filter(Boolean) as string[];
    if (changed.length === 0) return current;
    const taxRate = await tenant.taxRate.update({ where: { id }, data: { name, milliPercent: rate } });
    await recordAudit(tenant, {
      action: "tax_rate.updated",
      actorUserId: actor.userId,
      targetType: "tax_rate",
      targetId: id,
      metadata: { fields: changed, milliPercent: rate },
    });
    return taxRate;
  });
}

export async function setTaxRateArchived(data: TenantData, actor: Actor, id: string, archived: boolean) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.taxRate.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Tax rate");
    if (Boolean(current.archivedAt) === archived) return current;
    const taxRate = await tenant.taxRate.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await recordAudit(tenant, {
      action: archived ? "tax_rate.archived" : "tax_rate.restored",
      actorUserId: actor.userId,
      targetType: "tax_rate",
      targetId: id,
    });
    return taxRate;
  });
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 25;

export interface ProductQuery {
  q?: string;
  /** Inactive products instead of active ones. */
  inactive?: boolean;
  page?: number;
}

export async function listProducts(data: TenantData, organizationId: string, query: ProductQuery = {}) {
  const tenant = data.scoped(organizationId);
  const q = query.q?.trim().slice(0, 100);
  const where: Prisma.ProductWhereInput = {
    active: !query.inactive,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { sku: { contains: q, mode: "insensitive" } },
            { category: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const total = await tenant.product.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.trunc(query.page ?? 1) || 1), pageCount);
  const items = await tenant.product.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: { prices: { orderBy: { currency: "asc" } }, taxRate: true },
  });
  return { items, total, page, pageCount };
}

export async function getProduct(data: TenantData, organizationId: string, id: string) {
  const product = await data.scoped(organizationId).product.findUnique({
    where: { id },
    include: { prices: { orderBy: { currency: "asc" } }, taxRate: true, createdBy: { select: { name: true } } },
  });
  if (!product) throw new RecordNotFoundError("Product");
  return product;
}

/** The tax rate must be one of this workspace's active rates (or unchanged). */
async function checkTaxRate(tenant: TenantDb, taxRateId: string | null, current?: string | null) {
  if (!taxRateId || taxRateId === current) return;
  const rate = await tenant.taxRate.findUnique({ where: { id: taxRateId } });
  if (!rate || rate.archivedAt) throw new InputValidationError({ taxRateId: "is not an active tax rate" });
}

/** A duplicate SKU is reported on the field, not as a server error. */
async function uniqueSku<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new InputValidationError({ sku: "is already used by another product" });
    throw error;
  }
}

export async function createProduct(data: TenantData, actor: Actor, input: unknown) {
  const { prices, ...values } = parse(productInputSchema, input);
  return uniqueSku(() =>
    data.transaction(actor.organizationId, async (tenant) => {
      await checkTaxRate(tenant, values.taxRateId);
      const product = await tenant.product.create({ data: { ...values, createdById: actor.userId } });
      if (prices.length) {
        await tenant.productPrice.createMany({ data: prices.map((price) => ({ ...price, productId: product.id })) });
      }
      await recordAudit(tenant, {
        action: "product.created",
        actorUserId: actor.userId,
        targetType: "product",
        targetId: product.id,
        metadata: { currencies: prices.map((price) => price.currency) },
      });
      return product;
    }),
  );
}

const COMPARED = ["name", "description", "sku", "unit", "category", "taxRateId"] as const;

/** Saves an edit made from `expectedVersion`, replacing the price list. */
export async function updateProduct(data: TenantData, actor: Actor, id: string, expectedVersion: number, input: unknown) {
  const { prices, ...values } = parse(productInputSchema, input);
  return uniqueSku(() =>
    data.transaction(actor.organizationId, async (tenant) => {
      const current = await tenant.product.findUnique({ where: { id }, include: { prices: true } });
      if (!current) throw new RecordNotFoundError("Product");
      if (current.version !== expectedVersion) throw new RecordConflictError("This product");
      await checkTaxRate(tenant, values.taxRateId, current.taxRateId);

      const changed: string[] = COMPARED.filter((field) => current[field] !== values[field]);
      const before = new Map(current.prices.map((price) => [price.currency, price.unitPriceMinor]));
      const after = new Map(prices.map((price) => [price.currency, price.unitPriceMinor]));
      const pricesChanged = before.size !== after.size || [...after].some(([currency, amount]) => before.get(currency) !== amount);
      if (pricesChanged) changed.push("prices");
      if (changed.length === 0) return current;

      const { count } = await tenant.product.updateMany({
        where: { id, version: expectedVersion },
        data: { ...values, version: { increment: 1 } },
      });
      if (count !== 1) throw new RecordConflictError("This product");
      if (pricesChanged) {
        await tenant.productPrice.deleteMany({ where: { productId: id, currency: { notIn: [...after.keys()] } } });
        for (const price of prices) {
          if (before.get(price.currency) === price.unitPriceMinor) continue;
          if (before.has(price.currency)) {
            await tenant.productPrice.updateMany({
              where: { productId: id, currency: price.currency },
              data: { unitPriceMinor: price.unitPriceMinor },
            });
          } else {
            await tenant.productPrice.create({ data: { ...price, productId: id } });
          }
        }
      }
      await recordAudit(tenant, {
        action: "product.updated",
        actorUserId: actor.userId,
        targetType: "product",
        targetId: id,
        metadata: { fields: changed, currencies: [...after.keys()] },
      });
      return tenant.product.findUniqueOrThrow({ where: { id } });
    }),
  );
}

/** Inactive products stay on existing documents but are not offered for new lines. */
export async function setProductActive(data: TenantData, actor: Actor, id: string, active: boolean) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const current = await tenant.product.findUnique({ where: { id } });
    if (!current) throw new RecordNotFoundError("Product");
    if (current.active === active) return current;
    const product = await tenant.product.update({ where: { id }, data: { active, version: { increment: 1 } } });
    await recordAudit(tenant, {
      action: active ? "product.reactivated" : "product.deactivated",
      actorUserId: actor.userId,
      targetType: "product",
      targetId: id,
    });
    return product;
  });
}

export type { ProductInput };
