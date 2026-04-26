"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import "./brand-strip.css";

/**
 * Top-of-viewport utility strip — Apple-style brand chrome that lives
 * above both surfaces (the consumer chat app and /developers/*) so any
 * visitor can hop sideways with one click.
 *
 * Visibility model: hidden by default; reveals when the user wheel-scrolls
 * with the cursor parked over the top nav zone (the strip + GlobalNav,
 * roughly the top 80px of viewport). Auto-hides 1.8s after the cursor
 * leaves the zone or scroll activity stops.
 *
 * Why this gesture: a hover-only hot zone was too thin to discover; a
 * page-scroll trigger fired in the wrong moments (every chat reply
 * pushed scroll). Wheel-on-nav is intentional — only when the user is
 * already looking at the top of the page do we surface the surface
 * switcher, then it gets out of the way.
 *
 * Touch / mobile sticks with the always-on 36px shape (no wheel concept).
 */
export function BrandStrip() {
  const pathname = usePathname() ?? "/";
  const current: "travelers" | "developers" = pathname.startsWith("/developers")
    ? "developers"
    : "travelers";

  // Hidden by default; revealed only by intentional wheel-on-nav.
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Bail on touch-only devices — wheel events don't exist meaningfully
    // there. Force the strip visible so the surface tabs aren't trapped.
    if (window.matchMedia("(hover: none)").matches) {
      setHidden(false);
      return;
    }

    // BrandStrip 36px + GlobalNav ~44px ≈ 80px top zone where the user is
    // intentionally looking at chrome. A wheel event with the cursor here
    // is the "summon the strip" signal.
    const NAV_ZONE_PX = 80;
    const IDLE_HIDE_MS = 1800;
    let mouseY = 9999;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    function clearHide() {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    }
    function scheduleHide() {
      clearHide();
      hideTimer = setTimeout(() => setHidden(true), IDLE_HIDE_MS);
    }

    function onMouseMove(e: MouseEvent) {
      mouseY = e.clientY;
      if (mouseY > NAV_ZONE_PX) {
        // Cursor left the nav zone — start the auto-hide countdown.
        scheduleHide();
      } else {
        // Cursor parked in the nav zone — keep the strip visible while
        // the user is interacting with it (clicking a tab etc.).
        clearHide();
      }
    }

    function onWheel() {
      // Only react to wheel events that happen while the cursor is in the
      // nav zone — wheel anywhere else is the user reading the body of the
      // page and shouldn't surface the brand strip.
      if (mouseY <= NAV_ZONE_PX) {
        setHidden(false);
        scheduleHide();
      }
    }

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("wheel", onWheel);
      clearHide();
    };
  }, []);

  return (
    <div
      className={`brand-strip${hidden ? " brand-strip--hidden" : ""}`}
      role="banner"
    >
      <div className="brand-strip-inner">
        <Link href="/" className="brand-strip-mark" aria-label="Onegent home">
          <span>Onegent</span>
          <span className="brand-strip-mark-dot">.</span>
        </Link>

        <nav className="brand-strip-tabs" aria-label="Surface switcher">
          <Link
            href="/"
            className="brand-strip-tab"
            data-current={current === "travelers"}
          >
            For travelers
          </Link>
          <span className="brand-strip-divider" aria-hidden="true" />
          <Link
            href="/developers"
            className="brand-strip-tab"
            data-current={current === "developers"}
          >
            For developers
          </Link>
        </nav>

        <span className="brand-strip-spacer" aria-hidden="true" />
      </div>
    </div>
  );
}
