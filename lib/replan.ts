/**
 * Scene-Level Replan Engine
 *
 * This is the difference between a booking runner and an orchestration agent.
 *
 * A booking runner treats each step independently.
 * An orchestration agent understands that steps are interconnected:
 *   - dinner time depends on hotel check-in, which depends on flight arrival
 *   - restaurant location relevance depends on which hotel area was booked
 *   - afternoon activity depends on when the morning task ends
 *
 * When any step's outcome differs from the original plan, this engine:
 *   1. Detects what changed (trigger)
 *   2. Determines which downstream steps are affected (dependency scan)
 *   3. Decides on a replan strategy: soft / ask_user
 *   4. Applies changes and writes decision log entries explaining the cascade
 *
 * ─── Strategies ──────────────────────────────────────────────────────────────
 *   soft_replan   — agent adjusts downstream steps automatically (within autonomy)
 *   ask_user      — change exceeds autonomy; agent explains what changed and asks
 *
 * ─── Triggers ────────────────────────────────────────────────────────────────
 *   time_shifted      — a step's time moved by ≥ MIN_CASCADE_MINUTES
 *   venue_changed     — hotel/restaurant switched to a different venue or area
 *   flight_shifted    — flight arrival changed, affecting whole-day schedule
 *   step_blocked      — a step couldn't complete; downstream steps are flagged
 */

import type { BookingJobStep, DecisionLogEntry } from "./db";
import type { AgentAutonomySettings } from "./autonomy";

// Minimum time shift (minutes) that triggers a cascade check
const MIN_CASCADE_MINUTES = 30;

// ── Types ──────────────────────────────────────────────────────────────────

export type ReplanTriggerType =
  | "time_shifted"
  | "venue_changed"
  | "flight_shifted"
  | "step_blocked";

export interface ReplanTrigger {
  type: ReplanTriggerType;
  stepIndex: number;
  stepType: BookingJobStep["type"];
  stepLabel: string;
  details: {
    originalTime?: string;
    newTime?: string;
    deltaMinutes?: number;     // positive = later, negative = earlier
    originalVenue?: string;
    newVenue?: string;
    blockReason?: string;
  };
}

export type ReplanStrategy = "soft_replan" | "ask_user" | "no_action";

export interface StepCascade {
  stepIndex: number;
  /** Mutation to apply to the step's body before it runs */
  bodyPatch?: Record<string, unknown>;
  /** Whether this cascade requires user approval before executing the step */
  requiresApproval: boolean;
  /** Log entries to prepend to that step's decision log */
  logEntries: DecisionLogEntry[];
}

export interface ReplanResult {
  strategy: ReplanStrategy;
  trigger: ReplanTrigger;
  cascades: StepCascade[];
  /** Entries appended to the triggering step's own decision log */
  triggerStepSummary: DecisionLogEntry[];
  affectedCount: number;
}

// ── Trigger detection ──────────────────────────────────────────────────────

/**
 * Compare a step's state before and after execution. Returns all replan
 * triggers caused by the completed step's outcome.
 */
export function detectReplanTriggers(
  before: BookingJobStep,
  after: BookingJobStep,
  stepIndex: number
): ReplanTrigger[] {
  const triggers: ReplanTrigger[] = [];

  // ── Time shift trigger (restaurant time adjusted) ──
  if (after.status === "done" && after.timeAdjusted && after.selected_time) {
    const originalTime = typeof before.body.time === "string" ? before.body.time : null;
    if (originalTime) {
      const delta = toMinutes(after.selected_time) - toMinutes(originalTime);
      if (Math.abs(delta) >= MIN_CASCADE_MINUTES) {
        triggers.push({
          type: "time_shifted",
          stepIndex,
          stepType: after.type,
          stepLabel: after.label,
          details: { originalTime, newTime: after.selected_time, deltaMinutes: delta },
        });
      }
    }
  }

  // ── Venue changed trigger (hotel or restaurant switched to fallback) ──
  if (after.status === "done" && after.usedFallback && after.label !== before.label) {
    triggers.push({
      type: "venue_changed",
      stepIndex,
      stepType: after.type,
      stepLabel: after.label,
      details: { originalVenue: before.label, newVenue: after.label },
    });
  }

  // ── Flight shifted trigger (flight time adjustment) ──
  if (after.status === "done" && after.type === "flight" && after.selected_time) {
    const originalTime = typeof before.body.time === "string" ? before.body.time : null;
    if (originalTime) {
      const delta = toMinutes(after.selected_time) - toMinutes(originalTime);
      if (Math.abs(delta) >= MIN_CASCADE_MINUTES) {
        triggers.push({
          type: "flight_shifted",
          stepIndex,
          stepType: "flight",
          stepLabel: after.label,
          details: { originalTime, newTime: after.selected_time, deltaMinutes: delta },
        });
      }
    }
  }

  // ── Step blocked trigger ──
  if (after.status === "error" && after.actionItem) {
    triggers.push({
      type: "step_blocked",
      stepIndex,
      stepType: after.type,
      stepLabel: after.label,
      details: { blockReason: after.error ?? "Could not complete" },
    });
  }

  return triggers;
}

