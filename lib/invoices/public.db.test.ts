import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createCustomer } from "@/lib/customers/service";
import { createMemoryEmailSender, unconfiguredEmailSender } from "@/lib/email";
import { RecordConflictError } from "@/lib/errors";
import { recordPayment } from "@/lib/payments/service";
import { createTenantData } from "@/lib/tenant/core";
import { createPublicLinks } from "@/lib/tenant/public";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { invoiceForDownload, openInvoice } from "./public";
import { createInvoice, getInvoice, issueInvoice, voidInvoice } from "./service";
import { createInvoiceLink, emailInvoice, invoiceActivity, revokeInvoiceLinks } from "./sharing";

const db = createTestDb();
const data = createTenantData(db);
const links = createPublicLinks(db);
const visitor = { ipAddress: "203.0.113.9", userAgent: "Test browser" };
let clock = new Date("2026-11-12T10:00:00Z");
const deps = () => ({ data, links, now: () => clock });

beforeEach(async () => {
  clock = new Date("2026-11-12T10:00:00Z");
  await resetDatabase();
});
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

async function setup() {
  const organizationId = randomUUID();
  await db.organization.create({
    data: {
      id: organizationId, name: "Sun Power", slug: `sun-${organizationId.slice(0, 8)}`,
      baseCurrency: "GHS", countryCode: "GH", locale: "en-GH", timezone: "Africa/Accra", defaultLanguage: "en",
    },
  });
  const userId = randomUUID();
  await db.user.create({ data: { id: userId, name: "Ama", email: `${userId}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId, userId, role: "owner" } });
  const actor = { organizationId, userId };
  const customer = await createCustomer(data, actor, { type: "organization", displayName: "Mensah Traders", email: "accounts@mensah.gh" });
  const draft = await createInvoice(data, actor, {
    customerId: customer.id, currency: "GHS", taxMode: "exclusive", issuedOn: "2026-11-12", dueOn: "2026-11-30",
    lines: [{ description: "Solar lantern", quantity: "10", unitPrice: "100" }],
  });
  return { actor, draft };
}

describe("invoice links", () => {
  it("shares issued invoices only, records the first view and views per half hour, and stops when revoked", async () => {
    const { actor, draft } = await setup();
    await expect(createInvoiceLink(data, actor, draft.id)).rejects.toThrow(RecordConflictError);
    await issueInvoice(data, actor, draft.id, 1);
    const { token } = await createInvoiceLink(data, actor, draft.id);

    expect(await openInvoice(deps(), "x".repeat(43), visitor)).toEqual({ state: "invalid" });
    expect(await openInvoice(deps(), token, visitor)).toMatchObject({ state: "ready", status: "viewed", seller: { name: "Sun Power" } });
    await openInvoice(deps(), token, visitor);
    clock = new Date(clock.getTime() + 31 * 60_000);
    await openInvoice(deps(), token, visitor);
    expect((await invoiceActivity(data, actor.organizationId, draft.id)).events).toHaveLength(2);
    expect((await getInvoice(data, actor.organizationId, draft.id)).viewedAt).toEqual(new Date("2026-11-12T10:00:00Z"));

    // Without the token, the app role sees no link rows at all.
    expect(await db.invoiceLink.findMany()).toEqual([]);
    await revokeInvoiceLinks(data, actor, draft.id);
    expect(await openInvoice(deps(), token, visitor)).toEqual({ state: "invalid" });
    expect(await invoiceForDownload(deps(), token)).toBeNull();
  });

  it("shows payments and cancellation to the customer", async () => {
    const { actor, draft } = await setup();
    await issueInvoice(data, actor, draft.id, 1);
    const { token } = await createInvoiceLink(data, actor, draft.id);
    await recordPayment(data, actor, draft.id, { amount: "1000", method: "mobile_money", receivedOn: "2026-11-12" }, { today: "2026-11-12", locale: "en-GH" });
    expect(await openInvoice(deps(), token, visitor)).toMatchObject({ status: "paid", invoice: { paidMinor: 100000n } });

    const second = await setup();
    await issueInvoice(data, second.actor, second.draft.id, 1);
    const link = await createInvoiceLink(data, second.actor, second.draft.id);
    clock = new Date("2026-12-05T10:00:00Z");
    expect(await openInvoice(deps(), link.token, visitor)).toMatchObject({ status: "overdue" });
    await voidInvoice(data, second.actor, second.draft.id, "Raised twice");
    expect(await openInvoice(deps(), link.token, visitor)).toMatchObject({ state: "ready", status: "void" });
    await expect(createInvoiceLink(data, second.actor, second.draft.id)).rejects.toThrow(/void/);
  });

  it("emails a fresh link to the recipient, keeping nothing if the email fails", async () => {
    const { actor, draft } = await setup();
    await issueInvoice(data, actor, draft.id, 1);
    const email = createMemoryEmailSender();
    await emailInvoice(data, actor, draft.id, { appUrl: "https://momentumdesk.app", seller: "Sun Power", locale: "en-GH", email });
    const message = email.lastTo("accounts@mensah.gh")!;
    expect(message.subject).toBe("Invoice INV-0001 from Sun Power");
    expect(message.text).toContain("GH₵1,000.00, due 30 November 2026");
    const token = /\/i\/([A-Za-z0-9_-]{43})/.exec(message.text)![1];
    expect(await openInvoice(deps(), token, visitor)).toMatchObject({ state: "ready" });
    await expect(emailInvoice(data, actor, draft.id, { appUrl: "https://x.test", seller: "S", locale: "en-GH", email: unconfiguredEmailSender })).rejects.toThrow(
      /not configured/,
    );
    expect((await invoiceActivity(data, actor.organizationId, draft.id)).links).toHaveLength(1);
  });
});
