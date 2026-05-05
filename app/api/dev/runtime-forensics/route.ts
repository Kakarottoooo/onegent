/**
 * Dev-only API for the Runtime Forensics workbench.
 *
 *   GET /api/dev/runtime-forensics
 *     - Returns aggregated summaries from filesystem artifacts.
 *     - Multi-select filters parsed via lib/runtime-forensics/url-filter:
 *         providers=resy,opentable
 *         classes=otp_or_login_required,unknown
 *         severities=p0,p1
 *         hideUnknown=1
 *         showFixtures=1   (alias: examples=1)
 *         sort=severity:desc | updatedAt:asc | provider:asc | scenario:asc
 *     - Single-value filters: provider= / status= / taskId= / sessionId= /
 *       primaryClass= remain accepted for parity with v1.
 *     - Always succeeds (returns empty list if no artifacts).
 *
 *   GET /api/dev/runtime-forensics?id=<jobId>
 *     - Returns a single ForensicsReport keyed by jobId, including
 *       fixture rows when present in the loader pool.
 *     - Re-runs the classifier and attaches a worker-log excerpt when
 *       the file is present.
 *
 * Read-only. No POST. No DB queries (V1). Dev-gated via the same
 * pattern as `app/api/dev/benchmark-runs/route.ts`.
 *
 * Hold rules:
 *   - Never invokes a live provider, OpenAI, payment, or worker.
 *   - Never touches `lib/booking-autopilot/`, `lib/core/`,
 *     `lib/execution-v2/`, or `worker/src/` runtime code.
 *   - Never returns sensitive PII; fixtures use placeholder data.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  aggregateForensics,
  applyEnhancedFilter,
  buildForensicsSummary,
  formatForensicsBugReport,
  parseFiltersFromQuery,
  recommendNextEvidence,
  serializeFiltersToString,
  sortSummaries,
  type FailureClass,
  type ForensicsListFilter,
  type FilterState,
} from "@/lib/runtime-forensics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isDevApiEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEV_BENCHMARK_API === "1"
  );
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

const SOURCE_CAVEAT =
  "V1 is artifact-based: this endpoint reads benchmark/runs/*.json + " +
  "worker/.debug-screenshots/*/summary.json + an optional " +
  "codex-worker.log excerpt. Static fixtures from " +
  "lib/runtime-forensics/__fixtures__/ are merged only when " +
  "?examples=1 (alias ?showFixtures=1) is passed. DB live lookup is a " +
  "future enhancement (codex domain).";

export async function GET(request: NextRequest) {
  if (!isDevApiEnabled()) return notFound();

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  // Single job lookup
  if (id) {
    return getSingleJob(id);
  }

  // Multi-select filter state via shared parser.
  const { state, warnings } = parseFiltersFromQuery(url.searchParams);

  // Single-value primaryClass (back-compat with v1 callers).
  const primaryClassRaw = url.searchParams.get("primaryClass");
  if (primaryClassRaw) {
    if (!FAILURE_CLASS_VALUES.includes(primaryClassRaw as FailureClass)) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_filter",
            message:
              `primaryClass must be one of: ` +
              FAILURE_CLASS_VALUES.join(", "),
          },
        },
        { status: 400 },
      );
    }
    if (!state.classes.includes(primaryClassRaw as FailureClass)) {
      state.classes = [...state.classes, primaryClassRaw as FailureClass];
    }
  }

  const loaderFilter = buildLoaderFilter(state, url.searchParams);

  let result;
  try {
    result = await aggregateForensics({
      filter: loaderFilter,
      limit: 200,
      includeFixtures: state.showFixtures,
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

  // Post-classification filter (classes + severities + hideUnknown).
  let summaries = applyEnhancedFilter(result.summaries, state);

  // Sort according to FilterState.
  summaries = sortSummaries(summaries, state.sortKey, state.sortDir);

  return NextResponse.json({
    summaries,
    total: summaries.length,
    workerLogAvailable: result.workerLogAvailable,
    workerLogPathHint: result.workerLogPathHint,
    benchmarkRunsScanned: result.benchmarkRunsScanned,
    fixturesLoaded: result.fixturesLoaded,
    fixturesEnabled: state.showFixtures,
    loaderNotes: result.loaderNotes,
    filterWarnings: warnings,
    canonicalQuery: serializeFiltersToString(state),
    sourceCaveat: SOURCE_CAVEAT,
  });
}

async function getSingleJob(id: string) {
  // Search both real artifacts and fixtures (so /dev/runtime-forensics?id=
  // works for the [FIXTURE] rows too).
  let result;
  try {
    result = await aggregateForensics({
      filter: { jobId: id },
      limit: 200,
      attachWorkerLog: true,
      includeFixtures: true,
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

  const recommendation = recommendNextEvidence(report, {
    workerLogPath: result.workerLogPathHint,
  });

  return NextResponse.json({
    report,
    summary: buildForensicsSummary(report),
    recommendation,
    markdown: formatForensicsBugReport(report, {
      workerLogPath: result.workerLogPathHint,
    }),
    workerLogAvailable: result.workerLogAvailable,
    workerLogPathHint: result.workerLogPathHint,
  });
}

/**
 * Translate FilterState's pre-classification slice into a
 * loader-side ForensicsListFilter. The loader only supports a single
 * provider/status string; if the URL carries multiple providers we
 * pass none and rely on post-classification filtering downstream
 * (we still drop non-matching rows via applyEnhancedFilter).
 */
function buildLoaderFilter(
  state: FilterState,
  searchParams: URLSearchParams,
): ForensicsListFilter {
  const filter: ForensicsListFilter = {};
  const singleProvider = searchParams.get("provider");
  const singleStatus = searchParams.get("status");
  const singleTaskId = searchParams.get("taskId");
  const singleSessionId = searchParams.get("sessionId");
  if (singleProvider) {
    filter.provider = singleProvider;
  } else if (state.providers.length === 1) {
    filter.provider = state.providers[0];
  }
  if (singleStatus) filter.status = singleStatus;
  if (state.taskId || singleTaskId) {
    filter.taskId = state.taskId ?? singleTaskId;
  }
  if (state.sessionId || singleSessionId) {
    filter.sessionId = state.sessionId ?? singleSessionId;
  }
  if (state.jobId) filter.jobId = state.jobId;
  return filter;
}
