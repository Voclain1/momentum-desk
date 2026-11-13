import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCustomer } from "@/lib/customers/service";
import { createMemoryEmailSender } from "@/lib/email";
import { createInvoice, issueInvoice, setDisputed, voidInvoice } from "@/lib/invoices/service";
import { openInvoice } from "@/lib/invoices/public";
import { createJobHandlers, DAILY_JOBS } from "@/lib/jobs/handlers";
import { runDueJobs, scheduleDaily, type WorkerDeps } from "@/lib/jobs/worker";
import { recordPayment } from "@/lib/payments/service";
import { addPromise, updateCollection } from "@/lib/receivables/service";
import { createTenantData } from "@/lib/tenant/core";
import { createPublicLinks } from "@/lib/tenant/public";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { optOutFromInvoiceLink, remindersFor, updateReminderSettings } from "./service";

const db = createTestDb();
const data = createTenantData(db);
const links = createPublicLinks(db);
let outbox = createMemoryEmailSender();

beforeEach(async () => {
  outbox = createMemoryEmailSender();
  await resetDatabase();
});
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

async function setup({ enabled = true, gap = 3 } = {}) {
  const organizationId = randomUUID();
  await db.organization.create({
    data: {
      id: organizationId, name: "Sun Power", slug: `sun-${organizationId.slice(0, 8)}`,
      baseCurrency: "NGN", countryCode: "NG", locale: "en-NG", timezone: "Africa/Lagos", defaultLanguage: "en",
    },
  });
  const userId = randomUUID();
  await db.user.create({ data: { id: userId, name: "Ada", email: `${userId}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId, userId, role: "owner" } });
  const actor = { organizationId, userId };
  await updateReminderSettings(data, actor, { enabled, minGapDays: gap });
  const customer = await createCustomer(data, actor, { type: "organization", displayName: "Okafor Farms", email: "pay@okafor.ng" });
  const invoice = async (dueOn: string) => {
    const draft = await createInvoice(data, actor, {
      customerId: customer.id, currency: "NGN", taxMode: "exclusive", issuedOn: "2026-09-01", dueOn,
      lines: [{ description: "Panels", quantity: "1", unitPrice: "100000" }],
    });
    return issueInvoice(data, actor, draft.id, 1);
  };
  return { actor, customer, invoice, members: new Set([userId]) };
}

/** Runs the worker as it would on the morning of `day` in Lagos. */
async function runDay(day: string) {
  const now = new Date(`${day}T08:00:00Z`);
  const handlers = createJobHandlers({
    organization: async () => ({ name: "Sun Power", baseCurrency: "NGN", timezone: "Africa/Lagos", locale: "en-NG" }),
    email: outbox,
    appUrl: "https://momentumdesk.app",
    fxProviderKey: undefined,
    http: async () => ({ status: 500, json: async () => ({}) }),
  });
  const deps: WorkerDeps = { db, data, handlers, daily: DAILY_JOBS, workerId: "test", now: () => now };
  await scheduleDaily(deps);
  while ((await runDueJobs(deps)).ran > 0);
}

const sentSubjects = () => outbox.sent.map((m) => m.subject);
const history = async (orgId: string, invoiceId: string) =>
  (await remindersFor(data, orgId, invoiceId)).map((r) => [r.offsetDays, r.status, r.reason, r.amountMinor]).reverse();

describe("payment reminders", () => {
  it("are off until an owner turns them on", async () => {
    const s = await setup({ enabled: false });
    await s.invoice("2026-11-01");
    await runDay("2026-11-13");
    expect(outbox.sent).toEqual([]);
  });

  it("go out once per step, state what is owed now, and stop when paid", async () => {
    const s = await setup();
    const invoice = await s.invoice("2026-11-20");
    await runDay("2026-11-16"); // nothing due yet
    await runDay("2026-11-17"); // 3 days before
    await runDay("2026-11-17"); // same day again: nothing new
    expect(sentSubjects()).toEqual(["Invoice INV-0001 is due on 20 November 2026"]);
    expect(outbox.sent[0]).toMatchObject({ to: "pay@okafor.ng" });
    expect(outbox.sent[0].text).toContain("₦100,000.00");
    // The link in the reminder opens the invoice.
    const token = /\/i\/([A-Za-z0-9_-]{43})/.exec(outbox.sent[0].text)![1];
    expect(await openInvoice({ data, links }, token, { ipAddress: null, userAgent: null })).toMatchObject({ state: "ready" });

    await recordPayment(data, s.actor, invoice.id, { amount: "40000", method: "cash", receivedOn: "2026-11-19" }, { today: "2026-11-19", locale: "en-NG" });
    await runDay("2026-11-21"); // 1 day overdue
    expect(sentSubjects()[1]).toBe("Reminder: invoice INV-0001, ₦60,000.00 outstanding");

    await recordPayment(data, s.actor, invoice.id, { amount: "60000", method: "cash", receivedOn: "2026-11-25" }, { today: "2026-11-25", locale: "en-NG" });
    await runDay("2026-11-27"); // 7 days: paid, nothing
    await runDay("2026-12-20"); // 30 days: nothing
    expect(outbox.sent).toHaveLength(2);
    expect(await history(s.actor.organizationId, invoice.id)).toEqual([
      [-3, "sent", null, 10000000n],
      [1, "sent", null, 6000000n],
    ]);
  });

  it("is checked again when sending: a payment in between stops it", async () => {
    const s = await setup();
    const invoice = await s.invoice("2026-11-10");
    const now = new Date("2026-11-11T08:00:00Z");
    const handlers = createJobHandlers({
      organization: async () => ({ name: "Sun Power", baseCurrency: "NGN", timezone: "Africa/Lagos", locale: "en-NG" }),
      email: outbox, appUrl: "https://momentumdesk.app", fxProviderKey: undefined, http: async () => ({ status: 500, json: async () => ({}) }),
    });
    const deps: WorkerDeps = { db, data, handlers, daily: DAILY_JOBS, workerId: "t", now: () => now };
    await scheduleDaily(deps);
    // Plan only: run the daily jobs, leaving the send job queued.
    await runDueJobs({ ...deps, handlers: { ...handlers, "reminders.send": async () => { throw new Error("not yet"); } } }, 3);
    await recordPayment(data, s.actor, invoice.id, { amount: "100000", method: "bank_transfer", receivedOn: "2026-11-11" }, { today: "2026-11-11", locale: "en-NG" });
    await data.scoped(s.actor.organizationId).job.updateMany({ where: { kind: "reminders.send" }, data: { runAt: now } });
    while ((await runDueJobs(deps)).ran > 0);
    expect(outbox.sent).toEqual([]);
    expect(await history(s.actor.organizationId, invoice.id)).toEqual([
      [-3, "skipped", "superseded", null],
      [1, "skipped", "paid", null],
    ]);
  });

  it("stop for void, dispute, pause, promise, escalation and opt-out, and resume afterwards", async () => {
    const s = await setup({ gap: 1 });
    const voided = await s.invoice("2026-11-01");
    const disputed = await s.invoice("2026-11-01");
    const paused = await s.invoice("2026-11-01");
    const promised = await s.invoice("2026-11-01");
    const escalated = await s.invoice("2026-11-01");
    await voidInvoice(data, s.actor, voided.id, "Raised in error");
    await setDisputed(data, s.actor, disputed.id, "Wrong quantity");
    const ctx = { today: "2026-11-02", memberIds: s.members };
    await updateCollection(data, s.actor, paused.id, { action: "pause", until: "2026-11-10", reason: "Awaiting their PO" }, ctx);
    await addPromise(data, s.actor, promised.id, { amount: "100000", promisedOn: "2026-11-06" }, { today: "2026-11-02" });
    await updateCollection(data, s.actor, escalated.id, { action: "escalate", note: "Call the director" }, ctx);

    await runDay("2026-11-02"); // +1 day for all
    expect(outbox.sent).toEqual([]);
    const reasons = async (id: string) => (await history(s.actor.organizationId, id)).map((h) => h[2]);
    expect(await reasons(voided.id)).toEqual([]); // void invoices are not planned at all
    // The step 3 days before due had already passed: superseded, never sent late.
    expect(await reasons(disputed.id)).toEqual(["superseded", "disputed"]);
    expect(await reasons(paused.id)).toEqual(["superseded", "paused"]);
    expect(await reasons(promised.id)).toEqual(["superseded", "promise"]);
    expect(await reasons(escalated.id)).toEqual(["superseded", "escalated"]);

    // The promise is broken and the pause ends: the next step goes out for those two only.
    await runDay("2026-11-08"); // +7 days
    expect(outbox.sent).toHaveLength(1); // promise broken on the 7th → reminded
    await runDay("2026-11-15"); // +14 days: pause ended on the 10th
    expect(outbox.sent.length).toBe(3);
    expect(await reasons(paused.id)).toEqual(["superseded", "paused", "paused", null]);

    // A customer stops reminders from the invoice link: nothing more for them.
    const token = /\/i\/([A-Za-z0-9_-]{43})/.exec(outbox.sent[0].text)![1];
    expect(await optOutFromInvoiceLink({ data, links }, token)).toBe(true);
    await runDay("2026-12-01"); // +30 days
    expect(outbox.sent.length).toBe(3);
    expect(await reasons(promised.id)).toContain("opted_out");
  });

  it("send only the latest due step, never a backlog, and keep a minimum gap", async () => {
    const s = await setup({ gap: 10 });
    const late = await s.invoice("2026-10-01"); // 43 days overdue on the 13th
    await runDay("2026-11-13");
    expect(sentSubjects()).toEqual(["Reminder: invoice INV-0001, ₦100,000.00 outstanding"]);
    expect(outbox.sent[0].text).toContain("remains unpaid 43 days after its due date");
    expect(await history(s.actor.organizationId, late.id)).toEqual([
      [-3, "skipped", "superseded", null],
      [1, "skipped", "superseded", null],
      [7, "skipped", "superseded", null],
      [14, "skipped", "superseded", null],
      [30, "sent", null, 10000000n],
    ]);

    // Two steps four days apart with a 10-day gap: the second waits, then goes.
    const soon = await s.invoice("2026-11-20");
    await runDay("2026-11-21"); // +1 sent
    await runDay("2026-11-27"); // +7 due, but within 10 days of the last: waits
    expect(outbox.sent.filter((m) => m.subject.includes("INV-0002"))).toHaveLength(1);
    await runDay("2026-12-01"); // gap passed: +7 still the latest due step
    expect(outbox.sent.filter((m) => m.subject.includes("INV-0002"))).toHaveLength(2);
    void soon;
  });
});
