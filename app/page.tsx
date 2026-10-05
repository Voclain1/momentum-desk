const metrics = [
  ["Open pipeline", "$184,250", "+12.4% this month", "green"],
  ["Quotes awaiting action", "14", "$47,800 in value", "amber"],
  ["Outstanding invoices", "$31,420", "8 invoices overdue", "red"],
  ["Collected this month", "$92,680", "81% of target", "blue"],
];

const actions = [
  ["Northstar Studio", "Quote viewed 3 days ago", "$8,400", "Follow up", "Quote"],
  ["Helio Works", "Invoice is 7 days overdue", "$12,750", "Review chase", "Invoice"],
  ["Atlas & Co.", "No activity for 5 days", "$24,000", "Plan next step", "Deal"],
  ["Koru Systems", "Payment failed this morning", "$3,200", "Resolve", "Payment"],
];

const nav = ["Overview", "Leads", "Deals", "Quotes", "Invoices", "Payments", "Collections"];

export default function Home() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">M</span><span>Momentum</span></div>
        <div className="workspace-switcher"><span className="workspace-avatar">DW</span><span><strong>Demo workspace</strong><small>USD · Owner</small></span><span>⌄</span></div>
        <nav className="nav-list" aria-label="Primary navigation">
          {nav.map((item, index) => <a className={index === 0 ? "active" : ""} href="#" key={item}><span>{["⌂","◉","◇","▱","▤","◎","↗"][index]}</span>{item}{item === "Collections" && <em>8</em>}</a>)}
        </nav>
        <div className="sidebar-spacer" />
        <div className="ai-card"><strong><span>✦</span> Momentum AI</strong><p>5 actions could move revenue forward today.</p><button>Review suggestions</button></div>
        <a className="settings" href="#">⚙ <span>Settings</span></a>
        <div className="profile"><span className="profile-avatar">SO</span><span><strong>Sample owner</strong><small>Product preview</small></span><span>•••</span></div>
      </aside>

      <section className="content">
        <header className="topbar"><div><p>PRODUCT PREVIEW · DEMO DATA</p><h1>Good morning.</h1></div><div className="header-actions"><button className="icon-button" aria-label="Notifications">♢<i /></button><button className="new-button"><span>＋</span> Create new</button></div></header>
        <section className="hero-row"><div><h2>Your revenue desk</h2><p>Here’s what needs attention across your pipeline and cash flow.</p></div><div className="target"><span>October target</span><strong>$114,420 <small>/ $150,000</small></strong><div><i /></div></div></section>

        <section className="metric-grid">
          {metrics.map(([label,value,note,tone]) => <article className="metric-card" key={label}><div><span>{label}</span><b>•••</b></div><strong>{value}</strong><p className={tone}><i />{note}</p></article>)}
        </section>

        <section className="main-grid">
          <article className="panel">
            <div className="panel-heading"><div><h3>Needs your attention</h3><p>Prioritized by urgency and revenue impact</p></div><button>View all 12</button></div>
            <div className="action-list">
              {actions.map(([company,task,amount,action,kind], index) => <div className="action-row" key={company}><span className={`action-icon icon-${index}`}>{["▱","!","◇","×"][index]}</span><div className="action-copy"><strong>{company}</strong><span>{task}</span></div><span className="pill">{kind}</span><b>{amount}</b><button>{action} →</button></div>)}
            </div>
          </article>

          <article className="panel flow-panel">
            <div className="panel-heading"><div><h3>Revenue flow</h3><p>Last 30 days</p></div><button>View report</button></div>
            <div className="funnel">
              <div><span><i className="dot indigo" />New leads</span><strong>48</strong><small>$286k potential</small></div>
              <div><span><i className="dot purple" />Qualified</span><strong>31</strong><small>65% conversion</small></div>
              <div><span><i className="dot amber-dot" />Quotes sent</span><strong>22</strong><small>$142k quoted</small></div>
              <div><span><i className="dot green-dot" />Won & paid</span><strong>16</strong><small>$92.7k collected</small></div>
            </div>
            <div className="conversion"><span>Lead-to-cash conversion</span><strong>33.3% <small>↑ 4.8%</small></strong></div>
          </article>
        </section>

        <footer className="system-note"><span>✓</span><div><strong>Foundation preview</strong><p>Live tenant, deal, quote, invoice and payment data comes next.</p></div><em>Day 1</em></footer>
      </section>
    </main>
  );
}
