import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createProduct, createTaxRate, setTaxRateArchived, updateTaxRate } from "@/lib/catalogue/service";
import { createCustomer, updateCustomer } from "@/lib/customers/service";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { createTenantData } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import {
  createQuote,
  deleteDraft,
  displayStatus,
  duplicateQuote,
  getQuote,
  listQuotes,
  quoteNumbering,
  reviseQuote,
  sendQuote,
  updateDraft,
  updateQuoteNumbering,
} from "./service";

/** As the restricted app role, like the application. */
const db = createTestDb();
const data = createTenantData(db);
const today = { today: "2026-11-12" };

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
  const actor = { organizationId, userId };
  const customer = await createCustomer(data, actor, {
    type: "organization", displayName: "Okafor Farms", email: "billing@okafor.ng", addressLine1: "1 Farm Road", city: "Ibadan",
  });
  const vat = await createTaxRate(data, actor, { name: "VAT", rate: "7.5" });
  return { actor, customer, vat };
}

type Line = Record<string, unknown>;
const input = (customerId: string, lines: Line[], extra: Record<string, unknown> = {}) => ({
  customerId, currency: "NGN", taxMode: "exclusive", issuedOn: "2026-11-12", expiresOn: "2026-12-12", lines, ...extra,
});

const fields = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof InputValidationError) return error.fields;
    throw error;
  }
  throw new Error("expected a validation error");
};

