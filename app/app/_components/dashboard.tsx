import Link from "next/link";
import type { AttentionItem, Totals } from "@/lib/dashboard/service";
import { formatMoney, money } from "@/lib/money";

/** Amounts in their own currencies, side by side, never added together. */
export function Amounts({ totals, locale, empty = "—" }: { totals: Totals; locale: string; empty?: string }) {
  if (totals.length === 0) return <>{empty}</>;
  return <>{totals.map((t) => formatMoney(money(t.amountMinor, t.currency), locale)).join(" · ")}</>;
}

export interface Card {
  label: string;
  totals: Totals;
  note: string;
  tone: "green" | "amber" | "red" | "blue";
  href: string;
}

export function MetricGrid({ cards, locale }: { cards: Card[]; locale: string }) {
  if (cards.length === 0) return null;
  return (
    <section className="metric-grid" aria-label="Key figures">
      {cards.map((card) => (
        <Link href={card.href} className="metric-card" key={card.label}>
          <div><span>{card.label}</span></div>
          <strong><Amounts totals={card.totals} locale={locale} empty="Nothing yet" /></strong>
          <p className={card.tone}><i />{card.note}</p>
        </Link>
      ))}
    </section>
  );
}

const kindIcons: Record<AttentionItem["kind"], { icon: string; className: string }> = {
  Quote: { icon: "▱", className: "icon-0" },
  Invoice: { icon: "!", className: "icon-1" },
  Lead: { icon: "◇", className: "icon-2" },
  Promise: { icon: "×", className: "icon-3" },
};

export function AttentionPanel({ items, locale }: { items: AttentionItem[]; locale: string }) {
  return (
    <article className="panel" aria-label="Needs your attention">
      <div className="panel-heading">
        <div><h3>Needs your attention</h3><p>Most urgent first</p></div>
      </div>
      {items.length === 0 ? (
        <p className="form-hint attention-empty">Nothing urgent: no overdue invoices, expiring quotes or late follow-ups.</p>
      ) : (
        <div className="action-list">
          {items.map((item) => (
            <div className="action-row" key={`${item.kind}-${item.href}-${item.reason}`}>
              <span className={`action-icon ${kindIcons[item.kind].className}`} aria-hidden>{kindIcons[item.kind].icon}</span>
              <div className="action-copy"><strong>{item.title}</strong><span>{item.reason}</span></div>
              <span className="pill">{item.kind}</span>
              <b>{item.amount ? formatMoney(money(item.amount.amountMinor, item.amount.currency), locale) : ""}</b>
              <Link href={item.href}>Open →</Link>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export function RevenueFlowPanel({ flow, canSeeMetrics }: { flow: { label: string; count: number }[]; canSeeMetrics: boolean }) {
  return (
    <article className="panel flow-panel" aria-label="Revenue flow">
      <div className="panel-heading">
        <div><h3>Revenue flow</h3><p>Last 30 days</p></div>
        {canSeeMetrics ? <Link href="/app/metrics?days=30">View metrics</Link> : null}
      </div>
      <div className="funnel">
        {flow.map((stage, index) => (
          <div key={stage.label}>
            <span><i className={`dot ${["green", "blue", "amber", "blue", "green"][index]}`} />{stage.label}</span>
            <strong>{stage.count}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}
