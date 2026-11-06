"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  icon: string;
  /** Present once the module has a route; until then the item renders as "Soon". */
  href?: string;
};

// V1 modules from docs/product-spec.md §4, in lead-to-cash order.
const navItems: NavItem[] = [
  { label: "Overview", icon: "⌂", href: "/app" },
  { label: "Customers", icon: "◍", href: "/app/customers" },
  { label: "Leads", icon: "◉", href: "/app/leads" },
  { label: "Pipeline", icon: "◇", href: "/app/pipeline" },
  { label: "Catalogue", icon: "▦" },
  { label: "Quotes", icon: "▱" },
  { label: "Invoices", icon: "▤" },
  { label: "Payments", icon: "◎" },
  { label: "Collections", icon: "↗" },
];

/** A section is current on its own page and any page below it (Overview only on /app). */
function isCurrent(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="nav-list" aria-label="Primary navigation">
      {navItems.map((item) => {
        if (!item.href) {
          return (
            <span className="nav-soon" aria-disabled="true" key={item.label}>
              <span aria-hidden>{item.icon}</span>
              {item.label}
              <small>Soon</small>
            </span>
          );
        }
        const current = isCurrent(pathname, item.href);
        return (
          <Link
            className={current ? "active" : undefined}
            aria-current={current ? "page" : undefined}
            href={item.href}
            key={item.label}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
