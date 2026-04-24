/**
 * GET /api/v1/execution-jobs/[jobId]/audit
 *
 * Returns the structured audit trail for a job — one entry per decision
 * (job_started, step_attempt, action_allowed/denied, time_adjusted,
 * provider_fallback, paused_payment, job_completed/failed, etc.).
 *
 * Auth: Authorization: Bearer ogk_live_<...>
 *
 * Query params:
 *   ?limit=N  (optional) — cap result count. Default 500, matching queryAudit.
 *
 * 404 if jobId has no audit rows AND no booking_jobs row. For an existing
 * job with no audit events (old jobs from before audit was wired up, or
 * very fresh runs), returns 200 + empty events array.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-auth/require-api-key";
import { getJob, queryAudit } from "@/lib/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.response;

  const { jobId } = await ctx.params;
  if (!jobId) {
    return NextResponse.json(
      { error: { code: "missing_job_id", message: "jobId path param required." } },
      { status: 400 },
    );
  }

  // 404 only when the job itself is unknown. Empty audit on a real job
  // is a legitimate 200 (e.g. job was created before audit logging existed).
  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json(
      { error: { code: "job_not_found", message: `No job with id "${jobId}".` } },
      { status: 404 },
    );
  }

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(2000, Number(limitParam))) : undefined;

  const events = await queryAudit(jobId, limit !== undefined ? { limit } : {});

  return NextResponse.json(
    {
      jobId,
      count: events.length,
      events,
    },
    { status: 200 },
  );
}
