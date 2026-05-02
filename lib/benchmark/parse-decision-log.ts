/**
 * Pure helpers that classify a booking_job step result back into the
 * benchmark domain (success / failure_reason).
 *
 * Kept dependency-free so it can be unit-tested without DB access.
 */

import { DRY_RUN_BOUNDARY_MARKER } from "@/lib/booking-autopilot/dry-run";
import type { FailureReason, BenchmarkCaseStatus, RestaurantBenchmarkCase } from "./types";

/** Minimal shape of step.decisionLog entry that matters to the classifier. */
export interface DecisionLogEntryLike {
  type: string;
  message: string;
  outcome?: string;
}

/** Minimal shape of booking_jobs.steps[] that matters to the classifier. */
export interface BenchmarkBookingStep {
  status: string;
  error?: string | null;
  decisionLog?: DecisionLogEntryLike[] | null;
}

export interface ClassifiedCaseResult {
  status: BenchmarkCaseStatus;
  success: boolean;
  failure_reason: FailureReason | null;
  payment_stop_triggered: boolean;
  human_handoff_required: boolean;
  // ─── v1 outcome flags (added 2026-04-30) ─────────────────────────────
  /** Safe = success OR (no_availability / payment_stop / verify_gate /
   *  deep_link_handoff / unsupported_platform). Wrong action = false. */
  safe_outcome: boolean;
  /** Boundary hit AND no human-touch boundary (no payment_stop, handoff,
   *  or verify_gate). The "true full automation" rate. */
  fully_automated_success: boolean;
  /** Executor encountered an SMS / OTP / email verify gate. */
  verify_gate_triggered: boolean;
  /** Executor recognised venue isn't online-bookable and handed off. */
  deep_link_handoff_triggered: boolean;
  /** Executor took a wrong action (wrong date / time / party size). */
  wrong_action_taken: boolean;
  /** Venue uses Tock / SevenRooms / similar unsupported platform. */
  unsupported_platform_detected: boolean;
}

/**
 * True when the step's decisionLog contains the dry_run boundary marker
 * written by the OpenTable / Resy providers.
 */
export function decisionLogHitDryRunBoundary(
  decisionLog: DecisionLogEntryLike[] | null | undefined,
): boolean {
  if (!decisionLog || decisionLog.length === 0) return false;
  return decisionLog.some(
    (entry) =>
      typeof entry?.message === "string" &&
      entry.message.includes(DRY_RUN_BOUNDARY_MARKER),
  );
}

/**
 * Inspect the boundary marker text to figure out what stage the executor
 * stopped at. Provider-level markers say "submit click skipped"; the
 * executor-level fallback marker says "reached payment_gate" /
 * "reached checkout_form" / "reached <stage>". Returns null if no boundary.
 */
export function classifyBoundaryStage(
  decisionLog: DecisionLogEntryLike[] | null | undefined,
): "payment_gate" | "checkout_form" | "form_filled" | "other" | null {
  if (!decisionLog || decisionLog.length === 0) return null;
  const entry = decisionLog.find(
    (e) =>
      typeof e?.message === "string" &&
      e.message.includes(DRY_RUN_BOUNDARY_MARKER),
  );
  if (!entry) return null;
  const m = (entry.message ?? "").toLowerCase();
  if (m.includes("payment_gate") || m.includes("payment gate")) return "payment_gate";
  if (m.includes("checkout_form") || m.includes("checkout form")) return "checkout_form";
  if (m.includes("submit click skipped") || m.includes("guest form filled"))
    return "form_filled";
  return "other";
}

/**
 * Inspect decisionLog for the provider's `[opentable] guest form filled: ...`
 * or `[resy] guest form filled: ...` trace and extract per-field outcome.
 *
 * Each field has three possible outcomes:
 *   - "true"      → field was visible AND filled successfully
 *   - "not_found" → field was NOT on the page (e.g. OT email-only form
 *                   doesn't show firstName/lastName until after OTP)
 *   - any other   → field was visible but fill failed (real failure)
 *
 * Run 12 dig (Fumo Soho): OT's /booking/details renders an email-only
 * Diner-details form — firstName / lastName / phone are intentionally
 * absent from this page (OT collects them on the next step after email
 * verification). Treating not_found as failure was unfair to OT cases.
 *
 * `allFilled` now reflects "every visible field was filled" — i.e. there
 * is at least one filled field AND no field was visible-but-failed. This
 * is what the user means by "the form was successfully filled to the
 * dry_run boundary."
 */
