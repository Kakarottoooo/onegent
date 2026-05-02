/**
 * lib/core/execution/job-manager · createJob / getJob / completeJob
 *
 * Thin wrapper around lib/db's BookingJob CRUD, shaped for callers who
 * speak in ExecutionJobRequest / ExecutionJobResult (the declarative
 * B 端 contract) instead of the legacy BookingJobStep fields.
 *
 * Responsibilities:
 *   - createJob: materialize an ExecutionJobRequest as a booking_jobs row
 *     with a single derived BookingJobStep (no executor run yet — async
 *     API pattern where caller creates + separately starts the job).
 *   - getJob: pass-through read.
 *   - completeJob: merge an ExecutionJobResult into the DB row (step-level
 *     + job-level status), called after runExecutionJob returns.
 *
 * What this layer does NOT do:
 *   - Start executor.runExecutionJob (caller orchestrates that)
 *   - Multi-step trip packaging (one ExecutionJobRequest = one step)
 *   - Decision Room coordination (Week 2.5)
 */

import { randomUUID } from "crypto";
import {
  createBookingJob,
  getBookingJob,
  updateBookingJobStatus,
  updateBookingJobSteps,
  type BookingJob,
  type BookingJobStep,
} from "@/lib/db";
import { CORE_EXECUTION_SOURCE } from "@/lib/core/cend-adapter";
import type { AgentAutonomySettings } from "@/lib/autonomy";
import type {
  ExecutionJobRequest,
  ExecutionJobResult,
  ExecutionJobStatus,
  ExecutionScenario,
} from "./types";

// ─── Public API ──────────────────────────────────────────────────────────────

export interface CreateJobMeta {
  /** Clerk user_id — null for B 端 callers without session context. */
  userId?: string | null;
  /**
   * Correlation ID on the caller's side for grouping multiple calls
   * (e.g. multi-step trip). Defaults to jobId itself when omitted.
   */
  sessionId?: string;
  /** Shown in /tasks UI. Defaults to "{Scenario}: {venue/route}". */
  tripLabel?: string;
  /**
   * Legacy C 端 autonomy settings — used by the old [id]/start/route.ts
   * recovery loop. B 端 callers should omit; US-007 recovery.ts reads
   * consent policy from the request body stored in step.body.consent.
   */
  autonomySettings?: AgentAutonomySettings | null;
  /**
   * Override the generated jobId. Use only when the caller has already
   * minted an id (e.g. idempotent retry on a known id). Normally omit.
   */
  jobId?: string;
}

/**
 * Create a booking_jobs row for an ExecutionJobRequest. Does NOT run the
 * executor — caller invokes executor.runExecutionJob() separately (and
 * typically via the /api/booking-jobs/[id]/start endpoint for C 端, or
 * via the job-manager helpers directly for B 端).
 */
export async function createJob(
  request: ExecutionJobRequest,
  meta: CreateJobMeta = {},
): Promise<BookingJob> {
  const jobId = meta.jobId ?? randomUUID();
  const step = buildStepFromRequest(request);
  const tripLabel = meta.tripLabel ?? defaultTripLabel(request);

  return createBookingJob({
    id: jobId,
    sessionId: meta.sessionId ?? jobId,
    userId: meta.userId ?? null,
    tripLabel,
    steps: [step],
    autonomySettings: meta.autonomySettings ?? null,
  });
}

/** Thin pass-through to lib/db.getBookingJob. */
export async function getJob(jobId: string): Promise<BookingJob | null> {
  return getBookingJob(jobId);
}

/**
 * Apply an ExecutionJobResult to the DB:
 *   - step[0].status, handoff_url, session_url, error, attemptCount,
 *     usedFallback, decisionLog all populated from result fields
 *   - Job-level status set to "done" (on paused_payment / completed),
 *     "failed" (on error / captcha / needs_login / no_availability),
 *     or left "running" for non-terminal status
 *   - completed_at written when status is terminal
 *
 * Returns early (no write) if the job row doesn't exist.
 */
