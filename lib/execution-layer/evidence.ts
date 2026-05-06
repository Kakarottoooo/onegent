import type { DecisionLogEntry } from "@/lib/db";
import type { TaskTimelineEvent } from "@/lib/task-timeline";
import type {
  ExecutionEvent,
  ExecutionStage,
  ExecutorTerminalOutcome,
} from "./types";

export const EVENT_DRIVEN_SCREENSHOT_STAGES = [
  "page_opened",
  "stage_transition",
  "before_action",
  "after_action",
  "failure",
  "layer_escalated",
  "terminal_checkpoint",
] as const satisfies readonly ExecutionStage[];

export interface ExecutionEvidenceRecord {
  event: ExecutionEvent;
  decisionLogEntry: DecisionLogEntry;
  timelineEvent: TaskTimelineEvent;
  screenshotRequired: boolean;
}

export function executionEventsToEvidenceRecords(
  events: readonly ExecutionEvent[],
): ExecutionEvidenceRecord[] {
  return events.map((event, index) => ({
    event,
    decisionLogEntry: executionEventToDecisionLogEntry(event),
    timelineEvent: executionEventToTaskTimelineEvent(event, index),
    screenshotRequired: shouldCaptureScreenshotForEvent(event),
  }));
}

export function executionEventToDecisionLogEntry(
  event: ExecutionEvent,
): DecisionLogEntry {
  return {
    ts: event.ts,
    type: decisionLogTypeForEvent(event),
    message: `[${event.layer}] ${event.message}`,
    outcome: event.terminalOutcome ?? event.escalationReason ?? event.stage,
  };
}

export function executionEventToTaskTimelineEvent(
  event: ExecutionEvent,
  index = 0,
): TaskTimelineEvent {
  return {
    id: `execution-layer-${event.eventId || index}`,
    ts: event.ts,
    level: event.stage === "orchestrator_started" ? "job" : "step",
    kind: timelineKindForEvent(event),
    status: timelineStatusForEvent(event),
    title: `${event.layer}: ${event.stage}`,
    detail: event.message,
    source: "decision_log",
  };
}

export function shouldCaptureScreenshotForEvent(event: ExecutionEvent): boolean {
  return (EVENT_DRIVEN_SCREENSHOT_STAGES as readonly ExecutionStage[]).includes(
    event.stage,
  );
}

function decisionLogTypeForEvent(event: ExecutionEvent): DecisionLogEntry["type"] {
  if (event.stage === "layer_escalated") return "retry";
  if (event.stage === "terminal_checkpoint") {
    if (event.terminalOutcome === "success" || event.terminalOutcome === "safe_handoff") {
      return "succeeded";
    }
    if (event.terminalOutcome === "no_availability") return "skipped";
    if (isErrorOutcome(event.terminalOutcome)) return "failed";
  }
  if (event.severity === "error") return "failed";
  if (event.stage === "attempt_started" || event.stage === "before_action") {
    return "attempt";
  }
  return "info";
}

function timelineKindForEvent(event: ExecutionEvent): TaskTimelineEvent["kind"] {
  switch (event.stage) {
    case "orchestrator_started":
      return "job_started";
    case "attempt_started":
    case "page_opened":
    case "stage_transition":
      return "step_started";
    case "layer_escalated":
      return "retry";
    case "before_action":
    case "after_action":
      return "trace";
    case "terminal_checkpoint":
      if (event.terminalOutcome === "payment_boundary") return "payment_required";
      if (event.terminalOutcome === "safe_handoff" || event.terminalOutcome === "success") {
        return "step_result";
      }
      return "user_attention";
    case "failure":
    case "layer_blocked":
      return "blocked";
    case "patch_proposal":
    case "executor_result":
      return "step_result";
  }
}

function timelineStatusForEvent(event: ExecutionEvent): TaskTimelineEvent["status"] {
  if (event.severity === "error") return "error";
  if (event.severity === "warning") return "warning";
  if (event.terminalOutcome === "success" || event.terminalOutcome === "safe_handoff") {
    return "success";
  }
  if (event.stage === "attempt_started") return "live";
  return "info";
}

function isErrorOutcome(
  outcome: ExecutorTerminalOutcome | undefined,
): boolean {
  return (
    outcome === "unsafe_boundary" ||
    outcome === "insufficient_evidence" ||
    outcome === "failed_unknown"
  );
}
