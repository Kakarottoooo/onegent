/**
 * POST /api/v1/execution-jobs
 *
 * Create an execution job and kick off the autopilot asynchronously.
 * Returns 202 + { jobId, status: "pending" } immediately; client polls
 * GET /api/v1/execution-jobs/[jobId] to see progress.
 *
 * Auth: Authorization: Bearer ogk_live_<...> (see lib/api-auth/require-api-key).
 * If the api_key's allowed_job_types is non-null, the requested scenario
 * must appear in that list (else 403).
 *
 * Body: ExecutionJobRequest — see lib/api-v1/schemas.ts for the zod shape.
 *
 * Async strategy: fire-and-forget. `void run().then(...)` runs the executor
 * out-of-band. Works great locally; on Vercel serverless the 60s-300s limit
 * will kill long runs mid-flight (Week 4 follow-up: switch to job queue).
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-auth/require-api-key";
import {
  createJob,
  runExecutionJobWithRecovery,
  completeJob,
  type ExecutionJobRequest,
} from "@/lib/core";
import { ExecutionJobRequestSchema } from "@/lib/api-v1/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const auth = await requireApiKey(req);
  if (!auth.ok) return auth.response;
  const { context } = auth;

  // ── Parse body ───────────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_json", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const parsed = ExecutionJobRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message: "Request body does not match ExecutionJobRequest schema.",
          details: parsed.error.issues,
        },
      },
      { status: 400 },
    );
  }

  const body = parsed.data as ExecutionJobRequest;

  // ── Scope check (allowedJobTypes) ────────────────────────────────────────
  if (
    context.allowedJobTypes !== null &&
    !context.allowedJobTypes.includes(body.request.scenario)
  ) {
    return NextResponse.json(
      {
        error: {
          code: "scenario_not_allowed",
          message: `This API key is not authorized for scenario "${body.request.scenario}".`,
          allowedJobTypes: context.allowedJobTypes,
        },
      },
      { status: 403 },
    );
  }

  // ── Create job row ───────────────────────────────────────────────────────
  let job;
  try {
    job = await createJob(body, {
      userId: null, // B 端 caller — no Clerk user
      sessionId: body.clientMetadata?.sessionId,
      tripLabel: undefined, // use default derived from scenario + params
      initialStatus: "running",
    });
  } catch (err) {
    console.error("[api/v1/execution-jobs] createJob failed", err);
    return NextResponse.json(
      {
        error: {
          code: "job_create_failed",
          message: "Unable to create job. Please retry.",
        },
      },
      { status: 500 },
    );
  }

  // ── Fire-and-forget executor ─────────────────────────────────────────────
  // NOT awaited. Client polls GET /api/v1/execution-jobs/[jobId] for status.
  void (async () => {
    try {
      const result = await runExecutionJobWithRecovery(body, {
        jobId: job.id,
        userId: null,
        stepIndex: 0,
      });
      await completeJob(job.id, result);
    } catch (err) {
      console.error(`[api/v1/execution-jobs] executor crashed for job ${job.id}`, err);
      // Mark the job as errored so the client can see something went wrong.
      await completeJob(job.id, {
        jobId: job.id,
        status: "error",
        summary: "Executor crashed",
        error: err instanceof Error ? err.message : String(err),
        decisionLog: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).catch(() => {
        // Nothing else we can do — error is already logged.
      });
    }
  })();

  // ── 202 Accepted ─────────────────────────────────────────────────────────
  return NextResponse.json(
    {
      jobId: job.id,
      status: "running" as const,
      scenario: body.request.scenario,
      organizationName: context.organizationName,
      _links: {
        self: `/api/v1/execution-jobs/${job.id}`,
        audit: `/api/v1/execution-jobs/${job.id}/audit`,
      },
    },
    { status: 202 },
  );
}
