import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCustomer } from "@/lib/customers/service";
import { InputValidationError, RecordConflictError } from "@/lib/errors";
import { refreshRates } from "@/lib/fx/provider";
import { addManualRate, rateFor } from "@/lib/fx/rates";
import { createInvoice, issueInvoice } from "@/lib/invoices/service";
import { recordPayment } from "@/lib/payments/service";
import { createTenantData } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { addCollectionNote, addPromise, agingReport, cancelPromise, getCollection, openReceivables, reviewReceivables, updateCollection } from "./service";

const db = createTestDb();
const data = createTenantData(db);
const today = "2026-11-13";

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

async function setup() {
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
  const customer = await createCustomer(data, actor, { type: "organization", displayName: "Okafor Farms" });
  const invoice = async (currency: string, unitPrice: string, dueOn: string, issuedOn = "2026-06-01") => {
    const draft = await createInvoice(data, actor, {
      customerId: customer.id, currency, taxMode: "exclusive", issuedOn, dueOn, lines: [{ description: "Work", quantity: "1", unitPrice }],
    });
    return issueInvoice(data, actor, draft.id, 1);
  };
  return { actor, invoice, members: new Set([userId]) };
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

describe("ageing", () => {
  it("buckets what is owed per currency and converts to the base currency only with a known rate", async () => {
    const s = await setup();
    await s.invoice("NGN", "100000", "2026-11-20"); // current
    await s.invoice("NGN", "50000", "2026-11-01"); // 12 days
    const partly = await s.invoice("NGN", "80000", "2026-09-01"); // 73 days
    await recordPayment(data, s.actor, partly.id, { amount: "30000", method: "cash", receivedOn: today }, { today, locale: "en-NG" });
    await s.invoice("USD", "1000", "2026-07-01"); // 135 days
    await s.invoice("GHS", "500", "2026-10-20"); // 24 days, no rate

    let report = await agingReport(data, s.actor.organizationId, { today, baseCurrency: "NGN" });
    expect(report.byCurrency.map((c) => [c.currency, c.invoices, c.totals.current, c.totals["1-30"], c.totals["61-90"], c.totals["90+"], c.totals.total])).toEqual([
      ["GHS", 1, 0n, 50000n, 0n, 0n, 50000n],
      ["NGN", 3, 10000000n, 5000000n, 5000000n, 0n, 20000000n],
      ["USD", 1, 0n, 0n, 0n, 100000n, 100000n],
    ]);
    expect(report.inBase).toMatchObject({ complete: false, missing: ["GHS", "USD"] });
    expect(report.inBase.totals.total).toBe(20000000n);

    // Provider rate for USD; staff rate for GHS wins over the provider's on the same day.
    await refreshRates(data, s.actor.organizationId, {
      day: today, base: "NGN", fetchTable: async () => ({ perUsd: { USD: "1", NGN: "1580", GHS: "15.8" } }),
    });
    await addManualRate(data, s.actor, "NGN", { quote: "GHS", rate: "101.5", effectiveOn: today }, today);
    report = await agingReport(data, s.actor.organizationId, { today, baseCurrency: "NGN" });
    expect(report.inBase.complete).toBe(true);
    expect(report.inBase.rates).toEqual([
      expect.objectContaining({ currency: "GHS", rate: "101.5", source: "manual", stale: false }),
      expect.objectContaining({ currency: "USD", rate: "1580", source: "openexchangerates", stale: false }),
    ]);
    // ₦200,000 + GH₵500 × 101.5 + $1,000 × 1,580 = ₦1,830,750.
    expect(report.inBase.totals.total).toBe(183075000n);
    expect(report.inBase.totals["90+"]).toBe(158000000n);

    // The same rate later is stale; before any rate, there is none.
    const tenant = data.scoped(s.actor.organizationId);
    expect((await rateFor(tenant, "NGN", "USD", new Date("2026-11-25T00:00:00Z")))?.stale).toBe(true);
    expect(await rateFor(tenant, "NGN", "USD", new Date("2026-11-12T00:00:00Z"))).toBeNull();
    // Rates are a record: never edited.
    const [row] = await tenant.exchangeRate.findMany({ where: { quote: "USD" } });
    await expect(tenant.exchangeRate.update({ where: { id: row.id }, data: { rate: "1" } })).rejects.toThrow(/append-only/);
    expect(await fields(addManualRate(data, s.actor, "NGN", { quote: "NGN", rate: "0", effectiveOn: "2026-12-01" }, today))).toEqual({
      rate: "must be a positive number with up to 12 decimal places",
      quote: "must differ from the base currency",
      effectiveOn: "cannot be in the future",
    });
  });
});

describe("collecting an invoice", () => {
  it("sets an owner, escalates, pauses and resumes, with notes", async () => {
    const s = await setup();
    const invoice = await s.invoice("NGN", "100000", "2026-10-01");
    const ctx = { today, memberIds: s.members };
    await updateCollection(data, s.actor, invoice.id, { action: "owner", ownerUserId: s.actor.userId }, ctx);
    expect(await fields(updateCollection(data, s.actor, invoice.id, { action: "owner", ownerUserId: randomUUID() }, ctx))).toEqual({
      ownerUserId: "must be a member of this workspace",
    });
    await updateCollection(data, s.actor, invoice.id, { action: "escalate", note: "No reply after three reminders" }, ctx);
    expect((await getCollection(data, s.actor.organizationId, invoice.id)).collection).toMatchObject({ status: "escalated", ownerUserId: s.actor.userId });
    expect(await fields(updateCollection(data, s.actor, invoice.id, { action: "pause", until: today, reason: "Waiting for PO" }, ctx))).toEqual({
      until: "must be after today",
    });
    await updateCollection(data, s.actor, invoice.id, { action: "pause", until: "2026-11-20", reason: "Waiting for PO" }, ctx);
    await addCollectionNote(data, s.actor, invoice.id, "Called the finance office");
    const state = await getCollection(data, s.actor.organizationId, invoice.id);
    expect(state.collection).toMatchObject({ status: "paused", pauseReason: "Waiting for PO" });
    expect(state.notes.map((n) => n.body)).toEqual(["Called the finance office"]);

    // The daily review resumes it once the pause ends.
    expect(await reviewReceivables(data, s.actor.organizationId, "2026-11-19")).toMatchObject({ resumed: 0 });
    expect(await reviewReceivables(data, s.actor.organizationId, "2026-11-20")).toMatchObject({ resumed: 1 });
    expect((await getCollection(data, s.actor.organizationId, invoice.id)).collection?.status).toBe("open");
    expect((await openReceivables(data, s.actor.organizationId, today, { ownerUserId: s.actor.userId })).map((r) => r.id)).toEqual([invoice.id]);
  });

  it("judges promises kept or broken by what was actually paid", async () => {
    const s = await setup();
    const keeps = await s.invoice("NGN", "100000", "2026-10-01");
    const breaks = await s.invoice("NGN", "100000", "2026-10-01");
    await addPromise(data, s.actor, keeps.id, { amount: "40000", promisedOn: "2026-11-15" }, { today });
    await addPromise(data, s.actor, breaks.id, { amount: "40000", promisedOn: "2026-11-15" }, { today });
    await expect(addPromise(data, s.actor, keeps.id, { amount: "1", promisedOn: "2026-11-16" }, { today })).rejects.toThrow(RecordConflictError);
    expect(await fields(addPromise(data, s.actor, breaks.id, { amount: "200000", promisedOn: "2026-11-10" }, { today }))).toEqual({
      promisedOn: "cannot be in the past",
    });

    await recordPayment(data, s.actor, keeps.id, { amount: "40000", method: "bank_transfer", receivedOn: "2026-11-15" }, { today: "2026-11-15", locale: "en-NG" });
    await recordPayment(data, s.actor, breaks.id, { amount: "10000", method: "bank_transfer", receivedOn: "2026-11-15" }, { today: "2026-11-15", locale: "en-NG" });
    expect(await reviewReceivables(data, s.actor.organizationId, "2026-11-15")).toMatchObject({ kept: 0, broken: 0 });
    expect(await reviewReceivables(data, s.actor.organizationId, "2026-11-16")).toMatchObject({ kept: 1, broken: 1 });
    expect(await reviewReceivables(data, s.actor.organizationId, "2026-11-17")).toMatchObject({ kept: 0, broken: 0 });
    expect((await getCollection(data, s.actor.organizationId, keeps.id)).promises[0].status).toBe("kept");
    expect((await getCollection(data, s.actor.organizationId, breaks.id)).promises[0].status).toBe("broken");

    const another = await addPromise(data, s.actor, breaks.id, { amount: "50000", promisedOn: "2026-11-30" }, { today: "2026-11-17" });
    await cancelPromise(data, s.actor, another.id);
    await expect(cancelPromise(data, s.actor, another.id)).rejects.toThrow(RecordConflictError);
  });

  it("never reaches another workspace's receivables", async () => {
    const mine = await setup();
    const theirs = await setup();
    const invoice = await theirs.invoice("NGN", "100000", "2026-10-01");
    await expect(updateCollection(data, mine.actor, invoice.id, { action: "resume" }, { today, memberIds: mine.members })).rejects.toThrow(/not found/);
    await expect(addPromise(data, mine.actor, invoice.id, { amount: "1", promisedOn: today }, { today })).rejects.toThrow(/not found/);
    await expect(addCollectionNote(data, mine.actor, invoice.id, "x")).rejects.toThrow(/not found/);
    expect((await agingReport(data, mine.actor.organizationId, { today, baseCurrency: "NGN" })).byCurrency).toEqual([]);
  });
});
