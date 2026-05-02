import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-auth/require-api-key";
import { getTaskEvents, getTravelTask } from "@/lib/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ taskId: string }> },
) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.response;

  const { taskId } = await ctx.params;
  if (!taskId) {
    return NextResponse.json(
      { error: { code: "missing_task_id", message: "taskId path param required." } },
      { status: 400 },
    );
  }

  const task = await getTravelTask(taskId);
  if (!task) {
    return NextResponse.json(
      { error: { code: "task_not_found", message: `No travel task with id "${taskId}".` } },
      { status: 404 },
    );
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
