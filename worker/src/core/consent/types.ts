/**
 * lib/core/consent · public types
 *
 * ConsentPolicy is the B 端 contract that tells the executor which
 * autonomous decisions it may make on the caller's behalf. When the
 * caller is our own C 端 Next.js route, we pass DEFAULT_CONSENT_POLICY
 * (equivalent to today's full-autonomy behavior). When the caller is an
 * external agent via REST / MCP, they hand us a policy that narrows the
 * executor's authority — e.g. "no time adjustments, don't retry more
 * than once, only use OpenTable".
 *
 * Validation happens at the executor's decision points (not at request
 * entry) — see validator.ts. A request with a restrictive policy isn't
 * rejected up-front; it's executed until the executor needs to make a
 * decision the policy forbids, at which point the job yields with a
 * reason string so the caller knows why we stopped short.
 */

// ─── The policy itself ───────────────────────────────────────────────────────

export interface ConsentPolicy {
  /**
   * Whether the executor may try alternate time slots when the user's
   * requested slot is unavailable.
   * C 端 default: true (today's time-fallback loop, ±30/60/90min).
   */
  allowTimeAdjustment?: boolean;
  /**
   * Maximum minutes of time shift the executor may try.
   * Only consulted when allowTimeAdjustment === true.
   * C 端 default: 90 (widest band of filterTimeFallbacks today).
   */
  maxTimeAdjustmentMinutes?: number;

  /**
   * Whether the executor may switch to a backup venue/hotel/restaurant
   * when the primary is unavailable.
   * C 端 default: true (today's fallbackCandidates path).
   */
  allowVenueSwitch?: boolean;

  /**
   * Maximum per-step retry count on transient errors (network / timeout).
   * C 端 default: 3 (today's recovery.ts).
   */
  maxRetries?: number;

  /**
   * Where the executor must stop in the payment flow.
   *
   *   "stop_before_cvc"    — fill everything up to (but not including) CVC.
   *                           This is the PCI iframe boundary — caller's
   *                           end-user completes payment via handoffUrl.
   *                           C 端 default.
   *   "stop_before_card"   — stop before touching any card field. Caller's
   *                           end-user fills the entire payment form.
   *   "user_pays_elsewhere" — don't touch the payment page at all; executor
   *                           stops at the cart/summary page and hands off.
   *
   * Note: the executor NEVER auto-submits payment regardless of this field.
   * `submit_payment` is not a permissible action in this version — the PCI
   * iframe boundary is a physical (not policy) limit.
   */
  paymentPolicy?: "stop_before_cvc" | "stop_before_card" | "user_pays_elsewhere";

  /**
   * Provider allow-list. If set, executor will ONLY use providers whose id
   * is in this list (e.g. ["opentable-com"] to force OpenTable, skip Resy
   * fallback). Omit for "any provider OK".
   */
  allowedProviders?: string[];
  /**
   * Provider block-list. If set, executor will NOT use providers in this
   * list even if they're the best match for the request. Takes precedence
   * over allowedProviders (blocked > allowed > default).
   */
  blockedProviders?: string[];

  /**
   * Maximum wall-clock seconds the entire job may run before the executor
   * forcibly aborts with status="error".
   * C 端 default: 420 (matches BROWSER_TASK_TIMEOUT_MS = 7min in
   * app/api/booking-jobs/[id]/start/route.ts).
   */
  maxJobDurationSeconds?: number;
}

// ─── Action types the executor asks permission for ───────────────────────────
// validator.validateConsent(policy, action) is called at each decision point
// in the executor. These four actions are the only ones that today's C 端
// executor actually branches on — adding new action types requires both a
// new variant here AND new `switch` branch in validator.ts.

export type ConsentAction =
  /** Executor wants to try a different time slot (restaurant no-availability). */
  | { type: "adjust_time"; fromTime: string; toTime: string }
  /** Executor wants to switch to a backup venue (hotel/restaurant primary failed). */
  | { type: "switch_venue"; fromVenue: string; toVenue: string }
  /** Executor wants to retry the current step after a transient error. */
  | { type: "retry"; attemptNumber: number }
  /**
   * Executor wants to route the request to a specific provider
   * (e.g. Resy as a fallback when OpenTable failed).
   */
  | { type: "use_provider"; providerId: string };

// ─── Validation result ───────────────────────────────────────────────────────

export type ValidationResult =
  | { allowed: true }
  | { allowed: false; reason: string };
