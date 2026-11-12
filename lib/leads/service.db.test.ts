import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { createTenantData, createTenantDb } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import {
  createLead,
  DEFAULT_STAGES,
  getBoard,
  getLead,
  listLeads,
  listStages,
  moveLead,
  setLeadArchived,
  updateLead,
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
  const userId = await user(organizationId, "Ada");
  return { actor: { organizationId, userId }, memberIds: new Set([userId]) };
}

async function user(organizationId: string, name: string) {
  const id = randomUUID();
  await db.user.create({ data: { id, name, email: `${id}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId, userId: id, role: "sales" } });
  return id;
}

async function stage(organizationId: string, key: string) {
  return (await listStages(data, organizationId)).find((s) => s.key === key)!;
}

const audit = (organizationId: string) =>
  createTenantDb(db, organizationId).auditLog.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

describe("pipeline stages", () => {
  it("creates the default stages once, even when first used concurrently", async () => {
    const { actor } = await workspace();
    await Promise.all([listStages(data, actor.organizationId), listStages(data, actor.organizationId)]);
    const stages = await listStages(data, actor.organizationId);
    expect(stages.map((s) => [s.key, s.kind])).toEqual(DEFAULT_STAGES.map((s) => [s.key, s.kind]));
  });
});

describe("leads", () => {
  it("stores the estimated value exactly and audits without personal data", async () => {
    const { actor, memberIds } = await workspace();
    const newStage = await stage(actor.organizationId, "new");
    const lead = await createLead(data, actor, {
      contactName: "Bola Ade", email: "Bola@Mail.ng", stageId: newStage.id, estimatedValue: "1,250,000.50", currency: "NGN",
      ownerUserId: actor.userId, source: "referral",
    }, { memberIds });
    expect(lead).toMatchObject({ estimatedValueMinor: BigInt(125000050), currency: "NGN", email: "bola@mail.ng", closedAt: null });
    const [entry] = await audit(actor.organizationId);
    expect(entry).toMatchObject({ action: "lead.created", metadata: { stage: "new" } });
    expect(JSON.stringify(entry)).not.toMatch(/Bola|mail\.ng/i);
  });

  it("only lets current members own a lead, but keeps a former member already assigned", async () => {
    const { actor, memberIds } = await workspace();
    const newStage = await stage(actor.organizationId, "new");
    const outsider = randomUUID();
    await db.user.create({ data: { id: outsider, name: "Out", email: `${outsider}@example.com` } });
    await expect(
      createLead(data, actor, { contactName: "X", stageId: newStage.id, ownerUserId: outsider }, { memberIds }),
    ).rejects.toMatchObject({ fields: { ownerUserId: "must be a member of this workspace" } });

    const colleague = await user(actor.organizationId, "Chidi");
    const lead = await createLead(data, actor, { contactName: "X", stageId: newStage.id, ownerUserId: colleague }, {
      memberIds: new Set([actor.userId, colleague]),
    });
    // Chidi leaves; editing other fields keeps him as owner.
    const edited = await updateLead(data, actor, lead.id, 1, { contactName: "X", stageId: newStage.id, ownerUserId: colleague, summary: "Solar" }, { memberIds });
    expect(edited.ownerUserId).toBe(colleague);
  });

  it("sets closing fields from the stage kind and audits stage moves by key", async () => {
    const { actor, memberIds } = await workspace();
    const [qualified, won, lost] = await Promise.all(["qualified", "won", "lost"].map((key) => stage(actor.organizationId, key)));
    const lead = await createLead(data, actor, { companyName: "Acme Solar", stageId: qualified.id }, { memberIds });

    const wonLead = await moveLead(data, actor, lead.id, won.id);
    expect(wonLead.closedAt).toBeInstanceOf(Date);
    const lostLead = await updateLead(data, actor, lead.id, wonLead.version, {
      companyName: "Acme Solar", stageId: lost.id, lostReason: "Went with a competitor",
    }, { memberIds });
    expect(lostLead).toMatchObject({ lostReason: "Went with a competitor" });
    const reopened = await moveLead(data, actor, lead.id, qualified.id);
    expect(reopened).toMatchObject({ closedAt: null, lostReason: null });

    expect(
      (await audit(actor.organizationId)).filter((e) => e.action === "lead.stage_changed").map((e) => e.metadata),
    ).toEqual([
      { from: "qualified", to: "won" },
      { from: "won", to: "lost" },
      { from: "lost", to: "qualified" },
    ]);
  });

  it("filters by owner, status, stage, follow-up date and search", async () => {
    const { actor, memberIds } = await workspace();
    const [newStage, won] = await Promise.all(["new", "won"].map((key) => stage(actor.organizationId, key)));
    const make = (patch: Record<string, unknown>) =>
      createLead(data, actor, { stageId: newStage.id, ...patch }, { memberIds });
    await make({ contactName: "Overdue", nextFollowUpOn: "2026-11-01", ownerUserId: actor.userId });
    await make({ contactName: "Today", nextFollowUpOn: "2026-11-06", tags: ["solar"] });
    await make({ contactName: "Next week", nextFollowUpOn: "2026-11-12" });
    const closed = await make({ contactName: "Closed", nextFollowUpOn: "2026-11-01" });
    await moveLead(data, actor, closed.id, won.id);

    const names = async (query: Parameters<typeof listLeads>[2]) =>
      (await listLeads(data, actor, query, "2026-11-06")).items.map((l) => l.contactName).sort();
    expect(await names({})).toEqual(["Next week", "Overdue", "Today"]);
    expect(await names({ followUp: "overdue" })).toEqual(["Overdue"]);
    expect(await names({ followUp: "today" })).toEqual(["Today"]);
    expect(await names({ followUp: "week" })).toEqual(["Next week", "Today"]);
    expect(await names({ owner: "me" })).toEqual(["Overdue"]);
    expect(await names({ owner: "unassigned" })).toEqual(["Next week", "Today"]);
    expect(await names({ status: "won" })).toEqual(["Closed"]);
    expect(await names({ status: "all", followUp: "overdue" })).toEqual(["Closed", "Overdue"]);
    expect(await names({ q: "solar" })).toEqual(["Today"]);
    expect(await names({ stageId: won.id, status: "all" })).toEqual(["Closed"]);
    expect((await listLeads(data, actor, { sort: "followup" }, "2026-11-06")).items.map((l) => l.contactName)).toEqual([
      "Overdue", "Today", "Next week",
    ]);
  });

  it("totals the board per currency and never adds currencies together", async () => {
    const { actor, memberIds } = await workspace();
    const [newStage, won] = await Promise.all(["new", "won"].map((key) => stage(actor.organizationId, key)));
    const make = (value: string | null, currency: string | null, stageId = newStage.id) =>
      createLead(data, actor, { contactName: "L", stageId, estimatedValue: value, currency }, { memberIds });
    await make("1000", "USD");
    await make("250.50", "USD");
    await make("500000", "NGN");
    await make(null, null);
    await make("7", "JPY", won.id);

    const board = await getBoard(data, actor.organizationId);
    const column = (key: string) => board.find((c) => c.stage.key === key)!;
    expect(column("new")).toMatchObject({
      count: 4,
      totals: [
        { currency: "NGN", amountMinor: BigInt(50000000) },
        { currency: "USD", amountMinor: BigInt(125050) },
      ],
    });
    expect(column("won")).toMatchObject({ count: 1, totals: [{ currency: "JPY", amountMinor: BigInt(7) }] });
    expect(column("contacted")).toMatchObject({ count: 0, totals: [], leads: [] });
  });

  it("rejects a stale edit and lets one of two simultaneous edits win", async () => {
    const { actor, memberIds } = await workspace();
    const newStage = await stage(actor.organizationId, "new");
    const lead = await createLead(data, actor, { contactName: "L", stageId: newStage.id }, { memberIds });
    const results = await Promise.allSettled(
      ["A", "B"].map((summary) => updateLead(data, actor, lead.id, 1, { contactName: "L", stageId: newStage.id, summary }, { memberIds })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(RecordConflictError);
    await expect(
      updateLead(data, actor, lead.id, 1, { contactName: "L", stageId: newStage.id, summary: "C" }, { memberIds }),
    ).rejects.toBeInstanceOf(RecordConflictError);
  });

  it("archives and restores", async () => {
    const { actor, memberIds } = await workspace();
    const newStage = await stage(actor.organizationId, "new");
    const lead = await createLead(data, actor, { contactName: "L", stageId: newStage.id }, { memberIds });
    await setLeadArchived(data, actor, lead.id, true);
    expect((await listLeads(data, actor, {}, "2026-11-06")).total).toBe(0);
    expect((await getBoard(data, actor.organizationId)).find((c) => c.stage.key === "new")!.count).toBe(0);
    await setLeadArchived(data, actor, lead.id, false);
    expect((await listLeads(data, actor, {}, "2026-11-06")).total).toBe(1);
  });
});

describe("isolation between workspaces", () => {
  it("cannot see, edit, move or archive another workspace's leads, or use its stages", async () => {
    const owner = await workspace("alpha");
    const other = await workspace("bravo");
    const ownerStage = await stage(owner.actor.organizationId, "new");
    const otherStage = await stage(other.actor.organizationId, "won");
    const lead = await createLead(data, owner.actor, { contactName: "Secret", stageId: ownerStage.id, estimatedValue: "10", currency: "USD" }, owner);

    expect((await listLeads(data, other.actor, { status: "all" }, "2026-11-06")).total).toBe(0);
    expect((await getBoard(data, other.actor.organizationId)).every((c) => c.count === 0 && c.totals.length === 0)).toBe(true);
    await expect(getLead(data, other.actor.organizationId, lead.id)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(updateLead(data, other.actor, lead.id, 1, { contactName: "Hijacked", stageId: otherStage.id }, other)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(moveLead(data, other.actor, lead.id, otherStage.id)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(setLeadArchived(data, other.actor, lead.id, true)).rejects.toBeInstanceOf(RecordNotFoundError);

    // A workspace cannot file its lead under another workspace's stage.
    await expect(createLead(data, owner.actor, { contactName: "X", stageId: otherStage.id }, owner)).rejects.toBeInstanceOf(InputValidationError);
    await expect(moveLead(data, owner.actor, lead.id, otherStage.id)).rejects.toBeInstanceOf(InputValidationError);

    expect(await getLead(data, owner.actor.organizationId, lead.id)).toMatchObject({ contactName: "Secret", stageId: ownerStage.id, version: 1 });
  });

  it("refuses, in the database, a lead in another workspace's stage", async () => {
    const owner = await workspace("alpha");
    const other = await workspace("bravo");
    const otherStage = await stage(other.actor.organizationId, "new");
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${owner.actor.organizationId}, true)`;
        await tx.$executeRaw`INSERT INTO "lead" (id, "organizationId", "contactName", "stageId", "updatedAt")
                             VALUES (${randomUUID()}, ${owner.actor.organizationId}, 'X', ${otherStage.id}, now())`;
      }),
    ).rejects.toThrow(/lead_stageId_organizationId_fkey|foreign key/);
  });

  it("deletes a workspace with its stages and leads", async () => {
    const { actor, memberIds } = await workspace();
    const newStage = await stage(actor.organizationId, "new");
    await createLead(data, actor, { contactName: "L", stageId: newStage.id }, { memberIds });
    await db.organization.delete({ where: { id: actor.organizationId } });
    expect(await createTenantDb(db, actor.organizationId).lead.count()).toBe(0);
  });
});
