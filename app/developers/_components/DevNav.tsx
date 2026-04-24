"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SignInButton, UserButton, useUser } from "@clerk/nextjs";

/**
 * Developer surface nav — sticky, transparent at the top, gains a hairline
 * border + backdrop-blur once the user scrolls. Hides itself entirely on
 * /developers/keys so the dashboard can render its own dark-themed nav
 * without two stacked headers.
 */
export function DevNav() {
  const [scrolled, setScrolled] = useState(false);
  const { isSignedIn, isLoaded } = useUser();
  const pathname = usePathname();

  // Dashboard owns its own chrome; suppress the marketing nav there.
  if (pathname?.startsWith("/developers/keys")) {
    return null;
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Don't render auth UI until Clerk has hydrated, otherwise the
  // signed-in/out branches flicker on every page load.
  const showSignedIn = isLoaded && isSignedIn;
  const showSignedOut = isLoaded && !isSignedIn;

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
          {showSignedIn && <NavLink href="/developers/keys">Dashboard</NavLink>}
        </nav>

        {/* Right CTA cluster */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
          }}
        >
          {showSignedOut && (
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
              <Link href="/developers/keys" className="dev-cta-pill">
                Get API key
              </Link>
            </>
          )}
          {showSignedIn && (
            <UserButton
              appearance={{
                elements: {
                  avatarBox: { width: "32px", height: "32px" },
                },
              }}
            />
          )}
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
