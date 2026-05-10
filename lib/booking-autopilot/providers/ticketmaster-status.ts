/**
 * Pure Ticketmaster task-state classifier and host helper.
 *
 * Maps a TicketmasterRpaResult-shaped input plus a small set of side signals
 * (active-tab URL, local-browser-disconnect flag) into the user-visible task
 * state the executor should surface. Pure / no Page / no I/O / no async �?fully
 * unit-testable.
 *
 * This module is wired into the live executor after the 2026-05-07 founder
 * dogfood runs exposed distinct Ticketmaster boundaries: seat selection,
 * login, external ad tabs, local browser disconnects, and provider-start
 * event choice. The classifier is shipped as a typed contract so:
 *
 *   1. Future evidence-driven patches can replace the inline branching with
 *      a 1-line `classifyTicketmasterTaskState({...})` call.
 *   2. The 7 user-visible task states are now testable against a single
 *      source of truth, instead of being implicit in inline conditionals.
 *
 * Cross-references:
 *   - lib/booking-autopilot/providers/ticketmaster-rpa.ts (`bookTicketmasterProgrammatic`
 *     return shape �?what feeds this classifier)
 *   - lib/operator-failure-taxonomy/ (related-class taxonomy �?same vocabulary)
 *   - docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md (operator triage runbook)
 *   - docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md (DB / log /
 *     screenshot triage order, plus stuck-job recovery template)
 *
 * The 7 task states this classifier covers:
 *
 *   - "checkout_reached"
 *       RPA reached `checkout.ticketmaster.com` / `payments.ticketmaster.com`.
 *       Executor should fall through to the existing form-fill pipeline.
 *       UX: task stays running; no user action required yet.
 *
 *   - "user_seat_selection_required"
 *       Event page reached, seat map visible, but the user has not yet picked
 *       a seat (Reserve still disabled). Safe handoff: paused_payment.
 *       UX: "Ready for review �?choose a seat in the browser to continue".
 *       Related class on `safe_boundary_reached`.
 *
 *   - "user_event_choice_required"
 *       Provider-start page reached, but the event/date/showtime is not yet
 *       uniquely selected. Safe handoff: paused_payment.
 *       UX: ask which visible event or showtime to use, then continue.
 *
 *   - "user_login_required"
 *       Account / sign-in / OAuth boundary reached. Safe handoff:
 *       paused_payment. Never enter credentials. Related class on
 *       `safe_boundary_reached` / `otp_or_login_required`.
 *       UX: "Sign in in the live browser to continue".
 *
 *   - "external_ad_tab_detected"
 *       Active tab URL host is not Ticketmaster-owned (`*.ticketmaster.com` /
 *       `*.ticketmaster.ca`). The runtime drove the wrong tab. Mapped to
 *       executor status `error` with a clear, non-generic summary so the
 *       task does not look "live forever". Related class on
 *       `provider_logic_failure`.
 *       UX: "Close the ad tab and continue on Ticketmaster".
 *
 *   - "local_browser_disconnected"
 *       page.url() threw / local CDP target dropped before checkout. Mapped
 *       to executor status `error` so the task is not left running/loading
 *       indefinitely. Reconciliation domain (artifact-only stuck-job audit
 *       + founder-approved manual UPDATE), not a provider regression.
 *       Related class on `model_env_transient`.
 *       UX: "Browser disconnected before checkout �?reopen the task to retry".
 *
 *   - "unknown_failure"
 *       RPA returned without checkout, without handoff_ready/needs_login, and
 *       without a disconnect or ad-tab signal. Last fallback so the task does
 *       not look live forever. Mapped to `error`.
 *
 * Decision precedence (top-down):
 *   1. checkout_reached         �?success regardless of other signals
 *   2. local_browser_disconnected �?cannot trust other signals without the page
 *   3. external_ad_tab_detected   �?wrong host means wrong tab; do not trust
 *      handoff_ready / needs_login (they were computed from the ad tab)
 *   4. user_login_required       �?explicit account boundary
 *   5. user_event_choice_required �?provider-start page needs a user choice
 *   6. user_seat_selection_required �?any other handoff_ready run
 *   7. unknown_failure           �?last fallback
 *
 * Hard rules:
 *   - Never claim login was performed for the user.
 *   - Never assume the user picked a seat.
 *   - Never silently downgrade an external-tab error to a generic "Ticketmaster
 *     RPA did not reach checkout" �?that summary is what made it hard to spot
 *     ad-tab incidents in the original inline logic.
 */

