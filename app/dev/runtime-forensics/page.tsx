/**
 * /dev/runtime-forensics — Provider Runtime Forensics Workbench.
 *
 * Read-only dashboard backed by `/api/dev/runtime-forensics`. V1 is
 * artifact-based: parses `benchmark/runs/*.json` and an optional
 * worker-log excerpt. NO live runs, NO retry buttons. Source of truth
 * is still the DB + worker log + screenshots — this is a triage helper
 * that pre-classifies failures and surfaces signals.
 *
 * Layout:
 *   - Top banner: V1 artifact-based caveat + worker-log presence.
 *   - Filter rail: provider / status / primaryClass.
 *   - Job table: provider · scenario · status · classification ·
 *     age · task link.
 *   - Detail drawer (on row click): raw terminal fields + parsed
 *     classification + step shape audit + decision log summary +
 *     cross-references + paste-ready markdown bug-report.
 *
 * P0 highlighting: rows with `hasLegacyShapeBug=true` get a red
 * border + 🚨 marker, signaling worker-gating regression.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  FAILURE_CLASS_LABEL,
  FAILURE_CLASS_TONE,
  FORENSICS_SEVERITY_LABEL,
  type FailureClass,
  type ForensicsReport,
  type ForensicsSeverity,
  type ForensicsSummary,
} from "@/lib/runtime-forensics/types";

interface ListResponse {
  summaries: ForensicsSummary[];
  total: number;
  workerLogAvailable: boolean;
  workerLogPathHint: string;
  benchmarkRunsScanned: number;
  loaderNotes: string[];
  sourceCaveat: string;
}

interface DetailResponse {
  report: ForensicsReport;
  summary: ForensicsSummary;
  markdown: string;
  workerLogAvailable: boolean;
  workerLogPathHint: string;
}

const FAILURE_CLASS_OPTIONS: ReadonlyArray<FailureClass> = [
  "legacy_shape_missing_source",
  "provider_no_availability",
  "provider_form_incomplete",
  "otp_or_login_required",
  "checkout_reached_manual_review",
  "model_or_env_blocked",
  "network_or_provider_5xx",
  "unknown",
];

const PROVIDER_OPTIONS = ["resy", "opentable", "expedia", "booking-com", "hotels-com"];
const STATUS_OPTIONS = [
  "pending",
  "running",
  "ready_for_confirmation",
  "succeeded",
  "failed",
  "cancelled",
];

export default function RuntimeForensicsPage() {
  const [list, setList] = useState<ListResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [filterProvider, setFilterProvider] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterClass, setFilterClass] = useState<string>("");

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (filterProvider) params.set("provider", filterProvider);
      if (filterStatus) params.set("status", filterStatus);
      if (filterClass) params.set("primaryClass", filterClass);
      const url = `/api/dev/runtime-forensics${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(`GET list failed: ${res.status} ${body?.error?.message ?? ""}`);
      }
      const data = (await res.json()) as ListResponse;
      setList(data);
    } catch (err) {
      setListError((err as Error).message);
      setList(null);
    } finally {
      setListLoading(false);
    }
  }, [filterProvider, filterStatus, filterClass]);

  const loadDetail = useCallback(async (jobId: string) => {
    setActiveJobId(jobId);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(
        `/api/dev/runtime-forensics?id=${encodeURIComponent(jobId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(`GET detail failed: ${res.status} ${body?.error?.message ?? ""}`);
      }
      const data = (await res.json()) as DetailResponse;
      setDetail(data);
    } catch (err) {
      setDetailError((err as Error).message);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  return (
    <main className="rfor">
      <header className="rfor__top">
        <div className="rfor__breadcrumb">
          <a href="/dev">/dev</a>
          <span> · </span>
          <span>runtime-forensics</span>
        </div>
        <h1 className="rfor__title">Provider Runtime Forensics</h1>
        <p className="rfor__subtitle">
          Read-only triage workbench. Reads `benchmark/runs/*.json`,
          `worker/.debug-screenshots/`, and an optional `codex-worker.log` excerpt
          to pre-classify provider failures across 8 categories. **No live
          runs, no retry, no worker control.**
        </p>
        <div className="rfor__caveat">
          <strong>V1 is artifact-based.</strong> Source of truth is still the
          DB + worker log + screenshots, not this page. DB live lookup is a
          future source (codex domain).
        </div>
      </header>

      <section className="rfor__filters">
        <h2 className="rfor__section-title">Filter</h2>
        <div className="rfor__filter-row">
          <label>
            <span>Provider</span>
            <select
              value={filterProvider}
              onChange={(e) => setFilterProvider(e.target.value)}
            >
              <option value="">(any)</option>
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">(any)</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Classification</span>
            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
            >
              <option value="">(any)</option>
              {FAILURE_CLASS_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {FAILURE_CLASS_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rfor__btn-tiny"
            onClick={() => {
              setFilterProvider("");
              setFilterStatus("");
              setFilterClass("");
            }}
          >
            Clear
          </button>
        </div>
      </section>

      <section className="rfor__section">
        <h2 className="rfor__section-title">
          Jobs {list ? `(${list.total})` : ""}
        </h2>
        {listLoading && <div className="rfor__loading">Loading…</div>}
        {listError && <div className="rfor__error">{listError}</div>}
        {!listLoading && list && list.total === 0 && (
          <EmptyState
            workerLogAvailable={list.workerLogAvailable}
            workerLogPathHint={list.workerLogPathHint}
            benchmarkRunsScanned={list.benchmarkRunsScanned}
            loaderNotes={list.loaderNotes}
          />
        )}
        {list && list.total > 0 && (
          <JobTable
            summaries={list.summaries}
            activeJobId={activeJobId}
            onSelect={(id) => void loadDetail(id)}
          />
        )}
        {list && (
          <div className="rfor__meta">
            Worker log:{" "}
            {list.workerLogAvailable ? (
              <span className="rfor__meta-good">present</span>
            ) : (
              <span className="rfor__meta-warn">absent</span>
            )}
            {" · "}
            Path hint: <code>{list.workerLogPathHint}</code>
            {" · "}
            Benchmark runs scanned: {list.benchmarkRunsScanned}
          </div>
        )}
      </section>

      <section className="rfor__section">
        <h2 className="rfor__section-title">Detail</h2>
        {detailLoading && <div className="rfor__loading">Loading…</div>}
        {detailError && <div className="rfor__error">{detailError}</div>}
        {!detailLoading && !detail && !detailError && (
          <div className="rfor__empty">
            <p>Select a job above to see classification + step shape audit + paste-ready bug report.</p>
          </div>
        )}
        {detail && <DetailPanel detail={detail} />}
      </section>

      <RuntimeForensicsStyles />
    </main>
  );
}

/* ─── Job table ──────────────────────────────────────────────────── */

