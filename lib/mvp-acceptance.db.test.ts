import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryEmailSender } from "@/lib/email";
import { addManualRate } from "@/lib/fx/rates";
import { createInvoiceFromQuote, getInvoice, invoiceStatus, issueInvoice } from "@/lib/invoices/service";
import { openInvoice } from "@/lib/invoices/public";
import { createInvoiceLink } from "@/lib/invoices/sharing";
import { createJobHandlers, DAILY_JOBS } from "@/lib/jobs/handlers";
import { runDueJobs, scheduleDaily, type WorkerDeps } from "@/lib/jobs/worker";
import { convertLead } from "@/lib/leads/conversion";
import { createLead, listStages, moveLead } from "@/lib/leads/service";
import { recordPayment } from "@/lib/payments/service";
import { confirmAcceptance, openQuote, requestAcceptanceCode } from "@/lib/quotes/public";
import { createQuote, sendQuote } from "@/lib/quotes/service";
import { createShareLink } from "@/lib/quotes/sharing";
import { agingReport } from "@/lib/receivables/service";
import { remindersFor, updateReminderSettings } from "@/lib/reminders/service";
import { createTenantData } from "@/lib/tenant/core";
import { createPublicLinks } from "@/lib/tenant/public";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";

/**
 * The spec's definition of MVP success (§22), as one test: a real business
 * completes "lead captured → opportunity tracked → quote sent in the correct
 * currency → quote accepted → invoice issued → payment recorded → balance
 * reconciled → overdue reminders handled correctly", across currencies.
 * Each step uses the same services the app and the worker use.
 */

const db = createTestDb();
const data = createTenantData(db);
const links = createPublicLinks(db);
const outbox = createMemoryEmailSender();
const visitor = { ipAddress: "203.0.113.20", userAgent: "acceptance" };

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

async function runWorkerOn(day: string) {
  const now = new Date(`${day}T08:00:00Z`);
  const handlers = createJobHandlers({
    organization: async () => ({ name: "Kano Solar", baseCurrency: "NGN", timezone: "Africa/Lagos", locale: "en-NG" }),
    email: outbox, appUrl: "https://momentumdesk.app", fxProviderKey: undefined,
    http: async () => ({ status: 500, json: async () => ({}) }),
  });
  const deps: WorkerDeps = { db, data, handlers, daily: DAILY_JOBS, workerId: "acceptance", now: () => now };
  await scheduleDaily(deps);
  while ((await runDueJobs(deps)).ran > 0);
}

