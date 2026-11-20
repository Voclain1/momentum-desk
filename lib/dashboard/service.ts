import { addDays, dateValue } from "@/lib/dates";
import type { TenantData } from "@/lib/tenant/core";

/**
 * The live dashboard (replaces the demo preview). Every amount stays in its
 * own currency (spec §5.5): totals are lists of (currency, amount), never
 * added across currencies. Each part is asked for only when the person's
 * role may see it.
 */

export type Totals = { currency: string; amountMinor: bigint }[];

function sum(rows: { currency: string | null; amountMinor: bigint | null }[]): Totals {
  const totals = new Map<string, bigint>();
  for (const row of rows) {
    if (!row.currency || row.amountMinor === null) continue;
    totals.set(row.currency, (totals.get(row.currency) ?? 0n) + row.amountMinor);
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountMinor]) => ({ currency, amountMinor }));
}

export interface Can {
  sales: boolean;
  quotes: boolean;
  invoices: boolean;
  payments: boolean;
}

export async function dashboardFigures(data: TenantData, organizationId: string, today: string, can: Can) {
  const tenant = data.scoped(organizationId);
  const monthStart = dateValue(`${today.slice(0, 8)}01`);
  const [pipeline, quotes, invoices, collected] = await Promise.all([
    can.sales
      ? tenant.lead.findMany({ where: { archivedAt: null, closedAt: null }, select: { currency: true, estimatedValueMinor: true } })
      : null,
    can.quotes
      ? tenant.quote.findMany({ where: { status: "sent", expiresOn: { gte: dateValue(today) } }, select: { currency: true, totalMinor: true } })
      : null,
    can.invoices
      ? tenant.invoice.findMany({ where: { status: "issued", outstandingMinor: { gt: 0 } }, select: { currency: true, outstandingMinor: true, dueOn: true } })
      : null,
    can.payments
      ? tenant.payment.findMany({ where: { voidedAt: null, receivedOn: { gte: monthStart, lte: dateValue(today) } }, select: { currency: true, amountMinor: true } })
      : null,
  ]);
  return {
    pipeline: pipeline && { leads: pipeline.length, totals: sum(pipeline.map((l) => ({ currency: l.currency, amountMinor: l.estimatedValueMinor }))) },
    quotes: quotes && { count: quotes.length, totals: sum(quotes.map((q) => ({ currency: q.currency, amountMinor: q.totalMinor }))) },
    invoices: invoices && {
      count: invoices.length,
      overdue: invoices.filter((i) => i.dueOn < dateValue(today)).length,
      totals: sum(invoices.map((i) => ({ currency: i.currency, amountMinor: i.outstandingMinor }))),
    },
    collected: collected && { payments: collected.length, totals: sum(collected) },
  };
}

export type AttentionItem = {
  kind: "Invoice" | "Quote" | "Lead" | "Promise";
  title: string;
  reason: string;
  href: string;
  amount: { currency: string; amountMinor: bigint } | null;
  /**
   * Lower is more urgent. Groups first (broken promises, overdue invoices,
   * accepted quotes to invoice, quotes about to expire, invoices due soon,
   * late follow-ups),
   * then the most urgent within each group.
   */
  rank: number;
};

