import Link from "next/link";
import type { Workspace } from "@/lib/auth/session";
import { SignOutButton } from "./sign-out-button";

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

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

const roleLabel = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

export function Sidebar({ workspace }: { workspace: Workspace }) {
  const { organization, user, role } = workspace;
  return (
    <aside className="sidebar">
      <Link className="brand" href="/">
        <span className="brand-mark">M</span>
        <span>MomentumDesk</span>
      </Link>
      <div className="workspace-switcher">
        <span className="workspace-avatar">{initials(organization.name)}</span>
        <span>
          <strong>{organization.name}</strong>
          <small>
            {organization.baseCurrency} base · {roleLabel(role)}
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
      <Link className="settings" href="/app/team">
        <span aria-hidden>☷</span> <span>Team</span>
      </Link>
      <Link className="settings settings-secondary" href="/app/settings">
        <span aria-hidden>⚙</span> <span>Settings</span>
      </Link>
      <div className="profile">
        <span className="profile-avatar">{initials(user.name)}</span>
        <span>
          <strong>{user.name}</strong>
          <small>{user.email}</small>
        </span>
        <SignOutButton />
      </div>
    </aside>
  );
}
