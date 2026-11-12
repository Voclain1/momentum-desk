import { recordAudit } from "@/lib/audit";
import { customerInputSchema } from "@/lib/customers/schema";
import { RecordConflictError, RecordNotFoundError } from "@/lib/errors";
import { findDuplicates } from "@/lib/records/duplicates";
import type { TenantData } from "@/lib/tenant/core";

/**
 * Lead → customer conversion without losing history (spec §7.2). The lead
 * stays, with its timeline and tasks, and gains a link to the customer; the
 * customer's timeline shows the conversion. Callers need sales:write and
 * customers:write.
 */

export interface Actor {
  organizationId: string;
  userId: string;
}

export type ConversionTarget = { mode: "new" } | { mode: "existing"; customerId: string };

/** Possible existing customers (and other leads) for a lead, for the conversion choice. */
export async function conversionCandidates(data: TenantData, organizationId: string, leadId: string) {
  const tenant = data.scoped(organizationId);
  const lead = await tenant.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new RecordNotFoundError("Lead");
  return findDuplicates(tenant, { email: lead.email, phone: lead.phone, names: [lead.contactName, lead.companyName] }, { leadId });
}

export async function convertLead(data: TenantData, actor: Actor, leadId: string, target: ConversionTarget) {
  return data.transaction(actor.organizationId, async (tenant) => {
    const lead = await tenant.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new RecordNotFoundError("Lead");
    if (lead.customerId) throw new RecordConflictError("This lead was already converted, so it");

    const isCompany = Boolean(lead.companyName);
    let customerId: string;
    if (target.mode === "existing") {
      const customer = await tenant.customer.findUnique({ where: { id: target.customerId } });
      if (!customer) throw new RecordNotFoundError("Customer");
      customerId = customer.id;
    } else {
      // A person's details go on the customer; a company's on its first contact.
      const values = customerInputSchema.parse({
        type: isCompany ? "organization" : "person",
        displayName: lead.companyName ?? lead.contactName,
        email: isCompany ? null : lead.email,
        phone: isCompany ? null : lead.phone,
        preferredCurrency: lead.currency,
        tags: lead.tags,
      });
      const customer = await tenant.customer.create({ data: { ...values, createdById: actor.userId } });
      customerId = customer.id;
      await recordAudit(tenant, {
        action: "customer.created",
        actorUserId: actor.userId,
        targetType: "customer",
        targetId: customer.id,
        metadata: { type: customer.type, fromLeadId: lead.id },
      });
    }

    // Bring the lead's contact person across, unless the customer already has them.
    if (isCompany && lead.contactName) {
      const contacts = await tenant.contact.findMany({ where: { customerId } });
      const known = contacts.some(
        (contact) =>
          contact.name.toLowerCase() === lead.contactName!.toLowerCase() || (lead.email !== null && contact.email === lead.email),
      );
      if (!known) {
        const contact = await tenant.contact.create({
          data: {
            customerId,
            name: lead.contactName,
            email: lead.email,
            phone: lead.phone,
            isPrimary: !contacts.some((c) => c.isPrimary),
          },
        });
        await recordAudit(tenant, {
          action: "contact.added",
          actorUserId: actor.userId,
          targetType: "contact",
          targetId: contact.id,
          metadata: { customerId, fromLeadId: lead.id },
        });
      }
    }

    // Compare-and-set: two people converting at once cannot both win.
    const { count } = await tenant.lead.updateMany({
      where: { id: lead.id, customerId: null },
      data: { customerId, convertedAt: new Date(), version: { increment: 1 } },
    });
    if (count !== 1) throw new RecordConflictError("This lead was already converted, so it");
    await recordAudit(tenant, {
      action: "lead.converted",
      actorUserId: actor.userId,
      targetType: "lead",
      targetId: lead.id,
      metadata: { customerId, newCustomer: target.mode === "new" },
    });
    return { customerId };
  });
}