export function parseGuestFormFillResult(
  decisionLog: DecisionLogEntryLike[] | null | undefined,
): { firstName: boolean; lastName: boolean; email: boolean; phone: boolean; allFilled: boolean } | null {
  if (!decisionLog || decisionLog.length === 0) return null;
  // Walk the log in reverse — if the provider re-ran fill (rare), the last
  // attempt's outcome is the truth.
  for (let i = decisionLog.length - 1; i >= 0; i -= 1) {
    const m = typeof decisionLog[i]?.message === "string" ? decisionLog[i].message : "";
    if (!m) continue;
    if (!/guest form filled:/i.test(m)) continue;
    type FieldOutcome = "filled" | "not_visible" | "failed" | "absent";
    const getOutcome = (field: string): FieldOutcome => {
      const re = new RegExp(`${field}=([a-z_]+)`, "i");
      const match = m.match(re);
      if (!match) return "absent"; // trace doesn't mention this field at all
      const v = match[1].toLowerCase();
      if (v === "true") return "filled";
      if (v === "not_found") return "not_visible";
      return "failed"; // "false", or any other non-"true" non-"not_found" value
    };
    const fnOut = getOutcome("firstName");
    const lnOut = getOutcome("lastName");
    const emOut = getOutcome("email");
    const phOut = getOutcome("phone");
    const outcomes = [fnOut, lnOut, emOut, phOut];
    const visibleAndFilled = outcomes.filter((o) => o === "filled").length;
    const visibleAndFailed = outcomes.filter((o) => o === "failed").length;
    const get = (o: FieldOutcome): boolean => o === "filled";
    const r = {
      firstName: get(fnOut),
      lastName: get(lnOut),
      email: get(emOut),
      phone: get(phOut),
      allFilled: false,
    };
    // Honest fully_automated: at least one visible field filled AND no
    // visible field failed. not_visible / absent are N/A — they don't
    // count for or against (e.g. OT email-only form has email visible
    // and the other 3 not_visible — that's a 1/1 fill, not a 1/4 fill).
    r.allFilled = visibleAndFilled > 0 && visibleAndFailed === 0;
    return r;
  }
  return null;
}

/** Scan decisionLog for verify-gate signals. */
export function decisionLogHitVerifyGate(
  decisionLog: DecisionLogEntryLike[] | null | undefined,
): boolean {
  if (!decisionLog || decisionLog.length === 0) return false;
  return decisionLog.some((entry) => {
    const m = typeof entry?.message === "string" ? entry.message.toLowerCase() : "";
    // Exclude pre-flight diagnostic skips (e.g.
    // "Resy verify-gate check skipped (-32000 Cannot find context...)")
    // — those are race conditions in the early-return probe, not actual
    // verify gates encountered during booking. Without this, case 007
    // Don Angie was misclassified as verify_gate.
    if (m.includes("verify-gate check skipped") || m.includes("verify gate check skipped")) {
      return false;
    }
    return (
      m.includes("verify-gate") ||
      m.includes("verify gate") ||
      m.includes("mobile-verify") ||
      m.includes("mobile verify") ||
      m.includes("phone otp") ||
      m.includes("sms verify") ||
      m.includes("sms-verify")
    );
  });
}

/** Scan decisionLog for deep-link handoff signals. */
export function decisionLogHitDeepLinkHandoff(
  decisionLog: DecisionLogEntryLike[] | null | undefined,
): boolean {
  if (!decisionLog || decisionLog.length === 0) return false;
  return decisionLog.some((entry) => {
    const m = typeof entry?.message === "string" ? entry.message.toLowerCase() : "";
    return (
      m.includes("deep_link_handoff") ||
      m.includes("deep-link handoff") ||
      m.includes("no online booking") ||
      m.includes("not bookable online") ||
      m.includes("handing off to user")
    );
  });
}

/** Scan decisionLog for unsupported-platform signals. */
export function decisionLogHitUnsupportedPlatform(
  decisionLog: DecisionLogEntryLike[] | null | undefined,
): boolean {
  if (!decisionLog || decisionLog.length === 0) return false;
  return decisionLog.some((entry) => {
    const m = typeof entry?.message === "string" ? entry.message.toLowerCase() : "";
    return (
      m.includes("unsupported_platform") ||
      m.includes("unsupported platform") ||
      m.includes("platform not supported")
    );
  });
}

