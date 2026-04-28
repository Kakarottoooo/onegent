import type { CSSProperties, ReactNode } from "react";

/**
 * Editorial design primitives — extracted from /pricing so any page that
 * wants the same Apple/Linear/Stripe-tier polish (big serif hero, eyebrow
 * badges, card variants) gets it via three components instead of 200 lines
 * of inline styles per page.
 *
 * Theme-aware: every visual prop reads from var() tokens defined in
 * app/globals.css — so light/dark/prefers-color-scheme switches Just Work
 * without component changes.
 *
 * Surfaces using these:
 *   /pricing                    — marketing hero, two tier cards, FAQ
 *   /account                    — page hero + 5 tab content shells
 *   future: /insights, /tasks   — same hero + section card pattern
 */

// ═══════════════════════════════════════════════════════════════════════════
// EditorialHero
// ═══════════════════════════════════════════════════════════════════════════
//
// The page-top headline block. Two sizes:
//   marketing — for /pricing-style landing surfaces (clamp 40-72px)
//   page      — for /account-style functional surfaces (clamp 32-56px)
//
// Two alignments:
//   left   — default, for in-app pages
//   center — for marketing pages (forces marginInline: auto + max-width)
//
// Optional eyebrow renders as a filled gold-soft badge above the title.

export type EditorialHeroProps = {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: "left" | "center";
  size?: "marketing" | "page";
  children?: ReactNode;
};

export function EditorialHero({
  eyebrow,
  title,
  subtitle,
  align = "left",
  size = "page",
  children,
}: EditorialHeroProps) {
  const titleSize =
    size === "marketing"
      ? "clamp(40px, 7vw, 72px)"
      : "clamp(32px, 5vw, 56px)";
  const titleMaxWidth = size === "marketing" ? "16ch" : "24ch";
  const subtitleSize = size === "marketing" ? "19px" : "17px";

  const wrapperStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-5)",
    alignItems: align === "center" ? "center" : "flex-start",
    textAlign: align,
    marginBottom: "var(--space-12)",
  };
  if (align === "center") {
    wrapperStyle.maxWidth = "880px";
    wrapperStyle.marginInline = "auto";
  }

  return (
    <header style={wrapperStyle}>
      {eyebrow ? <EyebrowLabel variant="filled">{eyebrow}</EyebrowLabel> : null}
      <h1
        style={{
          fontFamily: "var(--font-playfair), Georgia, serif",
          fontSize: titleSize,
          fontWeight: 600,
          lineHeight: 1.05,
          letterSpacing: "-0.025em",
          margin: 0,
          color: "var(--ink-9)",
          maxWidth: titleMaxWidth,
        }}
      >
        {title}
      </h1>
      {subtitle ? (
        <p
          style={{
            fontSize: subtitleSize,
            lineHeight: 1.6,
            color: "var(--ink-6)",
            maxWidth: "52ch",
            margin: 0,
          }}
        >
          {subtitle}
        </p>
      ) : null}
      {children}
    </header>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EyebrowLabel
// ═══════════════════════════════════════════════════════════════════════════
//
// Three variants:
//   default — uppercase tracked text in muted ink (for section headers in
//             cards where a filled badge would feel too heavy)
//   muted   — same shape but lower contrast (sub-section tertiary)
//   filled  — gold-soft badge with rounded-pill — used for hero eyebrows
//             and "Recommended" / "PRO" tier markers

export type EyebrowVariant = "default" | "muted" | "filled";

export function EyebrowLabel({
  children,
  variant = "default",
  as: Component = "span",
}: {
  children: ReactNode;
  variant?: EyebrowVariant;
  as?: "span" | "div" | "p";
}) {
  const base: CSSProperties = {
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
    margin: 0,
  };
  const variants: Record<EyebrowVariant, CSSProperties> = {
    default: { color: "var(--ink-5)" },
    muted: { color: "var(--ink-4)" },
    filled: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--space-2)",
      color: "var(--gold-text)",
      background: "var(--gold-soft)",
      padding: "6px 14px",
      borderRadius: "var(--radius-pill)",
    },
  };
  return <Component style={{ ...base, ...variants[variant] }}>{children}</Component>;
}

// ═══════════════════════════════════════════════════════════════════════════
// EditorialCard
// ═══════════════════════════════════════════════════════════════════════════
//
// Three card variants:
//   flat       — default white/card-bg with subtle border (most content)
//   highlight  — gold-soft gradient + gold border (CTA / tier-recommended)
//   premium    — dark warm gradient with gold tint border (premium content
//                like /account Identity tab — the "this is your private
//                identity layer" feel)
//
// Three padding scales:
//   tight    (24px)  — dense lists / settings
//   default  (32px)  — most content
//   spacious (48px)  — marquee tier cards

export type EditorialCardVariant = "flat" | "highlight" | "premium";
export type EditorialCardPadding = "tight" | "default" | "spacious";

export function EditorialCard({
  variant = "flat",
  padding = "default",
  children,
  style,
  as: Component = "article",
}: {
  variant?: EditorialCardVariant;
  padding?: EditorialCardPadding;
  children: ReactNode;
  style?: CSSProperties;
  as?: "article" | "section" | "div";
}) {
  const padMap: Record<EditorialCardPadding, string> = {
    tight: "var(--space-6)",
    default: "var(--space-8)",
    spacious: "var(--space-12) var(--space-10)",
  };

  const variants: Record<EditorialCardVariant, CSSProperties> = {
    flat: {
      background: "var(--card)",
      border: "1px solid var(--ink-3)",
      borderRadius: "var(--radius-2xl)",
      color: "var(--ink-8)",
    },
    highlight: {
      background:
        "linear-gradient(180deg, var(--card) 0%, var(--gold-soft) 100%)",
      border: "1px solid var(--gold)",
      borderRadius: "var(--radius-2xl)",
      boxShadow: "var(--shadow-3)",
      color: "var(--ink-9)",
    },
    premium: {
      background:
        "linear-gradient(180deg, rgba(42,38,33,0.96) 0%, rgba(31,28,25,0.98) 100%)",
      border: "0.5px solid rgba(201,168,76,0.22)",
      borderRadius: "var(--radius-2xl)",
      boxShadow: "0 24px 60px rgba(0,0,0,0.16)",
      color: "#F8F2E7",
    },
  };

  return (
    <Component
      style={{
        ...variants[variant],
        padding: padMap[padding],
        ...style,
      }}
    >
      {children}
    </Component>
  );
}
