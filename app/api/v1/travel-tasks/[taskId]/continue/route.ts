/**
 * POST /api/v1/travel-tasks/[taskId]/continue
 *
 * Resume a paused TravelTask with patched execution input. This is the
 * backend hook ProfileGapCard needs after the user supplies missing fields.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  actorCanAccessTask,
  actorCanUseScenario,
  notFoundResponse,
  requireApiActor,
} from "@/lib/api-auth/require-api-actor";
import {
  appendTaskEvent,
  createJob,
  getTravelTask,
  updateTravelTaskRequest,
  type ExecutionJobRequest,
} from "@/lib/core";
import { ExecutionJobRequestSchema } from "@/lib/api-v1/schemas";
import { runTravelTaskAttempt } from "@/lib/api-v1/run-travel-task-attempt";
import { parseProfilePatch, upsertDefaultBookingProfile } from "@/lib/profile-patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const profilePatch = getProfilePatch(rawBody);
  let profileUpdatedFields: string[] = [];
  let continueBody = rawBody;

  if (actor.type === "user" && profilePatch !== undefined && !hasExecutionRequest(rawBody)) {
    const parsedProfile = parseProfilePatch(profilePatch);
    if (!parsedProfile.ok) {
      return NextResponse.json({ error: parsedProfile.error }, { status: 400 });
    }
    await upsertDefaultBookingProfile(actor.userId, parsedProfile.value);
    profileUpdatedFields = parsedProfile.updatedFields;
    continueBody = { profile: parsedProfile.value };
  }

  const nextExecution = parseContinueBody(continueBody, task.request_json);
  if (!nextExecution.ok) {
    return NextResponse.json(nextExecution.body, { status: 400 });
  }

  if (!actorCanUseScenario(actor, nextExecution.value.request.scenario)) {
    return NextResponse.json(
      {
        error: {
          code: "scenario_not_allowed",
          message: `This API key is not authorized for scenario "${nextExecution.value.request.scenario}".`,
        },
      },
      { status: 403 },
    );
  }

  let job;
  try {
    job = await createJob(nextExecution.value, {
      userId: task.user_id,
      sessionId: nextExecution.value.clientMetadata?.sessionId ?? task.id,
      tripLabel: task.title,
      initialStatus: "running",
    });
  } catch (err) {
    console.error("[api/v1/travel-tasks/continue] createJob failed", err);
    return NextResponse.json(
      { error: { code: "job_create_failed", message: "Unable to create execution attempt." } },
      { status: 500 },
    );
  }

  const updatedTask = await updateTravelTaskRequest({
    taskId: task.id,
    request: nextExecution.value,
    state: "executing",
    currentBookingJobId: job.id,
    eventData: {
      reason: "continue",
      supersededJobId: task.current_booking_job_id,
      ...(profileUpdatedFields.length > 0 ? { profileUpdatedFields } : {}),
    },
  });
  if (!updatedTask) {
    return NextResponse.json(
      { error: { code: "task_not_found", message: `No travel task with id "${taskId}".` } },
      { status: 404 },
    );
  }

  await appendTaskEvent(updatedTask.id, "booking_job_created", {
    jobId: job.id,
    supersededJobId: task.current_booking_job_id,
  });
  await appendTaskEvent(updatedTask.id, "execution_started", {
    jobId: job.id,
    resumedFromState: task.state,
  });

  void runTravelTaskAttempt({
    taskId: updatedTask.id,
    jobId: job.id,
    execution: nextExecution.value,
  });

  return NextResponse.json(
    {
      task: {
        id: updatedTask.id,
        scenario: updatedTask.scenario,
        title: updatedTask.title,
        state: updatedTask.state,
        currentBookingJobId: updatedTask.current_booking_job_id,
        decisionRoomId: updatedTask.decision_room_id,
        terminalReason: updatedTask.terminal_reason,
        terminalCode: updatedTask.terminal_code,
        policy: updatedTask.policy_json,
        createdAt: updatedTask.created_at,
        updatedAt: updatedTask.updated_at,
      },
      currentJobId: job.id,
      status: updatedTask.state,
      _links: {
        self: `/api/v1/travel-tasks/${updatedTask.id}`,
        events: `/api/v1/travel-tasks/${updatedTask.id}/events`,
        timelineEvents: `/api/v1/travel-tasks/${updatedTask.id}/timeline-events`,
        snapshots: `/api/v1/travel-tasks/${updatedTask.id}/snapshots`,
        currentJob: `/api/v1/execution-jobs/${job.id}`,
      },
    },
    { status: 202 },
  );
}

function getProfilePatch(rawBody: unknown): Record<string, unknown> | undefined {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) return undefined;
  const value = (rawBody as { profile?: unknown }).profile;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function hasExecutionRequest(rawBody: unknown): boolean {
  return Boolean(rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) && "request" in rawBody);
}

function parseContinueBody(
  rawBody: unknown,
  currentRequest: ExecutionJobRequest,
):
  | { ok: true; value: ExecutionJobRequest }
  | { ok: false; body: unknown } {
  const full = ExecutionJobRequestSchema.safeParse(rawBody);
  if (full.success) return { ok: true, value: full.data as ExecutionJobRequest };

  if (rawBody && typeof rawBody === "object" && "profile" in rawBody) {
    const candidate = {
      ...currentRequest,
      profile: {
        ...(currentRequest.profile ?? {}),
        ...(rawBody as { profile?: Record<string, unknown> }).profile,
      },
    };
    const patched = ExecutionJobRequestSchema.safeParse(candidate);
    if (patched.success) return { ok: true, value: patched.data as ExecutionJobRequest };
  }

  return {
    ok: false,
    body: {
      error: {
        code: "invalid_request",
        message: "Request body must be an ExecutionJobRequest or { profile: {...} }.",
        details: full.error.issues,
      },
    },
  };
}
