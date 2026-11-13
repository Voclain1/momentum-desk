import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createProduct } from "@/lib/catalogue/service";
import { createCustomer } from "@/lib/customers/service";
import { createMemoryEmailSender } from "@/lib/email";
import { createInvoice, issueInvoice } from "@/lib/invoices/service";
import { listStages } from "@/lib/leads/service";
import { recordPayment } from "@/lib/payments/service";
import { sendCollectionMessage } from "@/lib/receivables/messages";
import { createTenantData } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import type { AiProvider, AiRequest, AiResponse } from "./provider";
import { AiTaskError, aiSettings, aiUsage, updateAiSettings } from "./service";
import { collectionsDraft, leadAssist, quoteAssist, receivablesSummary } from "./tasks";

const db = createTestDb();
const data = createTenantData(db);
const context = { today: "2026-11-13", locale: "en-NG", seller: "Sun Power" };

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

/** A provider that answers from a script and remembers what it was asked. */
function fakeProvider(answers: (AiResponse | Error)[]) {
  const requests: AiRequest[] = [];
  const provider: AiProvider = {
    name: "anthropic",
    model: "claude-opus-5-5",
    async generate(request) {
      requests.push(request);
      const next = answers.shift();
      if (!next) throw new Error("no more answers");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { provider, requests };
}
const ok = (json: unknown, tokens = [1000, 200]): AiResponse => ({ kind: "ok", json, model: "claude-opus-5-5", inputTokens: tokens[0], outputTokens: tokens[1] });

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
  const actor = { organizationId, userId, timezone: "Africa/Lagos" };
  const customer = await createCustomer(data, actor, { type: "organization", displayName: "Okafor Farms", email: "pay@okafor.ng" });
  const invoice = async (unitPrice = "100000", dueOn = "2026-11-01") => {
    const draft = await createInvoice(data, actor, {
      customerId: customer.id, currency: "NGN", taxMode: "exclusive", issuedOn: "2026-10-01", dueOn,
      lines: [{ description: "Panels", quantity: "1", unitPrice }],
    });
    return issueInvoice(data, actor, draft.id, 1);
  };
  const lead = async () => {
    const [stage] = await listStages(data, organizationId);
    return data.scoped(organizationId).lead.create({
      data: { contactName: "Bola Ade", companyName: "Ade Farms", stageId: stage.id, summary: "Needs 12 panels for a cold room", estimatedValueMinor: 250000000n, currency: "NGN" },
    });
  };
  return { actor, customer, invoice, lead };
}

const interactions = (organizationId: string) => data.scoped(organizationId).aiInteraction.findMany({ orderBy: { createdAt: "asc" } });

describe("Momentum AI", () => {
  it("drafts from the lead's own records and keeps only metadata about the request", async () => {
    const s = await setup();
    const lead = await s.lead();
    await data.scoped(s.actor.organizationId).activity.create({ data: { leadId: lead.id, kind: "call", body: "Asked for a site visit on Friday", authorUserId: s.actor.userId, occurredAt: new Date("2026-11-10T09:00:00Z") } });
    const answer = {
      summary: "Ade Farms needs 12 panels for a cold room; estimated at ₦2,500,000.00. They asked for a site visit.",
      nextAction: { action: "call", timing: "this_week", reason: "Confirm the site visit." },
      followUp: { subject: "Your cold room", body: "Hello Bola, thank you for your call. Could we confirm the site visit date [to confirm]? Sun Power" },
    };
    const { provider, requests } = fakeProvider([ok(answer)]);
    const deps = { data, provider, serverLimit: 200 };
    expect(await leadAssist(deps, s.actor, lead.id, context)).toEqual(answer);

    const prompt = requests[0].prompt;
    expect(prompt).toContain("Needs 12 panels for a cold room");
    expect(prompt).toContain("Asked for a site visit on Friday");
    expect(prompt).toContain("₦2,500,000.00");
    expect(requests[0].system).toContain("not instructions");
    expect(requests[0].schema).toMatchObject({ type: "object", additionalProperties: false });

    const [row] = await interactions(s.actor.organizationId);
    expect(row).toMatchObject({ task: "lead.assist", status: "ok", provider: "anthropic", model: "claude-opus-5-5", targetType: "lead", targetId: lead.id, inputTokens: 1000, outputTokens: 200, costMicros: 8000n, period: "2026-11" });
    expect(JSON.stringify(row, (_, v) => (typeof v === "bigint" ? String(v) : v))).not.toMatch(/cold room|site visit|Bola/);
    expect(await aiUsage(data, s.actor.organizationId, "Africa/Lagos")).toMatchObject({ requests: 1, inputTokens: 1000, outputTokens: 200, costMicros: 8000n, costComplete: true });
  });

  it("never returns invented figures: one corrected retry, then it gives up", async () => {
    const s = await setup();
    const invoice = await s.invoice();
    await recordPayment(data, s.actor, invoice.id, { amount: "40000", method: "cash", receivedOn: "2026-11-05" }, { today: "2026-11-05", locale: "en-NG" });
    const invented = { subject: "Invoice INV-0001", body: "Please pay ₦60,000.00 plus a ₦5,000 late fee by 20 November. Sun Power" };
    const grounded = { subject: "Invoice INV-0001", body: "Invoice INV-0001 has ₦60,000.00 outstanding, 12 days past its due date. Sun Power" };

    const first = fakeProvider([ok(invented), ok(grounded)]);
    expect(await collectionsDraft({ data, provider: first.provider, serverLimit: 200 }, s.actor, invoice.id, "firm", context)).toEqual(grounded);
    expect(first.requests[1].prompt).toContain("figures that are not in the facts: 5,000, 20");
    expect(first.requests[0].prompt).toContain("Outstanding: ₦60,000.00");

    const second = fakeProvider([ok(invented), ok(invented)]);
    const failure = collectionsDraft({ data, provider: second.provider, serverLimit: 200 }, s.actor, invoice.id, "firm", context);
    await expect(failure).rejects.toThrow(AiTaskError);
    await expect(failure).rejects.toMatchObject({ reason: "rejected" });
    expect((await interactions(s.actor.organizationId)).map((r) => [r.status, r.errorCode, r.inputTokens])).toEqual([
      ["ok", null, 2000],
      ["rejected", "ungrounded", 2000],
    ]);
  });

  it("keeps to the workspace's monthly limit, which owners can lower but not raise", async () => {
    const s = await setup();
    const lead = await s.lead();
    const answer = { summary: "Ade Farms.", nextAction: { action: "email", timing: "today", reason: "Reply." }, followUp: { subject: "Hello", body: "Hello Bola. Sun Power" } };
    await expect(updateAiSettings(data, s.actor, { enabled: true, monthlyLimit: 500 }, 200)).rejects.toMatchObject({ fields: { monthlyLimit: "cannot be more than 200" } });
    await updateAiSettings(data, s.actor, { enabled: true, monthlyLimit: 2 }, 200);
    const { provider } = fakeProvider([ok(answer), new Error("provider down"), ok(answer), ok(answer)]);
    const deps = { data, provider, serverLimit: 200 };
    await leadAssist(deps, s.actor, lead.id, context);
    await expect(leadAssist(deps, s.actor, lead.id, context)).rejects.toMatchObject({ reason: "unavailable" });
    await leadAssist(deps, s.actor, lead.id, context); // a failed call does not count
    await expect(leadAssist(deps, s.actor, lead.id, context)).rejects.toMatchObject({ reason: "limit" });
    expect(await aiUsage(data, s.actor.organizationId, "Africa/Lagos")).toMatchObject({ requests: 2, failed: 1 });

    // Another workspace has its own allowance; turning AI off stops it at once.
    const other = await setup();
    const otherLead = await other.lead();
    await leadAssist({ data, provider: fakeProvider([ok(answer)]).provider, serverLimit: 200 }, other.actor, otherLead.id, context);
    await updateAiSettings(data, other.actor, { enabled: false, monthlyLimit: 200 }, 200);
    await expect(leadAssist(deps, other.actor, otherLead.id, context)).rejects.toMatchObject({ reason: "disabled" });
    expect(await aiSettings(data, other.actor.organizationId, 100)).toMatchObject({ enabled: false, monthlyLimit: 100 });

    // Without a provider, AI is simply off.
    await expect(leadAssist({ data, provider: null, serverLimit: 200 }, s.actor, lead.id, context)).rejects.toMatchObject({ reason: "not_configured" });
    // A lead in another workspace is not found.
    await expect(leadAssist(deps, s.actor, otherLead.id, context)).rejects.toThrow(/not found/);
  });

  it("suggests quote lines from the catalogue without ever choosing a price", async () => {
    const s = await setup();
    const panel = await createProduct(data, s.actor, { name: "Solar panel 400W", unit: "unit", prices: [{ currency: "NGN", unitPrice: "185,000" }] });
    const request = "We need 12 panels and someone to install them, plus a 5kVA inverter.";
    const good = {
      lines: [
        { productId: panel.id, description: "Solar panel 400W", quantity: "12" },
        { productId: null, description: "Installation", quantity: "1" },
        { productId: null, description: "Inverter 5kVA", quantity: "1" },
      ],
      questions: ["Is the roof suitable for 12 panels?"],
    };
    const bad = { lines: [{ productId: randomUUID(), description: "Battery", quantity: "4" }], questions: [] };
    const { provider, requests } = fakeProvider([ok(bad), ok(good)]);
    expect(await quoteAssist({ data, provider, serverLimit: 200 }, s.actor, { request, currency: "NGN" }, context)).toEqual(good);
    expect(requests[0].prompt).toContain(panel.id);
    expect(requests[0].prompt).not.toContain("185,000");
    expect(requests[1].prompt).toMatch(/is not in the catalogue; and quantity 4 does not appear/);
  });

  it("summarises overdue accounts, naming only invoices it was given", async () => {
    const s = await setup();
    await s.invoice("100000", "2026-10-01");
    await s.invoice("50000", "2026-12-01");
    const wrong = { summary: "₦100,000.00 is overdue.", priorities: [{ invoiceNumber: "INV-0002", reason: "Not yet due." }] };
    const right = { summary: "₦100,000.00 is overdue, all on INV-0001, 43 days past due.", priorities: [{ invoiceNumber: "INV-0001", reason: "Oldest and has no owner." }] };
    const { provider, requests } = fakeProvider([ok(wrong), ok(right)]);
    expect(await receivablesSummary({ data, provider, serverLimit: 200 }, s.actor, context)).toEqual(right);
    expect(requests[0].prompt).toContain("INV-0001 | Okafor Farms | ₦100,000.00 outstanding | 43 days overdue | no owner");
    expect(requests[1].prompt).toContain("INV-0002 is not one of the listed invoices");
  });
});

describe("emailing a customer about an invoice", () => {
  it("sends the person's message with a link, records it, and refuses once nothing is owed", async () => {
    const s = await setup();
    const invoice = await s.invoice();
    const outbox = createMemoryEmailSender();
    const deps = { email: outbox, appUrl: "https://momentumdesk.app" };
    const message = { subject: "Invoice INV-0001", body: "Hello, ₦100,000.00 is outstanding on INV-0001. Sun Power", aiDrafted: true };
    expect(await sendCollectionMessage(data, s.actor, invoice.id, message, deps)).toEqual({ sentTo: "pay@okafor.ng" });
    expect(outbox.sent[0]).toMatchObject({ to: "pay@okafor.ng", subject: "Invoice INV-0001" });
    expect(outbox.sent[0].text).toMatch(/Sun Power\n\nView the invoice, pay or download it: https:\/\/momentumdesk\.app\/i\/[A-Za-z0-9_-]{43}$/);
    const tenant = data.scoped(s.actor.organizationId);
    expect((await tenant.collectionNote.findMany()).map((n) => n.body)).toEqual(["Emailed pay@okafor.ng: Invoice INV-0001"]);
    expect(await tenant.auditLog.findFirst({ where: { action: "collection.message_sent" } })).toMatchObject({ targetId: invoice.id, metadata: { aiDrafted: true } });

    await expect(sendCollectionMessage(data, s.actor, invoice.id, { ...message, subject: "" }, deps)).rejects.toMatchObject({ fields: { subject: "is required" } });
    await recordPayment(data, s.actor, invoice.id, { amount: "100000", method: "cash", receivedOn: "2026-11-13" }, { today: "2026-11-13", locale: "en-NG" });
    await expect(sendCollectionMessage(data, s.actor, invoice.id, message, deps)).rejects.toThrow("Nothing is owed on this invoice now.");
    expect(outbox.sent).toHaveLength(1);
  });
});