describe("quote drafts", () => {
  it("computes exact totals per tax rate and copies every line", async () => {
    const { actor, customer, vat } = await workspace();
    const panel = await createProduct(data, actor, { name: "Panel", prices: [{ currency: "NGN", unitPrice: "185000" }] });
    const quote = await createQuote(data, actor, input(customer.id, [
      { productId: panel.id, description: "Solar panel 400W", quantity: "4", unit: "unit", unitPrice: "185,000", taxRateId: vat.id,
        discountKind: "percent", discount: "10" },
      { description: "Installation", quantity: "6.5", unit: "hour", unitPrice: "7500.50", taxRateId: vat.id },
      { description: "Permit fee", quantity: "1", unitPrice: "20000", discountKind: "fixed", discount: "2,000" },
    ]));
    expect(quote).toMatchObject({ number: "Q-0001", revision: 1, status: "draft", recipientName: "Okafor Farms", recipientEmail: "billing@okafor.ng" });

    const saved = await getQuote(data, actor.organizationId, quote.id);
    // 4 × 185,000 = 740,000 − 10% = 666,000; 6.5 × 7,500.50 = 48,753.25; 20,000 − 2,000 = 18,000.
    expect(saved.items.map((i) => [i.description, i.grossMinor, i.discountMinor, i.netMinor, i.taxMilliPercent])).toEqual([
      ["Solar panel 400W", 74000000n, 7400000n, 66600000n, 7500],
      ["Installation", 4875325n, 0n, 4875325n, 7500],
      ["Permit fee", 2000000n, 200000n, 1800000n, null],
    ]);
    // VAT on 714,753.25 = 53,606.49375 → 53,606.49.
    expect(saved.taxLines).toEqual([{ taxRateId: vat.id, name: "VAT", milliPercent: 7500, baseMinor: "71475325", taxMinor: "5360649" }]);
    expect([saved.subtotalMinor, saved.discountMinor, saved.taxMinor, saved.totalMinor]).toEqual([
      73275325n, 7600000n, 5360649n, 78635974n,
    ]);
    expect(saved.customerSnapshot).toMatchObject({ name: "Okafor Farms", addressLine1: "1 Farm Road", city: "Ibadan" });
  });

  it("handles zero- and three-decimal currencies and tax-inclusive prices", async () => {
    const { actor, customer, vat } = await workspace();
    const jpy = await createQuote(data, actor, input(customer.id, [{ description: "Bolts", quantity: "3", unitPrice: "333", taxRateId: vat.id }], { currency: "JPY" }));
    // 999 + 7.5% = 74.925 → 75.
    expect((await getQuote(data, actor.organizationId, jpy.id)).totalMinor).toBe(1074n);
    const kwd = await createQuote(data, actor, input(customer.id, [{ description: "Survey", quantity: "1", unitPrice: "107.500", taxRateId: vat.id }], {
      currency: "KWD", taxMode: "inclusive",
    }));
    const saved = await getQuote(data, actor.organizationId, kwd.id);
    expect([saved.subtotalMinor, saved.taxMinor, saved.totalMinor]).toEqual([107500n, 7500n, 107500n]);
  });

  it("explains every problem by line and field", async () => {
    const { actor, customer, vat } = await workspace();
    expect(
      await fields(createQuote(data, actor, input(customer.id, [
        { description: "", quantity: "0", unitPrice: "10.5" },
        { description: "Ok", quantity: "1.2345", unitPrice: "-1", taxRateId: "nope" },
        { description: "Too much off", quantity: "1", unitPrice: "100", discountKind: "fixed", discount: "150" },
      ], { currency: "JPY", expiresOn: "2026-11-01" }))),
    ).toEqual({
      expiresOn: "cannot be before the issue date",
    });
    expect(
      await fields(createQuote(data, actor, input(customer.id, [
        { description: "", quantity: "0", unitPrice: "10.5" },
        { description: "Ok", quantity: "1.2345", unitPrice: "abc", taxRateId: "nope" },
      ], { currency: "JPY" }))),
    ).toEqual({
      "lines.1.description": "is required",
      "lines.2.quantity": "must be a number above zero with up to 3 decimals",
      "lines.2.unitPrice": "must be an amount such as 1500 or 1500.50",
      "lines.2.taxRateId": "is not an active tax rate",
    });
    expect(
      await fields(createQuote(data, actor, input(customer.id, [{ description: "X", quantity: "1", unitPrice: "10.5" }], { currency: "JPY" }))),
    ).toEqual({ "lines.1.unitPrice": "has too many decimal places for JPY" });
    expect(
      await fields(createQuote(data, actor, input(customer.id, [{ description: "X", quantity: "1", unitPrice: "100", discountKind: "fixed", discount: "150" }]))),
    ).toEqual({ "lines.1.discount": "is more than the line amount" });
    expect(await fields(createQuote(data, actor, input(customer.id, [])))).toEqual({ lines: "needs at least one line" });
    expect(await fields(createQuote(data, actor, input(customer.id, [{ description: "X", quantity: "1", unitPrice: "1" }], { currency: "ABC" })))).toEqual({
      currency: "must be a supported ISO 4217 currency code",
    });
  });

  it("saves draft edits from the right version, keeping a rate archived since it was added", async () => {
    const { actor, customer, vat } = await workspace();
    const quote = await createQuote(data, actor, input(customer.id, [{ description: "A", quantity: "1", unitPrice: "100", taxRateId: vat.id }]));
    await updateTaxRate(data, actor, vat.id, { name: "VAT", rate: "7.5" });
    await setTaxRateArchived(data, actor, vat.id, true);
    // The draft keeps its copied rate; a new quote cannot use the archived rate.
    const edited = await updateDraft(data, actor, quote.id, 1, input(customer.id, [
      { description: "A", quantity: "2", unitPrice: "100", taxRateId: vat.id },
    ]));
    expect(edited.version).toBe(2);
    expect(edited.totalMinor).toBe(21500n);
    await expect(updateDraft(data, actor, quote.id, 1, input(customer.id, [{ description: "B", quantity: "1", unitPrice: "1" }]))).rejects.toThrow(RecordConflictError);
    expect(await fields(createQuote(data, actor, input(customer.id, [{ description: "A", quantity: "1", unitPrice: "1", taxRateId: vat.id }])))).toEqual({
      "lines.1.taxRateId": "is not an active tax rate",
    });
  });
});

