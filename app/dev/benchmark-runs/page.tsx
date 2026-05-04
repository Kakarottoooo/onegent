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

            {/* Artifact rail — surfaces per-case taskId / timelineUrl /
                snapshotsUrl / outcome tags, and renders a strategy-log
                placeholder until codex's runner emits a `strategyLog`
                field on the case result. Click a row in CaseTable above
                to drive this panel. */}
            <ArtifactRail
              caseResult={selectedCase}
              reportFile={selectedFile}
              reportRunId={report.runId}
              reportSource={reportSource}
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

/* ─── Artifact rail (per-case taskId / urls / outcome chips) ───────── */

/**
 * Below-the-table rail that surfaces, for the case the user just clicked:
 *   - report file path (so founder can grep / open in editor)
 *   - taskId + currentJobId (for direct DB lookup)
 *   - snapshotsUrl / timelineUrl as live API links
 *   - outcome chips: safe failure / severe tripwire / no_availability_correct
 *   - strategy-log group (placeholder until codex adds a `strategyLog`
 *     field on Phase0BenchmarkCaseResult; works today against `terminalReason`
 *     when it contains `[provider][strategy ...]` lines)
 *
 * Built inline (not as a separate component file) so the diff stays
 * concentrated and codex can review the shape in one place.
 */
function ArtifactRail({
  caseResult,
  reportFile,
  reportRunId,
  reportSource,
}: {
  caseResult: Phase0BenchmarkCaseResult | null;
  reportFile: string | null;
  reportRunId: string;
  reportSource: "run" | "fixture" | null;
}) {
  if (!caseResult) {
    return (
      <section className="benchmark-artifacts benchmark-artifacts--empty">
        <h3 className="benchmark-artifacts__title">Artifacts</h3>
        <p className="benchmark-artifacts__hint">
          Click a row in the case table above to inspect taskId, timeline /
          snapshot URLs, outcome tripwires, and strategy logs.
        </p>
      </section>
    );
  }

  const reportPath =
    reportFile && reportSource
      ? `benchmark/${reportSource === "fixture" ? "fixtures" : "runs"}/${reportFile}`
      : null;

  const provider = inferProviderFromCaseId(caseResult.caseId);

  return (
    <section className="benchmark-artifacts">
      <header className="benchmark-artifacts__header">
        <h3 className="benchmark-artifacts__title">
          Artifacts · <code>{caseResult.caseId}</code>
        </h3>
        <OutcomeChipRow caseResult={caseResult} />
      </header>

      <div className="benchmark-artifacts__grid">
        <ArtifactRow label="Run report" value={reportPath ?? "—"} mono />
        <ArtifactRow label="Run ID" value={reportRunId} mono />
        <ArtifactRow
          label="Task ID"
          value={caseResult.taskId ?? "—"}
          mono
          link={
            caseResult.taskId
              ? `/tasks/${encodeURIComponent(caseResult.taskId)}`
              : null
          }
        />
        <ArtifactRow
          label="Job ID"
          value={caseResult.currentJobId ?? "—"}
          mono
        />
        <ArtifactRow
          label="Timeline URL"
          value={caseResult.timelineUrl ?? "—"}
          mono
          link={caseResult.timelineUrl ?? null}
        />
        <ArtifactRow
          label="Snapshots URL"
          value={caseResult.snapshotsUrl ?? "—"}
          mono
          link={caseResult.snapshotsUrl ?? null}
        />
      </div>

      <StrategyLogPanel caseResult={caseResult} />

      <CrossDashboardRail caseResult={caseResult} provider={provider} />
    </section>
  );
}

/** Infer the booking provider from a Phase 0 caseId prefix.
 *  `R-*` (Resy) is the only suite live on master today; the rest are
 *  reserved for future restaurant providers + planned hotel/flight suites. */
