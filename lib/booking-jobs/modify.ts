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
  type ActivityConstraintsPlaceholder,
  type JobConstraints,
  type JobModificationPatch,
  type JobPolicy,
  type RestaurantConstraints,
} from "./types";
import { buildDirectActivityTask } from "@/lib/capture/direct-provider-url";
import { stepNeedsProviderEventChoice } from "@/lib/booking-jobs/provider-choice";

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
    if (c.event_date !== undefined && (typeof c.event_date !== "string" || !ISO_DATE_RE.test(c.event_date))) {
      throw new ModifyValidationError("patch.constraints.event_date must be YYYY-MM-DD");
    }
    if (c.event_time !== undefined && (typeof c.event_time !== "string" || !HHMM_RE.test(c.event_time))) {
      throw new ModifyValidationError("patch.constraints.event_time must be HH:MM (24h)");
    }
    if (c.party_size !== undefined) {
      if (typeof c.party_size !== "number" || !Number.isInteger(c.party_size) || c.party_size < 1 || c.party_size > 20) {
        throw new ModifyValidationError("patch.constraints.party_size must be an integer 1-20");
      }
    }
    if (c.num_tickets !== undefined) {
      if (typeof c.num_tickets !== "number" || !Number.isInteger(c.num_tickets) || c.num_tickets < 1 || c.num_tickets > 20) {
        throw new ModifyValidationError("patch.constraints.num_tickets must be an integer 1-20");
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
    const hasProviderEventChoice = job.steps.some(stepNeedsProviderEventChoice);
    if (hasProviderEventChoice) return;
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

export function deriveActivityConstraintsFromStep(
  step: BookingJobStep | undefined,
): ActivityConstraintsPlaceholder {
  const body = (step?.body ?? {}) as Record<string, unknown>;
  const eventName =
    typeof body.event_name === "string" ? body.event_name :
    typeof body.activity_name === "string" ? body.activity_name :
    typeof body.eventName === "string" ? body.eventName :
    typeof body.title === "string" ? body.title :
    typeof step?.label === "string" ? step.label : "";
  const eventDate =
    typeof body.event_date === "string" ? body.event_date :
    typeof body.eventDate === "string" ? body.eventDate :
    typeof body.date === "string" ? body.date : "";
  const eventTime =
    typeof body.event_time === "string" ? body.event_time :
    typeof body.eventTime === "string" ? body.eventTime :
    typeof body.time === "string" ? body.time : "";
  const city = typeof body.city === "string" ? body.city : "";
  const numTickets = typeof body.num_tickets === "number" ? body.num_tickets :
    typeof body.numTickets === "number" ? body.numTickets :
    typeof body.tickets === "number" ? body.tickets : 1;

  return {
    task_type: "activity_booking",
    event_name: eventName,
    event_date: eventDate,
    event_time: eventTime,
    city,
    num_tickets: numTickets,
    ...(typeof body.provider === "string" ? { provider: body.provider } : {}),
    ...(typeof body.provider_page_type === "string" ? { provider_page_type: body.provider_page_type } : {}),
    ...(typeof body.startUrl === "string" ? { startUrl: body.startUrl } : {}),
  };
}

function deriveConstraintsFromJob(job: BookingJob): JobConstraints {
  const first = job.steps?.[0];
  if (first?.type === "activity") {
    return deriveActivityConstraintsFromStep(first) as JobConstraints;
  }
  return deriveRestaurantConstraintsFromStep(first) as JobConstraints;
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

function mirrorActivityConstraintsToBody(
  step: BookingJobStep,
  c: ActivityConstraintsPlaceholder,
): BookingJobStep {
  const body = { ...(step.body as Record<string, unknown>) };
  const eventName = readString(c.event_name) ?? readString(body.event_name) ?? readString(body.activity_name) ?? step.label;
  const eventDate = readString(c.event_date);
  const eventTime = readString(c.event_time);
  const city = readString(c.city);
  const numTickets = readNumber(c.num_tickets);
  const provider = readString(c.provider) ?? readString(body.provider) ?? "ticketmaster";
  const pageType = readString(c.provider_page_type) ?? readString(body.provider_page_type);
  const providerUrl = readString(c.startUrl) ?? readString(body.startUrl) ?? readString(body.fallbackUrl);

  if (eventName) {
    body.event_name = eventName;
    body.activity_name = eventName;
  }
  if (eventDate) {
    body.event_date = eventDate;
    body.date = eventDate;
  }
  if (eventTime) {
    body.event_time = eventTime;
    body.time = eventTime;
  }
  if (city) body.city = city;
  if (numTickets) body.num_tickets = numTickets;
  if (providerUrl && eventName) {
    const baseTask = buildDirectActivityTask({
      eventName,
      eventDate,
      numTickets: numTickets ?? readNumber(body.num_tickets) ?? 1,
      providerUrl,
      provider: provider as Parameters<typeof buildDirectActivityTask>[0]["provider"],
      pageType: pageType as Parameters<typeof buildDirectActivityTask>[0]["pageType"],
    });
    const choiceDetails = [
      eventDate ? `date ${eventDate}` : null,
      eventTime ? `time ${eventTime}` : null,
      city ? `city ${city}` : null,
    ].filter(Boolean).join(", ");
    body.task = choiceDetails
      ? `${baseTask} The user selected ${choiceDetails}; use that to choose the provider-rendered listing.`
      : baseTask;
  }

  return { ...step, body };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ─── Audit log entry ────────────────────────────────────────────────────────

function summarisePatch(patch: JobModificationPatch): string {
  const parts: string[] = [];
  const c = patch.constraints;
  if (c) {
    if (c.time !== undefined) parts.push(`time → ${c.time}`);
    if (c.date !== undefined) parts.push(`date → ${c.date}`);
    if (c.event_date !== undefined) parts.push(`event_date → ${c.event_date}`);
    if (c.event_time !== undefined) parts.push(`event_time → ${c.event_time}`);
    if (c.party_size !== undefined) parts.push(`party_size → ${c.party_size}`);
    if (c.num_tickets !== undefined) parts.push(`num_tickets → ${c.num_tickets}`);
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
    deriveConstraintsFromJob(job);
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
        : step.type === "activity" && nextConstraints.task_type === "activity_booking"
          ? mirrorActivityConstraintsToBody(step, nextConstraints)
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
