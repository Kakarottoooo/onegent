"use client";

/**
 * /dev/benchmark-runs — Phase 0 acceptance gate dashboard.
 *
 * Reads codex's dev-only endpoints:
 *   GET /api/dev/benchmark-runs                — list of run + fixture summaries
 *   GET /api/dev/benchmark-runs/{file}         — full report for one run
 *
 * Single source of truth for the report shape lives in
 * `lib/benchmark/phase0-report.ts` + `benchmark/PHASE0_REPORT_CONTRACT.md`.
 *
 * This route is dev-only (codex's API gates on `NODE_ENV !== "production"`
 * or `ENABLE_DEV_BENCHMARK_API=1`), so the dashboard renders an explicit
 * not-available state in prod.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BucketDistribution,
  CaseDetailDrawer,
  CaseTable,
  FailureTaxonomyChart,
  GateBreakdown,
  MetricCard,
  TAXONOMY_LABEL,
  Validator,
  formatRate,
  formatTimestamp,
  type BenchmarkRunFileResponse,
  type BenchmarkRunsListResponse,
  type Phase0BenchmarkCaseResult,
  type Phase0BenchmarkReport,
  type Phase0BenchmarkRunSummary,
  type Phase0OutcomeBucket,
} from "@/components/benchmark";
import "@/components/benchmark/benchmark.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

export default function BenchmarkRunsPage() {
  /* ─── Run list ────────────────────────────────────────────────── */
  const [runs, setRuns] = useState<Phase0BenchmarkRunSummary[]>([]);
  const [listState, setListState] = useState<LoadState>({ status: "loading" });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  /* ─── Single report ───────────────────────────────────────────── */
  const [report, setReport] = useState<Phase0BenchmarkReport | null>(null);
  const [reportSource, setReportSource] = useState<"run" | "fixture" | null>(null);
  const [reportState, setReportState] = useState<LoadState>({ status: "loading" });

  /* ─── Filters ─────────────────────────────────────────────────── */
  const [activeBucket, setActiveBucket] = useState<Phase0OutcomeBucket | null>(null);
  const [activeTaxonomy, setActiveTaxonomy] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");

  /* ─── Drawer ─────────────────────────────────────────────────── */
  const [selectedCase, setSelectedCase] = useState<Phase0BenchmarkCaseResult | null>(null);

  /* ─── Loaders ─────────────────────────────────────────────────── */

  const loadRuns = useCallback(async () => {
    setListState({ status: "loading" });
    try {
      const res = await fetch("/api/dev/benchmark-runs", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(
            "Benchmark API not available. Set ENABLE_DEV_BENCHMARK_API=1 in non-dev environments.",
          );
        }
        throw new Error(`Failed to load run list (${res.status})`);
      }
      const json = (await res.json()) as BenchmarkRunsListResponse;
      setRuns(json.runs);
      setListState({ status: "ready" });
      // Auto-select the most recent run if nothing's selected yet.
      setSelectedFile((prev) => prev ?? json.runs[0]?.file ?? null);
    } catch (err) {
      setListState({
        status: "error",
        message: err instanceof Error ? err.message : "Could not load run list.",
      });
    }
  }, []);

  const loadReport = useCallback(async (file: string) => {
    setReportState({ status: "loading" });
    setReport(null);
    setReportSource(null);
    setActiveBucket(null);
    setActiveTaxonomy(null);
    setSearchText("");
    setSelectedCase(null);
    try {
      const res = await fetch(`/api/dev/benchmark-runs/${encodeURIComponent(file)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Failed to load report (${res.status})`);
      }
      const json = (await res.json()) as BenchmarkRunFileResponse;
      setReport(json.report);
      setReportSource(json.source);
      setReportState({ status: "ready" });
    } catch (err) {
      setReportState({
        status: "error",
        message: err instanceof Error ? err.message : "Could not load report.",
      });
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (selectedFile) void loadReport(selectedFile);
  }, [selectedFile, loadReport]);

  /* ─── Derived ─────────────────────────────────────────────────── */

  const cases = report?.results ?? [];
  const metrics = report?.metrics ?? null;

  const taxonomyHelperText = useMemo(() => {
    if (!metrics) return undefined;
    return `${metrics.taxonomyCovered} of ${metrics.taxonomyNeeded} requiring categorization`;
  }, [metrics]);

  /* ─── Render ──────────────────────────────────────────────────── */

  return (
    <div className="benchmark-page">
      <header className="benchmark-page__top">
        <div className="benchmark-page__top-row">
          <h1 className="benchmark-page__title">Phase 0 benchmark runs</h1>
          {reportSource && (
            <span
              className={[
                "benchmark-page__source-pill",
                `benchmark-page__source-pill--${reportSource}`,
              ].join(" ")}
            >
              {reportSource}
            </span>
          )}
          <select
            className="benchmark-page__select"
            value={selectedFile ?? ""}
            onChange={(e) => setSelectedFile(e.currentTarget.value || null)}
            disabled={listState.status !== "ready" || runs.length === 0}
            aria-label="Select benchmark run"
          >
            {runs.length === 0 && <option value="">No runs available</option>}
            {runs.map((r) => (
              <option key={r.file} value={r.file}>
                {labelRunOption(r)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="benchmark-page__refresh"
            onClick={() => {
              void loadRuns();
              if (selectedFile) void loadReport(selectedFile);
            }}
          >
            Refresh
          </button>
        </div>

        {report && (
          <div className="benchmark-page__meta">
            <span>
              <strong>Run:</strong> <code>{report.runId}</code>
            </span>
            <span>
              <strong>Suite:</strong> <code>{report.suiteId}</code> v{report.suiteVersion}
            </span>
            <span>
              <strong>Created:</strong> {formatTimestamp(report.createdAt)}
            </span>
            <span>
              <strong>Cases:</strong> {report.metrics.total}
            </span>
            {report.dryRun && <span>· dry-run</span>}
            {report.dispatchOnly && <span>· dispatch-only</span>}
          </div>
        )}
      </header>

      <main className="benchmark-page__body">
        {listState.status === "loading" && (
          <div className="benchmark-page__loading">Loading runs…</div>
        )}
        {listState.status === "error" && (
          <div className="benchmark-page__error">{listState.message}</div>
        )}

        {listState.status === "ready" && runs.length === 0 && (
          <div className="benchmark-page__empty">
            No benchmark runs found. Run{" "}
            <code>npx tsx scripts/run-phase0-resy-benchmark.ts</code> locally to
            generate one, or check that{" "}
            <code>benchmark/fixtures/sample-phase0-resy-report.json</code> exists.
          </div>
        )}

        {listState.status === "ready" && runs.length > 0 && reportState.status === "loading" && (
          <div className="benchmark-page__loading">Loading report…</div>
        )}
        {reportState.status === "error" && (
          <div className="benchmark-page__error">{reportState.message}</div>
        )}

        {report && metrics && (
          <>
            {/* Gate banner + 4 metrics */}
            <section className="benchmark-gate">
              <div
                className={[
                  "benchmark-gate__pill",
                  metrics.passed
                    ? "benchmark-gate__pill--pass"
                    : "benchmark-gate__pill--fail",
                ].join(" ")}
              >
                <span className="benchmark-gate__verdict">
                  {metrics.passed ? "PASS" : "FAIL"}
                </span>
                <span className="benchmark-gate__verdict-sub">
                  Phase 0 acceptance gate
                </span>
              </div>

              <div className="benchmark-gate__metrics">
                <MetricCard
                  label="Booking-ready rate"
                  rate={metrics.bookingReadyRate}
                  countLabel={`${metrics.bookingReady} of ${metrics.total}`}
                  direction="up"
                />
                <MetricCard
                  label="Safe-outcome rate"
                  rate={metrics.safeOutcomeRate}
                  countLabel={`${metrics.safe} of ${metrics.total}`}
                  direction="up"
                />
                <MetricCard
                  label="Severe-error rate"
                  rate={metrics.severeErrorRate}
                  countLabel={`${metrics.severe} of ${metrics.total}`}
                  direction="down"
                />
                <MetricCard
                  label="Taxonomy coverage"
                  rate={metrics.taxonomyCoverageRate}
                  countLabel={`${metrics.taxonomyCovered} of ${metrics.taxonomyNeeded}`}
                  direction="up"
                  helper={taxonomyHelperText}
                />
              </div>
            </section>

            <GateBreakdown metrics={metrics} results={cases} />

            <BucketDistribution
              cases={cases}
              activeBucket={activeBucket}
              onBucketClick={setActiveBucket}
            />

            <FailureTaxonomyChart
              cases={cases}
              activeTaxonomy={activeTaxonomy}
              onTaxonomyClick={setActiveTaxonomy}
            />

            <section className="benchmark-filters" aria-label="Case filters">
              <input
                className="benchmark-filters__search"
                type="search"
                placeholder="Search by case ID, prompt, or taxonomy code…"
                value={searchText}
                onChange={(e) => setSearchText(e.currentTarget.value)}
              />
              {activeBucket && (
                <span className="benchmark-filters__chip">
                  bucket = {activeBucket}
                  <button type="button" onClick={() => setActiveBucket(null)}>
                    ×
                  </button>
                </span>
              )}
              {activeTaxonomy && (
                <span className="benchmark-filters__chip">
                  taxonomy = {activeTaxonomy}
                  {TAXONOMY_LABEL[activeTaxonomy] && (
                    <> ({TAXONOMY_LABEL[activeTaxonomy]})</>
                  )}
                  <button type="button" onClick={() => setActiveTaxonomy(null)}>
                    ×
                  </button>
                </span>
              )}
              {searchText && (
                <span className="benchmark-filters__chip">
                  search = {searchText}
                  <button type="button" onClick={() => setSearchText("")}>
                    ×
                  </button>
                </span>
              )}
            </section>

            <CaseTable
              cases={cases}
              activeBucket={activeBucket}
              activeTaxonomy={activeTaxonomy}
              searchText={searchText}
              onCaseClick={setSelectedCase}
              selectedCaseId={selectedCase?.caseId ?? null}
            />

            <Validator
              loadedReport={report}
              loadedLabel={`${report.runId} · ${reportSource ?? ""}`}
            />
          </>
        )}

        {/* Validator is also available even before a report is selected,
            so codex can paste raw JSON from a fresh runner output and
            check shape WITHOUT having to push it first. */}
        {!report && listState.status === "ready" && (
          <Validator loadedReport={null} />
        )}
      </main>

      <CaseDetailDrawer
        caseResult={selectedCase}
        onClose={() => setSelectedCase(null)}
      />
    </div>
  );
}

/* ─── Helper ──────────────────────────────────────────────────────── */

function labelRunOption(r: Phase0BenchmarkRunSummary): string {
  // formatTimestamp is friendly; throw the file name in too so duplicates disambiguate.
  const ts = formatTimestamp(r.createdAt);
  const verdict = r.metrics.passed ? "PASS" : "FAIL";
  const rate = formatRate(r.metrics.bookingReadyRate);
  return `${ts} · ${verdict} · ready ${rate} · ${r.runId} (${r.source})`;
}
