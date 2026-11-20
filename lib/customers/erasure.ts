import { recordAudit } from "@/lib/audit";
import { InputValidationError, RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import type { TenantData } from "@/lib/tenant/core";

/**
 * Erasing a customer's personal data on request (decision D25). Owners and
 * admins only (data:export; the caller checks). What stays: issued quotes
 * and invoices exactly as sent, their payments and refunds, and quote
 * acceptance evidence. They are financial and contractual records kept
 * under legal obligation (D31 keeps issued documents unchanged). Everything
 * else that identifies the customer is removed or blanked, in one
 * transaction, and the customer appears as "Erased customer" from then on.
 */

export const ERASED_NAME = "Erased customer";

export async function eraseCustomer(
  data: TenantData,
  actor: { organizationId: string; userId: string },
  customerId: string,
  confirmation: string,
  now: Date = new Date(),
) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const customer = await tenant.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new RecordNotFoundError("Customer");
    if (customer.erasedAt) throw new RecordConflictError("This customer was already erased, so it");
    if (confirmation.trim() !== customer.displayName) throw new InputValidationError({ confirmation: "must be the customer's name exactly" });

    const leads = (await tenant.lead.findMany({ where: { customerId }, select: { id: true } })).map((l) => l.id);
    const quotes = (await tenant.quote.findMany({ where: { customerId }, select: { id: true } })).map((q) => q.id);
    const invoices = (await tenant.invoice.findMany({ where: { customerId }, select: { id: true } })).map((i) => i.id);
    const about = { OR: [{ customerId }, { leadId: { in: leads } }] };

    const removed = {
      contacts: (await tenant.contact.deleteMany({ where: { customerId } })).count,
      activities: (await tenant.activity.deleteMany({ where: about })).count,
      tasks: (await tenant.task.deleteMany({ where: about })).count,
      draftQuotes: (await tenant.quote.deleteMany({ where: { customerId, status: "draft" } })).count,
      draftInvoices: (await tenant.invoice.deleteMany({ where: { customerId, status: "draft" } })).count,
      collectionNotes: (await tenant.collectionNote.deleteMany({ where: { invoiceId: { in: invoices } } })).count,
      acceptanceCodes: (await tenant.quoteAcceptanceCode.deleteMany({ where: { quoteId: { in: quotes } } })).count,
    };
    await tenant.promiseToPay.updateMany({ where: { invoiceId: { in: invoices } }, data: { note: null } });
    await tenant.quoteEvent.updateMany({ where: { quoteId: { in: quotes } }, data: { ipAddress: null, userAgent: null } });
    await tenant.invoiceEvent.updateMany({ where: { invoiceId: { in: invoices } }, data: { ipAddress: null, userAgent: null } });
    await tenant.reminderExecution.updateMany({ where: { invoiceId: { in: invoices }, sentTo: { not: null } }, data: { sentTo: null } });
    await tenant.lead.updateMany({
      where: { id: { in: leads } },
      data: { contactName: ERASED_NAME, companyName: null, email: null, phone: null, summary: null, notes: null, tags: [], lostReason: null, version: { increment: 1 } },
    });
    await tenant.customer.updateMany({
      where: { id: customerId },
      data: {
        displayName: ERASED_NAME, legalName: null, email: null, phone: null, website: null, taxId: null,
        addressLine1: null, addressLine2: null, city: null, region: null, postalCode: null, notes: null, tags: [],
        erasedAt: now, archivedAt: customer.archivedAt ?? now, version: { increment: 1 },
      },
    });
    // No name or contact details in the log: only what was done.
    await recordAudit(tenant, {
      action: "customer.erased", actorUserId: actor.userId, targetType: "customer", targetId: customerId,
      metadata: { ...removed, leads: leads.length, keptIssuedQuotes: quotes.length - removed.draftQuotes, keptIssuedInvoices: invoices.length - removed.draftInvoices },
    });
    return removed;
  });
}
