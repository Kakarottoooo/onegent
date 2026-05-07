/**
 * Semantic Status System
 *
 * The DB stores simple "pending | running | done | failed" for jobs.
 * This module computes richer semantic statuses from the step data,
 * giving the UI enough nuance to express partial success, scheduled
 * retries, and the distinction between recoverable vs terminal failures.
 *
 * Job statuses:
 *   succeeded_first_try    — all steps done, no adjustments, 1 attempt each
 *   succeeded_with_adjustment — all steps done, at least one used fallback
 *   partially_completed    — some done, some blocked/failed
 *   blocked_needs_user_input — all blocked (agent can't proceed without user)
 *   retrying               — at least one step has a scheduled retry pending
 *   failed_recoverable     — all failed but user can retry
 *   failed_terminal        — all failed with no recovery path
 */

import type { BookingJob, BookingJobStep } from "./db";
import { stepNeedsProviderEventChoice } from "./booking-jobs/provider-choice";

// ── Types ──────────────────────────────────────────────────────────────────

export type StepSemanticStatus =
  | "pending"
  | "running"
  | "succeeded_first_try"
  | "succeeded_with_adjustment"
  | "blocked_needs_input"
  | "retrying"
  | "failed_recoverable"
  | "failed_terminal";

export type JobSemanticStatus =
  | "pending"
  | "running"
  | "awaiting_payment"
  | "succeeded_first_try"
  | "succeeded_with_adjustment"
  | "partially_completed"
  | "blocked_needs_user_input"
  | "retrying"
  | "no_availability"
  | "failed_recoverable"
  | "failed_terminal";

export function isQueuedJobStatus(status: unknown): boolean {
  return status === "pending" || status === "pending_local";
}

export function isActiveJobStatus(status: unknown): boolean {
  return status === "running" || isQueuedJobStatus(status);
}

// ── Step status computation ────────────────────────────────────────────────

export function computeStepSemanticStatus(step: BookingJobStep): StepSemanticStatus {
  // Scheduled retry overrides everything except done
  if (step.retryScheduledFor && step.status !== "done") return "retrying";

  switch (step.status) {
    case "pending": return "pending";
    case "loading": return "running";
    case "done":
      // First-try success: no fallback, no time adjustment, 1 attempt
      if (!step.usedFallback && !step.timeAdjusted && (step.attemptCount ?? 1) <= 1) {
        return "succeeded_first_try";
      }
      return "succeeded_with_adjustment";
    case "awaiting_confirmation":
      return "blocked_needs_input";
    case "error":
      if (step.actionItem) return "blocked_needs_input";
      return "failed_recoverable";
    case "no_availability":
      return "failed_recoverable";
    default:
      return "failed_terminal";
  }
}

// ── Job status computation ─────────────────────────────────────────────────

export function computeJobSemanticStatus(job: BookingJob): JobSemanticStatus {
  // While actually running/pending, use the DB status directly
  if (job.status === "running") return "running";
  if (isQueuedJobStatus(job.status)) return "pending";

  const stepStatuses = job.steps.map(computeStepSemanticStatus);

  const doneCount  = job.steps.filter((s) => s.status === "done").length;
  const errorCount = job.steps.filter((s) => s.status === "error").length;
  const total      = job.steps.length;

  const hasRetrying        = stepStatuses.some((s) => s === "retrying");
  const hasBlocked         = stepStatuses.some((s) => s === "blocked_needs_input");
  const allFirstTry        = stepStatuses.every((s) => s === "succeeded_first_try");
  const hasAwaitingPayment = job.steps.some(
    (s) => s.status === "awaiting_confirmation" && !s.actionItem && !stepNeedsProviderEventChoice(s),
  );
  const allNoAvailability  = job.steps.every((s) => s.status === "no_availability");

  if (hasRetrying) return "retrying";

  if (hasAwaitingPayment) return "awaiting_payment";

  if (allNoAvailability) return "no_availability";

  if (doneCount === total) {
    return allFirstTry ? "succeeded_first_try" : "succeeded_with_adjustment";
  }

  if (doneCount > 0 && (hasBlocked || errorCount > 0)) return "partially_completed";

  if (hasBlocked && doneCount === 0) return "blocked_needs_user_input";

  if (errorCount === total) return "failed_recoverable";

  return "failed_recoverable"; // default — can always suggest retry
}

// ── Display metadata ───────────────────────────────────────────────────────

export interface StatusDisplay {
  label: string;
  color: string;
  dot?: string; // optional dot/icon before label
  animate?: boolean;
}

export const JOB_SEMANTIC_DISPLAY: Record<JobSemanticStatus, StatusDisplay> = {
  pending:                  { label: "Queued",                        color: "var(--text-muted, #aaa)",      animate: false },
  running:                  { label: "Agent working…",                color: "var(--gold, #D4A34B)",          animate: true  },
  awaiting_payment:         { label: "Ready to review - confirm on site", color: "rgba(22,163,74,0.85)",      animate: false },
  succeeded_first_try:      { label: "All done — first try",          color: "rgba(22,163,74,0.85)",          animate: false },
  succeeded_with_adjustment:{ label: "Done — with smart adjustments", color: "rgba(22,163,74,0.7)",           animate: false },
  partially_completed:      { label: "Partial — action needed",       color: "rgba(234,179,8,0.9)",           animate: false },
  blocked_needs_user_input: { label: "Needs your input",              color: "rgba(234,88,12,0.85)",          animate: false },
  retrying:                 { label: "Retry scheduled…",              color: "var(--gold, #D4A34B)",          animate: true  },
  no_availability:          { label: "Not available for these dates",  color: "rgba(107,114,128,0.85)",        animate: false },
  failed_recoverable:       { label: "Failed — tap to retry",         color: "rgba(220,38,38,0.75)",          animate: false },
  failed_terminal:          { label: "Failed",                        color: "rgba(220,38,38,0.8)",           animate: false },
};

export const STEP_SEMANTIC_DISPLAY: Record<StepSemanticStatus, StatusDisplay> = {
  pending:                  { label: "Queued",              color: "var(--text-muted, #aaa)"  },
  running:                  { label: "Working…",            color: "var(--gold, #D4A34B)",  animate: true },
  succeeded_first_try:      { label: "Booked first try",   color: "rgba(22,163,74,0.85)"   },
  succeeded_with_adjustment:{ label: "Booked",             color: "rgba(22,163,74,0.75)"   },
  blocked_needs_input:      { label: "Needs your decision",color: "rgba(220,38,38,0.8)"    },
  retrying:                 { label: "Retry scheduled",    color: "var(--gold, #D4A34B)"   },
  failed_recoverable:       { label: "Needs your decision",color: "rgba(220,38,38,0.75)"   },
  failed_terminal:          { label: "Failed",             color: "rgba(220,38,38,0.8)"    },
};
