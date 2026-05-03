import { NextResponse, type NextRequest } from "next/server";
import {
  actorCanAccessTask,
  notFoundResponse,
  requireApiActor,
} from "@/lib/api-auth/require-api-actor";
import {
  getTaskEvents,
  getTravelTask,
  type TravelTask,
  type TravelTaskEvent,
  type TravelTaskState,
} from "@/lib/core";
import {
  buildJobTimelinePayload,
  type JobTimelinePayload,
} from "@/lib/task-timeline-payload";
import type {
  TaskTimelineEvent,
  TaskTimelineSummary,
} from "@/lib/task-timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STREAM_INTERVAL_MS = 1_200;
const STREAM_MAX_MS = 60_000;

const USER_WAITING_STATES = new Set<TravelTaskState>([
  "awaiting_profile",
  "awaiting_login",
  "awaiting_otp",
  "ready_for_confirmation",
]);
const TERMINAL_TASK_STATES = new Set<TravelTaskState>([
  "completed",
  "failed",
  "cancelled",
]);

interface TravelTaskTimelinePayload {
  taskId: string;
  task: ReturnType<typeof toPublicTask>;
  currentJobId: string | null;
  currentJob: JobTimelinePayload["job"] | null;
  events: TaskTimelineEvent[];
  taskEvents: Array<{
    id: string;
    kind: string;
    data: Record<string, unknown>;
    createdAt: string;
  }>;
  summary: TaskTimelineSummary;
  entries: JobTimelinePayload["entries"];
  total: number;
  closed: boolean;
  epoch: number;
  source: "task" | "live" | "audit";
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ taskId: string }> },
) {
  const auth = await requireApiActor(req);
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const { taskId } = await ctx.params;
  if (!taskId) {
    return NextResponse.json(
      { error: { code: "missing_task_id", message: "taskId path param required." } },
      { status: 400 },
    );
  }

  const task = await getTravelTask(taskId);
  if (!task || !actorCanAccessTask(actor, task)) {
    return notFoundResponse("task_not_found", `No travel task with id "${taskId}".`);
  }

  const url = new URL(req.url);
  const wantsJson =
    url.searchParams.get("format") === "json" ||
    req.headers.get("accept")?.includes("application/json");

  if (wantsJson) {
    const payload = await buildTravelTaskTimelinePayload(taskId);
    if (!payload) return notFoundResponse("task_not_found", `No travel task with id "${taskId}".`);
    return NextResponse.json(payload);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let lastSerialized = "";
      const startedAt = Date.now();

      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      controller.enqueue(encoder.encode("retry: 1500\n\n"));

      while (!req.signal.aborted && Date.now() - startedAt < STREAM_MAX_MS) {
        const payload = await buildTravelTaskTimelinePayload(taskId);
        if (!payload) {
          send("error", {
            error: { code: "task_not_found", message: `No travel task with id "${taskId}".` },
          });
          break;
        }

        const serialized = JSON.stringify(payload);
        if (serialized !== lastSerialized) {
          send("timeline", payload);
          lastSerialized = serialized;
        } else {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }

        if (payload.closed) break;
        await sleep(STREAM_INTERVAL_MS);
      }

      try {
        controller.close();
      } catch {
        // The client may have already disconnected.
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Content-Encoding": "identity",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function buildTravelTaskTimelinePayload(
  taskId: string,
): Promise<TravelTaskTimelinePayload | null> {
  const task = await getTravelTask(taskId);
  if (!task) return null;

  const [taskEvents, jobPayload] = await Promise.all([
    getTaskEvents(task.id),
    task.current_booking_job_id
      ? buildJobTimelinePayload(task.current_booking_job_id)
      : Promise.resolve(null),
  ]);

  const taskTimelineEvents = taskEvents.map(taskEventToTimelineEvent);
  const events = dedupeAndSortTimelineEvents([
    ...taskTimelineEvents,
    ...(jobPayload?.events ?? []),
  ]);
  const summary = buildTravelTaskSummary(task, jobPayload?.summary);
  const closed =
    USER_WAITING_STATES.has(task.state) ||
    TERMINAL_TASK_STATES.has(task.state) ||
    Boolean(jobPayload?.closed);

  return {
    taskId: task.id,
    task: toPublicTask(task),
    currentJobId: task.current_booking_job_id,
    currentJob: jobPayload?.job ?? null,
    events,
    taskEvents: taskEvents.map((event) => ({
      id: event.id,
      kind: event.kind,
      data: event.data_json,
      createdAt: toIsoString(event.created_at),
    })),
    summary,
    entries: jobPayload?.entries ?? [],
    total: events.length,
    closed,
    epoch: jobPayload?.epoch ?? 0,
    source: jobPayload?.source ?? "task",
  };
}

function taskEventToTimelineEvent(
  event: TravelTaskEvent,
  index: number,
): TaskTimelineEvent {
  const data = event.data_json ?? {};
  const state = stringValue(data.state);
  const executionStatus = stringValue(data.executionStatus);
  const error = stringValue(data.error) || stringValue(data.terminalReason);
  const jobId = stringValue(data.jobId);

  switch (event.kind) {
    case "task_created":
      return baseTaskEvent(event, index, {
        kind: "job_started",
        status: "info",
        title: "Travel task created",
        detail: stringValue(data.title) || stringValue(data.scenario),
      });
    case "booking_job_created":
      return baseTaskEvent(event, index, {
        kind: "job_started",
        status: "live",
        title: "Execution attempt created",
        detail: jobId ? `Booking job ${jobId}` : undefined,
      });
    case "execution_started":
      return baseTaskEvent(event, index, {
        kind: "job_started",
        status: "live",
        title: "Started automated run",
        detail: jobId ? `Booking job ${jobId}` : undefined,
      });
    case "execution_finished":
      return baseTaskEvent(event, index, {
        kind: executionStatus === "completed" ? "job_completed" : "step_result",
        status: executionStatus === "completed" ? "success" : error ? "error" : "warning",
        title: "Execution finished",
        detail: error || stringValue(data.summary) || executionStatus,
      });
    case "state_changed":
      return stateChangedEvent(event, index, state ?? "", data);
    case "task_cancelled":
      return baseTaskEvent(event, index, {
        kind: "job_failed",
        status: "warning",
        title: "Task cancelled",
        detail: stringValue(data.reason),
      });
    default:
      const kindLabel = event.kind as string;
      return baseTaskEvent(event, index, {
        kind: "trace",
        status: "info",
        title: sentenceCase(kindLabel.replace(/_/g, " ")),
        detail: JSON.stringify(data),
      });
  }
}

function stateChangedEvent(
  event: TravelTaskEvent,
  index: number,
  state: string,
  data: Record<string, unknown>,
): TaskTimelineEvent {
  if (state === "awaiting_profile") {
    return baseTaskEvent(event, index, {
      kind: "user_attention",
      status: "warning",
      title: "Booking profile required",
      detail: stringValue(data.terminalReason) || "The agent needs missing profile fields before it can continue.",
    });
  }
  if (state === "awaiting_login") {
    return baseTaskEvent(event, index, {
      kind: "user_attention",
      status: "warning",
      title: "Login required",
      detail: stringValue(data.terminalReason) || "The site requires a user login before the task can continue.",
    });
  }
  if (state === "awaiting_otp") {
    return baseTaskEvent(event, index, {
      kind: "user_attention",
      status: "warning",
      title: "OTP required",
      detail: stringValue(data.terminalReason) || "The site requires a one-time passcode before the task can continue.",
    });
  }
  if (state === "ready_for_confirmation") {
    return baseTaskEvent(event, index, {
      kind: "payment_required",
      status: "warning",
      title: "Ready for confirmation",
      detail: stringValue(data.terminalReason) || "The agent stopped at the final user-confirmation boundary.",
    });
  }
  if (state === "completed") {
    return baseTaskEvent(event, index, {
      kind: "job_completed",
      status: "success",
      title: "Task completed",
      detail: stringValue(data.terminalReason),
    });
  }
  if (state === "failed" || state === "cancelled") {
    return baseTaskEvent(event, index, {
      kind: "job_failed",
      status: state === "cancelled" ? "warning" : "error",
      title: state === "cancelled" ? "Task cancelled" : "Task failed",
      detail: stringValue(data.terminalReason) || stringValue(data.error),
    });
  }

  return baseTaskEvent(event, index, {
    kind: "trace",
    status: "info",
    title: state ? `State changed: ${state}` : "State changed",
    detail: stringValue(data.reason),
  });
}

function baseTaskEvent(
  event: TravelTaskEvent,
  index: number,
  fields: Pick<TaskTimelineEvent, "kind" | "status" | "title" | "detail">,
): TaskTimelineEvent {
  return {
    id: `task-${event.id || index}`,
    ts: toIsoString(event.created_at),
    level: "job",
    source: "job",
    ...fields,
  };
}

function buildTravelTaskSummary(
  task: TravelTask,
  jobSummary?: TaskTimelineSummary,
): TaskTimelineSummary {
  switch (task.state) {
    case "awaiting_profile":
      return {
        eyebrow: "Needs you",
        title: "Booking profile required",
        detail: task.terminal_reason ?? "The agent needs missing profile fields before it can continue.",
        tone: "warning",
      };
    case "awaiting_login":
      return {
        eyebrow: "Needs you",
        title: "Login required",
        detail: task.terminal_reason ?? "The site requires a user login before the task can continue.",
        tone: "warning",
      };
    case "awaiting_otp":
      return {
        eyebrow: "Needs you",
        title: "OTP required",
        detail: task.terminal_reason ?? "The site requires a one-time passcode before the task can continue.",
        tone: "warning",
      };
    case "ready_for_confirmation":
      return {
        eyebrow: "Ready",
        title: "Ready for confirmation",
        detail: task.terminal_reason ?? "The agent stopped at the final user-confirmation boundary.",
        tone: "warning",
      };
    case "completed":
      return {
        eyebrow: "Complete",
        title: "Task completed",
        detail: task.terminal_reason ?? "The travel task completed successfully.",
        tone: "success",
      };
    case "failed":
      return {
        eyebrow: "Stopped",
        title: "Task failed",
        detail: task.terminal_reason ?? "The task stopped before reaching a ready state.",
        tone: "error",
      };
    case "cancelled":
      return {
        eyebrow: "Stopped",
        title: "Task cancelled",
        detail: task.terminal_reason ?? "The task was cancelled.",
        tone: "warning",
      };
    case "executing":
      return jobSummary ?? {
        eyebrow: "Live now",
        title: task.title,
        detail: "Agent is progressing the booking flow in real time.",
        tone: "live",
      };
    case "draft":
    default:
      return {
        eyebrow: "Draft",
        title: task.title,
        detail: "The travel task has not started execution yet.",
        tone: "info",
      };
  }
}

function dedupeAndSortTimelineEvents(events: TaskTimelineEvent[]): TaskTimelineEvent[] {
  const sorted = [...events].sort((a, b) => {
    return new Date(a.ts).getTime() - new Date(b.ts).getTime();
  });
  const deduped: TaskTimelineEvent[] = [];
  for (const event of sorted) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.kind === event.kind &&
      prev.title === event.title &&
      prev.detail === event.detail &&
      Math.abs(new Date(prev.ts).getTime() - new Date(event.ts).getTime()) < 1000
    ) {
      continue;
    }
    deduped.push(event);
  }
  return deduped;
}

function toPublicTask(task: TravelTask) {
  return {
    id: task.id,
    scenario: task.scenario,
    title: task.title,
    state: task.state,
    currentBookingJobId: task.current_booking_job_id,
    decisionRoomId: task.decision_room_id,
    terminalReason: task.terminal_reason,
    terminalCode: task.terminal_code,
    policy: task.policy_json,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function sentenceCase(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
