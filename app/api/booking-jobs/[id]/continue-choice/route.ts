import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  applyBookingJobModification,
  getBookingJob,
} from "@/lib/db";
import { buildActivityEventChoicePatch } from "@/lib/booking-jobs/activity-choice";
import {
  applyJobModification,
  ModifyForbiddenStateError,
  ModifyValidationError,
} from "@/lib/booking-jobs/modify";
import { stepNeedsProviderEventChoice } from "@/lib/booking-jobs/provider-choice";

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

  if (job.user_id != null && job.user_id !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { message?: unknown };
  try {
    body = (await req.json()) as { message?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const choiceStep = job.steps.find((step) => step.type === "activity" && stepNeedsProviderEventChoice(step));
  if (!choiceStep) {
    return NextResponse.json(
      { error: "job is not waiting for provider event choice" },
      { status: 409 },
    );
  }

  const patchResult = buildActivityEventChoicePatch(message, choiceStep);
  if (!patchResult.ok || !patchResult.patch) {
    return NextResponse.json(
      {
        error: "missing_required_fields",
        missing_fields: patchResult.parsed.missing_fields,
        question: patchResult.question,
      },
      { status: 422 },
    );
  }

  let result: ReturnType<typeof applyJobModification>;
  try {
    result = applyJobModification(job, patchResult.patch);
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
    const error = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error }, { status: 500 });
  }

  const updated = await applyBookingJobModification({
    id,
    constraints: result.constraints,
    policy: result.policy,
    steps: result.steps,
  });
  if (!updated) {
    return NextResponse.json(
      { error: "job disappeared during choice continuation" },
      { status: 410 },
    );
  }

  return NextResponse.json({
    jobId: id,
    plan_version: result.plan_version,
    status: updated.status,
    summary: result.summary,
    parsed: patchResult.parsed,
  });
}
