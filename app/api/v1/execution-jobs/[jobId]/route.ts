/**
 * GET /api/v1/execution-jobs/[jobId]
 *
 * Poll for the status of a job created via POST /api/v1/execution-jobs.
 * Returns ExecutionJobResult shape regardless of whether the job is
 * still running, paused at payment, or fully terminal.
 *
 * Auth: Authorization: Bearer ogk_live_<...>
 * 404 if jobId unknown. 200 otherwise.
 *
 * Multi-tenant note: this week does NOT restrict reads by org — any
 * valid API key can read any jobId. Week 4 adds organization_id to
 * booking_jobs for true isolation.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-auth/require-api-key";
import { getJob, type ExecutionJobResult, type ExecutionJobStatus } from "@/lib/core";
import type { BookingJob, BookingJobStep } from "@/lib/db";

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

  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json(
      { error: { code: "job_not_found", message: `No job with id "${jobId}".` } },
      { status: 404 },
    );
  }

  return NextResponse.json(toExecutionJobResult(job), { status: 200 });
}

// ─── Mapping: BookingJob + BookingJobStep → ExecutionJobResult ───────────────

/**
 * Collapse the DB shape (BookingJob with N steps, legacy autopilot fields)
 * into the declarative ExecutionJobResult B 端 contract.
 *
 * lib/core callers create jobs with exactly ONE step, so we focus on
 * steps[0]. The mapping mirrors lib/core/execution/job-manager.ts's
 * completeJob() in reverse.
 */
function toExecutionJobResult(job: BookingJob): ExecutionJobResult {
  const step: BookingJobStep | undefined = job.steps[0];
  const status = mapToExecutionJobStatus(job, step);

  return {
    jobId: job.id,
    status,
    handoffUrl: step?.handoff_url,
    sessionUrl: step?.session_url,
    summary: deriveSummary(job, step, status),
    screenshotBase64: undefined, // not persisted in booking_jobs
    decisionLog: step?.decisionLog ?? [],
    attemptCount: step?.attemptCount,
    usedFallback: step?.usedFallback,
    error: step?.error,
    profileGap: getProfileGap(step),
    availableSlots: undefined, // tracked in decisionLog entries, not a dedicated field
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at ?? undefined,
  };
}

function mapToExecutionJobStatus(
  job: BookingJob,
  step: BookingJobStep | undefined,
): ExecutionJobStatus {
  if (!step) return job.status === "failed" ? "error" : "pending";

  // Job-level gives us running/terminal; step-level gives the specifics.
  if (job.status === "running") return "running";
  if (job.status === "pending") return "pending";

  // job.status is "done" or "failed" — derive from step.status
  switch (step.status) {
    case "awaiting_confirmation":
      if (getProfileGap(step)) return "needs_profile_data";
      return "paused_payment";
    case "done":
      return "completed";
    case "no_availability":
      return "no_availability";
    case "error": {
      // Try to differentiate common error classes from the error message.
      const msg = (step.error ?? "").toLowerCase();
      if (msg.includes("captcha")) return "captcha";
      if (msg.includes("login") || msg.includes("sign in")) return "needs_login";
      return "error";
    }
    case "pending":
    case "loading":
      return "running"; // terminal job with non-terminal step = weird; show running
    default:
      return "error";
  }
}

function deriveSummary(
  job: BookingJob,
  step: BookingJobStep | undefined,
  status: ExecutionJobStatus,
): string {
  if (!step) return job.trip_label || `Job ${job.id}`;
  switch (status) {
    case "pending":
      return `Queued: ${step.label}`;
    case "running":
      return `Executing: ${step.label}`;
    case "paused_payment":
      return `Paused at payment gate for ${step.label}. Open handoffUrl to complete.`;
    case "needs_otp":
      return `Waiting for one-time verification code for ${step.label}.`;
    case "needs_profile_data":
      return getProfileGap(step)?.message ?? `Missing booking profile data for ${step.label}.`;
    case "ready_for_confirmation":
      return `Ready for user confirmation for ${step.label}.`;
    case "completed":
      return `Completed: ${step.label}`;
    case "no_availability":
      return `No availability for ${step.label}`;
    case "captcha":
      return `CAPTCHA blocked ${step.label}`;
    case "needs_login":
      return `Site requires login for ${step.label}`;
    case "error":
      return step.error ? `Error: ${step.error}` : `Error on ${step.label}`;
  }
}

function getProfileGap(step: BookingJobStep | undefined): ExecutionJobResult["profileGap"] {
  const value = step?.body?.profileGap;
  if (!value || typeof value !== "object") return undefined;
  const profileGap = value as ExecutionJobResult["profileGap"];
  return profileGap?.kind === "needs_profile_data" ? profileGap : undefined;
}
