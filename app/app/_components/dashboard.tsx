import { formatMoney, type Money } from "@/lib/money";
import {
  attentionItems,
  demoWorkspace,
  leadToCash,
  metrics,
  monthlyTarget,
  revenueFlow,
  type AttentionKind,
} from "../_data/demo-dashboard";

const { locale } = demoWorkspace;
const full = (value: Money) => formatMoney(value, locale);
const compact = (value: Money) => formatMoney(value, locale, { compact: true });

export function CurrencyBasis() {
  return (
    <p className="currency-basis">
      Sample amounts in <strong>{demoWorkspace.baseCurrency}</strong>. Live totals will use your
      workspace base currency.
    </p>
  );
}

export function TargetProgress() {
  const { collected, target, label } = monthlyTarget;
  const percent =
    target.amountMinor > BigInt(0)
      ? Number((collected.amountMinor * BigInt(100)) / target.amountMinor)
      : 0;
  return (
    <div className="target">
      <span>{label}</span>
      <strong>
        {full(collected)} <small>/ {full(target)}</small>
      </strong>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percent, 100)}
      >
        <i style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}

export function MetricGrid() {
  return (
    <section className="metric-grid" aria-label="Key metrics">
      {metrics.map((metric) => (
        <article className="metric-card" key={metric.label}>
          <div>
            <span>{metric.label}</span>
          </div>
          <strong>{typeof metric.value === "number" ? metric.value : full(metric.value)}</strong>
          <p className={metric.tone}>
            <i />
            {metric.noteAmount ? `${full(metric.noteAmount)} ${metric.note}` : metric.note}
          </p>
        </article>
      ))}
    </section>
  );
}

const kindIcons: Record<AttentionKind, { icon: string; className: string }> = {
  Quote: { icon: "▱", className: "icon-0" },
  Invoice: { icon: "!", className: "icon-1" },
  Opportunity: { icon: "◇", className: "icon-2" },
  Payment: { icon: "×", className: "icon-3" },
};

export function AttentionPanel() {
  return (
    <article className="panel">
      <div className="panel-heading">
        <div>
          <h3>Needs your attention</h3>
          <p>Prioritized by urgency and revenue impact</p>
        </div>
        <button type="button">View all 12</button>
      </div>
      <div className="action-list">
        {attentionItems.map((item) => (
          <div className="action-row" key={item.company}>
            <span className={`action-icon ${kindIcons[item.kind].className}`} aria-hidden>
              {kindIcons[item.kind].icon}
            </span>
            <div className="action-copy">
              <strong>{item.company}</strong>
              <span>{item.reason}</span>
            </div>
            <span className="pill">{item.kind}</span>
            <b>{full(item.amount)}</b>
            <button type="button">{item.action} →</button>
          </div>
        ))}
      </div>
    </article>
  );
}

export function RevenueFlowPanel() {
  return (
    <article className="panel flow-panel">
      <div className="panel-heading">
        <div>
          <h3>Revenue flow</h3>
          <p>Last 30 days</p>
        </div>
        <button type="button">View report</button>
      </div>
      <div className="funnel">
        {revenueFlow.map((stage) => (
          <div key={stage.label}>
            <span>
              <i className={`dot ${stage.dot}`} />
              {stage.label}
            </span>
            <strong>{stage.count}</strong>
            <small>
              {stage.detailAmount ? `${compact(stage.detailAmount)} ${stage.detail}` : stage.detail}
            </small>
          </div>
        ))}
      </div>
      <div className="conversion">
        <span>Lead-to-cash conversion</span>
        <strong>
          {leadToCash.rate} <small>{leadToCash.change}</small>
        </strong>
      </div>
    </article>
  );
}