const WRONG_ACTION_REASONS = new Set<FailureReason>([
  "wrong_date_selected",
  "wrong_time_selected",
  "wrong_party_size_selected",
]);

const SAFE_OUTCOME_REASONS = new Set<FailureReason>([
  "no_availability",
  "payment_stop",
  "verify_gate",
  "deep_link_handoff",
  "unsupported_platform",
  "dry_run_blocked",
]);

/** Compute the v1 derived outcome flags from a base classification. */
function deriveV1Flags(
  base: Pick<
    ClassifiedCaseResult,
    "success" | "failure_reason" | "payment_stop_triggered" | "human_handoff_required"
  >,
  signals: {
    verify_gate: boolean;
    deep_link_handoff: boolean;
    unsupported_platform: boolean;
  },
  formFill: ReturnType<typeof parseGuestFormFillResult>,
): {
  safe_outcome: boolean;
  fully_automated_success: boolean;
  wrong_action_taken: boolean;
} {
  const wrongAction =
    base.failure_reason !== null && WRONG_ACTION_REASONS.has(base.failure_reason);
  const reasonSafe =
    base.failure_reason === null ||
    SAFE_OUTCOME_REASONS.has(base.failure_reason);
  const safe =
    !wrongAction &&
    (base.success || reasonSafe || signals.verify_gate || signals.deep_link_handoff);

  // Fully automated success = boundary reached cleanly AND the provider's
  // guest form actually contains all four contact fields (firstName +
  // lastName + email + phone), each evaluated by `parseGuestFormFillResult`.
  //
  // Without the form-fill gate the classifier accepts "submit click skipped"
  // markers as full-automation evidence even when the form is empty. Run 6
  // case 002 (Tao Downtown) hit this: only email=true, the other three
  // fields were not_found, but boundary marker fired so old classifier
  // counted it as fully_automated. User explicitly rejected this metric.
  //
  // formFill === null means the provider never reached fillGuestForm — also
  // not a full automation success regardless of boundary marker (e.g. Resy
  // pre-form modal that we click through but stagehand-executor terminates
  // before re-entering form fill).
  const fully =
    base.success &&
    !base.payment_stop_triggered &&
    !base.human_handoff_required &&
    !signals.verify_gate &&
    !signals.deep_link_handoff &&
    formFill !== null &&
    formFill.allFilled;
  return {
    safe_outcome: safe,
    fully_automated_success: fully,
    wrong_action_taken: wrongAction,
  };
}

/**
 * Map a finished step → benchmark case classification.
 *
 * Priority:
 *   1. Boundary marker present → succeeded (case proved end-to-end pipeline)
 *   2. step.status === "no_availability" → failed (no_availability)
 *   3. step.status === "awaiting_confirmation" → failed (payment_stop)
 *      [ this means executor reached payment but boundary didn't fire — should
 *        not happen in dry_run, but defensive map ]
 *   4. step.status === "error" → inspect step.error for known patterns
 *   5. step.status === "done" + no boundary marker → unexpected_success
 *      (the executor claimed completion without hitting our boundary; either
 *      a bug or a non-OT/Resy provider; mark as failed for safety)
 *   6. fallthrough → unknown_error
 *
 * The terminology "succeeded" here means "benchmark observed the system
 * performed correctly", not "a real reservation was made".
 */
