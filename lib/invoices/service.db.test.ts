import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTaxRate } from "@/lib/catalogue/service";
import { createCustomer, setCustomerArchived } from "@/lib/customers/service";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { recordPayment, voidPayment } from "@/lib/payments/service";
import { createQuote, sendQuote } from "@/lib/quotes/service";
import { createTenantData } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import {
  createInvoice,
  createInvoiceFromQuote,
  deleteDraft,
  getInvoice,
  invoiceStatus,
  issueInvoice,
  listInvoices,
  setDisputed,
  updateDraft,
  updateInvoiceNumbering,
  voidInvoice,
} from "./service";

/** As the restricted app role, like the application. */
const db = createTestDb();
const data = createTenantData(db);
const today = "2026-11-12";
const ctx = { today, locale: "en-NG" };

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
  const customer = await createCustomer(data, actor, { type: "organization", displayName: "Okafor Farms", email: "billing@okafor.ng" });
  const vat = await createTaxRate(data, actor, { name: "VAT", rate: "7.5" });
  return { actor, customer, vat };
}

const input = (customerId: string, lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
  customerId, currency: "NGN", taxMode: "exclusive", issuedOn: today, dueOn: "2026-11-26", lines, ...extra,
});

async function issued(w: Awaited<ReturnType<typeof workspace>>, unitPrice = "100000", extra: Record<string, unknown> = {}) {
  const draft = await createInvoice(data, w.actor, input(w.customer.id, [{ description: "Panels", quantity: "1", unitPrice, taxRateId: w.vat.id }], extra));
  return issueInvoice(data, w.actor, draft.id, 1);
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

const pay = (w: Awaited<ReturnType<typeof workspace>>, invoiceId: string, amount: string, receivedOn = today) =>
  recordPayment(data, w.actor, invoiceId, { amount, method: "bank_transfer", receivedOn, reference: "TRF-1" }, ctx);

describe("issuing", () => {
  it("numbers invoices only when issued, in order and without gaps, and fixes them", async () => {
    const w = await workspace();
    const drafts = await Promise.all(
      Array.from({ length: 5 }, () => createInvoice(data, w.actor, input(w.customer.id, [{ description: "A", quantity: "1", unitPrice: "1" }]))),
    );
    expect(drafts.every((d) => d.number === null)).toBe(true);
    const numbers = (await Promise.all(drafts.map((d) => issueInvoice(data, w.actor, d.id, 1)))).map((i) => i.number).sort();
    expect(numbers).toEqual(["INV-0001", "INV-0002", "INV-0003", "INV-0004", "INV-0005"]);

    // A failed issue uses no number.
    const failing = await createInvoice(data, w.actor, input(w.customer.id, [{ description: "A", quantity: "1", unitPrice: "1" }]));
    await setCustomerArchived(data, w.actor, w.customer.id, true);
    expect(await fields(issueInvoice(data, w.actor, failing.id, 1))).toEqual({ customerId: "is archived" });
    await setCustomerArchived(data, w.actor, w.customer.id, false);
    await updateInvoiceNumbering(data, w.actor, { prefix: "MD-", nextNumber: "6", padding: "5" });
    expect((await issueInvoice(data, w.actor, failing.id, 1)).number).toBe("MD-00006");

    const tenant = data.scoped(w.actor.organizationId);
    const invoice = drafts[0];
    await expect(tenant.invoice.update({ where: { id: invoice.id }, data: { totalMinor: 1n } })).rejects.toThrow(/cannot change/);
    await expect(tenant.invoiceItem.updateMany({ where: { invoiceId: invoice.id }, data: { unitPriceMinor: 5n } })).rejects.toThrow(/cannot change/);
    await expect(tenant.invoice.update({ where: { id: invoice.id }, data: { paidMinor: 1n } })).rejects.toThrow(/kept by payment allocations/);
    await expect(tenant.invoice.delete({ where: { id: invoice.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(updateDraft(data, w.actor, invoice.id, 2, input(w.customer.id, [{ description: "B", quantity: "1", unitPrice: "1" }]))).rejects.toThrow(
      RecordConflictError,
    );
  });

  it("explains invalid drafts by line and keeps exact totals", async () => {
    const w = await workspace();
    expect(await fields(createInvoice(data, w.actor, input(w.customer.id, [{ description: "X", quantity: "1", unitPrice: "10.5" }], { currency: "JPY" })))).toEqual({
      "lines.1.unitPrice": "has too many decimal places for JPY",
    });
    expect(await fields(createInvoice(data, w.actor, input(w.customer.id, [{ description: "X", quantity: "1", unitPrice: "1" }], { dueOn: "2026-11-01" })))).toEqual({
      dueOn: "cannot be before the issue date",
    });
    const kwd = await createInvoice(data, w.actor, input(w.customer.id, [{ description: "Survey", quantity: "1.5", unitPrice: "2.345", taxRateId: w.vat.id }], {
      currency: "KWD",
    }));
    // 1.5 × 2.345 = 3.5175 → 3.518; 7.5% = 0.26385 → 0.264.
    expect([kwd.subtotalMinor, kwd.taxMinor, kwd.totalMinor, kwd.outstandingMinor]).toEqual([3518n, 264n, 3782n, 3782n]);
    await deleteDraft(data, w.actor, kwd.id);
    await expect(getInvoice(data, w.actor.organizationId, kwd.id)).rejects.toThrow(RecordNotFoundError);
  });
});

describe("from an accepted quote", () => {
  it("copies the accepted lines and totals verbatim, once", async () => {
    const w = await workspace();
    const quote = await createQuote(data, w.actor, {
      customerId: w.customer.id, currency: "NGN", taxMode: "exclusive", issuedOn: today, expiresOn: "2026-12-12",
      lines: [
        { description: "Panels", quantity: "2", unitPrice: "185000", discountKind: "percent", discount: "10", taxRateId: w.vat.id },
        { description: "Install", quantity: "6.5", unitPrice: "7500.50", taxRateId: w.vat.id },
      ],
      notes: "Thanks", terms: "50% deposit",
    });
    await expect(createInvoiceFromQuote(data, w.actor, quote.id, { today })).rejects.toThrow(/Only an accepted quote/);
    await sendQuote(data, w.actor, quote.id, 1, { today });
    await data.scoped(w.actor.organizationId).quote.update({ where: { id: quote.id }, data: { status: "accepted", acceptedAt: new Date() } });

    // Concurrent conversions: exactly one wins.
    const results = await Promise.allSettled([1, 2, 3].map(() => createInvoiceFromQuote(data, w.actor, quote.id, { today })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof RecordConflictError)).toBe(true);
    const invoice = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ id: string }>).value;

    const saved = await getInvoice(data, w.actor.organizationId, invoice.id);
    expect(saved).toMatchObject({ quoteId: quote.id, totalMinor: 41038474n, notes: "Thanks", terms: "50% deposit", dueOn: new Date("2026-11-26T00:00:00Z") });
    expect(saved.items.map((i) => [i.description, i.netMinor])).toEqual([["Panels", 33300000n], ["Install", 4875325n]]);

    // Only dates, recipient, notes and terms change on such a draft.
    expect(await fields(updateDraft(data, w.actor, invoice.id, 1, { ...input(w.customer.id, [{ description: "Cheaper", quantity: "1", unitPrice: "1" }]) }))).toEqual({
      "customerId, currency, taxMode, lines": "is not a known field",
    });
    await updateDraft(data, w.actor, invoice.id, 1, { issuedOn: today, dueOn: "2026-12-31", notes: "Thanks", terms: "Net 30" });
    const issuedInvoice = await issueInvoice(data, w.actor, invoice.id, 2);
    expect(issuedInvoice).toMatchObject({ number: "INV-0001", totalMinor: 41038474n, terms: "Net 30" });
  });
});

describe("payments and derived status", () => {
  it("goes issued → partly paid → paid, never overpaid, with void restoring the balance", async () => {
    const w = await workspace();
    const invoice = await issued(w); // 100,000 + 7.5% = 107,500.00
    expect(invoiceStatus(invoice, today)).toBe("issued");

    await pay(w, invoice.id, "50,000");
    let current = await getInvoice(data, w.actor.organizationId, invoice.id);
    expect([current.paidMinor, current.outstandingMinor]).toEqual([5000000n, 5750000n]);
    expect(invoiceStatus(current, today)).toBe("partially_paid");
    expect(invoiceStatus(current, "2026-11-27")).toBe("overdue");

    expect(await fields(pay(w, invoice.id, "57500.01"))).toEqual({ amount: "is more than the ₦57,500.00 still owed" });
    expect(await fields(pay(w, invoice.id, "0"))).toEqual({ amount: "must be more than zero" });
    expect(await fields(pay(w, invoice.id, "1", "2026-11-13"))).toEqual({ receivedOn: "cannot be in the future" });

    const second = await pay(w, invoice.id, "57500");
    current = await getInvoice(data, w.actor.organizationId, invoice.id);
    expect([current.paidMinor, current.outstandingMinor]).toEqual([10750000n, 0n]);
    expect(invoiceStatus(current, "2027-01-01")).toBe("paid");
    expect((await listInvoices(data, w.actor.organizationId, { status: "paid" }, today)).items.map((i) => i.id)).toEqual([invoice.id]);

    // Voiding a payment returns the balance; the payment itself stays.
    await expect(voidInvoice(data, w.actor, invoice.id, "Wrong customer")).rejects.toThrow(/has payments/);
    await voidPayment(data, w.actor, second.id, "Bounced transfer");
    current = await getInvoice(data, w.actor.organizationId, invoice.id);
    expect([current.paidMinor, current.outstandingMinor]).toEqual([5000000n, 5750000n]);
    expect(current.allocations.map((a) => [a.amountMinor, a.voidedAt !== null, a.payment.voidReason])).toEqual([
      [5000000n, false, null],
      [5750000n, true, "Bounced transfer"],
    ]);
    await expect(voidPayment(data, w.actor, second.id, "Again")).rejects.toThrow(/already void/);
  });

  it("refuses overpayment, mismatched currency or customer, and draft or void invoices in the database", async () => {
    const w = await workspace();
    const invoice = await issued(w, "1000");
    const tenant = data.scoped(w.actor.organizationId);
    const payment = await tenant.payment.create({
      data: { customerId: w.customer.id, currency: "NGN", amountMinor: 200000n, method: "cash", receivedOn: new Date(`${today}T00:00:00Z`) },
    });
    await expect(tenant.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: invoice.id, amountMinor: 200000n } })).rejects.toThrow(
      /invoice_paid_check/,
    );
    const usd = await tenant.payment.create({
      data: { customerId: w.customer.id, currency: "USD", amountMinor: 100n, method: "cash", receivedOn: new Date(`${today}T00:00:00Z`) },
    });
    await expect(tenant.paymentAllocation.create({ data: { paymentId: usd.id, invoiceId: invoice.id, amountMinor: 100n } })).rejects.toThrow(/currency/);
    const other = await createCustomer(data, w.actor, { type: "person", displayName: "Someone else" });
    const theirs = await tenant.payment.create({
      data: { customerId: other.id, currency: "NGN", amountMinor: 100n, method: "cash", receivedOn: new Date(`${today}T00:00:00Z`) },
    });
    await expect(tenant.paymentAllocation.create({ data: { paymentId: theirs.id, invoiceId: invoice.id, amountMinor: 100n } })).rejects.toThrow(/customer/);
    await expect(tenant.payment.update({ where: { id: payment.id }, data: { amountMinor: 1n } })).rejects.toThrow(/cannot change/);
    await expect(tenant.payment.delete({ where: { id: payment.id } })).rejects.toThrow(/never deleted/);

    const draft = await createInvoice(data, w.actor, input(w.customer.id, [{ description: "A", quantity: "1", unitPrice: "1" }]));
    await expect(pay(w, draft.id, "1")).rejects.toThrow(/still a draft/);
    await voidInvoice(data, w.actor, invoice.id, "Issued by mistake");
    await expect(pay(w, invoice.id, "1")).rejects.toThrow(/is void/);
    expect(invoiceStatus(await getInvoice(data, w.actor.organizationId, invoice.id), today)).toBe("void");
    await expect(tenant.invoice.update({ where: { id: invoice.id }, data: { status: "issued" } })).rejects.toThrow(/cannot go from void/);
    expect(await fields(voidInvoice(data, w.actor, (await issued(w)).id, ""))).toEqual({ reason: "is required" });
  });

  it("records payments exactly in zero- and three-decimal currencies", async () => {
    const w = await workspace();
    const jpy = await issued(w, "333", { currency: "JPY" }); // 333 + 7.5% = 24.975 → 25 → ¥358
    expect(await fields(pay(w, jpy.id, "100.5"))).toEqual({ amount: "has too many decimal places for JPY" });
    await pay(w, jpy.id, "358");
    expect(invoiceStatus(await getInvoice(data, w.actor.organizationId, jpy.id), today)).toBe("paid");
    const kwd = await issued(w, "1.235", { currency: "KWD" }); // 1.235 + 0.092625 → 0.093 = 1.328
    await pay(w, kwd.id, "1.327");
    expect((await getInvoice(data, w.actor.organizationId, kwd.id)).outstandingMinor).toBe(1n);
  });

  it("shows disputes, and lists overdue and unpaid invoices", async () => {
    const w = await workspace();
    const invoice = await issued(w);
    await setDisputed(data, w.actor, invoice.id, "Panels arrived damaged");
    expect(invoiceStatus(await getInvoice(data, w.actor.organizationId, invoice.id), "2027-01-01")).toBe("disputed");
    await setDisputed(data, w.actor, invoice.id, null);
    expect(invoiceStatus(await getInvoice(data, w.actor.organizationId, invoice.id), "2027-01-01")).toBe("overdue");
    expect((await listInvoices(data, w.actor.organizationId, { status: "overdue" }, "2027-01-01")).total).toBe(1);
    expect((await listInvoices(data, w.actor.organizationId, { status: "overdue" }, today)).total).toBe(0);
    expect((await listInvoices(data, w.actor.organizationId, { status: "unpaid" }, today)).total).toBe(1);
  });
});

