"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import "./brand-strip.css";

/**
 * Top-of-viewport utility strip — Apple-style brand chrome that lives
 * above both surfaces (the consumer chat app and /developers/*) so any
 * visitor can hop sideways with one click.
 *
 * Scrolls away on scroll (position: relative) — the per-surface main
 * navs still sticky to the viewport top below it.
 *
 * Current surface is detected from pathname; that side gets a small
 * gold dot as the "you are here" cue (Apple uses dim grey, we use a
 * pinpoint gold which carries our brand without screaming).
 */
export function BrandStrip() {
  const pathname = usePathname() ?? "/";
  const current: "travelers" | "developers" = pathname.startsWith("/developers")
    ? "developers"
    : "travelers";

  return (
    <div className="brand-strip" role="banner">
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
