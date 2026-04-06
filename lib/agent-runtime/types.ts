/**
 * Unified Agent Runtime — Core Types
 *
 * Abstracts the booking system into a composable framework.
 * Adding a new scenario (date_night, gifts, activities) = config, not infrastructure.
 *
 *   Task          — a user intent ("weekend trip to Paris")
 *   TaskStep      — one atomic booking action within a task
 *   Skill         — a reusable capability that can execute, verify, and recover
 *   SkillContext  — runtime environment passed to every skill execution
 *   StepOutcome   — the result of executing a skill
 *   RecoveryStrategy — how to handle failure
 */

import type { AgentAutonomySettings } from "@/lib/autonomy";
import type { PolicyBias, UserPreferenceProfile } from "@/lib/policy";
import type { RelationshipProfile } from "@/lib/memory";
import type { DecisionLogEntry } from "@/lib/db";

// ── Step outcome ───────────────────────────────────────────────────────────

export type StepOutcome =
  | { status: "succeeded";  result: SkillResult; adjustment?: string }
  | { status: "adjusted";   result: SkillResult; adjustment: string }
  | { status: "fallback";   result: SkillResult; fallbackLabel: string }
  | { status: "blocked";    reason: string; actionItem?: string; retryAfter?: string }
  | { status: "failed";     reason: string; terminal?: boolean };

// ── Skill result ───────────────────────────────────────────────────────────

export interface SkillResult {
  /** Human-readable summary: "Booked Masa at 8 PM" */
  summary: string;
  /** The primary entity selected (venue name, hotel name, flight number, …) */
  entityLabel: string;
  /** Provider used (OpenTable, Booking.com, Google Flights, …) */
  provider?: string;
  /** URL for the user to confirm / manage the booking */
  handoffUrl?: string;
  /** ISO datetime if the booking has a specific time */
  scheduledAt?: string;
  /** Whether this result used a fallback option (affects satisfaction score) */
  usedFallback?: boolean;
  /** Whether the booking flow requires a payment step */
  requiresPayment?: boolean;
  /** Arbitrary payload for downstream steps / replan */
  meta?: Record<string, unknown>;
}

// ── Recovery strategy ──────────────────────────────────────────────────────

export type RecoveryType =
  | "retry_same"          // try the same approach again
  | "retry_alternative"   // try a different provider / venue
  | "adjust_time"         // shift time slot and retry
  | "adjust_location"     // shift to nearby area and retry
  | "schedule_retry"      // defer to a later time (cron retry)
  | "escalate_to_user";   // requires human input

export interface RecoveryStrategy {
  type: RecoveryType;
  priority: number;          // lower = try first
  params?: Record<string, unknown>;
  description: string;
}

// ── Skill interface ────────────────────────────────────────────────────────

export interface Skill<TInput = Record<string, unknown>, TOutput extends SkillResult = SkillResult> {
  /** Unique identifier, snake_case */
  id: string;
  /** Display name shown in logs and UI */
  label: string;
  /** Emoji for log entries */
  emoji: string;
  /** Step type — "restaurant" | "hotel" | "flight" match DB; "activity" | "custom" are runtime-only */
  stepType: "restaurant" | "hotel" | "flight" | "activity" | "custom";

  /**
   * Execute the skill.
   * The runner provides full context; the skill focuses solely on its domain.
   */
  execute(input: TInput, ctx: SkillContext): Promise<StepOutcome>;

  /**
   * Verify a previously executed result is still valid.
   * Called by active monitors. Return null if not verifiable.
   */
  verify?(result: TOutput, ctx: SkillContext): Promise<VerifyResult | null>;

  /**
   * Return ordered list of recovery strategies for a given failure reason.
   * The runner picks the highest-priority strategy that fits the autonomy settings.
   */
  getFallbackStrategies(reason: string, ctx: SkillContext): RecoveryStrategy[];
}

// ── Verify result ──────────────────────────────────────────────────────────

export type VerifyResult =
  | { status: "ok" }
  | { status: "changed"; detail: string }
  | { status: "cancelled"; detail: string }
  | { status: "unavailable"; detail: string };

// ── Skill context ──────────────────────────────────────────────────────────

export interface SkillContext {
  /** Job / task identity */
  jobId: string;
  sessionId: string;
  tripLabel: string;

  /** Autonomy / tolerance settings from the user */
  autonomy: AgentAutonomySettings;

  /** Policy bias computed from feedback history */
  policy: PolicyBias;

  /** Behavioral profile: what the user consistently rejects */
  profile: UserPreferenceProfile;

  /** Group / relationship context */
  relationship: RelationshipProfile | null;

  /** Append a structured log entry (fire-and-forget) */
  log(entry: Omit<DecisionLogEntry, "ts">): void;

  /** Abort signal for long-running operations */
  signal?: AbortSignal;

  /** Base URL for internal API calls (needed in server-side skill execution) */
  baseUrl: string;
}

// ── Task and step definitions ──────────────────────────────────────────────

export interface TaskStepDef<TInput extends Record<string, unknown> = Record<string, unknown>> {
  /** Skill to invoke */
  skillId: string;
  /** Human-readable label: "Dinner at Le Bernardin" */
  label: string;
  /** Emoji for UI */
  emoji: string;
  /** Input to pass to skill.execute() */
  input: TInput;
  /** Whether this step is optional (skip on repeated failure) */
  optional?: boolean;
  /**
   * Dependencies: indices of steps that must succeed before this one runs.
   * Used for scene-level replan cascades.
   */
  dependsOn?: number[];
}

export interface TaskDef {
  /** Task template identifier, e.g. "date_night", "weekend_trip" */
  id: string;
  /** Display label */
  label: string;
  /** Ordered list of steps */
  steps: TaskStepDef[];
}

// ── Scenario builder ───────────────────────────────────────────────────────

/**
 * A scenario is a factory that builds a TaskDef from user-provided parameters.
 * This is the only thing you need to add to support a new scenario type.
 */
export interface ScenarioBuilder<TParams = Record<string, unknown>> {
  id: string;
  label: string;
  description: string;
  build(params: TParams): TaskDef;
}

// ── Runtime result ─────────────────────────────────────────────────────────

export interface StepRunResult {
  stepIndex: number;
  skillId: string;
  outcome: StepOutcome;
  durationMs: number;
  logEntries: DecisionLogEntry[];
}

export interface TaskRunResult {
  taskId: string;
  jobId: string;
  steps: StepRunResult[];
  overallStatus: "succeeded" | "partially_completed" | "failed" | "blocked";
  summary: string;
}
