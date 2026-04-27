"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";

/**
 * Dark-themed nav shared by every /developers/* dashboard sub-page.
 * Active route is highlighted via usePathname() match against each link's
 * href — so a new sub-page only needs to be added to NAV_ITEMS, no manual
 * per-page styling.
 *
 * UserButton stays — it's the only Clerk component the dashboard needs.
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
        height: "var(--nav-height)",
        background: "rgba(10, 10, 11, 0.78)",
        backdropFilter: "saturate(140%) blur(16px)",
        WebkitBackdropFilter: "saturate(140%) blur(16px)",
        borderBottom: "1px solid var(--ink-200)",
      }}
    >
      <div
        style={{
          maxWidth: "var(--container)",
          margin: "0 auto",
          padding: "0 var(--space-8)",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-12)",
        }}
      >
        <Link
          href="/developers"
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--space-3)",
            textDecoration: "none",
            color: "var(--ink-900)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-playfair), serif",
              fontWeight: 600,
              fontSize: "22px",
              letterSpacing: "-0.02em",
            }}
          >
            Onegent
          </span>
          <span
            style={{
              fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
              fontSize: "14px",
              fontWeight: 400,
              color: "var(--ink-500)",
              letterSpacing: "0.01em",
            }}
          >
            / Dashboard
          </span>
        </Link>

        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-8)",
          }}
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
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <UserButton
          appearance={{
            baseTheme: undefined,
            elements: {
              avatarBox: { width: "32px", height: "32px" },
            },
          }}
        />
      </div>
    </header>
  );
}
