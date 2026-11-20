import type { TenantData } from "@/lib/tenant/core";
import { EVENT_NAMES, type EventName } from "./events";

/**
 * The spec §17 metrics for a period, from product events and the records
 * they point to. Rates are null when there is nothing to divide by. Money is
 * kept per currency. Reminder attribution is deliberately simple and
 * documented on the page: a payment within 7 days after a reminder counts.
 */

export const ATTRIBUTION_DAYS = 7;
const DAY = 86_400_000;

export interface Metrics {
  from: Date;
  to: Date;
  counts: Record<EventName, number>;
  leadToQuote: { leads: number; quoted: number; rate: number | null; averageDays: number | null };
  quoteAcceptance: { sent: number; accepted: number; rate: number | null };
  quoteToPayment: { accepted: number; paid: number; rate: number | null };
  timeToPayment: { paidInvoices: number; averageDays: number | null };
  reminders: { sent: number; followedByPayment: number; rate: number | null; collected: { currency: string; amountMinor: bigint }[] };
}

const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);
const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export async function metrics(data: TenantData, organizationId: string, { from, to }: { from: Date; to: Date }): Promise<Metrics> {
  const tenant = data.scoped(organizationId);
  const inPeriod = { occurredAt: { gte: from, lt: to } };
  const grouped = await tenant.productEvent.groupBy({ by: ["name"], where: inPeriod, _count: { _all: true } });
  const counts = Object.fromEntries(EVENT_NAMES.map((name) => [name, grouped.find((g) => g.name === name)?._count._all ?? 0])) as Record<EventName, number>;
  const ids = async (name: EventName) => (await tenant.productEvent.findMany({ where: { ...inPeriod, name }, select: { entityId: true } })).map((e) => e.entityId);

  // Leads created in the period, and how soon each got its first quote.
  const leadIds = await ids("lead_created");
  const leads = await tenant.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, createdAt: true } });
  const firstQuotes = await tenant.quote.groupBy({ by: ["leadId"], where: { leadId: { in: leadIds } }, _min: { createdAt: true } });
  const quoteDays = firstQuotes.flatMap((q) => {
    const lead = leads.find((l) => l.id === q.leadId);
    return lead && q._min.createdAt ? [(q._min.createdAt.getTime() - lead.createdAt.getTime()) / DAY] : [];
  });

  // Quotes sent in the period: accepted? Accepted ones: invoiced and paid in full?
  const sentIds = await ids("quote_sent");
  const accepted = await tenant.quote.findMany({ where: { id: { in: sentIds }, status: "accepted" }, select: { id: true } });
  const invoicesOfAccepted = await tenant.invoice.findMany({
    where: { quoteId: { in: accepted.map((q) => q.id) }, status: "issued", outstandingMinor: 0 },
    select: { quoteId: true },
  });

  // Invoices sent in the period and paid in full: days from issue to the last payment.
  const sentInvoices = await tenant.invoice.findMany({
    where: { id: { in: await ids("invoice_sent") }, status: "issued", outstandingMinor: 0, totalMinor: { gt: 0 } },
    select: { id: true, issuedOn: true, allocations: { where: { voidedAt: null }, select: { payment: { select: { receivedOn: true } } } } },
  });
  const paymentDays = sentInvoices.flatMap((invoice) => {
    const last = Math.max(...invoice.allocations.map((a) => a.payment.receivedOn.getTime()));
    return Number.isFinite(last) ? [Math.max(0, (last - invoice.issuedOn.getTime()) / DAY)] : [];
  });

  // Reminders sent in the period, and payments received within the attribution window after each.
  const reminders = await tenant.reminderExecution.findMany({
    where: { status: "sent", completedAt: { gte: from, lt: to } },
    select: { invoiceId: true, completedAt: true },
  });
  const collected = new Map<string, bigint>();
  const counted = new Set<string>();
  let followed = 0;
  for (const reminder of reminders) {
    const sentOn = new Date(reminder.completedAt!.toISOString().slice(0, 10));
    const allocations = await tenant.paymentAllocation.findMany({
      where: {
        invoiceId: reminder.invoiceId, voidedAt: null,
        payment: { receivedOn: { gte: sentOn, lt: new Date(sentOn.getTime() + (ATTRIBUTION_DAYS + 1) * DAY) } },
      },
      select: { id: true, amountMinor: true, invoice: { select: { currency: true } } },
    });
    if (allocations.length) followed++;
    for (const allocation of allocations) {
      if (counted.has(allocation.id)) continue;
      counted.add(allocation.id);
      collected.set(allocation.invoice.currency, (collected.get(allocation.invoice.currency) ?? 0n) + allocation.amountMinor);
    }
  }

  return {
    from,
    to,
    counts,
    leadToQuote: { leads: leads.length, quoted: firstQuotes.length, rate: rate(firstQuotes.length, leads.length), averageDays: average(quoteDays) },
    quoteAcceptance: { sent: sentIds.length, accepted: accepted.length, rate: rate(accepted.length, sentIds.length) },
    quoteToPayment: { accepted: accepted.length, paid: invoicesOfAccepted.length, rate: rate(invoicesOfAccepted.length, accepted.length) },
    timeToPayment: { paidInvoices: paymentDays.length, averageDays: average(paymentDays) },
    reminders: {
      sent: reminders.length,
      followedByPayment: followed,
      rate: rate(followed, reminders.length),
      collected: [...collected].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountMinor]) => ({ currency, amountMinor })),
    },
  };
}