describe("numbering", () => {
  it("hands out padded numbers in order, never twice, following the settings", async () => {
    const { actor, customer } = await workspace();
    const line = [{ description: "A", quantity: "1", unitPrice: "1" }];
    const quotes = await Promise.all(Array.from({ length: 6 }, () => createQuote(data, actor, input(customer.id, line))));
    expect(quotes.map((q) => q.number).sort()).toEqual(["Q-0001", "Q-0002", "Q-0003", "Q-0004", "Q-0005", "Q-0006"]);

    await updateQuoteNumbering(data, actor, { prefix: "MD/2026/", nextNumber: "40", padding: "3" });
    expect((await createQuote(data, actor, input(customer.id, line))).number).toBe("MD/2026/040");
    expect(await quoteNumbering(data, actor.organizationId)).toEqual({ prefix: "MD/2026/", nextNumber: 41, padding: 3 });

    // Moving the sequence back skips numbers already used.
    await updateQuoteNumbering(data, actor, { prefix: "Q-", nextNumber: "5", padding: "4" });
    expect((await createQuote(data, actor, input(customer.id, line))).number).toBe("Q-0007");
    await expect(updateQuoteNumbering(data, actor, { prefix: "<b>", nextNumber: "0", padding: "4" })).rejects.toThrow(InputValidationError);
  });
});

describe("sending and revisions", () => {
  it("fixes a sent quote; a revision supersedes it when sent; accepted quotes are final", async () => {
    const { actor, customer, vat } = await workspace();
    const quote = await createQuote(data, actor, input(customer.id, [{ description: "A", quantity: "1", unitPrice: "100", taxRateId: vat.id }]));
    const sent = await sendQuote(data, actor, quote.id, 1, today);
    expect(sent).toMatchObject({ status: "sent", sentAt: expect.any(Date) });

    // Later customer edits do not change the sent snapshot.
    await updateCustomer(data, actor, customer.id, 1, { type: "organization", displayName: "Okafor Farms Ltd" });
    expect((await getQuote(data, actor.organizationId, quote.id)).customerSnapshot).toMatchObject({ name: "Okafor Farms" });
    await expect(updateDraft(data, actor, quote.id, sent.version, input(customer.id, [{ description: "B", quantity: "1", unitPrice: "1" }]))).rejects.toThrow(
      RecordConflictError,
    );
    await expect(deleteDraft(data, actor, quote.id)).rejects.toThrow(RecordConflictError);

    // The database refuses changes to a sent quote whatever code runs.
    const tenant = data.scoped(actor.organizationId);
    await expect(tenant.quote.update({ where: { id: quote.id }, data: { totalMinor: 1n } })).rejects.toThrow(/cannot change/);
    await expect(tenant.quoteItem.updateMany({ where: { quoteId: quote.id }, data: { unitPriceMinor: 1n } })).rejects.toThrow(/cannot change/);
    await expect(tenant.quote.update({ where: { id: quote.id }, data: { status: "draft" } })).rejects.toThrow(/cannot go from sent to draft/);
    await expect(tenant.quote.delete({ where: { id: quote.id } })).rejects.toThrow(/cannot be deleted/);

    const revision = await reviseQuote(data, actor, quote.id, { today: "2026-11-20" });
    expect(revision).toMatchObject({ number: "Q-0001", revision: 2, previousId: quote.id, status: "draft" });
    expect(revision.issuedOn).toEqual(new Date("2026-11-20T00:00:00Z"));
    expect(revision.expiresOn).toEqual(new Date("2026-12-20T00:00:00Z"));
    await expect(reviseQuote(data, actor, quote.id, today)).rejects.toThrow(/newer draft revision/);
    await expect(updateDraft(data, actor, revision.id, 1, input("other", [{ description: "B", quantity: "1", unitPrice: "1" }]))).rejects.toThrow(
      InputValidationError,
    );
    await updateDraft(data, actor, revision.id, 1, input(customer.id, [{ description: "A", quantity: "1", unitPrice: "90", taxRateId: vat.id }]));

    await sendQuote(data, actor, revision.id, 2, today);
    const history = await getQuote(data, actor.organizationId, revision.id);
    expect(history.revisions.map((r) => [r.revision, r.status])).toEqual([[2, "sent"], [1, "superseded"]]);
    expect((await listQuotes(data, actor.organizationId, { status: "all" })).items.map((q) => q.revision)).toEqual([2]);

    // Accept revision 2 (as the public page will), then nothing can revise it.
    await tenant.quote.update({ where: { id: revision.id }, data: { status: "accepted", acceptedAt: new Date() } });
    await expect(reviseQuote(data, actor, revision.id, today)).rejects.toThrow(/was accepted/);
    await expect(tenant.quote.update({ where: { id: revision.id }, data: { status: "rejected", rejectedAt: new Date() } })).rejects.toThrow(
      /cannot go from accepted/,
    );
  });

  it("refuses to send an expired draft and deletes drafts", async () => {
    const { actor, customer } = await workspace();
    const quote = await createQuote(data, actor, input(customer.id, [{ description: "A", quantity: "1", unitPrice: "1" }], {
      issuedOn: "2026-10-01", expiresOn: "2026-10-31",
    }));
    expect(await fields(sendQuote(data, actor, quote.id, 1, today))).toEqual({ expiresOn: "has passed; choose a later date" });
    await deleteDraft(data, actor, quote.id);
    await expect(getQuote(data, actor.organizationId, quote.id)).rejects.toThrow(RecordNotFoundError);
  });

  it("duplicates into a new numbered draft dated today", async () => {
    const { actor, customer } = await workspace();
    const quote = await createQuote(data, actor, input(customer.id, [{ description: "A", quantity: "2", unitPrice: "50" }], {
      issuedOn: "2026-10-01", expiresOn: "2026-10-15",
    }));
    const copy = await duplicateQuote(data, actor, quote.id, today);
    expect(copy).toMatchObject({ number: "Q-0002", revision: 1, status: "draft", totalMinor: 10000n });
    expect([copy.issuedOn, copy.expiresOn]).toEqual([new Date("2026-11-12T00:00:00Z"), new Date("2026-11-26T00:00:00Z")]);
    expect((await getQuote(data, actor.organizationId, copy.id)).items).toHaveLength(1);
  });

  it("shows viewed and expired from dates, not stored states", () => {
    const base = { status: "sent", viewedAt: null, expiresOn: new Date("2026-11-30T00:00:00Z") };
    expect(displayStatus(base, "2026-11-12")).toBe("sent");
    expect(displayStatus({ ...base, viewedAt: new Date() }, "2026-11-12")).toBe("viewed");
    expect(displayStatus(base, "2026-12-01")).toBe("expired");
    expect(displayStatus({ ...base, status: "accepted" }, "2026-12-01")).toBe("accepted");
  });
});