export type TicketmasterTaskState =
  | "checkout_reached"
  | "user_seat_selection_required"
  | "user_event_choice_required"
  | "user_login_required"
  | "external_ad_tab_detected"
  | "local_browser_disconnected"
  | "unknown_failure";

/**
 * Executor status the surrounding stagehand-executor branch should return.
 * Subset of the existing `BrowserTaskStatus` union it already supports;
 * "running" is the fall-through-to-form-fill case (the executor does NOT
 * return early). "needs_login" is preserved as a distinct value because the
 * task-state mapper at `lib/api-v1/run-travel-task-attempt.ts` maps
 * `paused_payment | ready_for_confirmation` -> `ready_for_confirmation` and
 * `needs_login` -> `awaiting_login`; conflating the two would lose the more
 * accurate user-facing label for the account/session boundary.
 */
export type TicketmasterTaskExecutorStatus =
  | "running"
  | "paused_payment"
  | "needs_login"
  | "error";

export interface TicketmasterTaskInput {
  /** True if the RPA reached checkout / payments. */
  reachedCheckout: boolean;
  /** True if the RPA returned `needs_login = true`. */
  needsLogin: boolean;
  /** True if the RPA needs the user to choose event/date/showtime first. */
  needsUserChoice?: boolean;
  /** True if the RPA returned `handoff_ready = true`. */
  handoffReady: boolean;
  /**
   * The active-tab URL the RPA observed at handoff. May be empty if
   * page.url() threw on a disconnected target (the existing `getUrl` helper
   * in ticketmaster-rpa returns "" in that case).
   */
  currentUrl: string;
  /**
   * Explicit signal from the executor / RPA that the local browser / CDP
   * target is no longer reachable. The existing RPA does not set this today;
   * a future evidence-driven patch will. Until then callers can pass `false`
   * and let the empty-currentUrl path classify as `unknown_failure`.
   */
  localBrowserDisconnected: boolean;
  /** Optional explicit error message from the RPA (passed through). */
  errorMessage?: string;
  /** Optional summary message from the RPA (passed through). */
  summary?: string;
}

export interface TicketmasterTaskDecision {
  state: TicketmasterTaskState;
  /** What the executor should return / fall through to. */
  executorStatus: TicketmasterTaskExecutorStatus;
  /**
   * User-visible summary. Always concrete. Never says login was performed.
   * Never says a seat was picked. Never says "did not reach checkout"
   * generically when a more specific cause is known.
   */
  summary: string;
  /**
   * Whether the local browser should be held open for manual review (the
   * executor's existing `holdBrowserOpenForManualReview` call). False when
   * the run cannot be recovered manually (disconnect, unknown failure with
   * empty URL).
   */
  holdBrowserOpen: boolean;
}

const TICKETMASTER_HOSTS_EXACT = new Set<string>([
  "ticketmaster.com",
  "ticketmaster.ca",
  "ticketmaster.co.uk",
  "ticketmaster.com.au",
  "ticketmaster.de",
  "ticketmaster.fr",
  "ticketmaster.es",
  "ticketmaster.it",
  "ticketmaster.nl",
  "ticketmaster.ie",
]);

const TICKETMASTER_HOSTS_SUFFIX = [
  ".ticketmaster.com",
  ".ticketmaster.ca",
  ".ticketmaster.co.uk",
  ".ticketmaster.com.au",
  ".ticketmaster.de",
  ".ticketmaster.fr",
  ".ticketmaster.es",
  ".ticketmaster.it",
  ".ticketmaster.nl",
  ".ticketmaster.ie",
];

/**
 * True if `url` parses as an absolute URL whose hostname is a Ticketmaster-owned
 * host. False for non-absolute URLs, empty strings, parse errors, and any
 * non-Ticketmaster hostname (including `payments.ticketmaster.example.com`-
 * style impersonation attempts via subdomain manipulation).
 *
 * Used by the `external_ad_tab_detected` branch of the task-state classifier.
 * Also safe to use as a tab-filter primitive in any future
 * `getAllPages()`-based ad-tab guard.
 */
export function isTicketmasterDomainUrl(url: string): boolean {
  if (!url) return false;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  if (TICKETMASTER_HOSTS_EXACT.has(host)) return true;
  return TICKETMASTER_HOSTS_SUFFIX.some((suffix) => host.endsWith(suffix));
}