function inferProviderFromCaseId(
  caseId: string,
): "resy" | "opentable" | "booking" | "expedia" | "hotels" | null {
  if (/^R-\d/i.test(caseId)) return "resy";
  if (/^OT-\d/i.test(caseId)) return "opentable";
  if (/^B-\d/i.test(caseId)) return "booking";
  if (/^E-\d/i.test(caseId)) return "expedia";
  if (/^H-\d/i.test(caseId)) return "hotels";
  return null;
}

/**
 * Cross-dashboard rail — surface the OTHER dev dashboards that have
 * relevant context for the case the user just clicked. Three audiences:
 *   1. "Was this case probe-validated before the live spend?" → probe runs
 *   2. "What did the page look like at terminal step?" → debug-screenshots
 *   3. "If this was a no_availability_correct outcome, retry only after
 *       a probe says live_ok" → probe-first protocol pointer
 */
function CrossDashboardRail({
  caseResult,
  provider,
}: {
  caseResult: Phase0BenchmarkCaseResult;
  provider: ReturnType<typeof inferProviderFromCaseId>;
}) {
  const isResy = provider === "resy";
  const noAvail = caseResult.outcome === "no_availability_correct";
  return (
    <div className="benchmark-cross">
      <h4 className="benchmark-cross__title">Related dashboards</h4>
      <ul className="benchmark-cross__items">
        {isResy && (
          <li>
            <a className="benchmark-cross__link" href="/dev/resy-probe-runs">
              /dev/resy-probe-runs
            </a>
            <span className="benchmark-cross__hint">
              {noAvail
                ? " — outcome was no_availability_correct. Probe-first: rerun this case live ONLY after a probe says use_for_live_fill_test for the same caseId + date/time."
                : " — verify the case had matching slots before re-running live."}
            </span>
          </li>
        )}
        <li>
          <a className="benchmark-cross__link" href="/dev/debug-artifacts">
            /dev/debug-artifacts
          </a>
          <span className="benchmark-cross__hint">
            {provider
              ? ` — inspect worker/.debug-screenshots/${provider}/* (page.png + summary.json) captured during the run, if the worker wrote any.`
              : " — inspect worker/.debug-screenshots/<provider>/* if the worker wrote any."}
          </span>
        </li>
        {caseResult.taskId && (
          <li>
            <a
              className="benchmark-cross__link"
              href={`/tasks/${encodeURIComponent(caseResult.taskId)}`}
            >
              /tasks/{caseResult.taskId}
            </a>
            <span className="benchmark-cross__hint">
              {" "}
              — full task timeline + state history.
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

function ArtifactRow({
  label,
  value,
  mono,
  link,
}: {
  label: string;
  value: string;
  mono?: boolean;
  link?: string | null;
}) {
  return (
    <div className="benchmark-artifacts__row">
      <span className="benchmark-artifacts__row-label">{label}</span>
      {link ? (
        <a
          className={`benchmark-artifacts__row-value${mono ? " benchmark-artifacts__row-value--mono" : ""}`}
          href={link}
          target="_blank"
          rel="noopener noreferrer"
        >
          {value}
        </a>
      ) : (
        <span
          className={`benchmark-artifacts__row-value${mono ? " benchmark-artifacts__row-value--mono" : ""}`}
        >
          {value}
        </span>
      )}
    </div>
  );
}

/**
 * Three primary outcome tripwire chips the user explicitly asked for:
 *   - safe failure (safe-bucket but not booking-ready)
 *   - severe tripwire (severe = true)
 *   - no_availability_correct (outcome bucket exact match)
 *
 * Plus a "booking-ready" success chip for completeness. Pure presentation;
 * gating decisions live in `metrics.passed` per PHASE0_REPORT_CONTRACT.
 */
function OutcomeChipRow({
  caseResult,
}: {
  caseResult: Phase0BenchmarkCaseResult;
}) {
  const chips: Array<{ tone: "good" | "ok" | "warn" | "bad"; label: string }> = [];
  if (caseResult.severe) {
    chips.push({ tone: "bad", label: "severe tripwire" });
  }
  if (caseResult.outcome === "no_availability_correct") {
    chips.push({ tone: "ok", label: "no_availability_correct" });
  }
  if (caseResult.bookingReady) {
    chips.push({ tone: "good", label: "booking-ready" });
  } else if (caseResult.safe) {
    chips.push({ tone: "ok", label: "safe failure" });
  }
  if (chips.length === 0) {
    chips.push({ tone: "warn", label: "no chips" });
  }
  return (
    <div className="benchmark-artifacts__chips">
      {chips.map((c) => (
        <span
          key={c.label}
          className={`benchmark-artifacts__chip benchmark-artifacts__chip--${c.tone}`}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Strategy-log panel.
 *
 * Today (2026-05-04 ship): groups any `[provider][strategy ...]` lines that
 * happen to appear in `caseResult.terminalReason`. Most cases won't have
 * any, so the panel renders a quiet "no strategy log captured" message
 * pointing at where codex would emit those lines.
 *
 * Tomorrow (codex hookup): when codex adds a `strategyLog?: string[]`
 * field on `Phase0BenchmarkCaseResult`, swap the source from
 * `terminalReason` parsing to direct field consumption — single-line
 * change. The grouping/rendering logic stays.
 */
function StrategyLogPanel({
  caseResult,
}: {
  caseResult: Phase0BenchmarkCaseResult;
}) {
  const lines = extractStrategyLines(caseResult.terminalReason ?? "");
  const groups = groupStrategyLines(lines);
  return (
    <div className="benchmark-strategy">
      <h4 className="benchmark-strategy__title">
        Provider strategy log
        {lines.length > 0 && (
          <span className="benchmark-strategy__count"> · {lines.length} entries</span>
        )}
      </h4>
      {lines.length === 0 ? (
        <p className="benchmark-strategy__empty">
          No <code>[provider][strategy …]</code> lines captured for this case.
          Worker emits these to <code>worker.log</code>; once codex adds a{" "}
          <code>strategyLog</code> field to the report payload, this panel
          will render the per-attempt ladder (e.g. <code>ot-phone-01-exact-locator</code>{" "}
          → <code>ot-phone-04-fixed-coordinate-high</code>).
        </p>
      ) : (
        <div className="benchmark-strategy__groups">
          {Object.entries(groups).map(([provider, attempts]) => (
            <div key={provider} className="benchmark-strategy__group">
              <h5 className="benchmark-strategy__group-title">{provider}</h5>
              <ol className="benchmark-strategy__attempts">
                {attempts.map((a, i) => (
                  <li key={i} className="benchmark-strategy__attempt">
                    <code>{a.label}</code>
                    {a.detail && (
                      <span className="benchmark-strategy__detail"> · {a.detail}</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface StrategyLine {
  provider: string;
  label: string;
  detail: string;
}

const STRATEGY_LINE_RE =
  /\[(resy|opentable|booking|expedia|hotels)\]\[strategy ([^\]]+)\](?:\s*[:\-]\s*(.+))?/gi;

function extractStrategyLines(source: string): StrategyLine[] {
  if (!source) return [];
  const out: StrategyLine[] = [];
  for (const m of source.matchAll(STRATEGY_LINE_RE)) {
    out.push({
      provider: m[1].toLowerCase(),
      label: m[2].trim(),
      detail: (m[3] ?? "").trim(),
    });
  }
  return out;
}

function groupStrategyLines(
  lines: StrategyLine[],
): Record<string, Array<{ label: string; detail: string }>> {
  const out: Record<string, Array<{ label: string; detail: string }>> = {};
  for (const ln of lines) {
    if (!out[ln.provider]) out[ln.provider] = [];
    out[ln.provider].push({ label: ln.label, detail: ln.detail });
  }
  return out;
}