describe("workspace isolation", () => {
  it("never reaches another workspace's invoices, quotes or payments", async () => {
    const mine = await workspace();
    const theirs = await workspace("other");
    const invoice = await issued(theirs);
    const payment = await pay(theirs, invoice.id, "1000");
    await expect(getInvoice(data, mine.actor.organizationId, invoice.id)).rejects.toThrow(RecordNotFoundError);
    await expect(pay(mine, invoice.id, "1")).rejects.toThrow(RecordNotFoundError);
    await expect(voidPayment(data, mine.actor, payment.id, "Not mine")).rejects.toThrow(RecordNotFoundError);
    await expect(voidInvoice(data, mine.actor, invoice.id, "Not mine")).rejects.toThrow(RecordNotFoundError);
    await expect(createInvoiceFromQuote(data, mine.actor, randomUUID(), { today })).rejects.toThrow(RecordNotFoundError);
    expect(await fields(createInvoice(data, mine.actor, input(theirs.customer.id, [{ description: "X", quantity: "1", unitPrice: "1" }])))).toMatchObject({
      customerId: "is not a customer of this workspace",
    });
    expect((await listInvoices(data, mine.actor.organizationId, { status: "all" }, today)).items).toEqual([]);
    // Numbers are per workspace.
    expect((await issued(mine)).number).toBe("INV-0001");
  });
});
