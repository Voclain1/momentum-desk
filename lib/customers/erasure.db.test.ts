import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addActivity } from "@/lib/activities/service";
import { InputValidationError, RecordConflictError } from "@/lib/errors";
import { createInvoice, issueInvoice } from "@/lib/invoices/service";
import { openInvoice } from "@/lib/invoices/public";
import { createInvoiceLink } from "@/lib/invoices/sharing";
import { recordPayment } from "@/lib/payments/service";
import { addCollectionNote } from "@/lib/receivables/service";
import { createTenantData } from "@/lib/tenant/core";
import { createPublicLinks } from "@/lib/tenant/public";
import { createTestDb, disconnectOwnerDb, resetDatabase } from "@/test/db";
import { ERASED_NAME, eraseCustomer } from "./erasure";
import { addContact, createCustomer } from "./service";

const db = createTestDb();
const data = createTenantData(db);
const links = createPublicLinks(db);

beforeEach(() => resetDatabase());
afterAll(() => Promise.all([db.$disconnect(), disconnectOwnerDb()]));

describe("erasing a customer", () => {
  it("removes what identifies them, keeps issued documents and payments as legal records, and logs no personal data", async () => {
    const organizationId = randomUUID();
    await db.organization.create({
      data: { id: organizationId, name: "Sun Power", slug: `sun-${organizationId.slice(0, 8)}`, baseCurrency: "NGN", countryCode: "NG", locale: "en-NG", timezone: "Africa/Lagos", defaultLanguage: "en" },
    });
    const userId = randomUUID();
    await db.user.create({ data: { id: userId, name: "Ada", email: `${userId}@example.com` } });
    await db.member.create({ data: { id: randomUUID(), organizationId, userId, role: "owner" } });
    const actor = { organizationId, userId, timezone: "Africa/Lagos" };
    const customer = await createCustomer(data, actor, { type: "person", displayName: "Chidi Okafor", email: "chidi@okafor.ng", phone: "+2348012345678", notes: "Prefers mornings" });
    await addContact(data, actor, customer.id, { name: "Ngozi Okafor", email: "ngozi@okafor.ng" });
    await addActivity(data, actor, { type: "customer", id: customer.id }, { kind: "call", body: "Spoke with Chidi about his roof" });
    const draft = await createInvoice(data, actor, { customerId: customer.id, currency: "NGN", taxMode: "exclusive", issuedOn: "2026-11-01", dueOn: "2026-11-15", lines: [{ description: "Panels", quantity: "1", unitPrice: "100000" }] });
    const issued = await issueInvoice(data, actor, draft.id, 1);
    await createInvoice(data, actor, { customerId: customer.id, currency: "NGN", taxMode: "exclusive", issuedOn: "2026-11-01", dueOn: "2026-11-15", lines: [{ description: "Draft", quantity: "1", unitPrice: "1" }] });
    await recordPayment(data, actor, issued.id, { amount: "40000", method: "bank_transfer", receivedOn: "2026-11-05" }, { today: "2026-11-05", locale: "en-NG" });
    const { token } = await createInvoiceLink(data, actor, issued.id);
    await openInvoice({ data, links }, token, { ipAddress: "203.0.113.7", userAgent: "Chidi's phone" });
    await addCollectionNote(data, actor, issued.id, "Chidi said Friday");

    await expect(eraseCustomer(data, actor, customer.id, "chidi")).rejects.toThrow(InputValidationError);
    const removed = await eraseCustomer(data, actor, customer.id, "Chidi Okafor");
    expect(removed).toMatchObject({ contacts: 1, activities: 1, draftInvoices: 1, collectionNotes: 1 });
    await expect(eraseCustomer(data, actor, customer.id, ERASED_NAME)).rejects.toThrow(RecordConflictError);

    const tenant = data.scoped(organizationId);
    const after = await tenant.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after).toMatchObject({ displayName: ERASED_NAME, email: null, phone: null, notes: null });
    expect(after.erasedAt).toBeInstanceOf(Date);
    expect(after.archivedAt).toBeInstanceOf(Date);
    expect(await tenant.invoiceEvent.findMany()).toEqual([expect.objectContaining({ ipAddress: null, userAgent: null })]);

    // Kept: the issued invoice exactly as sent, and its payment.
    const kept = await tenant.invoice.findUniqueOrThrow({ where: { id: issued.id } });
    expect([kept.number, kept.paidMinor, JSON.stringify(kept.customerSnapshot).includes("Chidi Okafor")]).toEqual(["INV-0001", 4000000n, true]);
    expect(await tenant.payment.count()).toBe(1);
    expect(await tenant.invoice.count()).toBe(1);

    // Nothing that identifies them remains outside the issued document.
    const everywhere = JSON.stringify(await Promise.all([
      tenant.customer.findMany(), tenant.contact.findMany(), tenant.activity.findMany(), tenant.collectionNote.findMany(),
      tenant.invoiceEvent.findMany(), tenant.auditLog.findMany(),
    ]), (_, v) => (typeof v === "bigint" ? String(v) : v));
    expect(everywhere).not.toMatch(/Chidi|Ngozi|okafor\.ng|2348012345678|203\.0\.113\.7|roof/);
  });
});
