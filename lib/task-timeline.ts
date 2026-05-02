import type { BookingJob, BookingJobStep, DecisionLogEntry } from "@/lib/db";
import type { LiveLogLineEntry } from "@/lib/live-log-store";

export type TaskTimelineEventLevel = "job" | "step" | "trace";
export type TaskTimelineEventStatus = "info" | "success" | "warning" | "error" | "live";
export type TaskTimelineEventKind =
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "step_started"
  | "step_result"
  | "fallback_used"
  | "search_loaded"
  | "form_filled"
  | "checkout_reached"
  | "payment_required"
  | "blocked"
  | "retry"
  | "user_attention"
  | "trace";

export interface TaskTimelineEvent {
  id: string;
  ts: string;
  level: TaskTimelineEventLevel;
  kind: TaskTimelineEventKind;
  status: TaskTimelineEventStatus;
  title: string;
  detail?: string;
  stepIndex?: number;
  source: "decision_log" | "live_log" | "job";
}

export interface TaskTimelineSummary {
  eyebrow: string;
  title: string;
  detail: string;
  tone: TaskTimelineEventStatus;
}

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sentenceCase(value: string): string {
  const trimmed = normalizeLine(value);
  if (!trimmed) return "";
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

function cleanTraceLabel(value: string): string {
  return sentenceCase(
    value
      .replace(/^\[[^\]]+\]\s*/g, "")
      .replace(/^booking\.com[:\s-]*/i, "")
      .replace(/^expedia[:\s-]*/i, "")
      .replace(/^flight-rpa[:\s-]*/i, "")
  );
}

function decisionLogToEvent(
  entry: DecisionLogEntry,
  step: BookingJobStep,
  stepIndex: number,
  index: number
): TaskTimelineEvent {
  let kind: TaskTimelineEventKind = "step_result";
  let status: TaskTimelineEventStatus = "info";

  switch (entry.type) {
    case "succeeded":
      kind = step.status === "awaiting_confirmation" ? "payment_required" : "step_result";
      status = "success";
      break;
    case "failed":
      kind = "user_attention";
      status = "error";
      break;
    case "retry":
      kind = "retry";
      status = "warning";
      break;
    case "time_adjusted":
    case "venue_switched":
    case "scene_replan":
    case "task_modified":
      kind = "fallback_used";
      status = "warning";
      break;
    case "skipped":
      kind = "user_attention";
      status = "warning";
      break;
    case "attempt":
    case "info":
    default:
      kind = "step_started";
      status = "info";
      break;
  }

  return {
    id: `decision-${stepIndex}-${index}`,
    ts: entry.ts,
    level: "step",
    kind,
    status,
    title: step.label,
    detail: entry.outcome ? `${entry.message} - ${entry.outcome}` : entry.message,
    stepIndex,
    source: "decision_log",
  };
}

