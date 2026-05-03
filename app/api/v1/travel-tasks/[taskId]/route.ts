import { NextResponse, type NextRequest } from "next/server";
import {
  actorCanAccessTask,
  notFoundResponse,
  requireApiActor,
} from "@/lib/api-auth/require-api-actor";
import { getJob, getTaskEvents, getTravelTask, type TravelTask } from "@/lib/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const [events, currentJob] = await Promise.all([
    getTaskEvents(task.id),
    task.current_booking_job_id ? getJob(task.current_booking_job_id) : Promise.resolve(null),
  ]);

  return NextResponse.json(
    {
      task: toPublicTask(task),
      currentJob: currentJob
        ? {
            id: currentJob.id,
            status: currentJob.status,
            tripLabel: currentJob.trip_label,
            createdAt: currentJob.created_at,
            updatedAt: currentJob.updated_at,
            completedAt: currentJob.completed_at,
          }
        : null,
      events: events.map((event) => ({
        id: event.id,
        kind: event.kind,
        data: event.data_json,
        createdAt: event.created_at,
      })),
      _links: {
        events: `/api/v1/travel-tasks/${task.id}/events`,
        timelineEvents: `/api/v1/travel-tasks/${task.id}/timeline-events`,
        snapshots: `/api/v1/travel-tasks/${task.id}/snapshots`,
        currentJob: task.current_booking_job_id
          ? `/api/v1/execution-jobs/${task.current_booking_job_id}`
          : null,
      },
    },
    { status: 200 },
  );
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
