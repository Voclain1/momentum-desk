import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addActivity, getTimeline } from "@/lib/activities/service";
import { addContact, createCustomer, getCustomer } from "@/lib/customers/service";
import { RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { findDuplicates } from "@/lib/records/duplicates";
import { createTask, tasksFor } from "@/lib/tasks/service";
import { createTenantData, createTenantDb } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { conversionCandidates, convertLead } from "./conversion";
import { createLead, getLead, listStages } from "./service";

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
  const actor = { organizationId, userId, timezone: "Africa/Lagos" };
  const [stage] = await listStages(data, organizationId);
  const lead = (input: Record<string, unknown>) =>
    createLead(data, actor, { stageId: stage.id, ...input }, { memberIds: new Set([userId]) });
  return { actor, lead };
}

describe("lead conversion", () => {
  it("turns a company lead into a customer with a primary contact, keeping the lead's history", async () => {
    const { actor, lead } = await workspace();
    const created = await lead({
      contactName: "Chidi Okafor", companyName: "Okafor Farms", email: "chidi@okafor.ng", phone: "0801 234 5678",
      estimatedValue: "500000", currency: "NGN", tags: ["solar"],
    });
    await addActivity(data, actor, { type: "lead", id: created.id }, { kind: "call", body: "Wants panels" });
    await createTask(data, actor, { type: "lead", id: created.id }, { title: "Send quote" }, { memberIds: new Set([actor.userId]) });

    const { customerId } = await convertLead(data, actor, created.id, { mode: "new" });
    const customer = await getCustomer(data, actor.organizationId, customerId);
    expect(customer).toMatchObject({ type: "organization", displayName: "Okafor Farms", email: null, preferredCurrency: "NGN", tags: ["solar"] });
    expect(customer.contacts).toEqual([
      expect.objectContaining({ name: "Chidi Okafor", email: "chidi@okafor.ng", phone: "0801 234 5678", isPrimary: true }),
    ]);

    // The lead keeps its timeline and tasks and links to the customer.
    expect(await getLead(data, actor.organizationId, created.id)).toMatchObject({ customerId, convertedAt: expect.any(Date) });
    const leadTimeline = await getTimeline(data, actor.organizationId, { type: "lead", id: created.id });
    expect(leadTimeline.some((e) => e.type === "activity" && e.body === "Wants panels")).toBe(true);
    expect(await tasksFor(data, actor.organizationId, { type: "lead", id: created.id })).toHaveLength(1);

    // The customer's timeline shows where it came from.
    const customerEvents = (await getTimeline(data, actor.organizationId, { type: "customer", id: customerId }))
      .map((e) => (e.type === "event" ? e.action : e.kind));
    expect(customerEvents).toEqual(expect.arrayContaining(["lead.converted", "customer.created", "contact.added"]));
  });

  it("turns a person lead into a person customer", async () => {
    const { actor, lead } = await workspace();
    const created = await lead({ contactName: "Bola Ade", email: "bola@mail.ng" });
    const { customerId } = await convertLead(data, actor, created.id, { mode: "new" });
    expect(await getCustomer(data, actor.organizationId, customerId)).toMatchObject({
      type: "person", displayName: "Bola Ade", email: "bola@mail.ng", contacts: [],
    });
  });

  it("links to an existing customer, adding the contact only if new", async () => {
    const { actor, lead } = await workspace();
    const existing = await createCustomer(data, actor, { type: "organization", displayName: "Okafor Farms" });
    await addContact(data, actor, existing.id, { name: "Chidi Okafor" });
    const first = await lead({ contactName: "Chidi Okafor", companyName: "Okafor Farms" });
    const second = await lead({ contactName: "Ngozi Okafor", companyName: "Okafor Farms" });

    await convertLead(data, actor, first.id, { mode: "existing", customerId: existing.id });
    await convertLead(data, actor, second.id, { mode: "existing", customerId: existing.id });
    const customer = await getCustomer(data, actor.organizationId, existing.id);
    expect(customer.contacts.map((c) => [c.name, c.isPrimary])).toEqual([
      ["Chidi Okafor", true],
      ["Ngozi Okafor", false],
    ]);
    expect(await createTenantDb(db, actor.organizationId).customer.count()).toBe(1);
  });

  it("converts a lead once, even when two people try at the same time", async () => {
    const { actor, lead } = await workspace();
    const created = await lead({ contactName: "Bola Ade" });
    const results = await Promise.allSettled([
      convertLead(data, actor, created.id, { mode: "new" }),
      convertLead(data, actor, created.id, { mode: "new" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(RecordConflictError);
    // The losing attempt rolled back its customer too.
    expect(await createTenantDb(db, actor.organizationId).customer.count()).toBe(1);
    await expect(convertLead(data, actor, created.id, { mode: "new" })).rejects.toBeInstanceOf(RecordConflictError);
  });

  it("cannot convert another workspace's lead or link to another workspace's customer", async () => {
    const owner = await workspace("alpha");
    const other = await workspace("bravo");
    const ownerLead = await owner.lead({ contactName: "Secret" });
    const otherCustomer = await createCustomer(data, other.actor, { type: "person", displayName: "Theirs" });
    const otherLead = await other.lead({ contactName: "Theirs" });

    await expect(convertLead(data, other.actor, ownerLead.id, { mode: "new" })).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(convertLead(data, owner.actor, ownerLead.id, { mode: "existing", customerId: otherCustomer.id })).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(conversionCandidates(data, other.actor.organizationId, ownerLead.id)).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(await getLead(data, owner.actor.organizationId, ownerLead.id)).toMatchObject({ customerId: null });
    expect(await getLead(data, other.actor.organizationId, otherLead.id)).toMatchObject({ customerId: null });
  });
});

describe("duplicate detection", () => {
  it("finds customers and leads by email, phone in any format, or name", async () => {
    const { actor, lead } = await workspace();
    const acme = await createCustomer(data, actor, { type: "organization", displayName: "Acme Solar", email: "billing@acme.ng" });
    await addContact(data, actor, acme.id, { name: "Ada Obi", phone: "+234 801 234 5678" });
    const other = await lead({ contactName: "acme solar", email: "x@y.ng" });
    const tenant = createTenantDb(db, actor.organizationId);

    const byEmail = await findDuplicates(tenant, { email: "Billing@Acme.ng" });
    expect(byEmail).toEqual([expect.objectContaining({ type: "customer", id: acme.id, reasons: ["email"] })]);
    const byPhone = await findDuplicates(tenant, { phone: "0801-234-5678" });
    expect(byPhone).toEqual([expect.objectContaining({ id: acme.id, reasons: ["phone"] })]);
    const byName = await findDuplicates(tenant, { names: ["  ACME   Solar "] });
    expect(byName.map((d) => [d.type, d.id])).toEqual([["customer", acme.id], ["lead", other.id]]);
    expect(await findDuplicates(tenant, { names: ["Acme Solar"] }, { leadId: other.id })).toHaveLength(1);
    expect(await findDuplicates(tenant, { phone: "0801 234 5679", email: "nobody@acme.ng" })).toEqual([]);
  });

  it("never finds records in another workspace", async () => {
    const owner = await workspace("alpha");
    const other = await workspace("bravo");
    await createCustomer(data, owner.actor, { type: "organization", displayName: "Acme Solar", email: "billing@acme.ng" });
    expect(await findDuplicates(createTenantDb(db, other.actor.organizationId), { email: "billing@acme.ng", names: ["Acme Solar"] })).toEqual([]);
  });
});