function parseLiveLogEntry(entry: LiveLogLineEntry, index: number): TaskTimelineEvent | null {
  const raw = normalizeLine(entry.line);
  const lower = raw.toLowerCase();

  let event:
    | Pick<TaskTimelineEvent, "kind" | "status" | "title" | "detail">
    | null = null;

  if (
    lower.includes("starting programmatic") ||
    lower.includes("executor starting") ||
    lower.includes("[ai-loop] starting")
  ) {
    event = {
      kind: "job_started",
      status: "live",
      title: "Started automated run",
      detail: cleanTraceLabel(raw),
    };
  } else if (
    lower.includes("waiting for flight results") ||
    lower.includes("listing page reached") ||
    lower.includes("search results")
  ) {
    event = {
      kind: "search_loaded",
      status: "live",
      title: "Loaded search results",
      detail: cleanTraceLabel(raw),
    };
  } else if (
    lower.includes("filled ") ||
    lower.includes("guest form filled") ||
    lower.includes("payment filled")
  ) {
    event = {
      kind: "form_filled",
      status: "success",
      title: "Filled booking details",
      detail: cleanTraceLabel(raw),
    };
  } else if (
    lower.includes("payment page reached") ||
    lower.includes("reached the payment gate") ||
    lower.includes("checkout reached") ||
    lower.includes("ready for manual payment completion")
  ) {
    event = {
      kind: lower.includes("payment") ? "payment_required" : "checkout_reached",
      status: "warning",
      title: lower.includes("payment") ? "Waiting for payment approval" : "Reached checkout",
      detail: cleanTraceLabel(raw),
    };
  } else if (
    lower.includes("blocked") ||
    lower.includes("captcha") ||
    lower.includes("bot-detection")
  ) {
    event = {
      kind: "blocked",
      status: "error",
      title: "Site blocked the run",
      detail: cleanTraceLabel(raw),
    };
  } else if (lower.includes("retry") || lower.includes("trying again")) {
    event = {
      kind: "retry",
      status: "warning",
      title: "Retrying automatically",
      detail: cleanTraceLabel(raw),
    };
  } else if (
    lower.includes("no availability") ||
    lower.includes("could not match") ||
    lower.includes("could not find") ||
    lower.includes("did not reach")
  ) {
    event = {
      kind: "user_attention",
      status: lower.includes("no availability") ? "warning" : "error",
      title: lower.includes("no availability") ? "No availability found" : "Agent hit a blocker",
      detail: cleanTraceLabel(raw),
    };
  } else if (
    lower.includes("clicked") ||
    lower.includes("opened matched hotel") ||
    lower.includes("selected card type") ||
    lower.includes("set quantity")
  ) {
    event = {
      kind: "trace",
      status: "info",
      title: "Progressed the flow",
      detail: cleanTraceLabel(raw),
    };
  }

  if (!event) return null;

  return {
    id: `trace-${index}`,
    ts: entry.ts,
    level: "trace",
    stepIndex: undefined,
    source: "live_log",
    ...event,
  };
}

function dedupeTimelineEvents(events: TaskTimelineEvent[]): TaskTimelineEvent[] {
  const deduped: TaskTimelineEvent[] = [];
  for (const event of events) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.kind === event.kind &&
      prev.title === event.title &&
      prev.detail === event.detail
    ) {
      continue;
    }
    deduped.push(event);
  }
  return deduped;
}

export function buildTaskTimelineEvents(
  job: BookingJob,
  liveEntries: LiveLogLineEntry[] = []
): TaskTimelineEvent[] {
  const events: TaskTimelineEvent[] = [
    {
      id: `job-start-${job.id}`,
      ts: job.created_at,
      level: "job",
      kind: "job_started",
      status: job.status === "failed" ? "error" : job.status === "done" ? "success" : "live",
      title: "Task created",
      detail: job.trip_label,
      source: "job",
    },
  ];

  job.steps.forEach((step, stepIndex) => {
    const startedAt = step.decisionLog?.[0]?.ts;
    if (startedAt) {
      events.push({
        id: `step-start-${stepIndex}`,
        ts: startedAt,
        level: "step",
        kind: "step_started",
        status: step.status === "loading" ? "live" : "info",
        title: step.label,
        detail: `Started ${step.type} step`,
        stepIndex,
        source: "job",
      });
    }
    for (const [index, entry] of (step.decisionLog ?? []).entries()) {
      events.push(decisionLogToEvent(entry, step, stepIndex, index));
    }
    if (step.status === "awaiting_confirmation") {
      const profileGap = getStepProfileGap(step);
      events.push({
        id: `step-awaiting-${stepIndex}`,
        ts: job.updated_at,
        level: "step",
        kind: profileGap ? "user_attention" : "payment_required",
        status: "warning",
        title: step.label,
        detail: profileGap?.message ?? "Agent reached the final payment gate and is waiting for you.",
        stepIndex,
        source: "job",
      });
    } else if (step.actionItem) {
      events.push({
        id: `step-action-${stepIndex}`,
        ts: job.updated_at,
        level: "step",
        kind: "user_attention",
        status: "error",
        title: step.label,
        detail: step.actionItem.message,
        stepIndex,
        source: "job",
      });
    }
  });

  for (const [index, entry] of liveEntries.entries()) {
    const parsed = parseLiveLogEntry(entry, index);
    if (parsed) events.push(parsed);
  }

  if (job.status === "done" && job.completed_at) {
    events.push({
      id: `job-complete-${job.id}`,
      ts: job.completed_at,
      level: "job",
      kind: "job_completed",
      status: "success",
      title: "Task completed",
      detail: `${job.steps.filter((step) => step.status === "done").length}/${job.steps.length} steps ready`,
      source: "job",
    });
  } else if (job.status === "failed") {
    events.push({
      id: `job-failed-${job.id}`,
      ts: job.updated_at,
      level: "job",
      kind: "job_failed",
      status: "error",
      title: "Task failed",
      detail: "The agent stopped before reaching a ready state.",
      source: "job",
    });
  }

  return dedupeTimelineEvents(events).sort((a, b) => {
    return new Date(a.ts).getTime() - new Date(b.ts).getTime();
  });
}

