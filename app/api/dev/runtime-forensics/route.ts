/**
 * Dev-only API for the Runtime Forensics workbench.
 *
 *   GET  /api/dev/runtime-forensics
 *     - Returns aggregated summaries from filesystem artifacts
 *       (`benchmark/runs/*.json`).
 *     - Filters: ?provider=resy / ?status=failed / ?primaryClass=…
 *     - Always succeeds (returns empty list if no artifacts).
 *
 *   GET  /api/dev/runtime-forensics?id=<jobId>
 *     - Returns a single full ForensicsReport keyed by jobId.
 *     - Re-runs the classifier with worker-log excerpt attached if
 *       the worker log file is present.
 *
 * Read-only. No POST. No DB queries (V1). Dev-gated via the same
 * pattern as `app/api/dev/benchmark-runs/route.ts`.
 *
 * Hold rules:
 *   - Never invokes a live provider, OpenAI, payment, or worker.
 *   - Never touches `lib/booking-autopilot/`, `lib/core/`, or
 *     `worker/src/` runtime code.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  aggregateForensics,
  buildForensicsReport,
  buildForensicsSummary,
  formatForensicsBugReport,
  readWorkerLogExcerpt,
  type ForensicsListFilter,
  type FailureClass,
} from "@/lib/runtime-forensics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isDevApiEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_BENCHMARK_API === "1";
}

function notFound() {
  return NextResponse.json(
    { error: { code: "not_found", message: "Not found." } },
    { status: 404 },
  );
}

const FAILURE_CLASS_VALUES: ReadonlyArray<FailureClass> = [
  "legacy_shape_missing_source",
  "provider_no_availability",
  "provider_form_incomplete",
  "otp_or_login_required",
  "checkout_reached_manual_review",
  "model_or_env_blocked",
  "network_or_provider_5xx",
  "unknown",
];

export async function GET(request: NextRequest) {
  if (!isDevApiEnabled()) return notFound();

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  // Single job lookup
  if (id) {
    return getSingleJob(id);
  }

  // List with optional filters
  const filter: ForensicsListFilter = {};
  const provider = url.searchParams.get("provider");
  const status = url.searchParams.get("status");
  const taskId = url.searchParams.get("taskId");
  const sessionId = url.searchParams.get("sessionId");
  const primaryClassRaw = url.searchParams.get("primaryClass");

  if (provider) filter.provider = provider;
  if (status) filter.status = status;
  if (taskId) filter.taskId = taskId;
  if (sessionId) filter.sessionId = sessionId;
  if (primaryClassRaw) {
    if (!FAILURE_CLASS_VALUES.includes(primaryClassRaw as FailureClass)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_filter",
            message: `primaryClass must be one of: ${FAILURE_CLASS_VALUES.join(", ")}`,
          },
        },
        { status: 400 },
      );
    }
    filter.primaryClass = primaryClassRaw as FailureClass;
  }

  let result;
  try {
    result = await aggregateForensics({ filter, limit: 100 });
  } catch (err) {
    // Should not throw — aggregateForensics handles all expected
    // failures gracefully. If we land here, it's an unexpected bug.
    return NextResponse.json(
      {
        error: {
          code: "aggregate_failed",
          message: (err as Error).message ?? "unknown error",
        },
      },
      { status: 500 },
    );
  }

  // Apply post-classification filter (primaryClass) if present.
  let summaries = result.summaries;
  if (filter.primaryClass) {
    summaries = summaries.filter((s) => s.primaryClass === filter.primaryClass);
  }

  return NextResponse.json({
    summaries,
    total: summaries.length,
    workerLogAvailable: result.workerLogAvailable,
    workerLogPathHint: result.workerLogPathHint,
    benchmarkRunsScanned: result.benchmarkRunsScanned,
    loaderNotes: result.loaderNotes,
    sourceCaveat:
      "V1 is artifact-based: this endpoint reads benchmark/runs/*.json + " +
      "worker/.debug-screenshots/*/summary.json + an optional " +
      "codex-worker.log excerpt. DB live lookup is a future enhancement.",
  });
}

async function getSingleJob(id: string) {
  // Re-aggregate (small cost) and find the matching report.
  let result;
  try {
    result = await aggregateForensics({
      filter: { jobId: id },
      limit: 200,
      attachWorkerLog: true,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: "aggregate_failed",
          message: (err as Error).message ?? "unknown error",
        },
      },
      { status: 500 },
    );
  }

  const report = result.reports.find((r) => r.jobId === id) ?? null;
  if (!report) {
    return NextResponse.json(
      { error: { code: "not_found", message: `No artifact found for jobId=${id}` } },
      { status: 404 },
    );
  }

  return NextResponse.json({
    report,
    summary: buildForensicsSummary(report),
    markdown: formatForensicsBugReport(report),
    workerLogAvailable: result.workerLogAvailable,
    workerLogPathHint: result.workerLogPathHint,
  });
}

/* ─── Re-export helpers used by tests / other server-side code. ──── */
export { buildForensicsReport, readWorkerLogExcerpt };