const FALLBACK_SUMMARY: Readonly<Record<TicketmasterTaskState, string>> =
  Object.freeze({
    checkout_reached:
      "Reached Ticketmaster checkout. Continuing with form fill.",
    user_seat_selection_required:
      "Ticketmaster page is ready for review. Choose a seat in the browser to continue.",
    user_event_choice_required:
      "Ticketmaster needs you to choose an event or showtime before I can continue.",
    user_login_required:
      "Ticketmaster needs you to sign in to continue. Open the live browser �?we won't enter account details for you.",
    external_ad_tab_detected:
      "An external ad tab opened during booking. Close the ad tab and continue on Ticketmaster.",
    local_browser_disconnected:
      "Ticketmaster browser session disconnected before checkout. Reopen the task to retry �?we won't keep this task running silently.",
    unknown_failure:
      "Couldn't reach Ticketmaster checkout. Open the link to finish manually.",
  });

/**
 * Classify a Ticketmaster RPA outcome into one of seven user-visible task
 * states. Pure / deterministic / no I/O.
 */
export function classifyTicketmasterTaskState(
  input: TicketmasterTaskInput,
): TicketmasterTaskDecision {
  // 1. Checkout reached: success regardless of other signals.
  if (input.reachedCheckout) {
    return {
      state: "checkout_reached",
      executorStatus: "running",
      summary: input.summary ?? FALLBACK_SUMMARY.checkout_reached,
      holdBrowserOpen: false,
    };
  }

  // 2. Local browser disconnect: cannot trust other signals.
  if (input.localBrowserDisconnected) {
    return {
      state: "local_browser_disconnected",
      executorStatus: "error",
      summary: input.summary ?? FALLBACK_SUMMARY.local_browser_disconnected,
      holdBrowserOpen: false,
    };
  }

  // 3. External ad tab: a non-empty URL on a non-Ticketmaster host means the
  //    runtime was driving the wrong tab. We surface a specific summary so the
  //    task is not classified as a generic "did not reach checkout" failure.
  //    NOTE: an empty currentUrl is not an ad tab �?it's either a disconnect
  //    (handled above) or an unknown failure (handled below).
  if (input.currentUrl !== "" && !isTicketmasterDomainUrl(input.currentUrl)) {
    return {
      state: "external_ad_tab_detected",
      executorStatus: "error",
      summary: input.summary ?? FALLBACK_SUMMARY.external_ad_tab_detected,
      holdBrowserOpen: true,
    };
  }

  // 4. Account / sign-in boundary. Returns `needs_login` (not
  //    `paused_payment`) so the upstream task-state mapper renders
  //    `awaiting_login`, the more accurate user-facing label, instead of
  //    `ready_for_confirmation`. The original inline executor branching
  //    conflated this with the seat-selection boundary.
  if (input.needsLogin) {
    return {
      state: "user_login_required",
      executorStatus: "needs_login",
      summary: input.summary ?? FALLBACK_SUMMARY.user_login_required,
      holdBrowserOpen: true,
    };
  }

  // 5. Provider-start event / showtime choice. Keep this separate from the
  // seat-selection checkpoint so task logs make clear what the user still
  // needs to decide.
  if (input.needsUserChoice) {
    return {
      state: "user_event_choice_required",
      executorStatus: "paused_payment",
      summary: input.summary ?? FALLBACK_SUMMARY.user_event_choice_required,
      holdBrowserOpen: true,
    };
  }

  // 6. Seat selection / generic safe handoff.
  if (input.handoffReady) {
    return {
      state: "user_seat_selection_required",
      executorStatus: "paused_payment",
      summary: input.summary ?? FALLBACK_SUMMARY.user_seat_selection_required,
      holdBrowserOpen: true,
    };
  }

  // 7. Last fallback: unknown failure. We avoid leaving the task looking live
  //    forever by returning `error` (not `running`).
  return {
    state: "unknown_failure",
    executorStatus: "error",
    summary:
      input.summary ?? input.errorMessage ?? FALLBACK_SUMMARY.unknown_failure,
    holdBrowserOpen: true,
  };
}

/**
 * The 7 task states, in their canonical order (matches the documentation in
 * the file header and the decision precedence). Exported so callers / tests
 * can iterate without re-deriving the list.
 */
export const TICKETMASTER_TASK_STATES: ReadonlyArray<TicketmasterTaskState> =
  Object.freeze([
    "checkout_reached",
    "user_seat_selection_required",
    "user_event_choice_required",
    "user_login_required",
    "external_ad_tab_detected",
    "local_browser_disconnected",
    "unknown_failure",
  ]);
