import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addActivity, getTimeline, removeActivity, updateActivity } from "@/lib/activities/service";
import { AuthorizationError } from "@/lib/auth/authorization";
import { addContact, createCustomer } from "@/lib/customers/service";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { createLead, listStages, moveLead } from "@/lib/leads/service";
import {
  createTask,
  getTask,
  listTasks,
  myTaskCounts,
  removeTask,
  setTaskCompleted,
  tasksFor,
  updateTask,
} from "@/lib/tasks/service";
import { createTenantData, createTenantDb } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";

/** As the restricted app role, like the application. */
const db = createTestDb();
const data = createTenantData(db);

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

const ALL = { leads: true, customers: true };

async function workspace(name = "acme") {
  const organizationId = randomUUID();
  await db.organization.create({
    data: {
      id: organizationId, name, slug: `${name}-${organizationId.slice(0, 8)}`,
      baseCurrency: "NGN", countryCode: "NG", locale: "en-NG", timezone: "Africa/Lagos", defaultLanguage: "en",
    },
  });
  const userId = await member(organizationId, "Ada");
  const actor = { organizationId, userId, timezone: "Africa/Lagos" };
  const stages = await listStages(data, organizationId);
  const lead = await createLead(data, actor, { contactName: "Bola", stageId: stages[0].id }, { memberIds: new Set([userId]) });
  return { actor, memberIds: new Set([userId]), lead, stages };
}