/** What needs doing next, most urgent first (spec §13: the next action should be obvious). */
export async function attention(data: TenantData, organizationId: string, today: string, can: Can & { collections: boolean }, limit = 8) {
  const tenant = data.scoped(organizationId);
  const day = dateValue(today);
  const items: AttentionItem[] = [];
  const daysBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86_400_000);
  if (can.invoices) {
    const overdue = await tenant.invoice.findMany({
      where: { status: "issued", outstandingMinor: { gt: 0 }, dueOn: { lt: day }, disputedAt: null },
      orderBy: { dueOn: "asc" },
      take: limit,
      include: { customer: { select: { displayName: true } } },
    });
    for (const i of overdue) {
      const late = daysBetween(day, i.dueOn);
      items.push({
        kind: "Invoice", title: i.customer.displayName, reason: `${i.number} is ${late} ${late === 1 ? "day" : "days"} overdue`,
        href: `/app/invoices/${i.id}`, amount: { currency: i.currency, amountMinor: i.outstandingMinor }, rank: 200 + 90 - Math.min(late, 90),
      });
    }
    const dueSoon = await tenant.invoice.findMany({
      where: { status: "issued", outstandingMinor: { gt: 0 }, dueOn: { gte: day, lte: dateValue(addDays(today, 7)) }, disputedAt: null },
      orderBy: { dueOn: "asc" },
      take: limit,
      include: { customer: { select: { displayName: true } } },
    });
    for (const i of dueSoon) {
      const left = daysBetween(i.dueOn, day);
      items.push({
        kind: "Invoice", title: i.customer.displayName, reason: `${i.number} is due ${left === 0 ? "today" : `in ${left} ${left === 1 ? "day" : "days"}`}`,
        href: `/app/invoices/${i.id}`, amount: { currency: i.currency, amountMinor: i.outstandingMinor }, rank: 450 + left,
      });
    }
    if (can.quotes) {
      const ready = await tenant.quote.findMany({
        where: { status: "accepted", invoice: null }, orderBy: { acceptedAt: "asc" }, take: limit,
        include: { customer: { select: { displayName: true } } },
      });
      for (const q of ready) {
        items.push({ kind: "Quote", title: q.customer.displayName, reason: `${q.number} was accepted: invoice it`, href: `/app/quotes/${q.id}`, amount: { currency: q.currency, amountMinor: q.totalMinor }, rank: 300 });
      }
    }
  }
  if (can.quotes) {
    const expiring = await tenant.quote.findMany({
      where: { status: "sent", expiresOn: { gte: day, lte: dateValue(addDays(today, 7)) } }, orderBy: { expiresOn: "asc" }, take: limit,
      include: { customer: { select: { displayName: true } } },
    });
    for (const q of expiring) {
      const left = daysBetween(q.expiresOn, day);
      items.push({
        kind: "Quote", title: q.customer.displayName,
        reason: `${q.number} expires ${left === 0 ? "today" : `in ${left} ${left === 1 ? "day" : "days"}`}${q.viewedAt ? " (viewed)" : " (not opened yet)"}`,
        href: `/app/quotes/${q.id}`, amount: { currency: q.currency, amountMinor: q.totalMinor }, rank: 400 + left,
      });
    }
  }
  if (can.sales) {
    const followUps = await tenant.lead.findMany({
      where: { archivedAt: null, closedAt: null, nextFollowUpOn: { lte: day } }, orderBy: { nextFollowUpOn: "asc" }, take: limit,
    });
    for (const l of followUps) {
      const late = daysBetween(day, l.nextFollowUpOn!);
      items.push({
        kind: "Lead", title: l.companyName ?? l.contactName ?? "Lead",
        reason: late === 0 ? "Follow-up due today" : `Follow-up ${late} ${late === 1 ? "day" : "days"} late`,
        href: `/app/leads/${l.id}`,
        amount: l.estimatedValueMinor !== null && l.currency ? { currency: l.currency, amountMinor: l.estimatedValueMinor } : null,
        rank: 500 + 30 - Math.min(late, 30),
      });
    }
  }
  if (can.collections) {
    const broken = await tenant.promiseToPay.findMany({
      where: { status: "broken", resolvedAt: { gte: dateValue(addDays(today, -7)) }, invoice: { status: "issued", outstandingMinor: { gt: 0 } } },
      take: limit,
      include: { invoice: { include: { customer: { select: { displayName: true } } } } },
    });
    for (const p of broken) {
      items.push({
        kind: "Promise", title: p.invoice.customer.displayName, reason: `Promise to pay on ${p.invoice.number} was broken`,
        href: `/app/invoices/${p.invoiceId}`, amount: { currency: p.invoice.currency, amountMinor: p.invoice.outstandingMinor }, rank: 100,
      });
    }
  }
  return items.sort((a, b) => a.rank - b.rank).slice(0, limit);
}

/** Lead-to-cash flow for the last 30 days, from product events. */
export async function recentFlow(data: TenantData, organizationId: string, now: Date = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const grouped = await data.scoped(organizationId).productEvent.groupBy({
    by: ["name"],
    where: { occurredAt: { gte: since }, name: { in: ["lead_created", "quote_sent", "quote_accepted", "invoice_sent", "payment_completed"] } },
    _count: { _all: true },
  });
  const count = (name: string) => grouped.find((g) => g.name === name)?._count._all ?? 0;
  return [
    { label: "Leads created", count: count("lead_created") },
    { label: "Quotes sent", count: count("quote_sent") },
    { label: "Quotes accepted", count: count("quote_accepted") },
    { label: "Invoices sent", count: count("invoice_sent") },
    { label: "Payments received", count: count("payment_completed") },
  ];
}
