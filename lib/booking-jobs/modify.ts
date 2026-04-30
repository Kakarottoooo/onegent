/**
 * Pure helper for Phase 1 mutable-task modifications.
 *
 * Takes a booking job + a patch, returns a new (plan_version + 1) view of
 * the job: merged constraints, merged policy, mirrored step bodies, all
 * step statuses reset to `pending`, and an audit entry written into the
 * first step's decisionLog.
 *
 * Decisions baked in (per discussion):
 *   A. Dual-write: constraints is canonical, but step.body is mirrored so
 *      the existing executor (which reads step.body) sees new values
 *      without any executor-side change.
 *   A. Full reset: every step → pending. Multi-step trips are rare today
 *      and the executor doesn't know how to skip already-completed work
 *      after a constraint flip; resetting is safer than partial replay.
 *   B. No auto-resume: this function only updates state; the caller is
 *      responsible for triggering POST /start. The Modify UI shows a
 *      "Run again" button after a successful patch.
 */

import type { BookingJob, BookingJobStep, DecisionLogEntry } from "@/lib/db";
import {
  DEFAULT_JOB_POLICY,
  type JobConstraints,
  type JobModificationPatch,
  type JobPolicy,
  type RestaurantConstraints,
} from "./types";

// ─── Errors ─────────────────────────────────────────────────────────────────

export class ModifyValidationError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "ModifyValidationError";
  }
}

export class ModifyForbiddenStateError extends Error {
  constructor(
    public state: BookingJob["status"],
    public reason: string,
  ) {
    super(reason);
    this.name = "ModifyForbiddenStateError";
  }
}

// ─── Validators (manual; keeps zod off the dependency surface here) ─────────

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_TIME_WINDOWS = new Set([0, 30, 60, 90]);

function validatePatch(patch: JobModificationPatch): void {
  if (patch == null || typeof patch !== "object") {
    throw new ModifyValidationError("patch must be an object");
  }
  const c = patch.constraints;
  if (c !== undefined) {
    if (c == null || typeof c !== "object" || Array.isArray(c)) {
      throw new ModifyValidationError("patch.constraints must be an object");
    }
    if (c.time !== undefined && (typeof c.time !== "string" || !HHMM_RE.test(c.time))) {
      throw new ModifyValidationError("patch.constraints.time must be HH:MM (24h)");
    }
    if (c.date !== undefined && (typeof c.date !== "string" || !ISO_DATE_RE.test(c.date))) {
      throw new ModifyValidationError("patch.constraints.date must be YYYY-MM-DD");
    }
    if (c.party_size !== undefined) {
      if (typeof c.party_size !== "number" || !Number.isInteger(c.party_size) || c.party_size < 1 || c.party_size > 20) {
        throw new ModifyValidationError("patch.constraints.party_size must be an integer 1-20");
      }
    }
    if (c.city !== undefined && typeof c.city !== "string") {
      throw new ModifyValidationError("patch.constraints.city must be a string");
    }
    if (c.restaurant_name !== undefined && typeof c.restaurant_name !== "string") {
      throw new ModifyValidationError("patch.constraints.restaurant_name must be a string");
    }
  }
  const p = patch.policy;
  if (p !== undefined) {
    if (p == null || typeof p !== "object" || Array.isArray(p)) {
      throw new ModifyValidationError("patch.policy must be an object");
    }
    if (p.time_window_minutes !== undefined && !ALLOWED_TIME_WINDOWS.has(p.time_window_minutes)) {
      throw new ModifyValidationError("patch.policy.time_window_minutes must be 0, 30, 60, or 90");
    }
    if (p.allow_venue_switch !== undefined && typeof p.allow_venue_switch !== "boolean") {
      throw new ModifyValidationError("patch.policy.allow_venue_switch must be boolean");
    }
    if (p.allow_platform_switch !== undefined && typeof p.allow_platform_switch !== "boolean") {
      throw new ModifyValidationError("patch.policy.allow_platform_switch must be boolean");
    }
  }
}

function assertModifiableState(job: BookingJob): void {
  if (job.status === "running") {
    throw new ModifyForbiddenStateError(
      job.status,
      "Job is currently running. Wait for it to finish (or cancel it) before modifying.",
    );
  }
  if (job.status === "done") {
    throw new ModifyForbiddenStateError(
      job.status,
      "Job is already completed. Create a new task instead.",
    );
  }
}

// ─── Constraint / policy seeding (legacy jobs without these fields) ─────────

/**
 * Read a restaurant step.body and back-fill a RestaurantConstraints object
 * with what we can find. Used only when a legacy job has constraints=null.
 */
export function deriveRestaurantConstraintsFromStep(
  step: BookingJobStep | undefined,
): RestaurantConstraints {
  const body = (step?.body ?? {}) as Record<string, unknown>;
  return {
    task_type: "restaurant_booking",
    city: typeof body.city === "string" ? body.city : "",
    date: typeof body.date === "string" ? body.date : "",
    time: typeof body.time === "string" ? body.time : "",
    party_size: typeof body.covers === "number" ? body.covers : 2,
    restaurant_name:
      typeof body.restaurantName === "string" ? body.restaurantName : "",
  };
}