async function member(organizationId: string, name: string) {
  const id = randomUUID();
  await db.user.create({ data: { id, name, email: `${id}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId, userId: id, role: "sales" } });
  return id;
}

describe("activities and the timeline", () => {
  it("merges notes and logged interactions with the record's history, newest first", async () => {
    const { actor, lead, stages } = await workspace();
    await addActivity(data, actor, { type: "lead", id: lead.id }, { kind: "note", body: "Wants 10kW" });
    await moveLead(data, actor, lead.id, stages[1].id);
    await addActivity(data, actor, { type: "lead", id: lead.id }, { kind: "call", body: "Called back" });

    const timeline = await getTimeline(data, actor.organizationId, { type: "lead", id: lead.id });
    expect(timeline.map((e) => (e.type === "activity" ? `${e.kind}:${e.body}` : e.action))).toEqual([
      "call:Called back",
      "lead.stage_changed",
      "note:Wants 10kW",
      "lead.created",
    ]);
    expect(timeline[0]).toMatchObject({ authorName: "Ada", edited: false });
  });

  it("shows contact changes on the customer's timeline", async () => {
    const { actor } = await workspace();
    const customer = await createCustomer(data, actor, { type: "organization", displayName: "Acme" });
    await addContact(data, actor, customer.id, { name: "Chidi" });
    const actions = (await getTimeline(data, actor.organizationId, { type: "customer", id: customer.id }))
      .map((e) => (e.type === "event" ? e.action : e.kind));
    expect(actions).toEqual(["contact.added", "customer.created"]);
  });

  it("stores back-dated wall-clock times in the workspace's timezone, and refuses the future", async () => {
    const { actor, lead } = await workspace();
    const call = await addActivity(data, actor, { type: "lead", id: lead.id }, {
      kind: "call", body: "Yesterday", occurredAt: "2026-01-10T15:30",
    });
    expect(call.occurredAt.toISOString()).toBe("2026-01-10T14:30:00.000Z");
    await expect(
      addActivity(data, actor, { type: "lead", id: lead.id }, { kind: "call", body: "x", occurredAt: "2099-01-01T09:00" }),
    ).rejects.toMatchObject({ fields: { occurredAt: "cannot be in the future" } });
  });

  it("lets only the author edit, and the author or a moderator remove, with removals on the timeline", async () => {
    const { actor, lead } = await workspace();
    const colleague = { ...actor, userId: await member(actor.organizationId, "Chidi") };
    const note = await addActivity(data, actor, { type: "lead", id: lead.id }, { kind: "note", body: "First" });

    await expect(updateActivity(data, colleague, note.id, { kind: "note", body: "Hijack" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(removeActivity(data, colleague, note.id, false)).rejects.toBeInstanceOf(AuthorizationError);
    const edited = await updateActivity(data, actor, note.id, { kind: "note", body: "First, corrected" });
    expect(edited.editedAt).toBeInstanceOf(Date);

    await removeActivity(data, colleague, note.id, true);
    const timeline = await getTimeline(data, actor.organizationId, { type: "lead", id: lead.id });
    expect(timeline.filter((e) => e.type === "activity")).toEqual([]);
    expect(timeline.map((e) => (e.type === "event" ? e.action : ""))).toContain("activity.removed");
  });
});

describe("tasks", () => {
  it("sorts open tasks into buckets relative to the workspace's today", async () => {
    const { actor, memberIds, lead } = await workspace();
    const make = (title: string, dueOn: string | null, parent: { type: "lead"; id: string } | null = null) =>
      createTask(data, actor, parent, { title, dueOn, assigneeUserId: actor.userId }, { memberIds });
    await make("Overdue", "2026-11-01");
    await make("Today", "2026-11-06", { type: "lead", id: lead.id });
    await make("Soon", "2026-11-10");
    await make("Later", "2026-12-20");
    await make("Whenever", null);
    const done = await make("Done", "2026-11-01");
    await setTaskCompleted(data, actor, done.id, true);

    const { buckets } = await listTasks(data, actor, {}, "2026-11-06", ALL);
    const titles = (list: { title: string }[]) => list.map((t) => t.title);
    expect(titles(buckets.overdue)).toEqual(["Overdue"]);
    expect(titles(buckets.today)).toEqual(["Today"]);
    expect(titles(buckets.upcoming)).toEqual(["Soon"]);
    expect(titles(buckets.later)).toEqual(["Later"]);
    expect(titles(buckets.noDate)).toEqual(["Whenever"]);
    expect(titles((await listTasks(data, actor, { status: "done" }, "2026-11-06", ALL)).tasks)).toEqual(["Done"]);
    expect(await myTaskCounts(data, actor, "2026-11-06", ALL)).toEqual({ overdue: 1, dueToday: 1 });

    // Without access to leads, the lead's task is not shown or counted.
    const noLeads = { leads: false, customers: true };
    expect(titles((await listTasks(data, actor, {}, "2026-11-06", noLeads)).buckets.today)).toEqual([]);
    expect(await myTaskCounts(data, actor, "2026-11-06", noLeads)).toEqual({ overdue: 1, dueToday: 0 });
  });

  it("only assigns to members, rejects stale edits, and audits completion on the record's timeline", async () => {
    const { actor, memberIds, lead } = await workspace();
    await expect(
      createTask(data, actor, null, { title: "x", assigneeUserId: randomUUID() }, { memberIds }),
    ).rejects.toBeInstanceOf(InputValidationError);

    const task = await createTask(data, actor, { type: "lead", id: lead.id }, { title: "Send quote" }, { memberIds });
    await updateTask(data, actor, task.id, 1, { title: "Send revised quote", dueOn: "2026-11-09" }, { memberIds });
    await expect(updateTask(data, actor, task.id, 1, { title: "Stale" }, { memberIds })).rejects.toBeInstanceOf(RecordConflictError);
    await setTaskCompleted(data, actor, task.id, true);
    expect(await getTask(data, actor.organizationId, task.id)).toMatchObject({ completedById: actor.userId, title: "Send revised quote" });
    await setTaskCompleted(data, actor, task.id, false);
    expect((await tasksFor(data, actor.organizationId, { type: "lead", id: lead.id }))[0]).toMatchObject({ completedAt: null });

    const actions = (await getTimeline(data, actor.organizationId, { type: "lead", id: lead.id }))
      .filter((e) => e.type === "event").map((e) => (e.type === "event" ? e.action : ""));
    expect(actions.slice(0, 4)).toEqual(["task.reopened", "task.completed", "task.updated", "task.created"]);

    await removeTask(data, actor, task.id);
    expect(await tasksFor(data, actor.organizationId, { type: "lead", id: lead.id })).toEqual([]);
  });
});

describe("isolation between workspaces", () => {
  it("cannot read, add to, edit or remove another workspace's activities and tasks", async () => {
    const owner = await workspace("alpha");
    const other = await workspace("bravo");
    const parent = { type: "lead" as const, id: owner.lead.id };
    const note = await addActivity(data, owner.actor, parent, { kind: "note", body: "Secret" });
    const task = await createTask(data, owner.actor, parent, { title: "Secret task" }, owner);

    expect(await getTimeline(data, other.actor.organizationId, parent)).toEqual([]);
    expect(await tasksFor(data, other.actor.organizationId, parent)).toEqual([]);
    expect((await listTasks(data, other.actor, { scope: "all" }, "2026-11-06", ALL)).tasks).toEqual([]);
    await expect(addActivity(data, other.actor, parent, { kind: "note", body: "x" })).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(createTask(data, other.actor, parent, { title: "x" }, other)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(updateActivity(data, { ...other.actor, userId: owner.actor.userId }, note.id, { kind: "note", body: "x" })).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(removeActivity(data, other.actor, note.id, true)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(getTask(data, other.actor.organizationId, task.id)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(setTaskCompleted(data, other.actor, task.id, true)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(removeTask(data, other.actor, task.id)).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(await getTask(data, owner.actor.organizationId, task.id)).toMatchObject({ completedAt: null });
  });

  it("refuses, in the database, an activity on another workspace's lead or on no record at all", async () => {
    const owner = await workspace("alpha");
    const other = await workspace("bravo");
    const insert = (leadId: string | null) =>
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${other.actor.organizationId}, true)`;
        await tx.$executeRaw`INSERT INTO "activity" (id, "organizationId", kind, body, "occurredAt", "leadId", "updatedAt")
                             VALUES (${randomUUID()}, ${other.actor.organizationId}, 'note', 'x', now(), ${leadId}, now())`;
      });
    await expect(insert(owner.lead.id)).rejects.toThrow(/activity_leadId_organizationId_fkey|foreign key/);
    await expect(insert(null)).rejects.toThrow(/activity_parent_check/);
    expect(await createTenantDb(db, other.actor.organizationId).activity.count()).toBe(0);
  });
});
