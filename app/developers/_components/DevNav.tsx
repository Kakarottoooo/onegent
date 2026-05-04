"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";

const clerkEnabled =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_") &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_test_placeholder";

/**
 * Developer surface nav — sticky, transparent at the top, gains a hairline
 * border + backdrop-blur once the user scrolls. Hides itself entirely on
 * /developers/keys so the dashboard can render its own dark-themed nav
 * without two stacked headers.
 */
export function DevNav() {
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  // ALL hooks must run on every render — never put a useEffect after
  // the early-return below or React will yell about hook count drift.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Dashboard owns its own chrome; suppress the marketing nav there.
  if (pathname?.startsWith("/developers/keys")) {
    return null;
  }

  return (
    <header
      data-scrolled={scrolled || undefined}
      className="dev-nav"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        height: "var(--nav-height)",
        backdropFilter: scrolled ? "saturate(140%) blur(16px)" : "none",
        WebkitBackdropFilter: scrolled ? "saturate(140%) blur(16px)" : "none",
        backgroundColor: scrolled ? "rgba(255, 255, 255, 0.78)" : "transparent",
        borderBottom: scrolled ? "1px solid var(--ink-200)" : "1px solid transparent",
        transition:
          "background-color var(--motion-base) var(--ease-out-soft)," +
          "border-color var(--motion-base) var(--ease-out-soft)," +
          "backdrop-filter var(--motion-base) var(--ease-out-soft)",
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
        {/* Wordmark */}
        <Link
          href="/developers"
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--space-3)",
            textDecoration: "none",
            color: "var(--ink-900)",
          }}
          aria-label="Onegent Developers — home"
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
            / Developers
          </span>
        </Link>

        {/* Center nav links */}
        <nav
          aria-label="Primary"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-8)",
          }}
          className="dev-nav-links"
        >
          <NavLink href="/developers/docs">Docs</NavLink>
          <NavLink href="/developers/pricing">Pricing</NavLink>
          {clerkEnabled && <DeveloperDashboardLink />}
        </nav>

        {/* Right CTA cluster */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
          }}
        >
          {clerkEnabled ? <DeveloperAuthControls /> : <DeveloperKeysLink />}
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 720px) {
          :global(.dev-nav-links) {
            display: none !important;
          }
        }
      `}</style>
    </header>
  );
}

function DeveloperDashboardLink() {
  const { isSignedIn, isLoaded } = useUser();
  return isLoaded && isSignedIn ? <NavLink href="/developers/keys">Dashboard</NavLink> : null;
}

function DeveloperAuthControls() {
  const { isSignedIn, isLoaded } = useUser();

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <>
        <SignInButton mode="modal">
          <button
            type="button"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--ink-700)",
              fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
              fontSize: "15px",
              fontWeight: 500,
              cursor: "pointer",
              padding: "var(--space-2) var(--space-3)",
            }}
          >
            Sign in
          </button>
        </SignInButton>
        <DeveloperKeysLink />
      </>
    );
  }

  return (
    <UserButton
      appearance={{
        elements: {
          avatarBox: { width: "32px", height: "32px" },
        },
      }}
    />
  );
}

function DeveloperKeysLink() {
  return (
    <Link href="/developers/keys" className="dev-cta-pill">
      Get API key
    </Link>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
        fontSize: "15px",
        fontWeight: 500,
        color: "var(--ink-700)",
        textDecoration: "none",
        padding: "var(--space-2) 0",
        position: "relative",
        transition: "color var(--motion-fast) var(--ease-out-soft)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink-900)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-700)")}
    >
      {children}
    </Link>
  );
}
