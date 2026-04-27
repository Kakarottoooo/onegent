"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Sub-nav (tab strip) shared by every /developers/* dashboard sub-page.
 *
 * Why no logo or UserButton here: the global BrandStrip already provides
 * brand identity + account / sign-out controls at the very top of the
 * viewport. Repeating them in this dashboard sub-nav was creating a
 * double-stutter (two "Onegent" wordmarks, two avatars stacked) — a
 * classic Stripe-style "global nav + section tabs" layout fixes it.
 *
 * Active route is highlighted via usePathname() match against each link's
 * href so a new sub-page only needs to be added to NAV_ITEMS.
 */

const NAV_ITEMS: Array<{ href: string; label: string }> = [
  { href: "/developers", label: "Overview" },
  { href: "/developers/docs", label: "Docs" },
  { href: "/developers/keys", label: "API keys" },
  { href: "/developers/connected-apps", label: "Connected apps" },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: "rgba(10, 10, 11, 0.78)",
        backdropFilter: "saturate(140%) blur(16px)",
        WebkitBackdropFilter: "saturate(140%) blur(16px)",
        borderBottom: "1px solid var(--ink-200)",
      }}
    >
      <nav
        style={{
          maxWidth: "var(--container)",
          margin: "0 auto",
          padding: "0 var(--space-8)",
          height: "44px",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-8)",
        }}
        aria-label="Dashboard sections"
      >
        {NAV_ITEMS.map((item) => {
          // Exact match for /developers (root), prefix match for sub-pages.
          const isActive =
            item.href === "/developers"
              ? pathname === item.href
              : pathname?.startsWith(item.href) ?? false;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                color: isActive ? "var(--accent)" : "var(--ink-500)",
                textDecoration: "none",
                fontSize: "14px",
                fontWeight: isActive ? 500 : 400,
                position: "relative",
                paddingBottom: "2px",
                borderBottom: isActive
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
                transition: "color 120ms ease, border-color 120ms ease",
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
