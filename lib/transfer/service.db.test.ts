import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/lib/csv";
import { createCustomer, listCustomers } from "@/lib/customers/service";
import { createLead, listStages } from "@/lib/leads/service";
import { createTenantData } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { CUSTOMER_COLUMNS, exportCustomers, exportLeads, importCustomers, importLeads, MAX_IMPORT_ROWS } from "./service";

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

const audits = (organizationId: string, action: string) =>
  data.scoped(organizationId).auditLog.findMany({ where: { action } });

describe("customer import and export", () => {
  it("round-trips customers, including a value that looks like a formula", async () => {
    const actor = await workspace();
    await createCustomer(data, actor, {
      type: "organization", displayName: "=Okafor Farms", email: "info@okafor.ng", phone: "+234 801 234 5678",
      countryCode: "NG", tags: ["solar", "vip"],
    });
    const csv = await exportCustomers(data, actor.organizationId);
    const [header, row] = parseCsv(csv);
    expect(header).toEqual([...CUSTOMER_COLUMNS, "archived", "createdAt"]);
    expect(row[1]).toBe("'=Okafor Farms");
    expect(row[16]).toBe("solar, vip");

    const other = await workspace("other");
    // The exported file's extra columns are not import columns: drop them.
    const importable = toCsv(CUSTOMER_COLUMNS, parseCsv(csv).slice(1).map((cells) => cells.slice(0, CUSTOMER_COLUMNS.length)));
    expect(await importCustomers(data, other, importable)).toEqual({ ok: true, imported: 1 });
    const { items: customers } = await listCustomers(data, other.organizationId);
    expect(customers).toEqual([
      expect.objectContaining({
        type: "organization", displayName: "=Okafor Farms", email: "info@okafor.ng", phone: "+234 801 234 5678",
        countryCode: "NG", tags: ["solar", "vip"],
      }),
    ]);
    expect(await audits(other.organizationId, "customer.imported")).toEqual([
      expect.objectContaining({ actorUserId: other.userId, metadata: { count: 1 } }),
    ]);
  });

  it("imports nothing when any row is invalid, and reports every error by line", async () => {
    const actor = await workspace();
    const csv = "displayName,Email,type\nAda Ltd,ada@example.com,\n,bad,organization\nBolu,,robot\n";
    expect(await importCustomers(data, actor, csv)).toEqual({
      ok: false,
      errors: [
        { line: 3, field: "displayName", message: "is required" },
        { line: 3, field: "email", message: "must be a valid email address" },
        { line: 4, field: "type", message: "must be organization or person" },
      ],
    });
    expect((await listCustomers(data, actor.organizationId)).items).toEqual([]);
    expect(await audits(actor.organizationId, "customer.imported")).toEqual([]);
  });

  it("rejects unknown columns, malformed files, empty files and too many rows", async () => {
    const actor = await workspace();
    const error = async (csv: string) => {
      const result = await importCustomers(data, actor, csv);
      return result.ok ? null : result.errors;
    };
    expect(await error("displayName,password\nAda,x\n")).toEqual([
      { line: 1, field: "header", message: "has unknown columns: password" },
    ]);
    expect(await error('displayName\n"Ada')).toEqual([
      { line: 1, field: "file", message: "is not a valid CSV file: A quoted field is not closed" },
    ]);
    expect(await error("displayName\n")).toEqual([{ line: 1, field: "file", message: "has no rows" }]);
    expect(await error("")).toEqual([{ line: 1, field: "file", message: "is empty" }]);
    const many = "displayName\n" + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `C${i}`).join("\n");
    expect(await error(many)).toEqual([{ line: 1, field: "file", message: `has more than ${MAX_IMPORT_ROWS} rows` }]);
  });
});

describe("lead import and export", () => {
  it("imports leads with stages by name or key, exact values and closing dates", async () => {
    const actor = await workspace();
    const csv = [
      "contactName,companyName,stage,estimatedValue,currency,nextFollowUpOn,tags",
      "Ada,,,1500.50,USD,2026-12-01,warm",
      "Bolu,Bolu Stores,qualified,\"2,000,000\",NGN,,",
      ",Chi Ltd,WON,,,,",
    ].join("\n");
    expect(await importLeads(data, actor, csv)).toEqual({ ok: true, imported: 3 });

    const stages = await listStages(data, actor.organizationId);
    const byKey = new Map(stages.map((stage) => [stage.key, stage.id]));
    const leads = await data.scoped(actor.organizationId).lead.findMany({ orderBy: { createdAt: "asc" } });
    const byName = new Map(leads.map((lead) => [lead.contactName ?? lead.companyName, lead]));
    expect(byName.get("Ada")).toMatchObject({
      stageId: byKey.get("new"), estimatedValueMinor: BigInt(150050), currency: "USD",
      nextFollowUpOn: new Date("2026-12-01T00:00:00Z"), tags: ["warm"], ownerUserId: null, closedAt: null,
    });
    expect(byName.get("Bolu")).toMatchObject({ stageId: byKey.get("qualified"), estimatedValueMinor: BigInt(200000000), currency: "NGN" });
    expect(byName.get("Chi Ltd")).toMatchObject({ stageId: byKey.get("won"), closedAt: expect.any(Date) });
    expect(await audits(actor.organizationId, "lead.imported")).toEqual([
      expect.objectContaining({ metadata: { count: 3 } }),
    ]);
  });

  it("reports unknown stages and invalid amounts, importing nothing", async () => {
    const actor = await workspace();
    const csv = "contactName,stage,estimatedValue,currency\nAda,Dreaming,,\nBolu,New,10.5,JPY\n";
    expect(await importLeads(data, actor, csv)).toEqual({
      ok: false,
      errors: [
        { line: 2, field: "stage", message: "is not a stage (New, Contacted, Qualified, Quote / proposal, Won, Lost)" },
        { line: 3, field: "estimatedValue", message: "has too many decimal places for JPY" },
      ],
    });
    expect(await data.scoped(actor.organizationId).lead.count()).toBe(0);
  });

  it("exports only the workspace's own leads", async () => {
    const actor = await workspace();
    const other = await workspace("other");
    const [stage] = await listStages(data, actor.organizationId);
    const [otherStage] = await listStages(data, other.organizationId);
    await createLead(data, actor, { stageId: stage.id, contactName: "Ada", estimatedValue: "1500.50", currency: "USD" }, { memberIds: new Set() });
    await createLead(data, other, { stageId: otherStage.id, contactName: "Eve" }, { memberIds: new Set() });

    const [header, ...rows] = parseCsv(await exportLeads(data, actor.organizationId));
    expect(header.slice(-5)).toEqual(["owner", "status", "customer", "archived", "createdAt"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].slice(0, 8)).toEqual(["Ada", "", "", "", "", "New", "1500.50", "USD"]);
    expect(rows[0][13]).toBe("open");
  });
});
