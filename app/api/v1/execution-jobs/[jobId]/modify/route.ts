/**
 * POST /api/v1/execution-jobs/[jobId]/modify
 *
 * B-end / MCP entry to mutate an in-flight (or failed / pending) job's
 * constraints + policy. Wraps the same applyJobModification helper used
 * by the Clerk-authenticated /api/booking-jobs/[id]/modify endpoint, but
 * gated by an API key instead of a session cookie.
 *
 * Body (all top-level keys optional):
 *   {
 *     patch: {
 *       constraints?: { time?, date?, party_size?, restaurant_name?, city?, ... },
 *       policy?:      { time_window_minutes?, allow_venue_switch?, ... },
 *       message?:     string  // optional human note for the audit log
 *     }
 *   }
 *
 * Response 200: { jobId, planVersion, status, summary }
 *           400: validation error (typed via ModifyValidationError)
 *           404: job not found
 *           409: job not in a modifiable state (running / done)
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-auth/require-api-key";
import { getBookingJob, applyBookingJobModification } from "@/lib/db";
import {
  applyJobModification,
  ModifyForbiddenStateError,
  ModifyValidationError,
} from "@/lib/booking-jobs/modify";
import type { JobModificationPatch } from "@/lib/booking-jobs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
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

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const body = (rawBody ?? {}) as { patch?: JobModificationPatch };
  const patch = body.patch ?? {};

  const job = await getBookingJob(jobId);
  if (!job) {
    return NextResponse.json(
      { error: { code: "job_not_found", message: `No job with id "${jobId}".` } },
      { status: 404 },
    );
  }

  let result;
  try {
    result = applyJobModification(job, patch);
  } catch (err) {
    if (err instanceof ModifyValidationError) {
      return NextResponse.json(
        { error: { code: "invalid_patch", message: err.reason } },
        { status: 400 },
      );
    }
    if (err instanceof ModifyForbiddenStateError) {
      return NextResponse.json(
        {
          error: {
            code: "forbidden_state",
            message: err.reason,
            state: err.state,
          },
        },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: { code: "modify_failed", message } },
      { status: 500 },
    );
  }

  const updated = await applyBookingJobModification({
    id: jobId,
    constraints: result.constraints,
    policy: result.policy,
    steps: result.steps,
  });
  if (!updated) {
    return NextResponse.json(
      { error: { code: "job_disappeared", message: "Job vanished during modify." } },
      { status: 410 },
    );
  }

  return NextResponse.json(
    {
      jobId,
      planVersion: result.plan_version,
      status: updated.status,
      summary: result.summary,
    },
    { status: 200 },
  );
}