export async function completeJob(
  jobId: string,
  result: ExecutionJobResult,
): Promise<void> {
  const job = await getBookingJob(jobId);
  if (!job || job.steps.length === 0) return;

  const step = job.steps[0];
  const updatedStep: BookingJobStep = {
    ...step,
    status: mapJobStatusToStepStatus(result.status),
    handoff_url: result.handoffUrl ?? step.handoff_url,
    session_url: result.sessionUrl ?? step.session_url,
    error: result.error ?? step.error,
    attemptCount: result.attemptCount ?? step.attemptCount,
    usedFallback: result.usedFallback ?? step.usedFallback,
    decisionLog: result.decisionLog.length > 0 ? result.decisionLog : step.decisionLog,
  };

  await updateBookingJobSteps(jobId, [updatedStep]);

  const jobStatus = mapJobStatusToBookingJobStatus(result.status);
  const completedAt = isTerminalBookingJobStatus(jobStatus) ? new Date() : undefined;
  await updateBookingJobStatus(jobId, jobStatus, completedAt);
}

// ─── Internal: ExecutionJobRequest → BookingJobStep ──────────────────────────

/** Emoji + display label per scenario, for /tasks UI. */
const SCENARIO_META: Record<
  ExecutionScenario,
  { emoji: string; label: string; stepType: BookingJobStep["type"] }
> = {
  restaurant: { emoji: "🍽️", label: "Restaurant", stepType: "restaurant" },
  hotel: { emoji: "🏨", label: "Hotel", stepType: "hotel" },
  flight: { emoji: "✈️", label: "Flight", stepType: "flight" },
  activity: { emoji: "🎟️", label: "Activity", stepType: "activity" },
};

function buildStepFromRequest(request: ExecutionJobRequest): BookingJobStep {
  const scenario = request.request.scenario;
  const meta = SCENARIO_META[scenario];
  return {
    type: meta.stepType,
    emoji: meta.emoji,
    label: defaultTripLabel(request),
    // Legacy field — used by the old recovery loop's callEndpoint path.
    // New lib/core callers don't rely on this, but the DB column is
    // NOT NULL so we keep a sensible default.
    apiEndpoint: "/api/booking-autopilot/universal",
    // Serialize the full ExecutionJobRequest so US-007 recovery.ts can
    // re-hydrate it when handling a retry / time fallback / venue switch.
    // Kept under `body` because BookingJobStep.body is already a
    // Record<string, unknown> grab-bag in the legacy schema.
    body: {
      scenario,
      params: request.request.params,
      profileId: request.profileId,
      consent: request.consent,
      // Marker so recovery.ts can detect "this job was created via lib/core"
      // and route to the new adapter instead of the legacy runUniversalStep.
      __source: CORE_EXECUTION_SOURCE,
    },
    fallbackUrl: "",
    status: "pending",
  };
}

function defaultTripLabel(request: ExecutionJobRequest): string {
  const p = request.request;
  switch (p.scenario) {
    case "restaurant":
      return `${p.params.restaurant_name} — ${p.params.city}`;
    case "hotel":
      return `${p.params.hotel_name} — ${p.params.city}`;
    case "flight":
      return `${p.params.origin} → ${p.params.dest}`;
    case "activity":
      return `${p.params.event_name} — ${p.params.city}`;
  }
}

// ─── Internal: status mappings ───────────────────────────────────────────────

function mapJobStatusToStepStatus(
  s: ExecutionJobStatus,
): BookingJobStep["status"] {
  switch (s) {
    case "paused_payment":
    case "needs_otp":
    case "ready_for_confirmation":
      return "awaiting_confirmation";
    case "completed":
      return "done";
    case "no_availability":
      return "no_availability";
    case "error":
    case "captcha":
    case "needs_login":
      return "error";
    case "pending":
    case "running":
      return "loading";
  }
}

function mapJobStatusToBookingJobStatus(
  s: ExecutionJobStatus,
): BookingJob["status"] {
  switch (s) {
    // paused_payment is "done" from the BookingJob perspective — the
    // autopilot has finished its work; user payment is a separate flow.
    case "paused_payment":
    case "needs_otp":
    case "ready_for_confirmation":
    case "completed":
      return "done";
    case "error":
    case "captcha":
    case "needs_login":
    case "no_availability":
      return "failed";
    case "pending":
    case "running":
      return "running";
  }
}

function isTerminalBookingJobStatus(s: BookingJob["status"]): boolean {
  return s === "done" || s === "failed";
}
