import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { createTenantData, createTenantDb } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import {
  addContact,
  createCustomer,
  getCustomer,
  listCustomers,
  PAGE_SIZE,
  removeContact,
  setCustomerArchived,
  updateContact,
  updateCustomer,
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
      baseCurrency: "USD", countryCode: "NG", locale: "en-NG", timezone: "Africa/Lagos", defaultLanguage: "en",
    },
  });
  const userId = randomUUID();
  await db.user.create({ data: { id: userId, name: "Ada", email: `${userId}@example.com` } });
  return { organizationId, userId };
}

const acme = { type: "organization", displayName: "Acme Solar", email: "Billing@Acme.ng", countryCode: "NG", tags: ["solar"] };
const audit = (organizationId: string) =>
  createTenantDb(db, organizationId).auditLog.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

describe("customers", () => {
  it("creates a customer and audits it without personal data", async () => {
    const actor = await workspace();
    const customer = await createCustomer(data, actor, acme);
    expect(customer).toMatchObject({ displayName: "Acme Solar", email: "billing@acme.ng", version: 1, createdById: actor.userId });
    const [entry] = await audit(actor.organizationId);
    expect(entry).toMatchObject({ action: "customer.created", targetId: customer.id, metadata: { type: "organization" } });
    expect(JSON.stringify(entry)).not.toContain("acme.ng");
  });

  it("names invalid fields", async () => {
    const actor = await workspace();
    await expect(createCustomer(data, actor, { ...acme, email: "nope", preferredCurrency: "dollars" })).rejects.toMatchObject({
      fields: { email: expect.any(String), preferredCurrency: expect.any(String) },
    });
  });

  it("searches, filters, sorts and pages", async () => {
    const actor = await workspace();
    await createCustomer(data, actor, { type: "person", displayName: "Bola Ade", email: "bola@mail.ng" });
    const zeta = await createCustomer(data, actor, { type: "organization", displayName: "Zeta Ltd", taxId: "TIN-778" });
    await addContact(data, actor, zeta.id, { name: "Chidi Okafor", email: "chidi@zeta.ng" });
    await createCustomer(data, actor, acme);

    const names = async (query: Parameters<typeof listCustomers>[2]) =>
      (await listCustomers(data, actor.organizationId, query)).items.map((c) => c.displayName);
    expect(await names({})).toEqual(["Acme Solar", "Bola Ade", "Zeta Ltd"]);
    expect(await names({ q: "ACME" })).toEqual(["Acme Solar"]);
    expect(await names({ q: "tin-778" })).toEqual(["Zeta Ltd"]);
    expect(await names({ q: "chidi" })).toEqual(["Zeta Ltd"]);
    expect(await names({ q: "solar" })).toEqual(["Acme Solar"]);
    expect(await names({ type: "person" })).toEqual(["Bola Ade"]);
    expect(await names({ sort: "created" })).toEqual(["Acme Solar", "Zeta Ltd", "Bola Ade"]);

    for (let i = 0; i < PAGE_SIZE; i++) await createCustomer(data, actor, { type: "person", displayName: `Person ${String(i).padStart(2, "0")}` });
    const page2 = await listCustomers(data, actor.organizationId, { page: 2 });
    expect(page2).toMatchObject({ total: PAGE_SIZE + 3, page: 2, pageCount: 2 });
    expect(page2.items).toHaveLength(3);
    expect((await listCustomers(data, actor.organizationId, { page: 99 })).page).toBe(2);
  });

  it("rejects a stale edit and records only which fields changed", async () => {
    const actor = await workspace();
    const customer = await createCustomer(data, actor, acme);
    const edited = await updateCustomer(data, actor, customer.id, 1, { ...acme, phone: "+234 801 234 5678", city: "Lagos" });
    expect(edited).toMatchObject({ version: 2, phone: "+234 801 234 5678", city: "Lagos" });
    await expect(updateCustomer(data, actor, customer.id, 1, { ...acme, city: "Abuja" })).rejects.toBeInstanceOf(RecordConflictError);

    const entries = await audit(actor.organizationId);
    expect(entries.at(-1)).toMatchObject({ action: "customer.updated", metadata: { changedFields: ["phone", "city"], version: 2 } });
    expect(JSON.stringify(entries)).not.toContain("801");
  });

  it("lets exactly one of two simultaneous edits win", async () => {
    const actor = await workspace();
    const customer = await createCustomer(data, actor, acme);
    const results = await Promise.allSettled(
      ["Lagos", "Abuja"].map((city) => updateCustomer(data, actor, customer.id, 1, { ...acme, city })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(RecordConflictError);
    expect((await getCustomer(data, actor.organizationId, customer.id)).version).toBe(2);
  });

  it("archives and restores, keeping the record", async () => {
    const actor = await workspace();
    const customer = await createCustomer(data, actor, acme);
    await setCustomerArchived(data, actor, customer.id, true);
    expect((await listCustomers(data, actor.organizationId)).total).toBe(0);
    expect((await listCustomers(data, actor.organizationId, { archived: true })).items.map((c) => c.id)).toEqual([customer.id]);
    await setCustomerArchived(data, actor, customer.id, false);
    expect((await listCustomers(data, actor.organizationId)).total).toBe(1);
    expect((await audit(actor.organizationId)).map((e) => e.action)).toEqual(["customer.created", "customer.archived", "customer.restored"]);
  });
});

describe("contacts", () => {
  it("keeps exactly one primary contact", async () => {
    const actor = await workspace();
    const customer = await createCustomer(data, actor, acme);
    const first = await addContact(data, actor, customer.id, { name: "Ada Obi" });
    expect(first.isPrimary).toBe(true);
    const second = await addContact(data, actor, customer.id, { name: "Bayo Ade", isPrimary: "on" });
    await updateContact(data, actor, first.id, { name: "Ada Obi", jobTitle: "CFO" });

    const primaries = async () =>
      (await getCustomer(data, actor.organizationId, customer.id)).contacts.filter((c) => c.isPrimary).map((c) => c.name);
    expect(await primaries()).toEqual(["Bayo Ade"]);

    await removeContact(data, actor, second.id);
    expect(await primaries()).toEqual(["Ada Obi"]);

    // The database refuses a second primary even if code forgot.
    await expect(
      createTenantDb(db, actor.organizationId).contact.create({ data: { customerId: customer.id, name: "Third", isPrimary: true } }),
    ).rejects.toThrow(/contact_one_primary_per_customer|Unique constraint/);
  });
});

describe("isolation between workspaces", () => {
  it("cannot see, edit, archive or add contacts to another workspace's customer", async () => {
    const owner = await workspace("alpha");
    const other = await workspace("bravo");
    const customer = await createCustomer(data, owner, acme);
    const contact = await addContact(data, owner, customer.id, { name: "Ada Obi" });

    expect((await listCustomers(data, other.organizationId)).total).toBe(0);
    expect((await listCustomers(data, other.organizationId, { q: "acme" })).total).toBe(0);
    await expect(getCustomer(data, other.organizationId, customer.id)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(updateCustomer(data, other, customer.id, 1, { ...acme, displayName: "Hijacked" })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    await expect(setCustomerArchived(data, other, customer.id, true)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(addContact(data, other, customer.id, { name: "Intruder" })).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(updateContact(data, other, contact.id, { name: "Hijacked" })).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(removeContact(data, other, contact.id)).rejects.toBeInstanceOf(RecordNotFoundError);

    const unchanged = await getCustomer(data, owner.organizationId, customer.id);
    expect(unchanged).toMatchObject({ displayName: "Acme Solar", version: 1, archivedAt: null });
    expect(unchanged.contacts.map((c) => c.name)).toEqual(["Ada Obi"]);
    expect(await audit(other.organizationId)).toEqual([]);
  });

  it("refuses, in the database, a contact pointing at another workspace's customer", async () => {
    const owner = await workspace("alpha");
    const other = await workspace("bravo");
    const customer = await createCustomer(data, owner, acme);
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${other.organizationId}, true)`;
        await tx.$executeRaw`INSERT INTO "contact" (id, "organizationId", "customerId", name, "updatedAt")
                             VALUES (${randomUUID()}, ${other.organizationId}, ${customer.id}, 'Intruder', now())`;
      }),
    ).rejects.toThrow(/contact_customerId_organizationId_fkey|foreign key/);
  });

  it("rejects an invalid version", async () => {
    const actor = await workspace();
    const customer = await createCustomer(data, actor, acme);
    await expect(updateCustomer(data, actor, customer.id, 0, acme)).rejects.toBeInstanceOf(InputValidationError);
  });
});
