/**
 * Shared Tailwind class strings built on the project's design tokens
 * (see app/globals.css for the CSS variables).
 *
 * Use these instead of hardcoding bg-gray-* / text-gray-* / bg-white /
 * bg-gray-900 — those break in dark mode because the body text color
 * switches to cream while the hardcoded backgrounds stay light, making
 * inputs invisible.
 *
 * Import pattern:
 *   import { CARD, INPUT, CTA, PILL_OFF, PILL_ON } from "@/app/_ui/tokens";
 */

// Surface containers
export const CARD =
  "bg-[var(--card)] rounded-2xl border border-[var(--border)]";

export const CARD_MUTED =
  "bg-[var(--card-2)] rounded-2xl border border-[var(--border)]";

// Form inputs — critical: always set text color explicitly so dark-mode
// body color (cream) does not make typed text invisible on light cards.
export const INPUT =
  "border border-[var(--border)] rounded-xl p-2 text-sm " +
  "bg-[var(--card)] text-[var(--text-primary)] " +
  "placeholder:text-[var(--text-muted)] " +
  "focus:outline-none focus:border-[var(--gold)]";

// Primary CTA — dark brown button on cream body.
export const CTA =
  "rounded-xl bg-[var(--text-primary)] text-[var(--bg)] " +
  "text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity";

// Secondary CTA — gold accent.
export const CTA_GOLD =
  "rounded-xl bg-[var(--gold)] text-white " +
  "text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity";

// Ghost/outline button.
export const CTA_GHOST =
  "rounded-xl border border-[var(--border)] bg-transparent " +
  "text-[var(--text-primary)] text-sm font-medium " +
  "hover:border-[var(--gold)] disabled:opacity-40 transition-colors";

// Toggleable pills (filter chips, picker items).
export const PILL_OFF =
  "px-3 py-1.5 rounded-full border border-[var(--border)] " +
  "text-xs text-[var(--text-secondary)] bg-[var(--card)] " +
  "hover:border-[var(--gold)] transition-colors";

export const PILL_ON =
  "px-3 py-1.5 rounded-full border border-[var(--gold)] " +
  "bg-[var(--gold)] text-white text-xs transition-colors";

// Hero / branded dark card — warm dark brown gradient that matches the
// project's gold accent without feeling like a cold gray enterprise UI.
export const HERO_BG: React.CSSProperties = {
  backgroundImage: "linear-gradient(135deg, #2C2416 0%, #4A3F2F 100%)",
  border: "0.5px solid var(--border)",
};

// Text helpers
export const TEXT_PRIMARY = "text-[var(--text-primary)]";
export const TEXT_SECONDARY = "text-[var(--text-secondary)]";
export const TEXT_MUTED = "text-[var(--text-muted)]";
export const TEXT_GOLD = "text-[var(--gold)]";

// Page wrapper — relies on body's var(--bg) rather than hardcoded bg-gray-50.
export const PAGE =
  "min-h-screen font-[family-name:var(--font-dm-sans)]";
