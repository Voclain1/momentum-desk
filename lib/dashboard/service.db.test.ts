import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCustomer } from "@/lib/customers/service";
import { createInvoice, issueInvoice } from "@/lib/invoices/service";
import { createLead, listStages } from "@/lib/leads/service";
import { recordPayment } from "@/lib/payments/service";
import { createQuote, sendQuote } from "@/lib/quotes/service";
import { createTenantData } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { attention, dashboardFigures, recentFlow } from "./service";

const db = createTestDb();
const data = createTenantData(db);
const today = "2026-11-20";
const all = { sales: true, quotes: true, invoices: true, payments: true, collections: true };

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

describe("the dashboard", () => {
  it("totals per currency, lists the most urgent work first, and shows only what the role may see", async () => {
    const organizationId = randomUUID();
    await db.organization.create({
      data: { id: organizationId, name: "Sun Power", slug: `sun-${organizationId.slice(0, 8)}`, baseCurrency: "NGN", countryCode: "NG", locale: "en-NG", timezone: "Africa/Lagos", defaultLanguage: "en" },
    });
    const userId = randomUUID();
    await db.user.create({ data: { id: userId, name: "Ada", email: `${userId}@example.com` } });
    await db.member.create({ data: { id: randomUUID(), organizationId, userId, role: "owner" } });
    const actor = { organizationId, userId };
    const [stage] = await listStages(data, organizationId);
    await createLead(data, actor, { contactName: "Bola", stageId: stage.id, estimatedValue: "500000", currency: "NGN", nextFollowUpOn: "2026-11-18" }, { memberIds: new Set([userId]) });
    await createLead(data, actor, { contactName: "Tom", stageId: stage.id, estimatedValue: "2000", currency: "USD" }, { memberIds: new Set([userId]) });
    const customer = await createCustomer(data, actor, { type: "organization", displayName: "Okafor Farms" });
    const invoice = async (currency: string, unitPrice: string, dueOn: string) => {
      const draft = await createInvoice(data, actor, { customerId: customer.id, currency, taxMode: "exclusive", issuedOn: "2026-10-01", dueOn, lines: [{ description: "Work", quantity: "1", unitPrice }] });
      return issueInvoice(data, actor, draft.id, 1);
    };
    const old = await invoice("NGN", "100000", "2026-10-15");
    await invoice("USD", "300", "2026-11-19");
    await invoice("NGN", "50000", "2026-11-25");
    await recordPayment(data, actor, old.id, { amount: "40000", method: "cash", receivedOn: "2026-11-05" }, { today: "2026-11-05", locale: "en-NG" });
    const quote = await createQuote(data, actor, { customerId: customer.id, currency: "NGN", taxMode: "exclusive", issuedOn: "2026-11-10", expiresOn: "2026-11-22", lines: [{ description: "Panels", quantity: "1", unitPrice: "250000" }] });
    await sendQuote(data, actor, quote.id, 1, { today: "2026-11-10" });

    const figures = await dashboardFigures(data, organizationId, today, all);
    expect(figures.pipeline).toEqual({ leads: 2, totals: [{ currency: "NGN", amountMinor: 50000000n }, { currency: "USD", amountMinor: 200000n }] });
    expect(figures.quotes).toEqual({ count: 1, totals: [{ currency: "NGN", amountMinor: 25000000n }] });
    expect(figures.invoices).toEqual({ count: 3, overdue: 2, totals: [{ currency: "NGN", amountMinor: 11000000n }, { currency: "USD", amountMinor: 30000n }] });
    expect(figures.collected).toEqual({ payments: 1, totals: [{ currency: "NGN", amountMinor: 4000000n }] });

    expect((await attention(data, organizationId, today, all)).map((i) => [i.kind, i.reason])).toEqual([
      ["Invoice", "INV-0001 is 36 days overdue"],
      ["Invoice", "INV-0002 is 1 day overdue"],
      ["Quote", "Q-0001 expires in 2 days (not opened yet)"],
      ["Invoice", "INV-0003 is due in 5 days"],
      ["Lead", "Follow-up 2 days late"],
    ]);
    expect((await recentFlow(data, organizationId)).find((f) => f.label === "Leads created")?.count).toBe(2);

    // A sales role sees the pipeline and quotes, not invoices or cash.
    const sales = { sales: true, quotes: true, invoices: false, payments: false, collections: false };
    const salesFigures = await dashboardFigures(data, organizationId, today, sales);
    expect([salesFigures.invoices, salesFigures.collected]).toEqual([null, null]);
    expect((await attention(data, organizationId, today, sales)).map((i) => i.kind)).toEqual(["Quote", "Lead"]);
  });
});
