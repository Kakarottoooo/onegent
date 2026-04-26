/**
 * lib/core/execution/should-try-fallback · trigger predicate for Phase 3
 *
 * Decides whether to escalate from the primary provider to the provider
 * fallback chain (recovery-providers.tryProviderFallbackChain).
 *
 * Why this lives in its own file:
 *   - The original Phase 3 trigger was a 1-line inline check
 *     (`status === "no_availability" && scenario === "restaurant"`).
 *     It missed the most common real-world case where OpenTable is the
 *     primary, the venue exists in OpenTable's index but uses its own
 *     reservation system (Carbone, Le Bernardin, Osteria La Baia, Ci Siamo
 *     etc.), so the executor returns status="error" instead of
 *     "no_availability" — and Phase 3 never fired.
 *   - That logic is now whitelist-shaped (multiple regex patterns), so it
 *     deserves its own home with unit tests rather than living inline.
 *
 * Whitelist > blacklist by design: only escalate to Phase 3 when the
 * failure shape resembles "venue probably exists on another provider".
 * Pure infra failures (page didn't load, quota exceeded, bot block)
 * are fast-failed via the deny list — trying Resy after a 402 quota
 * error wastes 2-3 minutes for no chance of success.
 */

export interface FallbackTriggerInput {
  scenario: string;
  status: string;
  summary: string;
  error?: string;
}

/**
 * Phrases that suggest the venue might exist on another provider even
 * though the primary attempt couldn't complete the booking.
 *
 * Each entry is a regex of patterns we've actually seen in production
 * summary/error strings emitted by lib/booking-autopilot/core/final-outcome.ts
 * and lib/booking-autopilot/stagehand-executor.ts.
 */
const FALLBACK_WORTHY_PATTERNS: readonly RegExp[] = [
  // Explicit "not in this provider's index" — already handled today, kept here for parity.
  /not found on (opentable|resy|yelp)/i,

  // Agent navigated but stuck mid-flow — venue exists but workflow couldn't proceed.
  /\b(stalled|stuck|stopped) at\b/i,
  /agent stopped at an intermediate/i,

  // Stage assessment never recognised a booking widget — strongest signal that
  // the venue uses a non-standard system. Carbone / Le Bernardin / Osteria La
  // Baia all hit this path: they appear in OpenTable search results, the agent
  // clicks through, but the detail page has no embedded booking widget so
  // assessBookingStage returns "unknown".
  /no recogni[sz]able page signals/i,
  /\bstage[ :=]unknown\b/i,

  // Final-outcome detected a payment-like page without filled fields — usually
  // means the venue's "reservations" CTA dropped the user on a different
  // platform's checkout the agent didn't recognise.
  /unverified checkout field/i,
  /guest.*values were not verified/i,
  /reached a payment-like page/i,

  // Free-text signals from agent message indicating handoff to venue's own system.
  /reservations? not (yet )?available (on|through)/i,
  /book.*(through|on) (their|its) (own|website|direct)/i,
];

/**
 * Patterns that explicitly DENY fallback even if the status is otherwise
 * recovery-eligible. These are infra/quota issues where Resy will hit
 * the same problem (or be unrelated to the failure).
 */
const FALLBACK_BLOCKED_PATTERNS: readonly RegExp[] = [
  // Browser failed to render the page at all.
  /page load failed|browser failed/i,
  /chrome-error|about:blank/i,

  // LLM/automation provider rejected the request (quota, billing, key).
  /quota|billing/i,
  /\bHTTP 4(0[12]|29)\b/, // 401 / 402 / 429

  // Bot protection — manual handoff is the right answer, not retry on Resy.
  /blocked the automated browser|bot protection/i,

  // Hard captcha — handled by status="captcha" in most paths but defense in depth.
  /captcha/i,
];

/**
 * Decide whether to enter Phase 3 (provider fallback chain).
 *
 * Truth table:
 *   scenario != "restaurant"               → false  (Phase 3 is restaurant-only here)
 *   status   = "no_availability"           → true   (classic case, always try)
 *   status   = "error" + worthy match      → true   (new: venue-elsewhere signal)
 *   status   = "error" + blocked match     → false  (infra issue — fast fail)
 *   status   = "error" + no whitelist hit  → false  (default: do not waste a 2-3 min Resy run)
 *   any other status                       → false  (captcha / needs_login / completed / paused_payment)
 */
export function shouldTryProviderFallback(input: FallbackTriggerInput): boolean {
  // Phase 3 is restaurant-only at this layer.
  // Hotel/flight/activity have different multi-provider strategies.
  if (input.scenario !== "restaurant") return false;

  // Classic case: the primary explicitly reported "couldn't book here".
  if (input.status === "no_availability") return true;

  // Expanded case: status="error" but the failure shape suggests the venue
  // exists somewhere else. Whitelist-only — anything not matching defaults
  // to no-fallback so we don't burn a Resy run on transient infra issues.
  if (input.status === "error") {
    const haystack = `${input.summary} ${input.error ?? ""}`;

    // Fast deny: infra / quota / bot block — Resy won't help.
    if (FALLBACK_BLOCKED_PATTERNS.some((re) => re.test(haystack))) {
      return false;
    }

    // Slow allow: at least one whitelist pattern matched.
    return FALLBACK_WORTHY_PATTERNS.some((re) => re.test(haystack));
  }

  // captcha / needs_login / paused_payment / completed — none of these
  // benefit from a provider switch.
  return false;
}