// ── Replan computation ─────────────────────────────────────────────────────

/**
 * Given a trigger and the current step array, decide what cascades to apply
 * to downstream steps. Returns null if no cascade is warranted.
 */
export function computeReplan(
  steps: BookingJobStep[],
  trigger: ReplanTrigger,
  autonomy: AgentAutonomySettings
): ReplanResult | null {
  const now = new Date().toISOString();
  const cascades: StepCascade[] = [];
  const triggerStepSummary: DecisionLogEntry[] = [];

  switch (trigger.type) {
    case "time_shifted":
    case "flight_shifted": {
      const { originalTime, newTime, deltaMinutes } = trigger.details;
      if (!originalTime || !newTime || deltaMinutes === undefined) break;
      const origMin = toMinutes(originalTime);

      for (let i = trigger.stepIndex + 1; i < steps.length; i++) {
        const step = steps[i];
        if (step.status === "done") continue; // already booked — immutable

        const stepBodyTime = typeof step.body.time === "string" ? step.body.time : null;
        if (!stepBodyTime) continue;

        const stepMin = toMinutes(stepBodyTime);
        // Only cascade to steps that are logically sequenced after the shifted step
        if (stepMin < origMin) continue;

        const cascadedTime = fromMinutes(stepMin + deltaMinutes);
        const absShift = Math.abs(deltaMinutes);

        // Check if the cascaded time is within this step's autonomy window
        const timeWindow = step.type === "restaurant"
          ? autonomy.restaurant.timeWindowMinutes
          : step.type === "flight"
          ? autonomy.flight.departureFlexMinutes
          : 0;

        const isAutoAllowed = absShift <= timeWindow;
        const direction = deltaMinutes > 0 ? "later" : "earlier";

        if (isAutoAllowed) {
          cascades.push({
            stepIndex: i,
            bodyPatch: { time: cascadedTime },
            requiresApproval: false,
            logEntries: [{
              ts: now,
              type: "scene_replan" as DecisionLogEntry["type"],
              message: `Scene replan: ${trigger.stepLabel} shifted ${Math.abs(deltaMinutes)} min ${direction}. Moving ${step.label} from ${stepBodyTime} → ${cascadedTime} to keep your schedule coherent.`,
              outcome: "Auto-adjusted",
            }],
          });
        } else {
          // Outside autonomy window — flag but don't auto-change
          cascades.push({
            stepIndex: i,
            requiresApproval: true,
            logEntries: [{
              ts: now,
              type: "scene_replan" as DecisionLogEntry["type"],
              message: `Scene replan: ${trigger.stepLabel} shifted ${Math.abs(deltaMinutes)} min ${direction}. ${step.label} (${stepBodyTime}) may now be misaligned — shift of ${cascadedTime} is outside your ±${timeWindow}min window.`,
              outcome: "Review recommended",
            }],
          });
        }
      }

      if (cascades.length > 0) {
        const auto = cascades.filter((c) => !c.requiresApproval).length;
        const manual = cascades.filter((c) => c.requiresApproval).length;
        const parts = [];
        if (auto > 0) parts.push(`${auto} step${auto > 1 ? "s" : ""} auto-adjusted`);
        if (manual > 0) parts.push(`${manual} step${manual > 1 ? "s" : ""} flagged for review`);
        triggerStepSummary.push({
          ts: now,
          type: "scene_replan" as DecisionLogEntry["type"],
          message: `Scene replan triggered: ${parts.join(", ")} to keep your itinerary in sync.`,
        });
      }
      break;
    }

    case "venue_changed": {
      const { originalVenue, newVenue } = trigger.details;

      // Hotel area switch → note on downstream restaurant steps
      if (trigger.stepType === "hotel") {
        for (let i = trigger.stepIndex + 1; i < steps.length; i++) {
          const step = steps[i];
          if (step.status === "done" || step.type !== "restaurant") continue;

          cascades.push({
            stepIndex: i,
            requiresApproval: false,
            logEntries: [{
              ts: now,
              type: "scene_replan" as DecisionLogEntry["type"],
              message: `Scene note: Hotel moved from ${originalVenue} to ${newVenue}. ${step.label} was selected near the original hotel — location may be less convenient now.`,
              outcome: "Heads up",
            }],
          });
        }

        if (cascades.length > 0) {
          triggerStepSummary.push({
            ts: now,
            type: "scene_replan" as DecisionLogEntry["type"],
            message: `Venue change noted across ${cascades.length} downstream step${cascades.length > 1 ? "s" : ""}.`,
          });
        }
      }

      // Restaurant venue switch → note on any later same-day steps
      if (trigger.stepType === "restaurant") {
        for (let i = trigger.stepIndex + 1; i < steps.length; i++) {
          const step = steps[i];
          if (step.status === "done") continue;

          // Only flag if the step's body suggests same-day proximity dependency
          if (step.type === "restaurant" || step.type === "hotel") {
            cascades.push({
              stepIndex: i,
              requiresApproval: false,
              logEntries: [{
                ts: now,
                type: "scene_replan" as DecisionLogEntry["type"],
                message: `Scene note: Dinner moved from ${originalVenue} to ${newVenue}. Double-check that ${step.label} is still in a convenient location.`,
                outcome: "Heads up",
              }],
            });
          }
        }
      }
      break;
    }

    case "step_blocked": {
      // Flag downstream steps that may now be logically blocked
      for (let i = trigger.stepIndex + 1; i < steps.length; i++) {
        const step = steps[i];
        if (step.status === "done") continue;

        // Only cascade to same-type or time-dependent steps
        if (step.type !== trigger.stepType) continue;

        cascades.push({
          stepIndex: i,
          requiresApproval: false,
          logEntries: [{
            ts: now,
            type: "scene_replan" as DecisionLogEntry["type"],
            message: `Scene note: ${trigger.stepLabel} is blocked. ${step.label} will still be attempted, but the itinerary may have gaps if the block isn't resolved.`,
            outcome: "Continuing",
          }],
        });
      }
      break;
    }
  }

  if (cascades.length === 0 && triggerStepSummary.length === 0) return null;

  const hasApproval = cascades.some((c) => c.requiresApproval);
  const hasAuto = cascades.some((c) => !c.requiresApproval);

  const strategy: ReplanStrategy =
    hasApproval && !hasAuto ? "ask_user" : "soft_replan";

  return {
    strategy,
    trigger,
    cascades,
    triggerStepSummary,
    affectedCount: cascades.length,
  };
}

