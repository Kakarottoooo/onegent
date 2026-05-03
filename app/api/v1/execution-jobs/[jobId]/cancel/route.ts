/**
 * POST /api/v1/execution-jobs/[jobId]/cancel
 *
 * Cancel an in-flight or pending job. Idempotent: cancelling an already
 * terminal job is a no-op success. Cancelling a 'running' job force-deletes
 * it (so the worker abandons whatever browser session is in flight on next
 * heartbeat); cancelling 'pending'/'failed'/'done' simply removes the row.
 *
 * Body: none.
 * Response 200: { jobId, cancelled: true, priorStatus }
 *          404: job not found
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  actorCanAccessJobUser,
  notFoundResponse,
  requireApiActor,
} from "@/lib/api-auth/require-api-actor";
import {
  getBookingJob,
  deleteBookingJob,
  deleteMonitorsByJobId,
  clearDecisionRoomBookingJobByJobId,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const auth = await requireApiActor(_req);
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const { jobId } = await ctx.params;
  if (!jobId) {
    return NextResponse.json(
      { error: { code: "missing_job_id", message: "jobId path param required." } },
      { status: 400 },
    );
  }

  const job = await getBookingJob(jobId);
  if (!job || !actorCanAccessJobUser(actor, job.user_id)) {
    return notFoundResponse("job_not_found", `No job with id "${jobId}".`);
  }

  // Cascade-clean monitors + decision-room links so stale UI cards don't
  // linger after the cancel. Mirrors DELETE /api/booking-jobs/[id].
  await deleteMonitorsByJobId(jobId);
  await clearDecisionRoomBookingJobByJobId(jobId);
  await deleteBookingJob(jobId);

  return NextResponse.json(
    { jobId, cancelled: true, priorStatus: job.status },
    { status: 200 },
  );
}
