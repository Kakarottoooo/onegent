import { type NextRequest } from "next/server";
import {
  actorCanAccessTask,
  notFoundResponse,
  requireApiActor,
} from "@/lib/api-auth/require-api-actor";
import { getBrowserSnapshot } from "@/lib/browser-snapshot-store";
import { getTravelTask } from "@/lib/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ taskId: string; snapshotId: string }> },
) {
  const auth = await requireApiActor(req);
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const { taskId, snapshotId } = await ctx.params;
  const task = await getTravelTask(taskId);
  if (!task || !actorCanAccessTask(actor, task) || !task.current_booking_job_id) {
    return notFoundResponse("snapshot_not_found", "Snapshot not found.");
  }

  const snapshot = await getBrowserSnapshot(task.current_booking_job_id, snapshotId);
  if (!snapshot) {
    return notFoundResponse("snapshot_not_found", "Snapshot not found.");
  }

  return new Response(Buffer.from(snapshot.imageBase64, "base64"), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
