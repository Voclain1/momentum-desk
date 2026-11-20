import { randomUUID } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { createCustomer } from "@/lib/customers/service";
import { createInvoice, issueInvoice } from "@/lib/invoices/service";
import { recordPayment } from "@/lib/payments/service";
import { createQuote, sendQuote } from "@/lib/quotes/service";
import { createTenantData } from "@/lib/tenant/core";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { exportWorkspace } from "./workspace-export";

const db = createTestDb();
const data = createTenantData(db);

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

async function workspace(name: string) {
  const organizationId = randomUUID();
  await db.organization.create({
    data: { id: organizationId, name, slug: `${name.toLowerCase().replace(/ /g, "-")}-${organizationId.slice(0, 6)}`, baseCurrency: "NGN", countryCode: "NG", locale: "en-NG", timezone: "Africa/Lagos", defaultLanguage: "en" },
  });
  const userId = randomUUID();
  await db.user.create({ data: { id: userId, name: "Ada", email: `${userId}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId, userId, role: "owner" } });
  return { organizationId, userId };
}

describe("workspace export", () => {
  it("contains every record as CSV with amounts and currencies, PDFs of issued documents, and nothing of other workspaces", async () => {
    const actor = await workspace("Sun Power");
    const customer = await createCustomer(data, actor, { type: "organization", displayName: "Okafor Farms", email: "pay@okafor.ng" });
    const quote = await createQuote(data, actor, { customerId: customer.id, currency: "NGN", taxMode: "exclusive", issuedOn: "2026-11-01", expiresOn: "2026-12-01", lines: [{ description: "Panels", quantity: "2", unitPrice: "185000" }] });
    await sendQuote(data, actor, quote.id, 1, { today: "2026-11-01" });
    const draft = await createInvoice(data, actor, { customerId: customer.id, currency: "USD", taxMode: "exclusive", issuedOn: "2026-11-01", dueOn: "2026-11-15", lines: [{ description: "Survey", quantity: "1", unitPrice: "120.50" }] });
    const invoice = await issueInvoice(data, actor, draft.id, 1);
    await recordPayment(data, actor, invoice.id, { amount: "20", method: "cash", receivedOn: "2026-11-05" }, { today: "2026-11-05", locale: "en-NG" });
    const other = await workspace("Rival Co");
    await createCustomer(data, other, { type: "person", displayName: "Secret Client" });

    const files = unzipSync(await exportWorkspace(data, actor, { name: "Sun Power", locale: "en-NG" }));
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      "README.txt", "customers.csv", "quotes.csv", "quote-items.csv", "invoices.csv", "invoice-items.csv", "payments.csv",
      "payment-allocations.csv", "audit-log.csv", "pdf/quotes/Q-0001.pdf", "pdf/invoices/INV-0001.pdf",
    ]));
    const text = (name: string) => strFromU8(files[name]);
    expect(text("customers.csv")).toContain("Okafor Farms");
    expect(Object.values(files).map((f) => strFromU8(f)).join("")).not.toContain("Secret Client");
    const [header, row] = parseCsv(text("invoices.csv"));
    const value = (column: string) => row[header.indexOf(column)];
    expect([value("currency"), value("total"), value("totalMinor"), value("paid"), value("outstanding")]).toEqual(["USD", "120.50", "12050", "20.00", "100.50"]);
    expect(text("quote-items.csv")).toContain("185000.00");
    expect(strFromU8(files["pdf/invoices/INV-0001.pdf"].slice(0, 5))).toBe("%PDF-");
    // No secrets or link tokens.
    expect(Object.keys(files).some((f) => /link|provider|session|account/.test(f))).toBe(false);
    expect((await data.scoped(actor.organizationId).auditLog.findMany({ where: { action: "workspace.exported" } }))).toHaveLength(1);
  });
});
