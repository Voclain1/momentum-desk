import Link from "next/link";
import { demoWorkspace } from "../_data/demo-dashboard";

type NavItem = {
  label: string;
  icon: string;
  /** Present once the module has a route; until then the item renders as "Soon". */
  href?: "/app";
  badge?: number;
};

// V1 modules from docs/product-spec.md §4, in lead-to-cash order.
const navItems: NavItem[] = [
  { label: "Overview", icon: "⌂", href: "/app" },
  { label: "Customers", icon: "◍" },
  { label: "Leads", icon: "◉" },
  { label: "Pipeline", icon: "◇" },
  { label: "Catalogue", icon: "▦" },
  { label: "Quotes", icon: "▱" },
  { label: "Invoices", icon: "▤" },
  { label: "Payments", icon: "◎" },
  { label: "Collections", icon: "↗", badge: 8 },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <Link className="brand" href="/">
        <span className="brand-mark">M</span>
        <span>MomentumDesk</span>
      </Link>
      <div className="workspace-switcher">
        <span className="workspace-avatar">{demoWorkspace.initials}</span>
        <span>
          <strong>{demoWorkspace.name}</strong>
          <small>
            {demoWorkspace.baseCurrency} base · {demoWorkspace.role}
          </small>
        </span>
        <span aria-hidden>⌄</span>
      </div>
      <nav className="nav-list" aria-label="Primary navigation">
        {navItems.map((item) =>
          item.href ? (
            <Link className="active" aria-current="page" href={item.href} key={item.label}>
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          ) : (
            <span className="nav-soon" aria-disabled="true" key={item.label}>
              <span aria-hidden>{item.icon}</span>
              {item.label}
              {item.badge !== undefined ? <em>{item.badge}</em> : <small>Soon</small>}
            </span>
          ),
        )}
      </nav>
      <div className="sidebar-spacer" />
      <div className="ai-card">
        <strong>
          <span aria-hidden>✦</span> Momentum AI
        </strong>
        <p>5 actions could move revenue forward today.</p>
        <button type="button">Review suggestions</button>
      </div>
      <span className="settings">
        <span aria-hidden>⚙</span> <span>Settings</span>
      </span>
      <div className="profile">
        <span className="profile-avatar">SO</span>
        <span>
          <strong>Sample owner</strong>
          <small>Product preview</small>
        </span>
        <span aria-hidden>•••</span>
      </div>
    </aside>
  );
}