function derivePolicyFromAutonomy(
  autonomy: BookingJob["autonomy_settings"],
): JobPolicy {
  if (!autonomy) return { ...DEFAULT_JOB_POLICY };
  return {
    ...DEFAULT_JOB_POLICY,
    time_window_minutes:
      (autonomy.restaurant?.timeWindowMinutes as JobPolicy["time_window_minutes"]) ??
      DEFAULT_JOB_POLICY.time_window_minutes,
    allow_venue_switch: autonomy.restaurant?.allowVenueSwitch ?? DEFAULT_JOB_POLICY.allow_venue_switch,
  };
}

// ─── Mirror constraints into step.body (decision A: dual-write) ─────────────

function mirrorRestaurantConstraintsToBody(
  step: BookingJobStep,
  c: RestaurantConstraints,
): BookingJobStep {
  const body = { ...(step.body as Record<string, unknown>) };
  if (c.restaurant_name) body.restaurantName = c.restaurant_name;
  if (c.city) body.city = c.city;
  if (c.date) body.date = c.date;
  if (c.time) body.time = c.time;
  if (c.party_size) body.covers = c.party_size;
  // If the step had a startUrl that encoded the OLD time/covers, drop it so
  // the runUniversalStep rebuilds the URL from current body fields.
  if (typeof body.startUrl === "string" && /dateTime=|covers=/.test(body.startUrl)) {
    delete body.startUrl;
  }
  return { ...step, body };
}

// ─── Audit log entry ────────────────────────────────────────────────────────

function summarisePatch(patch: JobModificationPatch): string {
  const parts: string[] = [];
  const c = patch.constraints;
  if (c) {
    if (c.time !== undefined) parts.push(`time → ${c.time}`);
    if (c.date !== undefined) parts.push(`date → ${c.date}`);
    if (c.party_size !== undefined) parts.push(`party_size → ${c.party_size}`);
    if (c.restaurant_name !== undefined) parts.push(`restaurant → ${c.restaurant_name}`);
    if (c.city !== undefined) parts.push(`city → ${c.city}`);
  }
  const p = patch.policy;
  if (p) {
    if (p.time_window_minutes !== undefined) parts.push(`time_window → ${p.time_window_minutes}m`);
    if (p.allow_venue_switch !== undefined) parts.push(`venue_switch → ${p.allow_venue_switch}`);
    if (p.allow_platform_switch !== undefined) parts.push(`platform_switch → ${p.allow_platform_switch}`);
  }
  return parts.length === 0 ? "no-op patch" : parts.join(", ");
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export interface ApplyJobModificationResult {
  /** New plan_version (= old + 1). */
  plan_version: number;
  constraints: JobConstraints;
  policy: JobPolicy;
  steps: BookingJobStep[];
  /** Human-readable summary of what changed. */
  summary: string;
}

export function applyJobModification(
  job: BookingJob,
  patch: JobModificationPatch,
): ApplyJobModificationResult {
  validatePatch(patch);
  assertModifiableState(job);

  // Seed constraints / policy if the job is a legacy row with nulls.
  const currentConstraints =
    job.constraints ??
    (deriveRestaurantConstraintsFromStep(job.steps?.[0]) as JobConstraints);
  const currentPolicy = job.policy ?? derivePolicyFromAutonomy(job.autonomy_settings);

  // Merge.
  const nextConstraints: JobConstraints = {
    ...currentConstraints,
    ...patch.constraints,
  } as JobConstraints;
  const nextPolicy: JobPolicy = {
    ...currentPolicy,
    ...patch.policy,
  };

  // Build new steps:
  //  - mirror constraints into body (only restaurant scope today)
  //  - reset status to pending
  //  - clear transient runtime fields so /start retries cleanly
  //  - prepend a task_modified entry to the first step's decisionLog
  const summary = summarisePatch(patch);
  const auditEntry: DecisionLogEntry = {
    ts: new Date().toISOString(),
    type: "task_modified",
    message: patch.message
      ? `${summary} — note: ${patch.message}`
      : summary,
    outcome: `plan_version ${job.plan_version} → ${job.plan_version + 1}`,
  };

  const nextSteps: BookingJobStep[] = job.steps.map((step, idx) => {
    const mirrored =
      step.type === "restaurant" && nextConstraints.task_type === "restaurant_booking"
        ? mirrorRestaurantConstraintsToBody(step, nextConstraints)
        : step;

    const baseLog: DecisionLogEntry[] = idx === 0
      ? [...(step.decisionLog ?? []), auditEntry]
      : (step.decisionLog ?? []);

    return {
      ...mirrored,
      status: "pending",
      error: undefined,
      handoff_url: undefined,
      session_url: undefined,
      selected_time: undefined,
      attemptCount: undefined,
      usedFallback: undefined,
      timeAdjusted: undefined,
      actionItem: undefined,
      retryScheduledFor: undefined,
      replanAdjusted: undefined,
      replanFlagged: undefined,
      decisionLog: baseLog,
    };
  });

  return {
    plan_version: job.plan_version + 1,
    constraints: nextConstraints,
    policy: nextPolicy,
    steps: nextSteps,
    summary,
  };
}
