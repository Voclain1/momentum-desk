import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTenantData } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { createCustomer } from "@/lib/customers/service";
import { createInvoice, issueInvoice } from "@/lib/invoices/service";
import { deadJobs, retryDeadJob } from "./admin";
import { createJobHandlers, DAILY_JOBS } from "./handlers";
import { enqueue } from "./queue";
import { backoffMs, claimJobs, LOCK_TIMEOUT_MINUTES } from "./queue-core";
import { type JobHandler, runDueJobs, scheduleDaily, type WorkerDeps } from "./worker";

const db = createTestDb();
const data = createTenantData(db);
let now = new Date("2026-11-13T10:00:00Z");

beforeEach(async () => {
  now = new Date("2026-11-13T10:00:00Z");
  await resetDatabase();
});
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

async function workspace(timezone = "Africa/Lagos") {
  const organizationId = randomUUID();
  await db.organization.create({
    data: {
      id: organizationId, name: "Acme", slug: `acme-${organizationId.slice(0, 8)}`,
      baseCurrency: "NGN", countryCode: "NG", locale: "en-NG", timezone, defaultLanguage: "en",
    },
  });
  const userId = randomUUID();
  await db.user.create({ data: { id: userId, name: "Ada", email: `${userId}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId, userId, role: "owner" } });
  return { organizationId, userId };
}

function deps(handlers: Record<string, JobHandler>, daily: string[] = [], workerId = "w1"): WorkerDeps {
  return { db, data, handlers, daily, workerId, now: () => now };
}

const jobs = (organizationId: string) => data.scoped(organizationId).job.findMany({ orderBy: { createdAt: "asc" } });

describe("the job queue", () => {
  it("enqueues once per key, and only if the causing transaction commits", async () => {
    const { organizationId } = await workspace();
    await data.transaction(organizationId, async (tenant) => {
      await enqueue(tenant, { kind: "test.say", key: "a" });
      await enqueue(tenant, { kind: "test.say", key: "a" });
    });
    await expect(
      data.transaction(organizationId, async (tenant) => {
        await enqueue(tenant, { kind: "test.say", key: "b" });
        throw new Error("the change failed");
      }),
    ).rejects.toThrow("the change failed");
    expect((await jobs(organizationId)).map((j) => j.key)).toEqual(["a"]);
  });

  it("runs due jobs as their own workspace, retries with back-off, then gives up", async () => {
    const a = await workspace();
    const b = await workspace();
    const seen: string[] = [];
    let failures = 2;
    const handlers: Record<string, JobHandler> = {
      "test.say": async ({ data: d, job }) => {
        // A handler sees only its job's workspace.
        seen.push(`${job.key}:${(await d.scoped(job.organizationId).job.count())}`);
      },
      "test.flaky": async () => {
        if (failures-- > 0) throw new Error("provider down");
      },
      "test.broken": async () => {
        throw new Error("always");
      },
    };
    await data.transaction(a.organizationId, (t) => enqueue(t, { kind: "test.say", key: "a1" }));
    await data.transaction(b.organizationId, async (t) => {
      await enqueue(t, { kind: "test.flaky", key: "f" });
      await enqueue(t, { kind: "test.broken", key: "x", maxAttempts: 2 });
      await enqueue(t, { kind: "test.later", key: "l", runAt: new Date("2026-11-14T00:00:00Z") });
    });

    expect(await runDueJobs(deps(handlers))).toEqual({ ran: 3, succeeded: 1, retried: 2, dead: 0 });
    expect(seen).toEqual(["a1:1"]);
    const flaky = (await jobs(b.organizationId)).find((j) => j.key === "f")!;
    expect(flaky).toMatchObject({ status: "queued", attempts: 1, lastError: "Error: provider down" });
    expect(flaky.runAt).toEqual(new Date(now.getTime() + backoffMs(1)));

    // Nothing is due until the back-off passes.
    expect((await runDueJobs(deps(handlers))).ran).toBe(0);
    now = new Date(now.getTime() + 2 * 60_000);
    expect(await runDueJobs(deps(handlers))).toEqual({ ran: 2, succeeded: 0, retried: 1, dead: 1 });
    now = new Date(now.getTime() + 5 * 60_000);
    expect(await runDueJobs(deps(handlers))).toEqual({ ran: 1, succeeded: 1, retried: 0, dead: 0 });
    expect((await jobs(b.organizationId)).map((j) => [j.key, j.status, j.attempts])).toEqual([
      ["f", "succeeded", 3], ["x", "dead", 2], ["l", "queued", 0],
    ]);

    // A person can send a dead job round again.
    expect((await deadJobs(data, b.organizationId)).map((j) => j.key)).toEqual(["x"]);
    await retryDeadJob(data, { organizationId: b.organizationId, userId: b.userId }, (await deadJobs(data, b.organizationId))[0].id);
    expect((await jobs(b.organizationId)).find((j) => j.key === "x")).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("never gives the same job to two workers, and reclaims a dead worker's job", async () => {
    const { organizationId } = await workspace();
    await data.transaction(organizationId, async (t) => {
      for (let i = 0; i < 6; i++) await enqueue(t, { kind: "test.say", key: String(i) });
    });
    const [first, second] = await Promise.all([claimJobs(db, "w1", 4, now), claimJobs(db, "w2", 4, now)]);
    const ids = [...first, ...second].map((j) => j.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);

    // w1 died: after the lock timeout its jobs can be claimed again.
    expect(await claimJobs(db, "w3", 10, now)).toEqual([]);
    const later = new Date(now.getTime() + (LOCK_TIMEOUT_MINUTES + 1) * 60_000);
    expect((await claimJobs(db, "w3", 10, later)).map((j) => j.lockedBy)).toEqual(Array(6).fill("w3"));
  });

  it("schedules daily jobs once per local day for every workspace", async () => {
    const lagos = await workspace("Africa/Lagos");
    const auckland = await workspace("Pacific/Auckland");
    now = new Date("2026-11-13T22:00:00Z"); // 23:00 in Lagos, 11:00 next day in Auckland
    await scheduleDaily(deps({}, ["test.daily"]));
    await scheduleDaily(deps({}, ["test.daily"]));
    expect((await jobs(lagos.organizationId)).map((j) => j.key)).toEqual(["2026-11-13"]);
    expect((await jobs(auckland.organizationId)).map((j) => j.key)).toEqual(["2026-11-14"]);
  });

  it("keeps each workspace's jobs to itself outside the worker", async () => {
    const a = await workspace();
    const b = await workspace();
    await data.transaction(a.organizationId, (t) => enqueue(t, { kind: "test.say", key: "secret" }));
    expect(await data.scoped(b.organizationId).job.findMany()).toEqual([]);
    expect(await db.job.findMany()).toEqual([]);
  });
});

describe("the daily jobs", () => {
  it("refresh exchange rates and review receivables through the worker", async () => {
    const { organizationId, userId } = await workspace();
    const customer = await createCustomer(data, { organizationId, userId }, { type: "person", displayName: "Kofi" });
    const draft = await createInvoice(data, { organizationId, userId }, {
      customerId: customer.id, currency: "USD", taxMode: "exclusive", issuedOn: "2026-11-01", dueOn: "2026-11-10",
      lines: [{ description: "Work", quantity: "1", unitPrice: "100" }],
    });
    await issueInvoice(data, { organizationId, userId }, draft.id, 1);
    const requests: string[] = [];
    const handlers = createJobHandlers({
      organization: async () => ({ baseCurrency: "NGN", timezone: "Africa/Lagos" }),
      fxProviderKey: "test-app-id-123",
      http: async (url) => {
        requests.push(url);
        return { status: 200, json: async () => ({ rates: { USD: 1, NGN: 1580.5 } }) };
      },
    });
    await scheduleDaily(deps(handlers, DAILY_JOBS));
    expect(await runDueJobs(deps(handlers, DAILY_JOBS))).toEqual({ ran: 2, succeeded: 2, retried: 0, dead: 0 });
    expect(requests).toEqual(["https://openexchangerates.org/api/latest.json?app_id=test-app-id-123"]);
    const [rate] = await data.scoped(organizationId).exchangeRate.findMany();
    expect([rate.base, rate.quote, rate.rate.toString(), rate.source]).toEqual(["NGN", "USD", "1580.5", "openexchangerates"]);
    // Running the day's jobs again changes nothing.
    await scheduleDaily(deps(handlers, DAILY_JOBS));
    expect((await runDueJobs(deps(handlers, DAILY_JOBS))).ran).toBe(0);
  });
});

