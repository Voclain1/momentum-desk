import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/auth/authorization";
import { createCustomer } from "@/lib/customers/service";
import { createInvoice, issueInvoice } from "@/lib/invoices/service";
import { openInvoice } from "@/lib/invoices/public";
import { createInvoiceLink } from "@/lib/invoices/sharing";
import { refundPayment } from "@/lib/payments/refunds";
import { recordPayment } from "@/lib/payments/service";
import { createQuote, sendQuote } from "@/lib/quotes/service";
import { createTenantData } from "@/lib/tenant/core";
import { createPublicLinks } from "@/lib/tenant/public";
import { createTestDb, createTestOwnerDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { cancelClosure, purgeClosedWorkspaces, requestClosure } from "./closure";

const db = createTestDb();
const owner = createTestOwnerDb();
const data = createTenantData(db);
const links = createPublicLinks(db);

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), owner.$disconnect(), disconnectOwnerDb()]));

async function workspace(name: string) {
  const organizationId = randomUUID();
  await db.organization.create({
    data: { id: organizationId, name, slug: `${name.toLowerCase()}-${organizationId.slice(0, 6)}`, baseCurrency: "NGN", countryCode: "NG", locale: "en-NG", timezone: "Africa/Lagos", defaultLanguage: "en" },
  });
  const userId = randomUUID();
  await db.user.create({ data: { id: userId, name: "Ada", email: `${userId}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId, userId, role: "owner" } });
  const adminId = randomUUID();
  await db.user.create({ data: { id: adminId, name: "Bo", email: `${adminId}@example.com` } });
  await db.member.create({ data: { id: randomUUID(), organizationId, userId: adminId, role: "admin" } });
  return { organizationId, userId, adminId };
}

/** A workspace with the guarded records: issued documents, payments, a refund, evidence, audit. */
async function busy(name: string) {
  const w = await workspace(name);
  const actor = { organizationId: w.organizationId, userId: w.userId };
  const customer = await createCustomer(data, actor, { type: "organization", displayName: `${name} Customer` });
  const quote = await createQuote(data, actor, { customerId: customer.id, currency: "NGN", taxMode: "exclusive", issuedOn: "2026-11-01", expiresOn: "2026-12-01", lines: [{ description: "Panels", quantity: "1", unitPrice: "1000" }] });
  await sendQuote(data, actor, quote.id, 1, { today: "2026-11-01" });
  const draft = await createInvoice(data, actor, { customerId: customer.id, currency: "NGN", taxMode: "exclusive", issuedOn: "2026-11-01", dueOn: "2026-11-15", lines: [{ description: "Work", quantity: "1", unitPrice: "1000" }] });
  const invoice = await issueInvoice(data, actor, draft.id, 1);
  const payment = await recordPayment(data, actor, invoice.id, { amount: "1000", method: "cash", receivedOn: "2026-11-02" }, { today: "2026-11-02", locale: "en-NG" });
  await refundPayment({ data, links, secretsKey: undefined, http: async () => ({ status: 500, json: async () => ({}) }) } as never, actor, payment.id, { amount: "100", reason: "Overcharged", method: "manual" }, { locale: "en-NG" });
  const { token } = await createInvoiceLink(data, actor, invoice.id);
  await openInvoice({ data, links }, token, { ipAddress: "203.0.113.1", userAgent: "x" });
  return w;
}

describe("closing a workspace", () => {
  it("lets only owners ask or cancel, then deletes everything after 30 days and nothing of other workspaces", async () => {
    const closing = await busy("Closing");
    const staying = await busy("Staying");
    const now = new Date("2026-11-20T10:00:00Z");

    await expect(requestClosure(db, { organizationId: closing.organizationId, userId: closing.adminId }, now)).rejects.toThrow(AuthorizationError);
    expect(await requestClosure(db, { organizationId: closing.organizationId, userId: closing.userId }, now)).toEqual(new Date("2026-12-20T10:00:00Z"));
    await cancelClosure(db, { organizationId: closing.organizationId, userId: closing.userId });
    expect(await purgeClosedWorkspaces(db, new Date("2027-01-01"))).toBe(0);
    await requestClosure(db, { organizationId: closing.organizationId, userId: closing.userId }, now);

    expect(await purgeClosedWorkspaces(db, new Date("2026-12-20T09:59:00Z"))).toBe(0);
    expect(await purgeClosedWorkspaces(db, new Date("2026-12-20T10:00:00Z"))).toBe(1);

    // Every workspace table is empty for the closed workspace (checked as the database owner, past row-level security).
    const tables = await owner.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'organizationId'`;
    for (const { table_name } of tables) {
      const [{ n }] = await owner.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table_name}" WHERE "organizationId" = $1`, closing.organizationId);
      expect([table_name, n]).toEqual([table_name, 0n]);
    }
    expect(await owner.organization.count({ where: { id: closing.organizationId } })).toBe(0);
    // People keep their accounts; the other workspace is untouched.
    expect(await owner.user.count({ where: { id: closing.userId } })).toBe(1);
    expect(await data.scoped(staying.organizationId).invoice.count()).toBe(1);
    expect(await data.scoped(staying.organizationId).refund.count()).toBe(1);
  });
});
