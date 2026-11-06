import Link from "next/link";
import type { Workspace } from "@/lib/auth/session";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

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
      <NavLinks />
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
