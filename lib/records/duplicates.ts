import type { TenantDb } from "@/lib/tenant/core";

/**
 * Possible duplicates among customers and leads (spec §7.2), by email, phone
 * or name. Policy (D28): duplicates are shown, never merged automatically; a
 * lead can be linked to an existing customer instead of creating another.
 */

/** Digits that identify a phone number regardless of formatting or country prefix. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  // "0801 234 5678" and "+234 801 234 5678" share their last 9 digits.
  return digits.slice(-9);
}

const normalName = (name: string | null | undefined) => name?.trim().replace(/\s+/g, " ").toLowerCase() || null;

export interface DuplicateProbe {
  email?: string | null;
  phone?: string | null;
  names?: (string | null | undefined)[];
}

export interface Duplicate {
  type: "customer" | "lead";
  id: string;
  label: string;
  reasons: ("email" | "phone" | "name")[];
}

export async function findDuplicates(
  tenant: TenantDb,
  probe: DuplicateProbe,
  exclude: { customerId?: string; leadId?: string } = {},
): Promise<Duplicate[]> {
  const email = probe.email?.trim().toLowerCase() || null;
  const phone = phoneKey(probe.phone);
  const names = [...new Set((probe.names ?? []).map(normalName).filter((n): n is string => Boolean(n)))];
  if (!email && !phone && names.length === 0) return [];

  // Narrow with the database, then confirm phone matches by their key.
  const phoneTail = phone?.slice(-4);
  const nameFilters = names.flatMap((name) => [{ equals: name, mode: "insensitive" as const }]);
  const [customers, leads] = await Promise.all([
    tenant.customer.findMany({
      where: {
        id: exclude.customerId ? { not: exclude.customerId } : undefined,
        OR: [
          ...(email ? [{ email }, { contacts: { some: { email } } }] : []),
          ...(phoneTail ? [{ phone: { contains: phoneTail } }, { contacts: { some: { phone: { contains: phoneTail } } } }] : []),
          ...nameFilters.flatMap((filter) => [{ displayName: filter }, { legalName: filter }, { contacts: { some: { name: filter } } }]),
        ],
      },
      include: { contacts: { select: { name: true, email: true, phone: true } } },
      take: 20,
    }),
    tenant.lead.findMany({
      where: {
        id: exclude.leadId ? { not: exclude.leadId } : undefined,
        archivedAt: null,
        OR: [
          ...(email ? [{ email }] : []),
          ...(phoneTail ? [{ phone: { contains: phoneTail } }] : []),
          ...nameFilters.flatMap((filter) => [{ contactName: filter }, { companyName: filter }]),
        ],
      },
      take: 20,
    }),
  ]);

  const reasonsFor = (candidate: { emails: (string | null)[]; phones: (string | null)[]; names: (string | null)[] }) => {
    const reasons: Duplicate["reasons"] = [];
    if (email && candidate.emails.includes(email)) reasons.push("email");
    if (phone && candidate.phones.some((p) => phoneKey(p) === phone)) reasons.push("phone");
    if (candidate.names.some((n) => names.includes(normalName(n) ?? ""))) reasons.push("name");
    return reasons;
  };

  return [
    ...customers.map((customer) => ({
      type: "customer" as const,
      id: customer.id,
      label: customer.displayName,
      reasons: reasonsFor({
        emails: [customer.email, ...customer.contacts.map((c) => c.email)],
        phones: [customer.phone, ...customer.contacts.map((c) => c.phone)],
        names: [customer.displayName, customer.legalName, ...customer.contacts.map((c) => c.name)],
      }),
    })),
    ...leads.map((lead) => ({
      type: "lead" as const,
      id: lead.id,
      label: [lead.contactName, lead.companyName].filter(Boolean).join(" · "),
      reasons: reasonsFor({ emails: [lead.email], phones: [lead.phone], names: [lead.contactName, lead.companyName] }),
    })),
  ].filter((duplicate) => duplicate.reasons.length > 0);
}
