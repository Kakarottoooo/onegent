import { NextRequest, NextResponse } from "next/server";
import {
  getBookingJob,
  deleteBookingJob,
  deleteMonitorsByJobId,
  clearDecisionRoomBookingJobByJobId,
} from "@/lib/db";
import { deleteBrowserSnapshots } from "@/lib/browser-snapshot-store";

type Params = { params: Promise<{ id: string }> };

/** GET /api/booking-jobs/[id] — poll job status */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const job = await getBookingJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json({ job });
}

/**
 * DELETE /api/booking-jobs/[id] — idempotent cascade delete.
 *
 * If the job exists and is running, refuse unless `?force=true`. Otherwise
 * (job exists OR job already gone but orphan monitors / room links remain),
 * always cascade-clean monitors + decision_room references by id so stale
 * UI cards can be cleared with a single Delete click.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const job = await getBookingJob(id);
  const force = req.nextUrl.searchParams.get("force") === "true";
  if (job && job.status === "running" && !force) {
    return NextResponse.json({ error: "Cannot delete a running job" }, { status: 409 });
  }
  await deleteMonitorsByJobId(id);
  await clearDecisionRoomBookingJobByJobId(id);
  await deleteBrowserSnapshots(id);
  if (job) await deleteBookingJob(id);
  return NextResponse.json({ deleted: true, forced: force, stale: !job });
}
