import Link from "next/link";
import { todayIn } from "@/lib/dates";
import { attention, dashboardFigures, recentFlow } from "@/lib/dashboard/service";
import { tenantData } from "@/lib/tenant";
import { requireTenant } from "@/lib/tenant/server";
import { RecentActivity } from "./_components/activity";
import { AttentionPanel, type Card, MetricGrid, RevenueFlowPanel } from "./_components/dashboard";
import { MyTasks } from "./_components/my-tasks";
import { SetupChecklist } from "./_components/setup-checklist";

function greeting(timezone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage() {
  // Checked here as well as in the layout: layouts do not re-run on every navigation.
  const tenant = await requireTenant("workspace:read");
  const { organization } = tenant;
  const today = todayIn(organization.timezone);
  const can = {
    sales: tenant.can("sales:read"),
    quotes: tenant.can("quotes:read"),
    invoices: tenant.can("invoices:read"),
    payments: tenant.can("payments:read"),
    collections: tenant.can("collections:read"),
  };
  const [figures, items, flow] = await Promise.all([
    dashboardFigures(tenantData, organization.id, today, can),
    attention(tenantData, organization.id, today, can),
    recentFlow(tenantData, organization.id),
  ]);
  const cards: Card[] = [
    ...(figures.pipeline ? [{ label: "Open pipeline", totals: figures.pipeline.totals, note: `${figures.pipeline.leads} open ${figures.pipeline.leads === 1 ? "lead" : "leads"}`, tone: "green" as const, href: "/app/pipeline" }] : []),
    ...(figures.quotes ? [{ label: "Quotes awaiting a reply", totals: figures.quotes.totals, note: `${figures.quotes.count} sent and still valid`, tone: "amber" as const, href: "/app/quotes" }] : []),
    ...(figures.invoices ? [{ label: "Outstanding invoices", totals: figures.invoices.totals, note: `${figures.invoices.overdue} of ${figures.invoices.count} overdue`, tone: "red" as const, href: "/app/receivables" }] : []),
    ...(figures.collected ? [{ label: "Collected this month", totals: figures.collected.totals, note: `${figures.collected.payments} ${figures.collected.payments === 1 ? "payment" : "payments"} received`, tone: "blue" as const, href: "/app/payments" }] : []),
  ];
  const firstName = tenant.user.name.split(" ")[0];
  return (
    <>
      <header className="topbar">
        <div>
          <p>{organization.name.toUpperCase()}</p>
          <h1>{greeting(organization.timezone)}, {firstName}.</h1>
        </div>
        <div className="header-actions">
          {tenant.can("sales:write") ? <Link href="/app/leads/new" className="icon-button text-button link-as-button">＋ Lead</Link> : null}
          {tenant.can("quotes:write") ? <Link href="/app/quotes/new" className="icon-button text-button link-as-button">＋ Quote</Link> : null}
          {tenant.can("invoices:write") ? <Link href="/app/invoices/new" className="new-button link-as-button">＋ Invoice</Link> : null}
        </div>
      </header>

      <SetupChecklist tenant={tenant} />

      <section className="hero-row">
        <div>
          <h2>Your revenue desk</h2>
          <p>What needs attention across your pipeline and cash flow.</p>
          <p className="currency-basis">Amounts are shown in their own currencies and never added together.</p>
        </div>
      </section>

      <MetricGrid cards={cards} locale={organization.locale} />

      <section className="main-grid">
        <AttentionPanel items={items} locale={organization.locale} />
        <RevenueFlowPanel flow={flow} canSeeMetrics={can.sales || can.invoices} />
      </section>

      <MyTasks tenant={tenant} />
      <RecentActivity tenant={tenant} />
    </>
  );
}