describe("MVP success (spec §22)", () => {
  it("takes a real lead to cash in a foreign currency, with reminders that stop once paid", async () => {
    const organizationId = randomUUID();
    await db.organization.create({
      data: { id: organizationId, name: "Kano Solar", slug: `kano-${organizationId.slice(0, 8)}`, baseCurrency: "NGN", countryCode: "NG", locale: "en-NG", timezone: "Africa/Lagos", defaultLanguage: "en" },
    });
    const userId = randomUUID();
    await db.user.create({ data: { id: userId, name: "Amina", email: `${userId}@example.com` } });
    await db.member.create({ data: { id: randomUUID(), organizationId, userId, role: "owner" } });
    const actor = { organizationId, userId, timezone: "Africa/Lagos" };
    const memberIds = new Set([userId]);
    const stages = await listStages(data, organizationId);
    const stage = (key: string) => stages.find((s) => s.key === key)!.id;

    // Real lead captured, opportunity tracked: a UK buyer, priced in US dollars.
    const lead = await createLead(data, actor, {
      contactName: "Jane Hart", companyName: "Hart Imports Ltd", email: "jane@hart-imports.example", stageId: stage("new"),
      estimatedValue: "4,800", currency: "USD", source: "referral",
    }, { memberIds });
    await moveLead(data, actor, lead.id, stage("qualified"));
    const { customerId } = await convertLead(data, actor, lead.id, { mode: "new" });

    // Quote sent in the correct currency, to the contact the lead became (as the builder picks by default).
    const [contact] = await data.scoped(organizationId).contact.findMany({ where: { customerId } });
    expect(contact.email).toBe("jane@hart-imports.example");
    const quote = await createQuote(data, actor, {
      customerId, recipientContactId: contact.id, leadId: lead.id, currency: "USD", taxMode: "exclusive", issuedOn: "2026-11-02", expiresOn: "2026-11-30",
      lines: [{ description: "Solar panel 400W", quantity: "12", unitPrice: "320" }, { description: "Installation", quantity: "1", unitPrice: "960" }],
    });
    expect([quote.currency, quote.totalMinor]).toEqual(["USD", 480000n]);
    await sendQuote(data, actor, quote.id, 1, { today: "2026-11-02" });
    await moveLead(data, actor, lead.id, stage("proposal"));
    const { token } = await createShareLink(data, actor, quote.id);

    // Quote accepted by the customer, confirmed by an emailed code.
    const publicDeps = { data, links, email: outbox, now: () => new Date("2026-11-03T10:00:00Z") };
    expect(await openQuote(publicDeps, token, visitor)).toMatchObject({ state: "ready" });
    const asked = await requestAcceptanceCode(publicDeps, token, { name: "Jane Hart" }, visitor);
    expect(asked).toMatchObject({ ok: true });
    const code = /(\d{6})/.exec(outbox.lastTo("jane@hart-imports.example")!.subject)![1];
    expect(await confirmAcceptance(publicDeps, token, { code }, visitor)).toMatchObject({ ok: true });
    await moveLead(data, actor, lead.id, stage("won"));

    // Invoice issued from the accepted quote: same currency, same amounts.
    const draft = await createInvoiceFromQuote(data, actor, quote.id, { today: "2026-11-03", dueInDays: 14 });
    const invoice = await issueInvoice(data, actor, draft.id, 1);
    expect([invoice.number, invoice.currency, invoice.totalMinor, invoice.dueOn.toISOString().slice(0, 10)]).toEqual(["INV-0001", "USD", 480000n, "2026-11-17"]);
    const { token: invoiceToken } = await createInvoiceLink(data, actor, invoice.id);
    expect(await openInvoice({ data, links }, invoiceToken, visitor)).toMatchObject({ state: "ready" });

    // Part payment received; the balance is reconciled to the cent.
    await recordPayment(data, actor, invoice.id, { amount: "1,800", method: "bank_transfer", receivedOn: "2026-11-10", reference: "HART-001" }, { today: "2026-11-10", locale: "en-NG" });
    let current = await getInvoice(data, organizationId, invoice.id);
    expect([current.paidMinor, current.outstandingMinor, invoiceStatus(current, "2026-11-10")]).toEqual([180000n, 300000n, "partially_paid"]);

    // Receivables in base currency need a dated rate; without one, they say so.
    let aging = await agingReport(data, organizationId, { today: "2026-11-18", baseCurrency: "NGN" });
    expect(aging.inBase).toMatchObject({ complete: false, missing: ["USD"] });
    await addManualRate(data, actor, "NGN", { quote: "USD", rate: "1550", effectiveOn: "2026-11-18" }, "2026-11-18");
    aging = await agingReport(data, organizationId, { today: "2026-11-18", baseCurrency: "NGN" });
    expect(aging.inBase.totals.total).toBe(465000000n); // $3,000 × 1,550 = ₦4,650,000

    // Overdue reminders handled correctly: one goes out stating what is owed now, then they stop once paid.
    await updateReminderSettings(data, actor, { enabled: true, minGapDays: 3 });
    await runWorkerOn("2026-11-18"); // 1 day overdue
    const reminders = outbox.sent.filter((m) => m.subject.startsWith("Reminder: invoice INV-0001"));
    expect(reminders.map((m) => m.subject)).toEqual(["Reminder: invoice INV-0001, US$3,000.00 outstanding"]);
    await recordPayment(data, actor, invoice.id, { amount: "3,000", method: "bank_transfer", receivedOn: "2026-11-20", reference: "HART-002" }, { today: "2026-11-20", locale: "en-NG" });
    current = await getInvoice(data, organizationId, invoice.id);
    expect([current.outstandingMinor, invoiceStatus(current, "2026-11-20")]).toEqual([0n, "paid"]);
    await runWorkerOn("2026-11-24"); // +7 days: paid, so nothing more
    await runWorkerOn("2026-12-17"); // +30 days: still nothing
    expect(outbox.sent.filter((m) => m.subject.startsWith("Reminder: invoice INV-0001"))).toHaveLength(1);
    expect((await remindersFor(data, organizationId, invoice.id)).map((r) => [r.offsetDays, r.status, r.reason])).toEqual(
      expect.arrayContaining([[1, "sent", null]]),
    );

    // The whole journey is in the workspace's metrics.
    const events = (await data.scoped(organizationId).productEvent.findMany()).map((e) => e.name);
    for (const name of ["lead_created", "lead_qualified", "opportunity_won", "quote_sent", "quote_viewed", "quote_accepted", "invoice_created", "invoice_sent", "invoice_viewed", "payment_completed", "invoice_overdue", "reminder_sent", "overdue_invoice_paid"]) {
      expect(events, name).toContain(name);
    }
  });
});
