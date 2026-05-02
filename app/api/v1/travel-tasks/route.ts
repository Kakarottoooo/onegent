/**
 * POST /api/v1/travel-tasks
 *
 * Phase 1 runtime facade. A TravelTask is the stable task aggregate; the
 * current execution attempt is still a legacy booking_jobs row.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-auth/require-api-key";
import {
  appendTaskEvent,
  completeJob,
  createJob,
  createTravelTask,
  listTravelTasks,
  runExecutionJobWithRecovery,
  updateTravelTaskState,
  type ExecutionJobRequest,
  type ExecutionJobResult,
  type ExecutionJobStatus,
  type TravelTask,
  type TravelTaskState,
} from "@/lib/core";
import {
  ExecutionJobRequestSchema,
  TravelTaskCreateEnvelopeSchema,
} from "@/lib/api-v1/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.response;

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 25;
  const tasks = await listTravelTasks(Number.isFinite(limit) ? limit : 25);
  return NextResponse.json({ tasks: tasks.map(toPublicTask) }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.response;
  const { context } = auth;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const parsed = parseCreateBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json(parsed.body, { status: 400 });
  }

  const { execution, task: taskOptions } = parsed.value;
  if (
    context.allowedJobTypes !== null &&
    !context.allowedJobTypes.includes(execution.request.scenario)
  ) {
    return NextResponse.json(
      {
        error: {
          code: "scenario_not_allowed",
          message: `This API key is not authorized for scenario "${execution.request.scenario}".`,
          allowedJobTypes: context.allowedJobTypes,
        },
      },
      { status: 403 },
    );
  }

  let job;
  try {
    job = await createJob(execution, {
      userId: null,
      sessionId: execution.clientMetadata?.sessionId,
      tripLabel: taskOptions?.title,
    });
  } catch (err) {
    console.error("[api/v1/travel-tasks] createJob failed", err);
    return NextResponse.json(
      { error: { code: "job_create_failed", message: "Unable to create execution attempt." } },
      { status: 500 },
    );
  }

  let task: TravelTask;
  try {
    task = await createTravelTask({
      userId: null,
      scenario: execution.request.scenario,
      title: taskOptions?.title ?? deriveTaskTitle(execution),
      state: "executing",
      request: execution,
      policy: taskOptions?.policy,
      currentBookingJobId: job.id,
      decisionRoomId: taskOptions?.decisionRoomId,
      createdByKeyId: context.keyId,
      createdByOrgName: context.organizationName,
    });
    await appendTaskEvent(task.id, "execution_started", { jobId: job.id });
  } catch (err) {
    console.error("[api/v1/travel-tasks] createTravelTask failed", err);
    return NextResponse.json(
      { error: { code: "task_create_failed", message: "Unable to create travel task." } },
      { status: 500 },
    );
  }

  void runAttemptForTask(task.id, job.id, execution);

  return NextResponse.json(
    {
      task: toPublicTask(task),
      currentJobId: job.id,
      status: task.state,
      organizationName: context.organizationName,
      _links: {
        self: `/api/v1/travel-tasks/${task.id}`,
        events: `/api/v1/travel-tasks/${task.id}/events`,
        currentJob: `/api/v1/execution-jobs/${job.id}`,
        currentJobAudit: `/api/v1/execution-jobs/${job.id}/audit`,
      },
    },
    { status: 202 },
  );
}

function parseCreateBody(rawBody: unknown):
  | {
      ok: true;
      value: {
        execution: ExecutionJobRequest;
        task?: { title?: string; policy?: Record<string, unknown>; decisionRoomId?: string };
      };
    }
  | { ok: false; body: unknown } {
  const envelope = TravelTaskCreateEnvelopeSchema.safeParse(rawBody);
  if (envelope.success) {
    return {
      ok: true,
      value: envelope.data as {
        execution: ExecutionJobRequest;
        task?: { title?: string; policy?: Record<string, unknown>; decisionRoomId?: string };
      },
    };
  }

  const legacy = ExecutionJobRequestSchema.safeParse(rawBody);
  if (legacy.success) {
    return { ok: true, value: { execution: legacy.data as ExecutionJobRequest } };
  }

  return {
    ok: false,
    body: {
      error: {
        code: "invalid_request",
        message: "Request body must be either { execution, task? } or an ExecutionJobRequest.",
        details: envelope.error.issues,
      },
    },
  };
}

async function runAttemptForTask(
  taskId: string,
  jobId: string,
  execution: ExecutionJobRequest,
): Promise<void> {
  try {
    const result = await runExecutionJobWithRecovery(execution, {
      jobId,
      userId: null,
      stepIndex: 0,
    });
    await completeJob(jobId, result);
    await appendTaskEvent(taskId, "execution_finished", {
      jobId,
      status: result.status,
      summary: result.summary,
      error: result.error,
    });
    await updateTravelTaskState(taskId, mapExecutionStatusToTaskState(result.status), {
      jobId,
      executionStatus: result.status,
      ...terminalDataForResult(result),
    });
  } catch (err) {
    console.error(`[api/v1/travel-tasks] executor crashed for task ${taskId}`, err);
    const message = err instanceof Error ? err.message : String(err);
    const result: ExecutionJobResult = {
      jobId,
      status: "error",
      summary: "Executor crashed",
      error: message,
      decisionLog: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await completeJob(jobId, result).catch(() => {});
    await appendTaskEvent(taskId, "execution_finished", {
      jobId,
      status: "error",
      error: message,
    }).catch(() => {});
    await updateTravelTaskState(taskId, "failed", {
      jobId,
      executionStatus: "error",
      terminalCode: "executor_crashed",
      terminalReason: message,
      error: message,
    }).catch(() => {});
  }
}

function terminalDataForResult(result: ExecutionJobResult): Record<string, unknown> {
  switch (result.status) {
    case "completed":
      return { terminalCode: "completed", terminalReason: result.summary };
    case "paused_payment":
    case "ready_for_confirmation":
      return { terminalCode: result.status, terminalReason: result.summary };
    case "needs_profile_data":
      return { terminalCode: "needs_profile_data", terminalReason: result.profileGap?.message ?? result.summary };
    case "needs_login":
    case "needs_otp":
      return { terminalCode: result.status, terminalReason: result.summary };
    case "captcha":
    case "error":
    case "no_availability":
      return { terminalCode: result.status, terminalReason: result.error ?? result.summary };
    case "pending":
    case "running":
      return {};
  }
}

function mapExecutionStatusToTaskState(status: ExecutionJobStatus): TravelTaskState {
  switch (status) {
    case "needs_profile_data":
      return "awaiting_profile";
    case "needs_login":
      return "awaiting_login";
    case "needs_otp":
      return "awaiting_otp";
    case "paused_payment":
    case "ready_for_confirmation":
      return "ready_for_confirmation";
    case "completed":
      return "completed";
    case "pending":
    case "running":
      return "executing";
    case "captcha":
    case "error":
    case "no_availability":
      return "failed";
  }
}

function deriveTaskTitle(execution: ExecutionJobRequest): string {
  const request = execution.request;
  switch (request.scenario) {
    case "restaurant":
      return `${request.params.restaurant_name} in ${request.params.city}`;
    case "hotel":
      return `${request.params.hotel_name} in ${request.params.city}`;
    case "flight":
      return `${request.params.origin} to ${request.params.dest}`;
    case "activity":
      return `${request.params.event_name} in ${request.params.city}`;
  }
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
