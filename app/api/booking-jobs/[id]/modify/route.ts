/**
 * POST /api/booking-jobs/[id]/modify
 *
 * Mutate a booking job's constraints / policy WITHOUT recreating it.
 * Increments plan_version, mirrors constraint changes into step.body so the
 * existing executor picks up new values, and resets every step to 'pending'.
 *
 * Auth: caller must be signed in AND own the job (or the job is anonymous —
 * benchmark dispatches use user_id=null, so allow those for any signed-in
 * user since they're internal artifacts only).
 *
 * Body:
 *   {
 *     constraints?: { time?, date?, party_size?, restaurant_name?, city?, ... },
 *     policy?:      { time_window_minutes?, allow_venue_switch?, ... },
 *     message?:     string  // optional human note for the audit log
 *   }
 *
 * Response:
 *   { jobId, plan_version, status, summary }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getBookingJob,
  applyBookingJobModification,
} from "@/lib/db";
import {
  applyJobModification,
  ModifyForbiddenStateError,
  ModifyValidationError,
} from "@/lib/booking-jobs/modify";
import type { JobModificationPatch } from "@/lib/booking-jobs/types";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "job id required" }, { status: 400 });
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  }

  const job = await getBookingJob(id);
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  // Ownership: own job OR anonymous (benchmark / pre-auth legacy).
  if (job.user_id != null && job.user_id !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let patch: JobModificationPatch;
  try {
    patch = (await req.json()) as JobModificationPatch;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let result: ReturnType<typeof applyJobModification>;
  try {
    result = applyJobModification(job, patch);
  } catch (err) {
    if (err instanceof ModifyValidationError) {
      return NextResponse.json({ error: err.reason }, { status: 400 });
    }
    if (err instanceof ModifyForbiddenStateError) {
      return NextResponse.json(
        { error: err.reason, state: err.state },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const updated = await applyBookingJobModification({
    id,
    constraints: result.constraints,
    policy: result.policy,
    steps: result.steps,
  });
  if (!updated) {
    return NextResponse.json(
      { error: "job disappeared during modify" },
      { status: 410 },
    );
  }

  return NextResponse.json({
    jobId: id,
    plan_version: result.plan_version,
    status: updated.status,
    summary: result.summary,
    constraints: result.constraints,
    policy: result.policy,
  });
}
