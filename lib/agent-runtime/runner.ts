/**
 * Unified Task Runner
 *
 * The single execution loop for all agent tasks.
 * Handles: skill dispatch, replan cascades, recovery, policy bias, logging.
 *
 * Design contract:
 *   - Never knows about specific domains (restaurant / hotel / flight)
 *   - All domain knowledge lives in Skill implementations
 *   - Replan logic lives in lib/replan.ts (imported, not duplicated)
 */

import type {
  TaskDef,
  TaskStepDef,
  SkillContext,
  StepOutcome,
  StepRunResult,
  TaskRunResult,
} from "./types";
import { getSkill } from "./registry";
import { detectReplanTriggers, computeReplan, applyReplan } from "@/lib/replan";
import type { BookingJobStep, DecisionLogEntry, StepActionItem } from "@/lib/db";

/**
 * Internal step snapshot — a superset of BookingJobStep used during execution.
 * Compatible with BookingJobStep for replan/cascade operations.
 */
type StepSnapshot = BookingJobStep;

// ── Run a full task ────────────────────────────────────────────────────────

export async function runTask(
  task: TaskDef,
  ctx: SkillContext,
  options: {
    /** Step indices that are already done and should be skipped */
    skipIndices?: Set<number>;
    /** DB steps snapshot — used for replan cascade */
    existingSteps?: BookingJobStep[];
    onStepComplete?: (index: number, result: StepRunResult) => Promise<void>;
  } = {}
): Promise<TaskRunResult> {
  const { skipIndices = new Set(), existingSteps, onStepComplete } = options;

  // Mutable step snapshots used for replan — shape matches BookingJobStep
  const stepSnapshots: StepSnapshot[] = existingSteps
    ? [...existingSteps]
    : task.steps.map((def, i) => stepDefToSnapshot(def, i));

  const stepResults: StepRunResult[] = [];

  for (let i = 0; i < task.steps.length; i++) {
    if (skipIndices.has(i)) continue;

    const def = task.steps[i]!;

    // Check dependencies — skip if a required predecessor failed
    if (def.dependsOn?.length) {
      const blockedBy = def.dependsOn.find((depIdx) => {
        const depResult = stepResults.find((r) => r.stepIndex === depIdx);
        return !depResult || depResult.outcome.status === "failed" || depResult.outcome.status === "blocked";
      });
      if (blockedBy !== undefined && !def.optional) {
        const blocked: StepRunResult = {
          stepIndex: i,
          skillId: def.skillId,
          outcome: {
            status: "blocked",
            reason: `Step ${blockedBy} (${task.steps[blockedBy]!.label}) did not succeed`,
            actionItem: "Resolve the upstream step first",
          },
          durationMs: 0,
          logEntries: [],
        };
        stepResults.push(blocked);
        await onStepComplete?.(i, blocked);
        continue;
      }
    }

    const skill = getSkill(def.skillId);
    if (!skill) {
      const missing: StepRunResult = {
        stepIndex: i,
        skillId: def.skillId,
        outcome: { status: "failed", reason: `Skill "${def.skillId}" not found`, terminal: true },
        durationMs: 0,
        logEntries: [],
      };
      stepResults.push(missing);
      await onStepComplete?.(i, missing);
      continue;
    }

    // Collect log entries emitted during this step
    const logEntries: DecisionLogEntry[] = [];
    const stepCtx: SkillContext = {
      ...ctx,
      log(entry) {
        logEntries.push({ ...entry, ts: new Date().toISOString() } as DecisionLogEntry);
        ctx.log(entry); // forward to outer logger too
      },
    };

    const before = { ...stepSnapshots[i] };
    const start = Date.now();
    let outcome: StepOutcome;

    try {
      outcome = await skill.execute(def.input, stepCtx);
    } catch (err) {
      outcome = {
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
        terminal: false,
      };
    }

    const durationMs = Date.now() - start;

    // Merge outcome into snapshot for replan
    stepSnapshots[i] = mergeOutcomeIntoSnapshot(stepSnapshots[i]!, outcome, def);

    const result: StepRunResult = { stepIndex: i, skillId: def.skillId, outcome, durationMs, logEntries };
    stepResults.push(result);

    // ── Scene-level replan ──
    const triggers = detectReplanTriggers(before, stepSnapshots[i]!, i);
    for (const trigger of triggers) {
      const replan = computeReplan(stepSnapshots, trigger, ctx.autonomy);
      if (replan && replan.affectedCount > 0) {
        const replanned = applyReplan(stepSnapshots, replan);
        for (let j = 0; j < replanned.length; j++) stepSnapshots[j] = replanned[j]!;
      }
    }

    await onStepComplete?.(i, result);
  }

  const overallStatus = deriveOverallStatus(stepResults);
  const summary = buildSummary(task, stepResults, overallStatus);

  return {
    taskId: task.id,
    jobId: ctx.jobId,
    steps: stepResults,
    overallStatus,
    summary,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function stepDefToSnapshot(def: TaskStepDef, _index: number): StepSnapshot {
  return {
    type: "restaurant",   // placeholder; runner uses skill.stepType in future
    label: def.label,
    emoji: def.emoji,
    apiEndpoint: "",      // filled by skill execution layer
    body: def.input as Record<string, unknown>,
    fallbackUrl: "",
    status: "pending",
  };
}

function mergeOutcomeIntoSnapshot(
  snap: StepSnapshot,
  outcome: StepOutcome,
  _def: TaskStepDef
): StepSnapshot {
  const base = { ...snap };
  if (outcome.status === "succeeded" || outcome.status === "adjusted" || outcome.status === "fallback") {
    base.status = "done";
    base.handoff_url = outcome.result.handoffUrl;
    if (outcome.result.sessionUrl) base.session_url = outcome.result.sessionUrl;
    base.selected_time = outcome.result.scheduledAt;
    base.body = {
      ...base.body,
      scheduledAt: outcome.result.scheduledAt,
      entityLabel: outcome.result.entityLabel,
      usedFallback: outcome.result.usedFallback ?? false,
    };
    if (outcome.status === "fallback") base.usedFallback = true;
  } else if (outcome.status === "blocked") {
    base.status = "no_availability";
    base.error = outcome.reason;
    const ai: StepActionItem = {
      message: outcome.actionItem ?? outcome.reason,
      options: [],
    };
    base.actionItem = ai;
    if (outcome.retryAfter) base.retryScheduledFor = outcome.retryAfter;
  } else {
    base.status = "error";
    base.error = outcome.reason;
  }
  return base;
}

function deriveOverallStatus(results: StepRunResult[]): TaskRunResult["overallStatus"] {
  if (results.length === 0) return "failed";
  const succeeded = results.filter((r) => r.outcome.status === "succeeded" || r.outcome.status === "adjusted" || r.outcome.status === "fallback").length;
  const failed    = results.filter((r) => r.outcome.status === "failed").length;
  const blocked   = results.filter((r) => r.outcome.status === "blocked").length;

  if (succeeded === results.length) return "succeeded";
  if (failed === results.length)    return "failed";
  if (blocked > 0 && succeeded === 0) return "blocked";
  return "partially_completed";
}

function buildSummary(task: TaskDef, results: StepRunResult[], status: string): string {
  const succeeded = results.filter((r) =>
    r.outcome.status === "succeeded" || r.outcome.status === "adjusted" || r.outcome.status === "fallback"
  ).length;
  return `${task.label}: ${succeeded}/${results.length} steps ${status}`;
}
