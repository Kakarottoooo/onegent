import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-auth/require-api-key";
import { getTravelTask } from "@/lib/core";
import { listBrowserSnapshots } from "@/lib/browser-snapshot-store";

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

  if (!task.current_booking_job_id) {
    return NextResponse.json({
      taskId: task.id,
      jobId: null,
      count: 0,
      snapshots: [],
    });
  }

  const snapshots = await listBrowserSnapshots(task.current_booking_job_id);
  return NextResponse.json({
    taskId: task.id,
    jobId: task.current_booking_job_id,
    count: snapshots.length,
    snapshots,
  });
}
