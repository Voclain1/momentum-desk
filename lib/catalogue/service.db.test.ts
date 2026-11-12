import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { createTenantData } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import {
  createProduct,
  createTaxRate,
  getProduct,
  listProducts,
  listTaxRates,
  setProductActive,
  setTaxRateArchived,
  updateProduct,
  updateTaxRate,
} from "./service";

/** As the restricted app role, like the application. */
const db = createTestDb();
const data = createTenantData(db);

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

async function workspace(name = "acme") {
  const organizationId = randomUUID();
  await db.organization.create({
    data: {
      id: organizationId, name, slug: `${name}-${organizationId.slice(0, 8)}`,
      baseCurrency: "NGN", countryCode: "NG", locale: "en-NG", timezone: "Africa/Lagos", defaultLanguage: "en",
    },
  });
  const userId = randomUUID();
  await db.user.create({ data: { id: userId, name: "Ada", email: `${userId}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId, userId, role: "owner" } });
  return { organizationId, userId };
}

const fields = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof InputValidationError) return error.fields;
    throw error;
  }
  throw new Error("expected a validation error");
};

const audits = (organizationId: string) =>
  data.scoped(organizationId).auditLog.findMany({ orderBy: { createdAt: "asc" }, select: { action: true, metadata: true } });

describe("tax rates", () => {
  it("stores rates exactly, edits and archives them, with an audit trail", async () => {
    const actor = await workspace();
    const vat = await createTaxRate(data, actor, { name: "VAT", rate: "7.5" });
    expect(vat.milliPercent).toBe(7500);
    await createTaxRate(data, actor, { name: "Sales tax", rate: "8.875%" });
    expect(await fields(createTaxRate(data, actor, { name: "Odd", rate: "8.8755" }))).toEqual({
      rate: "must be a percentage from 0 to 100, with up to 3 decimals",
    });
    expect(await fields(createTaxRate(data, actor, { name: "", rate: "101" }))).toEqual({
      name: "is required",
      rate: "must be a percentage from 0 to 100, with up to 3 decimals",
    });

    await updateTaxRate(data, actor, vat.id, { name: "VAT", rate: "10" });
    await setTaxRateArchived(data, actor, vat.id, true);
    expect((await listTaxRates(data, actor.organizationId)).map((r) => [r.name, r.milliPercent])).toEqual([["Sales tax", 8875]]);
    expect(await listTaxRates(data, actor.organizationId, { includeArchived: true })).toHaveLength(2);
    expect((await audits(actor.organizationId)).map((a) => a.action)).toEqual([
      "tax_rate.created", "tax_rate.created", "tax_rate.updated", "tax_rate.archived",
    ]);
  });

  it("refuses a rate outside 0–100% in the database too", async () => {
    const { organizationId } = await workspace();
    await expect(data.scoped(organizationId).taxRate.create({ data: { name: "Bad", milliPercent: 100001 } })).rejects.toThrow();
  });
});

describe("products", () => {
  it("keeps one exact price per currency and finds products by name, SKU or category", async () => {
    const actor = await workspace();
    const vat = await createTaxRate(data, actor, { name: "VAT", rate: "7.5" });
    const panel = await createProduct(data, actor, {
      name: "Solar panel 400W", sku: "SP-400", unit: "unit", category: "Hardware", taxRateId: vat.id,
      prices: [
        { currency: "NGN", unitPrice: "185,000" },
        { currency: "USD", unitPrice: "120.50" },
        { currency: "KWD", unitPrice: "37.125" },
        { currency: "JPY", unitPrice: "18000" },
      ],
    });
    const product = await getProduct(data, actor.organizationId, panel.id);
    expect(product.prices.map((p) => [p.currency, p.unitPriceMinor])).toEqual([
      ["JPY", 18000n], ["KWD", 37125n], ["NGN", 18500000n], ["USD", 12050n],
    ]);
    expect(product.taxRate?.name).toBe("VAT");

    await createProduct(data, actor, { name: "Installation", unit: "hour", category: "Services" });
    for (const q of ["solar", "sp-4", "hardware"]) {
      expect((await listProducts(data, actor.organizationId, { q })).items.map((p) => p.name)).toEqual(["Solar panel 400W"]);
    }
  });

  it("explains invalid prices, duplicate currencies and a duplicate SKU", async () => {
    const actor = await workspace();
    expect(
      await fields(createProduct(data, actor, { name: "X", prices: [{ currency: "JPY", unitPrice: "10.5" }] })),
    ).toEqual({ prices: "has too many decimal places for JPY" });
    expect(
      await fields(createProduct(data, actor, { name: "X", prices: [{ currency: "USD", unitPrice: "1" }, { currency: "USD", unitPrice: "2" }] })),
    ).toEqual({ prices: "has USD twice" });
    expect(await fields(createProduct(data, actor, { name: "X", prices: [{ currency: "XXX", unitPrice: "1" }] }))).toEqual({
      prices: "must be a supported ISO 4217 currency code",
    });

    await createProduct(data, actor, { name: "A", sku: "SKU-1" });
    expect(await fields(createProduct(data, actor, { name: "B", sku: "SKU-1" }))).toEqual({ sku: "is already used by another product" });
    // Another workspace may use the same SKU.
    const other = await workspace("other");
    await expect(createProduct(data, other, { name: "C", sku: "SKU-1" })).resolves.toMatchObject({ sku: "SKU-1" });
  });

  it("replaces prices on edit, checks the version and audits by field name", async () => {
    const actor = await workspace();
    const product = await createProduct(data, actor, {
      name: "Consulting", prices: [{ currency: "USD", unitPrice: "100" }, { currency: "GBP", unitPrice: "80" }],
    });
    await updateProduct(data, actor, product.id, 1, {
      name: "Consulting", prices: [{ currency: "USD", unitPrice: "110" }, { currency: "EUR", unitPrice: "95" }],
    });
    const updated = await getProduct(data, actor.organizationId, product.id);
    expect(updated.version).toBe(2);
    expect(updated.prices.map((p) => [p.currency, p.unitPriceMinor])).toEqual([["EUR", 9500n], ["USD", 11000n]]);
    await expect(updateProduct(data, actor, product.id, 1, { name: "Stale" })).rejects.toThrow(RecordConflictError);

    await setProductActive(data, actor, product.id, false);
    expect((await listProducts(data, actor.organizationId)).items).toEqual([]);
    expect((await listProducts(data, actor.organizationId, { inactive: true })).items).toHaveLength(1);
    expect((await audits(actor.organizationId)).map((a) => [a.action, a.metadata])).toEqual([
      ["product.created", { currencies: ["USD", "GBP"] }],
      ["product.updated", { fields: ["prices"], currencies: ["USD", "EUR"] }],
      ["product.deactivated", {}],
    ]);
  });

  it("never uses another workspace's tax rate or product", async () => {
    const actor = await workspace();
    const other = await workspace("other");
    const foreignRate = await createTaxRate(data, other, { name: "Theirs", rate: "5" });
    expect(await fields(createProduct(data, actor, { name: "X", taxRateId: foreignRate.id }))).toEqual({
      taxRateId: "is not an active tax rate",
    });
    const archived = await createTaxRate(data, actor, { name: "Old", rate: "5" });
    await setTaxRateArchived(data, actor, archived.id, true);
    expect(await fields(createProduct(data, actor, { name: "X", taxRateId: archived.id }))).toEqual({
      taxRateId: "is not an active tax rate",
    });

    const theirs = await createProduct(data, other, { name: "Secret", prices: [{ currency: "USD", unitPrice: "1" }] });
    await expect(getProduct(data, actor.organizationId, theirs.id)).rejects.toThrow(RecordNotFoundError);
    await expect(updateProduct(data, actor, theirs.id, 1, { name: "Mine" })).rejects.toThrow(RecordNotFoundError);
    await expect(setProductActive(data, actor, theirs.id, false)).rejects.toThrow(RecordNotFoundError);
    await expect(updateTaxRate(data, actor, foreignRate.id, { name: "Mine", rate: "1" })).rejects.toThrow(RecordNotFoundError);
    expect((await listProducts(data, actor.organizationId, { q: "Secret" })).items).toEqual([]);
    // The database refuses a price on another workspace's product too.
    await expect(
      data.scoped(actor.organizationId).productPrice.create({ data: { productId: theirs.id, currency: "EUR", unitPriceMinor: 1n } }),
    ).rejects.toThrow();
  });
});