describe("workspace isolation", () => {
  it("never quotes another workspace's customer, product, tax rate or lead, nor reads its quotes", async () => {
    const mine = await workspace();
    const theirs = await workspace("other");
    const product = await createProduct(data, theirs.actor, { name: "Theirs" });
    expect(
      await fields(createQuote(data, mine.actor, input(theirs.customer.id, [
        { productId: product.id, description: "X", quantity: "1", unitPrice: "1", taxRateId: theirs.vat.id },
      ], { leadId: "unknown" }))),
    ).toEqual({
      customerId: "is not a customer of this workspace",
      leadId: "is not a lead of this workspace",
      "lines.1.taxRateId": "is not an active tax rate",
      "lines.1.productId": "is not an active product",
    });

    const quote = await createQuote(data, theirs.actor, input(theirs.customer.id, [{ description: "Secret", quantity: "1", unitPrice: "1" }]));
    await expect(getQuote(data, mine.actor.organizationId, quote.id)).rejects.toThrow(RecordNotFoundError);
    await expect(sendQuote(data, mine.actor, quote.id, 1, today)).rejects.toThrow(RecordNotFoundError);
    await expect(reviseQuote(data, mine.actor, quote.id, today)).rejects.toThrow(RecordNotFoundError);
    await expect(duplicateQuote(data, mine.actor, quote.id, today)).rejects.toThrow(RecordNotFoundError);
    await expect(deleteDraft(data, mine.actor, quote.id)).rejects.toThrow(RecordNotFoundError);
    expect((await listQuotes(data, mine.actor.organizationId, { status: "all" })).items).toEqual([]);
    // Each workspace numbers its own quotes.
    expect((await createQuote(data, mine.actor, input(mine.customer.id, [{ description: "A", quantity: "1", unitPrice: "1" }]))).number).toBe("Q-0001");
  });
});