export function classifyStepResult(
  step: BenchmarkBookingStep,
): ClassifiedCaseResult {
  const boundaryHit = decisionLogHitDryRunBoundary(step.decisionLog);
  const verifyGate = decisionLogHitVerifyGate(step.decisionLog);
  const handoff = decisionLogHitDeepLinkHandoff(step.decisionLog);
  const unsupported = decisionLogHitUnsupportedPlatform(step.decisionLog);
  const boundaryStage = classifyBoundaryStage(step.decisionLog);

  // Build the base classification (status / success / failure_reason /
  // payment_stop / human_handoff). v1 derived flags get layered on at the
  // end so every return path picks them up uniformly.
  const base = (() => {
    if (boundaryHit) {
      // Verify gate hit before payment → succeeded but classifier should
      // surface verify_gate as the reason (success + verify_gate is a valid
      // safe outcome, not a "real" full-automation success).
      if (verifyGate) {
        return {
          status: "succeeded" as BenchmarkCaseStatus,
          success: true,
          failure_reason: "verify_gate" as FailureReason,
          payment_stop_triggered: false,
          human_handoff_required: true,
        };
      }
      if (handoff) {
        return {
          status: "succeeded" as BenchmarkCaseStatus,
          success: true,
          failure_reason: "deep_link_handoff" as FailureReason,
          payment_stop_triggered: false,
          human_handoff_required: true,
        };
      }
      // Boundary marker reached payment_gate → this is payment_stop,
      // NOT fully_automated. Without this branch the classifier counts
      // payment-gated cases as fully-automated successes, which produces
      // the "payment_mistake = 3" false positive in the safety counter.
      if (boundaryStage === "payment_gate") {
        return {
          status: "succeeded" as BenchmarkCaseStatus,
          success: true,
          failure_reason: "payment_stop" as FailureReason,
          payment_stop_triggered: true,
          human_handoff_required: true,
        };
      }
      return {
        status: "succeeded" as BenchmarkCaseStatus,
        success: true,
        failure_reason: null,
        payment_stop_triggered: false,
        human_handoff_required: false,
      };
    }

    switch (step.status) {
      case "no_availability":
        return {
          status: "failed" as BenchmarkCaseStatus,
          success: false,
          failure_reason: "no_availability" as FailureReason,
          payment_stop_triggered: false,
          human_handoff_required: false,
        };
      case "awaiting_confirmation":
        return {
          status: "failed" as BenchmarkCaseStatus,
          success: false,
          failure_reason: "payment_stop" as FailureReason,
          payment_stop_triggered: true,
          human_handoff_required: true,
        };
      case "error":
        // verify-gate / handoff / unsupported can all surface as 'error'
        // status with no boundary marker (e.g. timeout because executor
        // got stuck on the gate). Promote those signals over generic
        // executor_error.
        if (verifyGate) {
          return {
            status: "failed" as BenchmarkCaseStatus,
            success: false,
            failure_reason: "verify_gate" as FailureReason,
            payment_stop_triggered: false,
            human_handoff_required: true,
          };
        }
        if (handoff) {
          return {
            status: "failed" as BenchmarkCaseStatus,
            success: false,
            failure_reason: "deep_link_handoff" as FailureReason,
            payment_stop_triggered: false,
            human_handoff_required: true,
          };
        }
        if (unsupported) {
          return {
            status: "failed" as BenchmarkCaseStatus,
            success: false,
            failure_reason: "unsupported_platform" as FailureReason,
            payment_stop_triggered: false,
            human_handoff_required: true,
          };
        }
        return {
          status: "failed" as BenchmarkCaseStatus,
          success: false,
          failure_reason: classifyError(step.error ?? ""),
          payment_stop_triggered: false,
          human_handoff_required: false,
        };
      case "done":
        return {
          status: "failed" as BenchmarkCaseStatus,
          success: false,
          failure_reason: "executor_error" as FailureReason,
          payment_stop_triggered: false,
          human_handoff_required: false,
        };
      default:
        return {
          status: "failed" as BenchmarkCaseStatus,
          success: false,
          failure_reason: "unknown_error" as FailureReason,
          payment_stop_triggered: false,
          human_handoff_required: false,
        };
    }
  })();

  const formFill = parseGuestFormFillResult(step.decisionLog);
  const derived = deriveV1Flags(
    base,
    {
      verify_gate: verifyGate,
      deep_link_handoff: handoff,
      unsupported_platform: unsupported,
    },
    formFill,
  );

  return {
    ...base,
    ...derived,
    verify_gate_triggered: verifyGate,
    deep_link_handoff_triggered: handoff,
    unsupported_platform_detected: unsupported,
  };
}

/**
 * Best-effort failure-reason inference from step.error string.
 *
 * Keep the patterns conservative — false positives map a real failure to the
 * wrong bucket, and benchmark stats only matter if buckets are accurate.
 */