interface JobTableProps {
  summaries: ForensicsSummary[];
  activeJobId: string | null;
  onSelect: (jobId: string) => void;
}

function JobTable({ summaries, activeJobId, onSelect }: JobTableProps) {
  return (
    <div className="rfor__table-wrap">
      <table className="rfor__table">
        <thead>
          <tr>
            <th>Job id</th>
            <th>Provider</th>
            <th>Scenario</th>
            <th>Status</th>
            <th>Classification</th>
            <th>Severity</th>
            <th>Age</th>
            <th>Task</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => {
            const tone = FAILURE_CLASS_TONE[s.primaryClass];
            const isActive = s.jobId === activeJobId;
            return (
              <tr
                key={(s.jobId ?? "noid") + ":" + s.scenario}
                className={
                  s.hasLegacyShapeBug
                    ? "rfor__row--p0"
                    : isActive
                    ? "rfor__row--active"
                    : undefined
                }
              >
                <td>
                  <code className="rfor__cell-mono">{s.jobId ?? "—"}</code>
                </td>
                <td>{s.provider}</td>
                <td>{s.scenario}</td>
                <td>{s.status}</td>
                <td>
                  <span className={`rfor__pill rfor__pill--${tone}`}>
                    {s.hasLegacyShapeBug ? "🚨 " : ""}
                    {FAILURE_CLASS_LABEL[s.primaryClass]}
                  </span>
                </td>
                <td>
                  <SeverityChip severity={s.severity} />
                </td>
                <td>{formatAge(s.ageSeconds)}</td>
                <td>
                  {s.taskId ? (
                    <a
                      className="rfor__link"
                      href={`/tasks/${encodeURIComponent(s.taskId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      open
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="rfor__btn-tiny"
                    disabled={!s.jobId}
                    onClick={() => s.jobId && onSelect(s.jobId)}
                  >
                    {isActive ? "Reload" : "Inspect"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Detail panel ───────────────────────────────────────────────── */

function DetailPanel({ detail }: { detail: DetailResponse }) {
  const { report, markdown } = detail;
  const tone = FAILURE_CLASS_TONE[report.classification.primaryClass];
  return (
    <div className={`rfor__detail rfor__detail--${tone}`}>
      <div className="rfor__detail-headline">
        <span className={`rfor__pill rfor__pill--${tone}`}>
          {report.stepShape.hasLegacyShapeBug ? "🚨 " : ""}
          {FAILURE_CLASS_LABEL[report.classification.primaryClass]}
        </span>
        <SeverityChip severity={report.classification.severity} />
        <span className="rfor__detail-runid">
          {report.jobId ? <code>{report.jobId}</code> : "(no id)"}
        </span>
      </div>

      <dl className="rfor__detail-dl">
        <div>
          <dt>Provider</dt>
          <dd>{report.provider}</dd>
        </div>
        <div>
          <dt>Scenario</dt>
          <dd>{report.scenario}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{report.status}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{report.classification.confidence}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{report.updatedAt ?? "—"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>
            <code>{report.inputSource}</code>
          </dd>
        </div>
      </dl>

      <h3 className="rfor__sub-title">Top signals</h3>
      {report.classification.signals.length === 0 ? (
        <p className="rfor__muted">No matched signals — classifier returned `unknown`.</p>
      ) : (
        <ul className="rfor__signal-list">
          {report.classification.signals.slice(0, 8).map((s, i) => (
            <li key={i}>
              <code>[{s.weight.toFixed(2)}]</code>
              {" "}
              <code>[{s.source}]</code>
              {" "}
              <code>[{s.supportsClass}]</code>
              {" "}
              <span>{s.label}</span>
              {s.excerpt && <div className="rfor__signal-excerpt">{s.excerpt}</div>}
            </li>
          ))}
        </ul>
      )}

      <h3 className="rfor__sub-title">Step shape audit</h3>
      <p>
        Total steps: <strong>{report.stepShape.totalSteps}</strong> · with{" "}
        <code>__source</code>: {report.stepShape.stepsWithSourceMarker} · missing:{" "}
        {report.stepShape.stepsMissingSourceMarker}
      </p>
      {report.stepShape.hasLegacyShapeBug && (
        <div className="rfor__p0-callout">
          <strong>P0: Legacy-shape bug detected.</strong> Step reached worker
          without `__source` marker — M5 force-gate at{" "}
          <code>app/api/booking-jobs/[id]/start/route.ts</code> failed to stamp.
          Review the gate-routing path and the worker step normalizer.
        </div>
      )}
      {report.stepShape.legacyShapeQuotes.length > 0 && (
        <ul className="rfor__quote-list">
          {report.stepShape.legacyShapeQuotes.slice(0, 6).map((q, i) => (
            <li key={i}>
              <code>{q}</code>
            </li>
          ))}
        </ul>
      )}

      <h3 className="rfor__sub-title">Raw terminal fields</h3>
      <ul className="rfor__raw-list">
        {report.rawTerminalReason && (
          <li>
            <strong>terminalReason</strong>
            <pre className="rfor__pre">{report.rawTerminalReason}</pre>
          </li>
        )}
        {report.rawTerminalCode && (
          <li>
            <strong>terminalCode</strong>: <code>{report.rawTerminalCode}</code>
          </li>
        )}
        {report.rawErrorMessage && (
          <li>
            <strong>errorMessage</strong>
            <pre className="rfor__pre">{report.rawErrorMessage}</pre>
          </li>
        )}
      </ul>

      {report.decisionLogSummary.totalEntries > 0 && (
        <>
          <h3 className="rfor__sub-title">
            Decision log ({report.decisionLogSummary.totalEntries})
          </h3>
          <p className="rfor__muted">
            Levels:{" "}
            {Object.entries(report.decisionLogSummary.byLevel)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}
            {report.decisionLogSummary.notableSignals.length > 0 && (
              <>
                {" · Notable: "}
                {report.decisionLogSummary.notableSignals.join(", ")}
              </>
            )}
          </p>
          <ul className="rfor__event-list">
            {report.decisionLogSummary.topEvents.map((e, i) => (
              <li key={i}>
                <code>{e.event}</code> × {e.count}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="rfor__sub-title">Cross-references</h3>
      <ul className="rfor__raw-list">
        {report.hints.taskPagePath && (
          <li>
            Task page:{" "}
            <a
              className="rfor__link"
              href={report.hints.taskPagePath}
              target="_blank"
              rel="noopener noreferrer"
            >
              <code>{report.hints.taskPagePath}</code>
            </a>
          </li>
        )}
        {report.hints.benchmarkReportFile && (
          <li>
            Benchmark report:{" "}
            <code>benchmark/runs/{report.hints.benchmarkReportFile}</code>
          </li>
        )}
        {report.hints.hasScreenshots && (
          <li>
            Debug screenshots:{" "}
            <code>
              {report.hints.screenshotsRel ?? `worker/.debug-screenshots/${report.provider}/`}
            </code>
          </li>
        )}
        {!report.hints.taskPagePath &&
          !report.hints.benchmarkReportFile &&
          !report.hints.hasScreenshots && (
            <li className="rfor__muted">No cross-references available for this artifact.</li>
          )}
      </ul>

      <h3 className="rfor__sub-title">Paste-ready bug report (Codex / Claude)</h3>
      <textarea
        className="rfor__markdown"
        readOnly
        value={markdown}
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}

/* ─── Empty state ────────────────────────────────────────────────── */

function EmptyState({
  workerLogAvailable,
  workerLogPathHint,
  benchmarkRunsScanned,
  loaderNotes,
}: {
  workerLogAvailable: boolean;
  workerLogPathHint: string;
  benchmarkRunsScanned: number;
  loaderNotes: string[];
}) {
  return (
    <div className="rfor__empty">
      <p>
        <strong>No matching artifacts.</strong> The forensics workbench is
        designed to render gracefully even when no benchmark runs are present.
      </p>
      <ul>
        <li>
          Benchmark runs scanned:{" "}
          <code>benchmark/runs/*.json</code> →{" "}
          <strong>{benchmarkRunsScanned}</strong>
        </li>
        <li>
          Worker log path:{" "}
          {workerLogAvailable ? (
            <span className="rfor__meta-good">present at</span>
          ) : (
            <span className="rfor__meta-warn">missing at</span>
          )}{" "}
          <code>{workerLogPathHint}</code>
          {!workerLogAvailable &&
            ` · override with WORKER_LOG_PATH env (codex's path: C:\\Users\\Gzw19\\onegent-e2e-20260503\\codex-worker.log)`}
        </li>
      </ul>
      {loaderNotes.length > 0 && (
        <div>
          <p>Loader notes:</p>
          <ul>
            {loaderNotes.map((n, i) => (
              <li key={i}>
                <code>{n}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ─── Building blocks ────────────────────────────────────────────── */

function SeverityChip({ severity }: { severity: ForensicsSeverity }) {
  const tone =
    severity === "p0"
      ? "bad"
      : severity === "p1"
      ? "warn"
      : severity === "p2"
      ? "warn"
      : severity === "info"
      ? "neutral"
      : "neutral";
  return (
    <span className={`rfor__sev-chip rfor__sev-chip--${tone}`}>
      {FORENSICS_SEVERITY_LABEL[severity]}
    </span>
  );
}

function formatAge(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/* ─── Styles ─────────────────────────────────────────────────────── */

function RuntimeForensicsStyles() {
  return (
    <style jsx global>{`
      .rfor {
        --ink-2: #f3f4f6;
        --ink-3: #e5e7eb;
        --ink-6: #6b7280;
        --ink-7: #4b5563;
        --ink-8: #1f2937;
        --ink-9: #111827;
        --card: #ffffff;
        --bg: #fafafa;
        --good: #16a34a;
        --good-bg: rgba(22, 163, 74, 0.10);
        --good-border: rgba(22, 163, 74, 0.30);
        --warn: #f59e0b;
        --warn-bg: rgba(245, 158, 11, 0.12);
        --warn-border: rgba(245, 158, 11, 0.32);
        --bad: #b91c1c;
        --bad-bg: rgba(185, 28, 28, 0.10);
        --bad-border: rgba(185, 28, 28, 0.30);
        --neutral: #6b7280;
        --neutral-bg: rgba(107, 114, 128, 0.08);
        --neutral-border: rgba(107, 114, 128, 0.22);

        max-width: 1280px;
        margin: 0 auto;
        padding: 32px 24px 64px;
        font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        min-height: 100vh;
        color: var(--ink-9);
      }
      .rfor__breadcrumb {
        font-size: 12px;
        color: var(--ink-6);
        margin-bottom: 8px;
      }
      .rfor__breadcrumb a {
        color: var(--ink-7);
        text-decoration: none;
      }
      .rfor__breadcrumb a:hover {
        text-decoration: underline;
      }
      .rfor__title {
        margin: 0 0 6px;
        font-size: 24px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .rfor__subtitle {
        margin: 0 0 12px;
        font-size: 13px;
        color: var(--ink-7);
        line-height: 1.55;
        max-width: 760px;
      }
      .rfor__caveat {
        background: var(--warn-bg);
        border: 1px solid var(--warn-border);
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 12.5px;
        color: var(--ink-8);
        max-width: 760px;
      }
      .rfor__section {
        margin-top: 28px;
      }
      .rfor__section-title {
        margin: 0 0 12px;
        font-size: 11.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--ink-7);
      }
      .rfor__filters {
        margin-top: 28px;
      }
      .rfor__filter-row {
        display: flex;
        gap: 12px;
        align-items: end;
        flex-wrap: wrap;
      }
      .rfor__filter-row label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 11px;
        color: var(--ink-7);
      }
      .rfor__filter-row select {
        padding: 6px 10px;
        border: 1px solid var(--ink-3);
        border-radius: 6px;
        font-size: 12.5px;
        min-width: 180px;
      }
      .rfor__btn-tiny {
        appearance: none;
        background: var(--card);
        border: 1px solid var(--ink-3);
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 11.5px;
        font-weight: 600;
        color: var(--ink-8);
        cursor: pointer;
        transition: border-color 120ms;
      }
      .rfor__btn-tiny:hover:not(:disabled) {
        border-color: var(--good);
      }
      .rfor__btn-tiny:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .rfor__table-wrap {
        overflow-x: auto;
        background: var(--card);
        border: 1px solid var(--ink-3);
        border-radius: 10px;
      }
      .rfor__table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .rfor__table th,
      .rfor__table td {
        padding: 8px 10px;
        text-align: left;
        border-bottom: 1px solid var(--ink-3);
        vertical-align: middle;
      }
      .rfor__table th {
        font-size: 10.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ink-6);
        background: var(--ink-2);
      }
      .rfor__row--p0 {
        background: rgba(185, 28, 28, 0.05);
        outline: 2px solid var(--bad-border);
        outline-offset: -2px;
      }
      .rfor__row--active {
        background: rgba(22, 163, 74, 0.05);
      }
      .rfor__cell-mono {
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 11px;
        color: var(--ink-7);
      }

      .rfor__pill {
        display: inline-flex;
        align-items: center;
        padding: 3px 10px;
        border-radius: 999px;
        font-size: 10.5px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .rfor__pill--good {
        color: var(--good);
        background: var(--good-bg);
        border: 1px solid var(--good-border);
      }
      .rfor__pill--warn {
        color: var(--warn);
        background: var(--warn-bg);
        border: 1px solid var(--warn-border);
      }
      .rfor__pill--bad {
        color: var(--bad);
        background: var(--bad-bg);
        border: 1px solid var(--bad-border);
      }
      .rfor__pill--neutral {
        color: var(--neutral);
        background: var(--neutral-bg);
        border: 1px solid var(--neutral-border);
      }

      .rfor__sev-chip {
        display: inline-flex;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.05em;
      }
      .rfor__sev-chip--bad {
        background: var(--bad-bg);
        color: var(--bad);
      }
      .rfor__sev-chip--warn {
        background: var(--warn-bg);
        color: var(--warn);
      }
      .rfor__sev-chip--neutral {
        background: var(--neutral-bg);
        color: var(--neutral);
      }

      .rfor__loading,
      .rfor__error,
      .rfor__empty {
        padding: 14px 16px;
        background: var(--card);
        border: 1px dashed var(--ink-3);
        border-radius: 8px;
        font-size: 12.5px;
        color: var(--ink-7);
      }
      .rfor__error {
        border-color: var(--bad-border);
        color: var(--bad);
      }

      .rfor__empty ul {
        margin: 8px 0 0 0;
        padding-left: 20px;
      }
      .rfor__empty li {
        font-size: 12px;
        margin-bottom: 4px;
      }

      .rfor__meta {
        margin-top: 8px;
        font-size: 11px;
        color: var(--ink-6);
      }
      .rfor__meta code {
        font-family: ui-monospace, monospace;
        background: var(--ink-2);
        padding: 1px 5px;
        border-radius: 3px;
        font-size: 11px;
      }
      .rfor__meta-good { color: var(--good); font-weight: 600; }
      .rfor__meta-warn { color: var(--warn); font-weight: 600; }

      .rfor__detail {
        background: var(--card);
        border: 1px solid var(--ink-3);
        border-radius: 12px;
        padding: 18px 22px;
      }
      .rfor__detail--bad { border-color: var(--bad-border); }
      .rfor__detail--warn { border-color: var(--warn-border); }
      .rfor__detail--good { border-color: var(--good-border); }
      .rfor__detail--neutral { border-color: var(--neutral-border); }

      .rfor__detail-headline {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 10px;
      }
      .rfor__detail-runid code {
        font-family: ui-monospace, monospace;
        font-size: 12px;
        color: var(--ink-6);
      }

      .rfor__detail-dl {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 8px;
        margin: 0 0 14px;
      }
      .rfor__detail-dl > div { font-size: 12.5px; }
      .rfor__detail-dl dt {
        font-weight: 600;
        color: var(--ink-7);
        margin-bottom: 2px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .rfor__detail-dl dd {
        margin: 0;
        color: var(--ink-9);
      }
      .rfor__detail-dl code {
        font-family: ui-monospace, monospace;
        font-size: 11.5px;
        background: var(--ink-2);
        padding: 1px 5px;
        border-radius: 3px;
      }

      .rfor__sub-title {
        margin: 16px 0 8px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ink-7);
      }

      .rfor__signal-list,
      .rfor__quote-list,
      .rfor__event-list,
      .rfor__raw-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .rfor__signal-list li,
      .rfor__event-list li {
        font-size: 12px;
        padding: 6px 10px;
        background: var(--ink-2);
        border-radius: 6px;
      }
      .rfor__signal-excerpt {
        font-size: 11px;
        color: var(--ink-6);
        margin-top: 4px;
        font-style: italic;
      }
      .rfor__quote-list li {
        font-size: 11.5px;
        padding: 6px 10px;
        background: var(--bad-bg);
        border-radius: 6px;
        border: 1px solid var(--bad-border);
      }
      .rfor__quote-list code {
        font-family: ui-monospace, monospace;
        font-size: 11px;
        color: var(--ink-9);
        background: transparent;
      }

      .rfor__raw-list li {
        margin-bottom: 8px;
        font-size: 12.5px;
      }
      .rfor__raw-list code {
        font-family: ui-monospace, monospace;
        font-size: 11.5px;
        background: var(--ink-2);
        padding: 1px 5px;
        border-radius: 3px;
      }
      .rfor__pre {
        background: var(--ink-2);
        border-radius: 6px;
        padding: 8px 10px;
        font-family: ui-monospace, monospace;
        font-size: 11px;
        max-height: 200px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        margin: 4px 0 0;
      }
      .rfor__signal-list code {
        font-family: ui-monospace, monospace;
        font-size: 11px;
        background: var(--card);
        padding: 1px 4px;
        border-radius: 3px;
        border: 1px solid var(--ink-3);
      }
      .rfor__event-list code {
        font-family: ui-monospace, monospace;
        font-size: 11px;
        background: transparent;
      }

      .rfor__p0-callout {
        margin: 8px 0;
        padding: 10px 14px;
        background: var(--bad-bg);
        border-left: 4px solid var(--bad);
        border-radius: 4px;
        font-size: 12.5px;
        color: var(--ink-9);
      }
      .rfor__p0-callout code {
        font-family: ui-monospace, monospace;
        font-size: 11.5px;
        background: var(--card);
        padding: 1px 5px;
        border-radius: 3px;
      }

      .rfor__markdown {
        width: 100%;
        min-height: 280px;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid var(--ink-3);
        background: var(--ink-2);
        font-family: ui-monospace, monospace;
        font-size: 11.5px;
        resize: vertical;
      }

      .rfor__link {
        color: var(--ink-9);
        text-decoration: underline;
      }

      .rfor__muted {
        color: var(--ink-6);
        font-size: 12px;
      }
    `}</style>
  );
}
