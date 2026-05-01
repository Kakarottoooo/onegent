/**
 * Pure helpers that classify a booking_job step result back into the
 * benchmark domain (success / failure_reason).
 *
 * Kept dependency-free so it can be unit-tested without DB access.
 */

import { DRY_RUN_BOUNDARY_MARKER } from "@/lib/booking-autopilot/dry-run";
import type { FailureReason, BenchmarkCaseStatus } from "./types";

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

  if (boundaryHit) {
    return {
      status: "succeeded",
      success: true,
      failure_reason: null,
      payment_stop_triggered: false,
      human_handoff_required: false,
    };
  }

  switch (step.status) {
    case "no_availability":
      return {
        status: "failed",
        success: false,
        failure_reason: "no_availability",
        payment_stop_triggered: false,
        human_handoff_required: false,
      };
    case "awaiting_confirmation":
      // Reached the payment / confirmation page but boundary marker didn't
      // fire. Means the provider either doesn't have a boundary yet, or the
      // executor reached payment via a non-fillGuestForm path. Either way
      // payment-stop is a sensible classification for benchmark purposes.
      return {
        status: "failed",
        success: false,
        failure_reason: "payment_stop",
        payment_stop_triggered: true,
        human_handoff_required: true,
      };
    case "error":
      return {
        status: "failed",
        success: false,
        failure_reason: classifyError(step.error ?? ""),
        payment_stop_triggered: false,
        human_handoff_required: false,
      };
    case "done":
      return {
        status: "failed",
        success: false,
        failure_reason: "executor_error",
        payment_stop_triggered: false,
        human_handoff_required: false,
      };
    default:
      return {
        status: "failed",
        success: false,
        failure_reason: "unknown_error",
        payment_stop_triggered: false,
        human_handoff_required: false,
      };
  }
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
  if (lower.includes("no availability") || lower.includes("no slots") || lower.includes("not available")) {
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
