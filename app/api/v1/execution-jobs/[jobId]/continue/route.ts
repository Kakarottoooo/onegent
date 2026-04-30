/**
 * POST /api/v1/execution-jobs/[jobId]/continue
 *
 * Resume a paused / failed / cancelled-mid-run job. Equivalent to the user
 * clicking "Run again" in the /tasks UI: triggers the existing
 * /api/booking-jobs/[id]/start endpoint via fire-and-forget fetch (so this
 * response stays under the v1 timeout even when the actual run takes 5+
 * minutes).
 *
 * Common use cases for callers (Claude / ChatGPT via MCP):
 *   - paused_payment → user entered card → continue_task to finalise
 *   - failed (transient network / DOM drift) → retry
 *   - just modified the task → continue_task to re-execute with new constraints
 *
 * Body: none.
 * Response 202: { jobId, triggered: true, priorStatus }
 *           404: job not found
 *           409: job is currently 'running' (would be a duplicate trigger)
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-auth/require-api-key";
import { getBookingJob } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const auth = await requireApiKey(_req);
  if (!auth.ok) return auth.response;

  const { jobId } = await ctx.params;
  if (!jobId) {
    return NextResponse.json(
      { error: { code: "missing_job_id", message: "jobId path param required." } },
      { status: 400 },
    );
  }

  const job = await getBookingJob(jobId);
  if (!job) {
    return NextResponse.json(
      { error: { code: "job_not_found", message: `No job with id "${jobId}".` } },
      { status: 404 },
    );
  }

  if (job.status === "running") {
    return NextResponse.json(
      {
        error: {
          code: "already_running",
          message: "Job is currently running. Wait for the current run to finish before continuing.",
          status: job.status,
        },
      },
      { status: 409 },
    );
  }

  // Fire-and-forget /start. The endpoint may take 5 min in legacy in-process
  // mode or return 202 immediately in worker mode — either way we don't
  // await it here. Caller polls GET /api/v1/execution-jobs/[jobId] for status.
  void fetch(`${DEFAULT_BASE_URL}/api/booking-jobs/${jobId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[v1/continue] /start fetch failed for ${jobId}: ${msg}`);
  });

  return NextResponse.json(
    { jobId, triggered: true, priorStatus: job.status },
    { status: 202 },
  );
}