export function classifyError(errorText: string): FailureReason {
  const lower = errorText.toLowerCase();
  if (!lower) return "unknown_error";
  if (lower.includes("captcha") || lower.includes("bot detection")) {
    return "captcha_or_bot_detection";
  }
  if (lower.includes("login") || lower.includes("sign in")) {
    return "login_required";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "provider_timeout";
  }
  // "unavailable" / "dates unavailable" / "stuck at listing page" all mean
  // the venue's time-picker returned no slots for the requested window.
  // Classifier was missing these phrases and falling through to
  // executor_error — incorrect labeling (4 cases in v1 baseline run 4).
  if (
    lower.includes("no availability") ||
    lower.includes("no slots") ||
    lower.includes("not available") ||
    lower.includes("unavailable") ||
    lower.includes("dates unavailable") ||
    lower.includes("stuck at listing page") ||
    lower.includes("stuck at listing/date") ||
    lower.includes("stalled at listing")
  ) {
    return "no_availability";
  }
  return "executor_error";
}

/**
 * Patterns that indicate the failure was infrastructure / race condition,
 * not a real "executor decided to give up" outcome. Worth retrying once.
 *
 * Observed in real benchmark dev.log:
 *   - Neon DB IPv6 connect timeouts (UND_ERR_CONNECT_TIMEOUT)
 *   - Chrome CDP target init races when 5 sessions spin up at once
 *   - Booking job 409 "Job already running" race with dispatcher
 *   - Various socket-level resets when stagehand initialises
 */
const TRANSIENT_ERROR_PATTERNS = [
  /Connect Timeout Error/i,
  /UND_ERR_CONNECT_TIMEOUT/i,
  /target closed before CDP response/i,
  /No Page found for target/i,
  /Job already running/i,
  /socket hang up/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /fetch failed/i,
];

export function isTransientError(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return TRANSIENT_ERROR_PATTERNS.some((p) => p.test(errorText));
}

/**
 * Compare what the dataset expected with what the executor actually produced.
 *
 * Dataset cases declare `expected_outcome` (e.g. "fully_automated",
 * "no_availability", "payment_stop", "verify_gate"). A peak-time fallback
 * case might explicitly expect `no_availability` — actually getting
 * no_availability is then a PASS, not a fail. Without this distinction the
 * dashboard treats every "failed" status as bad, which masks correctly-
 * functioning fallback paths and inflates the apparent failure rate.
 *
 * Returns:
 *   - `true`  → actual outcome matches expected (PASS)
 *   - `false` → actual outcome does NOT match expected (FAIL)
 *   - `null`  → no expected_outcome set on the case (legacy data; caller
 *               should fall back to raw classification)
 */
export function outcomeMatchesExpected(
  classified: Pick<
    ClassifiedCaseResult,
    | "success"
    | "failure_reason"
    | "fully_automated_success"
    | "payment_stop_triggered"
    | "verify_gate_triggered"
    | "deep_link_handoff_triggered"
    | "unsupported_platform_detected"
  >,
  expected: RestaurantBenchmarkCase["expected_outcome"],
): boolean | null {
  if (!expected) return null;
  // Array form: PASS if actual matches any of the listed outcomes. Used
  // for ±0 happy cases where venue inventory is genuinely uncertain — both
  // fully_automated (slot was open) and no_availability (slot full,
  // correctly identified) count as the agent doing its job.
  const list = Array.isArray(expected) ? expected : [expected];
  for (const e of list) {
    if (matchesSingleExpected(classified, e)) return true;
  }
  return false;
}

function matchesSingleExpected(
  classified: Pick<
    ClassifiedCaseResult,
    | "success"
    | "failure_reason"
    | "fully_automated_success"
    | "payment_stop_triggered"
    | "verify_gate_triggered"
    | "deep_link_handoff_triggered"
    | "unsupported_platform_detected"
  >,
  expected: NonNullable<RestaurantBenchmarkCase["expected_outcome"]>,
): boolean {
  // Should never receive an array here — outcomeMatchesExpected wraps.
  if (Array.isArray(expected)) return false;
  switch (expected) {
    case "fully_automated":
      return classified.fully_automated_success === true;
    case "payment_stop":
      // Boundary reached at payment + payment_stop flagged. Note that some
      // OT venues with credit-card hold reach the cc-section boundary which
      // we classify as success+payment_stop_triggered=true; both shapes
      // should count as a payment_stop pass.
      return (
        classified.payment_stop_triggered === true ||
        classified.failure_reason === "payment_stop"
      );
    case "no_availability":
      return classified.failure_reason === "no_availability";
    case "verify_gate":
      return classified.verify_gate_triggered === true;
    case "deep_link_handoff":
      return classified.deep_link_handoff_triggered === true;
    case "unsupported_platform":
      return classified.unsupported_platform_detected === true;
    default:
      return false;
  }
}
