import { NextResponse, type NextRequest } from "next/server";
import {
  actorCanAccessTask,
  notFoundResponse,
  requireApiActor,
} from "@/lib/api-auth/require-api-actor";
import { getTaskEvents, getTravelTask } from "@/lib/core";

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

  const events = await getTaskEvents(task.id);
  return NextResponse.json(
    {
      taskId: task.id,
      events: events.map((event) => ({
        id: event.id,
        kind: event.kind,
        data: event.data_json,
        createdAt: event.created_at,
      })),
    },
    { status: 200 },
  );
}
