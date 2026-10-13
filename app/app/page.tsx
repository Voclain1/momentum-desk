import {
  AttentionPanel,
  CurrencyBasis,
  MetricGrid,
  RevenueFlowPanel,
  TargetProgress,
} from "./_components/dashboard";
import { requireTenant } from "@/lib/tenant/server";
import { RecentActivity } from "./_components/activity";

export default async function DashboardPage() {
  // Checked here as well as in the layout: layouts do not re-run on every navigation.
  const tenant = await requireTenant();
  return (
    <>
      <header className="topbar">
        <div>
          <p>PRODUCT PREVIEW · DEMO DATA</p>
          <h1>Good morning.</h1>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-button" aria-label="Notifications">
            ♢<i />
          </button>
          <button type="button" className="new-button">
            <span aria-hidden>＋</span> Create new
          </button>
        </div>
      </header>

      <section className="hero-row">
        <div>
          <h2>Your revenue desk</h2>
          <p>Here’s what needs attention across your pipeline and cash flow.</p>
          <CurrencyBasis />
        </div>
        <TargetProgress />
      </section>

      <MetricGrid />

      <section className="main-grid">
        <AttentionPanel />
        <RevenueFlowPanel />
      </section>

      <RecentActivity tenant={tenant} />

      <footer className="system-note">
        <span aria-hidden>✓</span>
        <div>
          <strong>Foundation preview</strong>
          <p>Live organization, customer, quote, invoice and payment data arrives with M0–M3.</p>
        </div>
        <em>M0</em>
      </footer>
    </>
  );
}