export function buildTaskTimelineSummary(job: BookingJob): TaskTimelineSummary {
  const activeStep = job.steps.find((step) => step.status === "loading");
  const paymentStep = job.steps.find((step) => step.status === "awaiting_confirmation");
  const actionStep = job.steps.find((step) => step.actionItem);
  const fallbackCount = job.steps.filter((step) => step.timeAdjusted || step.usedFallback).length;
  const readyCount = job.steps.filter((step) => step.status === "done").length;

  if (paymentStep) {
    const profileGap = getStepProfileGap(paymentStep);
    return {
      eyebrow: "Needs you",
      title: profileGap ? "Booking profile required" : "Waiting for payment approval",
      detail: profileGap?.message ?? `${paymentStep.label} is at the final gate. ${fallbackCount > 0 ? `${fallbackCount} agent adjustment${fallbackCount > 1 ? "s" : ""} used.` : "Everything else is ready."}`,
      tone: "warning",
    };
  }

  if (activeStep) {
    return {
      eyebrow: "Live now",
      title: activeStep.label,
      detail: fallbackCount > 0
        ? `${fallbackCount} adjustment${fallbackCount > 1 ? "s" : ""} used so far. Agent is still progressing the flow.`
        : "Agent is progressing the booking flow in real time.",
      tone: "live",
    };
  }

  if (actionStep) {
    return {
      eyebrow: "Attention",
      title: "Needs your decision",
      detail: actionStep.actionItem?.message ?? "The agent needs you to pick the next move.",
      tone: "error",
    };
  }

  if (job.status === "done") {
    return {
      eyebrow: "Ready",
      title: "Task completed",
      detail: `${readyCount}/${job.steps.length} step${job.steps.length === 1 ? "" : "s"} ready. ${fallbackCount > 0 ? `Agent used ${fallbackCount} fallback${fallbackCount > 1 ? "s" : ""}.` : "No fallback needed."}`,
      tone: "success",
    };
  }

  if (job.status === "failed") {
    return {
      eyebrow: "Stopped",
      title: "Task failed",
      detail: "The run stopped before reaching a handoff or payment-ready state.",
      tone: "error",
    };
  }

  return {
    eyebrow: "Queued",
    title: "Waiting to start",
    detail: "The task has been created and is waiting for the executor.",
    tone: "info",
  };
}

function getStepProfileGap(step: BookingJobStep): { message?: string } | null {
  const value = step.body?.profileGap;
  if (!value || typeof value !== "object") return null;
  const profileGap = value as { kind?: unknown; message?: unknown };
  if (profileGap.kind !== "needs_profile_data") return null;
  return typeof profileGap.message === "string" ? { message: profileGap.message } : {};
}
