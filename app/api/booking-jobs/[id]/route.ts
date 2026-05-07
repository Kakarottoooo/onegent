import { NextRequest, NextResponse } from "next/server";
import {
  deleteBookingJob,
  deleteMonitorsByJobId,
  clearDecisionRoomBookingJobByJobId,
} from "@/lib/db";
import { deleteBrowserSnapshots } from "@/lib/browser-snapshot-store";
import { resolveBookingJobAccess } from "@/lib/booking-jobs/access";

type Params = { params: Promise<{ id: string }> };

/** GET /api/booking-jobs/[id] — poll job status */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await resolveBookingJobAccess(req, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  return NextResponse.json({ job: access.job });
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
  const access = await resolveBookingJobAccess(req, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const job = access.job;
  const force = req.nextUrl.searchParams.get("force") === "true";
  if (job.status === "running" && !force) {
    return NextResponse.json({ error: "Cannot delete a running job" }, { status: 409 });
  }
  await deleteMonitorsByJobId(id);
  await clearDecisionRoomBookingJobByJobId(id);
  await deleteBrowserSnapshots(id);
  await deleteBookingJob(id);
  return NextResponse.json({ deleted: true, forced: force, stale: false });
}
