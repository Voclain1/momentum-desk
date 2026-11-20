import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCustomer } from "@/lib/customers/service";
import { createInvoice, issueInvoice } from "@/lib/invoices/service";
import { openInvoice } from "@/lib/invoices/public";
import { createInvoiceLink } from "@/lib/invoices/sharing";
import { createLead, listStages, moveLead } from "@/lib/leads/service";
import { recordPayment } from "@/lib/payments/service";
import { createQuote, sendQuote } from "@/lib/quotes/service";
import { reviewReceivables } from "@/lib/receivables/service";
import { createTenantData } from "@/lib/tenant/core";
import { createPublicLinks } from "@/lib/tenant/public";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { metrics } from "./metrics";

const db = createTestDb();
const data = createTenantData(db);
const links = createPublicLinks(db);
const visitor = { ipAddress: null, userAgent: null };

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

async function workspace() {
  const organizationId = randomUUID();
  await db.organization.create({
    data: { id: organizationId, name: "Sun Power", slug: `sun-${organizationId.slice(0, 8)}`, baseCurrency: "NGN", countryCode: "NG", locale: "en-NG", timezone: "Africa/Lagos", defaultLanguage: "en" },
  });
  const userId = randomUUID();
  await db.user.create({ data: { id: userId, name: "Ada", email: `${userId}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId, userId, role: "owner" } });
  return { organizationId, userId, memberIds: new Set([userId]) };
}

const events = async (organizationId: string) =>
  (await data.scoped(organizationId).productEvent.findMany({ orderBy: [{ occurredAt: "asc" }, { id: "asc" }] })).map((e) => [e.name, e.entityType]);

describe("product analytics", () => {
  it("records each step of the flow once, with ids only, and turns them into the spec's metrics", async () => {
    const s = await workspace();
    const actor = { organizationId: s.organizationId, userId: s.userId };
    const stages = await listStages(data, s.organizationId);
    const stage = (key: string) => stages.find((st) => st.key === key)!.id;
    const lead = await createLead(data, actor, { contactName: "Bola Ade", stageId: stage("new") }, { memberIds: s.memberIds });
    await createLead(data, actor, { contactName: "Kemi Lawal", stageId: stage("new") }, { memberIds: s.memberIds });
    await moveLead(data, actor, lead.id, stage("qualified"));
    await moveLead(data, actor, lead.id, stage("won"));
    await moveLead(data, actor, lead.id, stage("qualified"));
    await moveLead(data, actor, lead.id, stage("won")); // won again: still one event

    const customer = await createCustomer(data, actor, { type: "organization", displayName: "Ade Farms" });
    const quote = await createQuote(data, actor, {
      customerId: customer.id, leadId: lead.id, currency: "NGN", taxMode: "exclusive", issuedOn: "2026-11-01", expiresOn: "2026-12-31",
      lines: [{ description: "Panels", quantity: "1", unitPrice: "100000" }],
    });
    await sendQuote(data, actor, quote.id, 1, { today: "2026-11-01" });

    const draft = await createInvoice(data, actor, {
      customerId: customer.id, currency: "NGN", taxMode: "exclusive", issuedOn: "2026-10-01", dueOn: "2026-10-15",
      lines: [{ description: "Survey", quantity: "1", unitPrice: "50000" }],
    });
    const invoice = await issueInvoice(data, actor, draft.id, 1);
    const { token } = await createInvoiceLink(data, actor, invoice.id);
    await openInvoice({ data, links }, token, visitor);
    await openInvoice({ data, links }, token, visitor); // a second view is not a new "first view"
    await reviewReceivables(data, s.organizationId, "2026-11-01");
    await reviewReceivables(data, s.organizationId, "2026-11-02"); // still overdue: once
    await recordPayment(data, actor, invoice.id, { amount: "20000", method: "cash", receivedOn: "2026-11-02" }, { today: "2026-11-02", locale: "en-NG" });
    await recordPayment(data, actor, invoice.id, { amount: "30000", method: "cash", receivedOn: "2026-11-05" }, { today: "2026-11-05", locale: "en-NG" });

    const recorded = await events(s.organizationId);
    expect(recorded).toHaveLength(13);
    expect(recorded).toEqual(expect.arrayContaining([
      ["lead_created", "lead"], ["lead_qualified", "lead"], ["opportunity_won", "lead"], ["quote_created", "quote"], ["quote_sent", "quote"],
      ["invoice_created", "invoice"], ["invoice_overdue", "invoice"], ["invoice_sent", "invoice"], ["invoice_viewed", "invoice"],
      ["payment_completed", "payment"], ["overdue_invoice_paid", "invoice"],
    ]));
    expect(recorded.filter(([name]) => name === "lead_created")).toHaveLength(2);
    expect(recorded.filter(([name]) => name === "payment_completed")).toHaveLength(2);
    const all = await data.scoped(s.organizationId).productEvent.findMany();
    expect(JSON.stringify(all)).not.toMatch(/Bola|Kemi|Ade Farms|50000|Panels/);
    await expect(data.scoped(s.organizationId).productEvent.updateMany({ where: {}, data: { name: "lead_created" } })).rejects.toThrow(/append-only/);

    const m = await metrics(data, s.organizationId, { from: new Date("2026-01-01"), to: new Date("2027-01-01") });
    expect(m.counts).toMatchObject({ lead_created: 2, quote_sent: 1, payment_completed: 2, invoice_overdue: 1, overdue_invoice_paid: 1 });
    expect(m.leadToQuote).toMatchObject({ leads: 2, quoted: 1, rate: 0.5 });
    expect(m.quoteAcceptance).toEqual({ sent: 1, accepted: 0, rate: 0 });
    expect(m.quoteToPayment).toEqual({ accepted: 0, paid: 0, rate: null });
    // Issued 1 October, last payment 5 November: 35 days.
    expect(m.timeToPayment).toEqual({ paidInvoices: 1, averageDays: 35 });

    // Another workspace sees none of it.
    const other = await workspace();
    expect((await metrics(data, other.organizationId, { from: new Date("2026-01-01"), to: new Date("2027-01-01") })).counts.lead_created).toBe(0);
  });
});
