import { NextRequest, NextResponse } from "next/server";
import {
  getBookingJob,
  deleteBookingJob,
  deleteMonitorsByJobId,
  clearDecisionRoomBookingJobByJobId,
} from "@/lib/db";

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

/** DELETE /api/booking-jobs/[id] — remove a job (not while running) */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const job = await getBookingJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const force = req.nextUrl.searchParams.get("force") === "true";
  if (job.status === "running" && !force) {
    return NextResponse.json({ error: "Cannot delete a running job" }, { status: 409 });
  }
  await deleteMonitorsByJobId(id);
  await clearDecisionRoomBookingJobByJobId(id);
  await deleteBookingJob(id);
  return NextResponse.json({ deleted: true, forced: force });
}
