/**
 * Centralized end-user error copy.
 *
 * Use these instead of inlining new error strings — keeps tone consistent
 * across the product (no more "Failed to X" / "Internal error" / "Network
 * error." dev-speak leaking into the UI). Each entry is human-readable,
 * actionable, and matches the existing chat-card / toast voice.
 *
 * For scenario-specific errors that don't fit a template here, write the
 * inline string in the same voice: short, plain English, says what
 * happened + what to do.
 *
 * If/when we add i18n, this is the single replacement point. Until then
 * English-only by design — see lib/outputCopy.ts for the bilingual
 * planner-output helpers (different surface, different audience).
 */

export const UI_ERR = {
  /** Generic network failure — fetch threw or browser is offline. */
  network:
    "Connection problem. Check your network and try again.",

  /** Generic catch-all when we don't have specific context. Avoid when possible. */
  generic:
    "Something went wrong. Please try again in a moment.",

  /** Resource not found (404). */
  notFound: (what: string) =>
    `This ${what} doesn't exist or has been removed.`,

  /** Forbidden (403). */
  forbidden: (what: string) =>
    `You don't have access to this ${what}.`,

  /** Authentication required (401). */
  unauthenticated:
    "Please sign in first.",

  /** Generic load failure with refresh suggestion. */
  loadFailed: (what: string) =>
    `We couldn't load ${what}. Please refresh.`,

  /** Generic save / update failure. */
  saveFailed: (what: string) =>
    `We couldn't save ${what}. Try again in a moment.`,

  /** Server returned 5xx. */
  serverError:
    "Our servers had a hiccup. Try again in a moment.",
};