// ── Apply replan mutations ─────────────────────────────────────────────────

/**
 * Apply a replan result to the steps array.
 * Returns a new array — original is not mutated.
 */
export function applyReplan(
  steps: BookingJobStep[],
  result: ReplanResult
): BookingJobStep[] {
  const updated = steps.map((s) => ({ ...s }));

  // Apply cascades to downstream steps
  for (const cascade of result.cascades) {
    const step = { ...updated[cascade.stepIndex] };

    if (cascade.bodyPatch) {
      step.body = { ...step.body, ...cascade.bodyPatch };
      step.replanAdjusted = true;
      // Update timeFallbacks to be relative to the new time
      if (cascade.bodyPatch.time && step.timeFallbacks) {
        const newBase = cascade.bodyPatch.time as string;
        step.timeFallbacks = regenerateTimeFallbacks(newBase, step.timeFallbacks);
      }
    }
    if (cascade.requiresApproval) {
      step.replanFlagged = true;
    }

    step.decisionLog = [...(step.decisionLog ?? []), ...cascade.logEntries];
    updated[cascade.stepIndex] = step;
  }

  // Append summary to the step that triggered the replan
  const trigStep = { ...updated[result.trigger.stepIndex] };
  trigStep.decisionLog = [
    ...(trigStep.decisionLog ?? []),
    ...result.triggerStepSummary,
  ];
  updated[result.trigger.stepIndex] = trigStep;

  return updated;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function fromMinutes(minutes: number): string {
  const clamped = Math.max(6 * 60, Math.min(23 * 60 + 30, minutes)); // 06:00–23:30 range
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * Shift existing timeFallbacks by the same delta as the new base time.
 * Preserves relative spacing between the base and alternatives.
 */
function regenerateTimeFallbacks(newBase: string, oldFallbacks: string[]): string[] {
  const baseMin = toMinutes(newBase);
  return [
    fromMinutes(baseMin - 30),
    fromMinutes(baseMin + 30),
    fromMinutes(baseMin - 60),
    fromMinutes(baseMin + 60),
  ].filter((t) => t !== newBase).slice(0, 4);
}
