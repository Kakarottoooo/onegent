"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

/**
 * Dark-themed nav for /developers/keys. Mirrors DevNav structure but
 * uses dashboard tokens (which flip via data-theme="dashboard" on the
 * wrapper). UserButton stays — it's the only Clerk component the
 * dashboard needs.
 */
export function DashboardNav() {
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
          <Link href="/developers" style={{ color: "var(--ink-500)", textDecoration: "none", fontSize: "14px" }}>
            Overview
          </Link>
          <Link href="/developers/docs" style={{ color: "var(--ink-500)", textDecoration: "none", fontSize: "14px" }}>
            Docs
          </Link>
          <Link
            href="/developers/keys"
            style={{
              color: "var(--accent)",
              textDecoration: "none",
              fontSize: "14px",
              fontWeight: 500,
            }}
          >
            API keys
          </Link>
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
