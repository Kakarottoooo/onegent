/**
 * /dev/runtime-forensics - Provider Runtime Forensics Workbench (UX v2).
 *
 * Read-only triage dashboard backed by /api/dev/runtime-forensics. V1 is
 * artifact-based: parses benchmark/runs/*.json + an optional codex-worker.log
 * excerpt + (optional) static fixtures from
 * lib/runtime-forensics/__fixtures__/. NO live runs, NO retry buttons,
 * NO worker control. Source of truth is still DB + worker log + screenshots.
 *
 * UX v2 highlights:
 *  - multi-select chips for providers / classes / severities
 *  - hide-unknown toggle
 *  - show-fixtures toggle (?examples=1) tagged [FIXTURE]
 *  - sortable column headers (severity / updatedAt / provider / scenario)
 *  - URL state roundtrip preserves all filter + sort state
 *  - detail drawer: source-of-truth reminder, signal grouping by source,
 *    step-shape audit with missing-source highlighting, copy buttons,
 *    recommended-next-evidence checklist + PowerShell commands
 *  - ASCII-only markers (no emoji) — uses [P0], [!], [FIXTURE], etc.
 */

"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  FAILURE_CLASS_LABEL,
  FAILURE_CLASS_TONE,
  FAILURE_CLASS_SEVERITY,
  FORENSICS_SEVERITY_LABEL,
  type ClassifierSignal,
  type FailureClass,
  type ForensicsReport,
  type ForensicsSeverity,
  type ForensicsSummary,
  type StepShapeAuditRow,
} from "@/lib/runtime-forensics/types";
import {
  DEFAULT_FILTER_STATE,
  parseFiltersFromQuery,
  serializeFiltersToString,
  type FilterState,
  type SortDir,
  type SortKey,
} from "@/lib/runtime-forensics/url-filter";
import type {
  Pointer,
  Recommendation,
  SearchCommand,
} from "@/lib/runtime-forensics/recommendations";

interface ListResponse {
  summaries: ForensicsSummary[];
  total: number;
  workerLogAvailable: boolean;
  workerLogPathHint: string;
  benchmarkRunsScanned: number;
  fixturesLoaded: number;
  fixturesEnabled: boolean;
  loaderNotes: string[];
  filterWarnings: string[];
  canonicalQuery: string;
  sourceCaveat: string;
}

interface DetailResponse {
  report: ForensicsReport;
  summary: ForensicsSummary;
  recommendation: Recommendation;
  markdown: string;
  workerLogAvailable: boolean;
  workerLogPathHint: string;
}

const FAILURE_CLASS_OPTIONS: ReadonlyArray<FailureClass> = [
  "legacy_shape_missing_source",
  "provider_form_incomplete",
  "model_or_env_blocked",
  "network_or_provider_5xx",
  "provider_no_availability",
  "otp_or_login_required",
  "checkout_reached_manual_review",
  "unknown",
];

const SEVERITY_OPTIONS: ReadonlyArray<ForensicsSeverity> = [
  "p0",
  "p1",
  "p2",
  "p3",
  "info",
];

const PROVIDER_OPTIONS = [
  "resy",
  "opentable",
  "expedia",
  "booking-com",
  "hotels-com",
];

const SOURCE_LABELS: Record<ClassifierSignal["source"], string> = {
  step_shape_audit: "Step shape audit",
  status_field: "Status field",
  error_message: "Error message",
  terminal_reason: "Terminal reason",
  terminal_code: "Terminal code",
  step_error: "Step.error",
  decision_log: "Decision log",
  raw_worker_log: "Worker log",
};

export default function RuntimeForensicsPage() {
  return (
    <Suspense fallback={<div className="rfor__loading">Loading filters...</div>}>
      <RuntimeForensicsClient />
    </Suspense>
  );
}

function RuntimeForensicsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // --- Filter state (URL-driven) ---
  const filterStateRef = useRef<FilterState>(DEFAULT_FILTER_STATE);
  const [filterState, setFilterState] = useState<FilterState>(() => {
    const parsed = parseFiltersFromQuery(searchParams ?? null);
    filterStateRef.current = parsed.state;
    return parsed.state;
  });

  // Pull URL changes back into state on navigation events.
  useEffect(() => {
    const parsed = parseFiltersFromQuery(searchParams ?? null);
    if (
      JSON.stringify(parsed.state) !==
      JSON.stringify(filterStateRef.current)
    ) {
      filterStateRef.current = parsed.state;
      setFilterState(parsed.state);
    }
  }, [searchParams]);

  const updateFilters = useCallback(
    (updater: (prev: FilterState) => FilterState) => {
      const next = updater(filterStateRef.current);
      filterStateRef.current = next;
      setFilterState(next);
      const qs = serializeFiltersToString(next);
      const nextUrl = qs.length > 0 ? `?${qs}` : "/dev/runtime-forensics";
      router.replace(nextUrl, { scroll: false });
    },
    [router],
  );

  // --- List state ---
  const [list, setList] = useState<ListResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // --- Detail state ---
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const qs = serializeFiltersToString(filterStateRef.current);
      const url = `/api/dev/runtime-forensics${qs.length > 0 ? `?${qs}` : ""}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          `GET list failed: ${res.status} ${body?.error?.message ?? ""}`,
        );
      }
      const data = (await res.json()) as ListResponse;
      setList(data);
    } catch (err) {
      setListError((err as Error).message);
      setList(null);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList, filterState]);

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
        throw new Error(
          `GET detail failed: ${res.status} ${body?.error?.message ?? ""}`,
        );
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

  return (
    <main className="rfor">
      <header className="rfor__top">
        <div className="rfor__breadcrumb">
          <a href="/dev">/dev</a>
          <span> / </span>
          <span>runtime-forensics</span>
        </div>
        <h1 className="rfor__title">Provider Runtime Forensics</h1>
        <p className="rfor__subtitle">
          Read-only triage workbench. Parses{" "}
          <code>benchmark/runs/*.json</code>,{" "}
          <code>worker/.debug-screenshots/</code>, and an optional{" "}
          <code>codex-worker.log</code> excerpt to pre-classify provider
          failures across 8 categories. <strong>No live runs, no retry,
          no worker control.</strong>
        </p>
        <div className="rfor__caveat">
          <strong>[V1]</strong> Artifact-based. Source of truth is still
          the DB + worker log + screenshots, NOT this page. DB live lookup
          is a future source (codex domain).
        </div>
      </header>

      <FilterRail
        state={filterState}
        onChange={updateFilters}
        list={list}
      />

      <section className="rfor__section">
        <div className="rfor__section-head">
          <h2 className="rfor__section-title">
            Jobs {list ? `(${list.total})` : ""}
          </h2>
          <div className="rfor__meta-inline">
            {list?.fixturesEnabled && list.fixturesLoaded > 0 && (
              <span className="rfor__pill rfor__pill--fixture">
                {list.fixturesLoaded} fixture rows visible
              </span>
            )}
          </div>
        </div>

        {listLoading && <div className="rfor__loading">Loading...</div>}
        {listError && <div className="rfor__error">{listError}</div>}

        {list && list.filterWarnings.length > 0 && (
          <div className="rfor__warning">
            <strong>URL filter warnings:</strong>
            <ul>
              {list.filterWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {!listLoading && list && list.total === 0 && (
          <EmptyState
            workerLogAvailable={list.workerLogAvailable}
            workerLogPathHint={list.workerLogPathHint}
            benchmarkRunsScanned={list.benchmarkRunsScanned}
            fixturesEnabled={list.fixturesEnabled}
            loaderNotes={list.loaderNotes}
            onShowFixtures={() =>
              updateFilters((s) => ({ ...s, showFixtures: true }))
            }
          />
        )}

        {list && list.total > 0 && (
          <JobTable
            summaries={list.summaries}
            activeJobId={activeJobId}
            sortKey={filterState.sortKey}
            sortDir={filterState.sortDir}
            onSort={(k) =>
              updateFilters((s) => {
                if (s.sortKey === k) {
                  return { ...s, sortDir: s.sortDir === "asc" ? "desc" : "asc" };
                }
                return { ...s, sortKey: k, sortDir: "desc" };
              })
            }
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
            )}{" "}
            / Path: <code>{list.workerLogPathHint}</code> / Benchmark runs
            scanned: {list.benchmarkRunsScanned} / Fixtures loaded:{" "}
            {list.fixturesLoaded}
          </div>
        )}
      </section>

      <section className="rfor__section">
        <h2 className="rfor__section-title">Detail</h2>
        {detailLoading && <div className="rfor__loading">Loading...</div>}
        {detailError && <div className="rfor__error">{detailError}</div>}
        {!detailLoading && !detail && !detailError && (
          <div className="rfor__empty">
            <p>
              Select a job above to see classification, step-shape audit,
              recommended next evidence, and the paste-ready markdown bug
              report.
            </p>
          </div>
        )}
        {detail && <DetailPanel detail={detail} />}
      </section>

      <RuntimeForensicsStyles />
    </main>
  );
}

/* --- Filter rail with multi-select chips --------------------------- */

function FilterRail({
  state,
  onChange,
  list,
}: {
  state: FilterState;
  onChange: (updater: (prev: FilterState) => FilterState) => void;
  list: ListResponse | null;
}) {
  return (
    <section className="rfor__filters">
      <div className="rfor__filter-head">
        <h2 className="rfor__section-title">Filter</h2>
        <button
          type="button"
          className="rfor__btn-tiny"
          onClick={() => onChange(() => DEFAULT_FILTER_STATE)}
        >
          Clear all
        </button>
      </div>

      <ChipGroup
        label="Provider"
        options={PROVIDER_OPTIONS}
        selected={state.providers}
        onToggle={(v) =>
          onChange((s) => ({
            ...s,
            providers: toggleString(s.providers, v),
          }))
        }
      />
      <ChipGroup
        label="Classification"
        options={FAILURE_CLASS_OPTIONS as readonly string[]}
        labelFor={(v) => FAILURE_CLASS_LABEL[v as FailureClass] ?? v}
        selected={state.classes as readonly string[]}
        onToggle={(v) =>
          onChange((s) => ({
            ...s,
            classes: toggleString(s.classes, v as FailureClass) as FailureClass[],
          }))
        }
      />
      <ChipGroup
        label="Severity"
        options={SEVERITY_OPTIONS as readonly string[]}
        labelFor={(v) => `[${FORENSICS_SEVERITY_LABEL[v as ForensicsSeverity]}]`}
        selected={state.severities as readonly string[]}
        onToggle={(v) =>
          onChange((s) => ({
            ...s,
            severities: toggleString(s.severities, v as ForensicsSeverity) as ForensicsSeverity[],
          }))
        }
      />

      <div className="rfor__filter-toggles">
        <label>
          <input
            type="checkbox"
            checked={state.hideUnknown}
            onChange={(e) =>
              onChange((s) => ({ ...s, hideUnknown: e.target.checked }))
            }
          />
          Hide <code>unknown</code> rows
        </label>
        <label>
          <input
            type="checkbox"
            checked={state.showFixtures}
            onChange={(e) =>
              onChange((s) => ({ ...s, showFixtures: e.target.checked }))
            }
          />
          Show <code>[FIXTURE]</code> example rows{" "}
          {list && list.fixturesEnabled && list.fixturesLoaded > 0 ? (
            <span className="rfor__hint">
              ({list.fixturesLoaded} synthetic, never confused with real
              evidence)
            </span>
          ) : null}
        </label>
      </div>

      {list && list.canonicalQuery.length > 0 && (
        <div className="rfor__filter-share">
          Share URL:
          <CopyButton
            label="Copy filter URL"
            value={
              typeof window !== "undefined"
                ? `${window.location.origin}/dev/runtime-forensics?${list.canonicalQuery}`
                : `/dev/runtime-forensics?${list.canonicalQuery}`
            }
          />
        </div>
      )}
    </section>
  );
}

function ChipGroup({
  label,
  options,
  labelFor,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly string[];
  labelFor?: (v: string) => string;
  selected: readonly string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="rfor__chip-row">
      <span className="rfor__chip-row-label">{label}</span>
      <div className="rfor__chips">
        {options.map((v) => {
          const active = selected.includes(v);
          return (
            <button
              key={v}
              type="button"
              className={
                active ? "rfor__chip rfor__chip--active" : "rfor__chip"
              }
              onClick={() => onToggle(v)}
            >
              {labelFor ? labelFor(v) : v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function toggleString<T extends string>(arr: ReadonlyArray<T>, v: T): T[] {
  if (arr.includes(v)) return arr.filter((x) => x !== v);
  return [...arr, v];
}

/* --- Empty state --------------------------------------------------- */

function EmptyState({
  workerLogAvailable,
  workerLogPathHint,
  benchmarkRunsScanned,
  fixturesEnabled,
  loaderNotes,
  onShowFixtures,
}: {
  workerLogAvailable: boolean;
  workerLogPathHint: string;
  benchmarkRunsScanned: number;
  fixturesEnabled: boolean;
  loaderNotes: string[];
  onShowFixtures: () => void;
}) {
  return (
    <div className="rfor__empty">
      <p>
        <strong>No artifact rows match the current filters.</strong>
      </p>
      <ul className="rfor__empty-list">
        <li>
          Benchmark runs scanned: <strong>{benchmarkRunsScanned}</strong>{" "}
          {benchmarkRunsScanned === 0 && (
            <em>
              - place files at <code>benchmark/runs/*.json</code> for the
              loader to find.
            </em>
          )}
        </li>
        <li>
          Worker log:{" "}
          {workerLogAvailable ? "present" : "absent"} (path:{" "}
          <code>{workerLogPathHint}</code>). Override with the{" "}
          <code>WORKER_LOG_PATH</code> env var. Codex's path is{" "}
          <code>C:\Users\Gzw19\onegent-e2e-20260503\codex-worker.log</code>.
        </li>
        {!fixturesEnabled && (
          <li>
            Or click{" "}
            <button
              type="button"
              className="rfor__btn-tiny"
              onClick={onShowFixtures}
            >
              Show [FIXTURE] examples
            </button>{" "}
            to see synthetic example rows that demonstrate every
            classification.
          </li>
        )}
      </ul>
      {loaderNotes.length > 0 && (
        <details className="rfor__loader-notes">
          <summary>Loader notes ({loaderNotes.length})</summary>
          <ul>
            {loaderNotes.map((n) => (
              <li key={n}>
                <code>{n}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/* --- Job table ----------------------------------------------------- */

function JobTable({
  summaries,
  activeJobId,
  sortKey,
  sortDir,
  onSort,
  onSelect,
}: {
  summaries: ForensicsSummary[];
  activeJobId: string | null;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  onSelect: (jobId: string) => void;
}) {
  return (
    <div className="rfor__table-wrap">
      <table className="rfor__table">
        <thead>
          <tr>
            <th>Job id</th>
            <SortableHeader
              k="provider"
              label="Provider"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              k="scenario"
              label="Scenario"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
            />
            <th>Status</th>
            <th>Classification</th>
            <SortableHeader
              k="severity"
              label="Severity"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              k="updatedAt"
              label="Age"
              activeKey={sortKey}
              dir={sortDir}
              onSort={onSort}
            />
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
                key={(s.jobId ?? "noid") + ":" + s.scenario + ":" + s.inputSource}
                className={
                  s.hasLegacyShapeBug
                    ? "rfor__row--p0"
                    : isActive
                    ? "rfor__row--active"
                    : undefined
                }
              >
                <td>
                  <code className="rfor__cell-mono">
                    {s.isFixture && (
                      <span className="rfor__tag rfor__tag--fixture">
                        [FIXTURE]
                      </span>
                    )}
                    {s.jobId ?? "(none)"}
                  </code>
                </td>
                <td>{s.provider}</td>
                <td>{s.scenario}</td>
                <td>{s.status}</td>
                <td>
                  <span className={`rfor__pill rfor__pill--${tone}`}>
                    {s.hasLegacyShapeBug ? "[!] " : ""}
                    {FAILURE_CLASS_LABEL[s.primaryClass]}
                  </span>
                </td>
                <td>
                  <SeverityChip severity={s.severity} />
                </td>
                <td>{formatAge(s.ageSeconds)}</td>
                <td>
                  {s.taskId && !s.isFixture ? (
                    <a
                      className="rfor__link"
                      href={`/tasks/${encodeURIComponent(s.taskId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      open task
                    </a>
                  ) : (
                    <span className="rfor__hint">{s.taskId ?? "-"}</span>
                  )}
                </td>
                <td>
                  {s.jobId && (
                    <button
                      type="button"
                      className="rfor__btn-tiny"
                      onClick={() => onSelect(s.jobId as string)}
                    >
                      Inspect
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({
  k,
  label,
  activeKey,
  dir,
  onSort,
}: {
  k: SortKey;
  label: string;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const isActive = k === activeKey;
  const indicator = isActive ? (dir === "asc" ? "  ^" : "  v") : "  -";
  return (
    <th>
      <button
        type="button"
        className={
          isActive
            ? "rfor__sort-header rfor__sort-header--active"
            : "rfor__sort-header"
        }
        onClick={() => onSort(k)}
        title={`Sort by ${label}`}
      >
        {label}
        <span className="rfor__sort-indicator">{indicator}</span>
      </button>
    </th>
  );
}

function SeverityChip({ severity }: { severity: ForensicsSeverity }) {
  return (
    <span className={`rfor__sev rfor__sev--${severity}`}>
      [{FORENSICS_SEVERITY_LABEL[severity]}]
    </span>
  );
}

/* --- Detail panel -------------------------------------------------- */

function DetailPanel({ detail }: { detail: DetailResponse }) {
  const r = detail.report;
  return (
    <div className="rfor__detail">
      <SourceOfTruthBlock report={r} />

      <div className="rfor__detail-head">
        <h3 className="rfor__detail-title">
          {r.isFixture && (
            <span className="rfor__tag rfor__tag--fixture">[FIXTURE]</span>
          )}
          <span className={`rfor__sev rfor__sev--${r.classification.severity}`}>
            [{FORENSICS_SEVERITY_LABEL[r.classification.severity]}]
          </span>
          {r.stepShape.hasLegacyShapeBug ? " [!] " : " "}
          {FAILURE_CLASS_LABEL[r.classification.primaryClass]}
        </h3>
        <div className="rfor__detail-meta">
          <span>
            Job id: <code>{r.jobId ?? "(none)"}</code>{" "}
            {r.jobId && <CopyButton label="Copy id" value={r.jobId} small />}
          </span>
          {r.taskId && (
            <span>
              Task id: <code>{r.taskId}</code>{" "}
              <CopyButton label="Copy id" value={r.taskId} small />
            </span>
          )}
          <span>
            Provider: <code>{r.provider}</code>
          </span>
          <span>
            Scenario: <code>{r.scenario}</code>
          </span>
          <span>
            Status: <code>{r.status}</code>
          </span>
          <span>
            Source: <code>{r.inputSource}</code>
          </span>
        </div>
      </div>

      <RecommendationPanel rec={detail.recommendation} />

      <SignalsBySourceBlock
        signals={r.classification.signals}
        perClassWeights={r.classification.perClassWeights}
      />

      <StepShapeBlock stepShape={r.stepShape} />

      <RawTerminalFields report={r} />

      <DecisionLogBlock summary={r.decisionLogSummary} />

      <CrossReferences hints={r.hints} />

      <MarkdownBlock markdown={detail.markdown} />
    </div>
  );
}

function SourceOfTruthBlock({ report }: { report: ForensicsReport }) {
  return (
    <div className="rfor__sot">
      <strong>Source of truth (verify before filing):</strong>
      <ol className="rfor__sot-list">
        <li>
          <strong>DB</strong>: <code>booking_jobs</code> row
          {report.jobId && (
            <>
              {" "}
              for <code>id = {report.jobId}</code>
            </>
          )}
          {" - "}check <code>steps[0].body.__source</code>,{" "}
          <code>terminalReason</code>, <code>terminalCode</code>.
        </li>
        <li>
          <strong>Worker log</strong>: tail{" "}
          <code>codex-worker.log</code> via <code>Select-String</code> on
          jobId / scenario / provider tag.
        </li>
        <li>
          <strong>Debug screenshots</strong>:{" "}
          <code>worker/.debug-screenshots/{report.provider}/&lt;run&gt;/</code>{" "}
          (page.png + page.html + summary.json).
        </li>
        <li>
          <strong>Playbook</strong>:{" "}
          <code>docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md</code>
        </li>
      </ol>
      {report.isFixture && (
        <div className="rfor__sot-fixture">
          [FIXTURE] This is a synthetic example, not real evidence. Do not
          file bugs against this row.
        </div>
      )}
    </div>
  );
}

function RecommendationPanel({ rec }: { rec: Recommendation }) {
  return (
    <div className="rfor__rec">
      <h4>Recommended next evidence</h4>
      <ol className="rfor__rec-list">
        {rec.baseChecklist.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      {rec.pointers.length > 0 && (
        <div className="rfor__rec-pointers">
          <strong>Pointers:</strong>
          <ul>
            {rec.pointers.map((p) => (
              <PointerItem key={p.label + p.ref} pointer={p} />
            ))}
          </ul>
        </div>
      )}
      {rec.searchCommands.length > 0 && (
        <div className="rfor__rec-cmds">
          <strong>Suggested worker-log searches (PowerShell):</strong>
          <ul>
            {rec.searchCommands.map((c) => (
              <SearchCommandItem key={c.command} cmd={c} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PointerItem({ pointer }: { pointer: Pointer }) {
  return (
    <li>
      <span className={`rfor__ptr-kind rfor__ptr-kind--${pointer.kind}`}>
        [{pointer.kind}]
      </span>{" "}
      <strong>{pointer.label}</strong> -{" "}
      <code>{pointer.ref}</code>
    </li>
  );
}

function SearchCommandItem({ cmd }: { cmd: SearchCommand }) {
  return (
    <li className="rfor__cmd">
      <div className="rfor__cmd-desc">{cmd.description}</div>
      <pre className="rfor__cmd-code">{cmd.command}</pre>
      <CopyButton label="Copy command" value={cmd.command} small />
    </li>
  );
}

function SignalsBySourceBlock({
  signals,
  perClassWeights,
}: {
  signals: ClassifierSignal[];
  perClassWeights: Partial<Record<FailureClass, number>>;
}) {
  const grouped = useMemo(() => groupSignalsBySource(signals), [signals]);
  const weightEntries = Object.entries(perClassWeights)
    .filter(([, v]) => typeof v === "number" && (v as number) > 0)
    .sort((a, b) => (b[1] as number) - (a[1] as number));

  return (
    <details className="rfor__block" open>
      <summary>
        Signals ({signals.length}, grouped by source)
      </summary>
      {signals.length === 0 && <p>(no matched signals - classifier returned unknown)</p>}
      {weightEntries.length > 0 && (
        <div className="rfor__weights">
          <strong>Per-class weight:</strong>
          {weightEntries.map(([k, v]) => (
            <span key={k} className="rfor__weight">
              {k}: {(v as number).toFixed(2)}
            </span>
          ))}
        </div>
      )}
      {Array.from(grouped.entries()).map(([src, sigs]) => (
        <div key={src} className="rfor__source-group">
          <h5>{SOURCE_LABELS[src as ClassifierSignal["source"]] ?? src}</h5>
          <ul>
            {sigs.map((s, i) => (
              <li key={`${s.label}-${i}`}>
                <span className="rfor__signal-weight">
                  [{s.weight.toFixed(2)}]
                </span>{" "}
                <span className={`rfor__pill rfor__pill--${FAILURE_CLASS_TONE[s.supportsClass]}`}>
                  [{FAILURE_CLASS_SEVERITY[s.supportsClass]}]
                </span>{" "}
                <strong>{s.label}</strong>
                {s.excerpt && (
                  <pre className="rfor__excerpt">{s.excerpt}</pre>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}

function groupSignalsBySource(
  signals: ClassifierSignal[],
): Map<string, ClassifierSignal[]> {
  const m = new Map<string, ClassifierSignal[]>();
  for (const s of signals) {
    const arr = m.get(s.source) ?? [];
    arr.push(s);
    m.set(s.source, arr);
  }
  // Sort each group by weight desc.
  for (const arr of m.values()) {
    arr.sort((a, b) => b.weight - a.weight);
  }
  return m;
}

function StepShapeBlock({
  stepShape,
}: {
  stepShape: { totalSteps: number; stepsWithSourceMarker: number; stepsMissingSourceMarker: number; hasLegacyShapeBug: boolean; rows: StepShapeAuditRow[]; legacyShapeQuotes: string[] };
}) {
  return (
    <details className="rfor__block" open={stepShape.hasLegacyShapeBug}>
      <summary>
        Step shape audit (
        {stepShape.totalSteps} steps,{" "}
        {stepShape.stepsMissingSourceMarker} missing __source)
        {stepShape.hasLegacyShapeBug && " [!] LEGACY SHAPE DETECTED"}
      </summary>
      {stepShape.rows.length === 0 ? (
        <p>(no steps in this job)</p>
      ) : (
        <table className="rfor__step-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>__source</th>
              <th>Marker</th>
              <th>Legacy phrase?</th>
              <th>Error excerpt</th>
            </tr>
          </thead>
          <tbody>
            {stepShape.rows.map((row) => (
              <tr
                key={row.index}
                className={
                  !row.hasSourceMarker ? "rfor__step-row--missing" : undefined
                }
              >
                <td>{row.index}</td>
                <td>{row.name}</td>
                <td>
                  {row.hasSourceMarker ? (
                    <span className="rfor__ok">yes</span>
                  ) : (
                    <span className="rfor__bad">[!] missing</span>
                  )}
                </td>
                <td>
                  <code>{row.sourceMarker ?? "-"}</code>
                </td>
                <td>{row.errorMentionsLegacyShape ? "yes" : "no"}</td>
                <td>
                  {row.errorExcerpt ? (
                    <code className="rfor__cell-mono">{row.errorExcerpt}</code>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {stepShape.legacyShapeQuotes.length > 0 && (
        <div className="rfor__quotes">
          <strong>Legacy-shape quotes:</strong>
          <ul>
            {stepShape.legacyShapeQuotes.map((q) => (
              <li key={q}>
                <code>{q}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

function RawTerminalFields({ report }: { report: ForensicsReport }) {
  if (
    !report.rawTerminalReason &&
    !report.rawTerminalCode &&
    !report.rawErrorMessage
  ) {
    return null;
  }
  return (
    <details className="rfor__block">
      <summary>Raw terminal fields</summary>
      {report.rawTerminalReason && (
        <div>
          <strong>terminalReason:</strong>
          <pre>{report.rawTerminalReason}</pre>
        </div>
      )}
      {report.rawTerminalCode && (
        <div>
          <strong>terminalCode:</strong> <code>{report.rawTerminalCode}</code>
        </div>
      )}
      {report.rawErrorMessage && (
        <div>
          <strong>errorMessage:</strong>
          <pre>{report.rawErrorMessage}</pre>
        </div>
      )}
    </details>
  );
}

function DecisionLogBlock({
  summary,
}: {
  summary: { totalEntries: number; byLevel: Partial<Record<string, number>>; topEvents: Array<{ event: string; count: number }>; excerpts: Array<{ at?: string | null; level?: string | null; event?: string | null; message?: string | null }>; notableSignals: string[] };
}) {
  if (summary.totalEntries === 0) return null;
  return (
    <details className="rfor__block">
      <summary>
        Decision log ({summary.totalEntries} entries)
      </summary>
      <div>
        <strong>Levels:</strong>{" "}
        {Object.entries(summary.byLevel)
          .filter(([, v]) => typeof v === "number" && (v as number) > 0)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ") || "(none)"}
      </div>
      {summary.topEvents.length > 0 && (
        <div>
          <strong>Top events:</strong>
          <ul>
            {summary.topEvents.map((e) => (
              <li key={e.event}>
                <code>{e.event}</code> x {e.count}
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.notableSignals.length > 0 && (
        <div>
          <strong>Notable signals:</strong>{" "}
          {summary.notableSignals.map((s) => (
            <code key={s} style={{ marginRight: 8 }}>
              {s}
            </code>
          ))}
        </div>
      )}
      {summary.excerpts.length > 0 && (
        <div>
          <strong>Excerpts (first 6 / last 6):</strong>
          <ul className="rfor__log-excerpts">
            {summary.excerpts.map((e, i) => (
              <li key={i}>
                <code>{e.at ?? ""}</code>{" "}
                <span>[{e.level ?? "info"}]</span>{" "}
                <strong>{e.event ?? ""}</strong>{" "}
                {e.message && <em>{e.message}</em>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

function CrossReferences({
  hints,
}: {
  hints: { hasScreenshots: boolean; screenshotsRel?: string; benchmarkReportFile?: string; taskPagePath?: string };
}) {
  if (!hints.hasScreenshots && !hints.benchmarkReportFile && !hints.taskPagePath) {
    return null;
  }
  return (
    <details className="rfor__block">
      <summary>Cross references</summary>
      <ul>
        {hints.taskPagePath && (
          <li>
            Task page: <code>{hints.taskPagePath}</code>
          </li>
        )}
        {hints.benchmarkReportFile && (
          <li>
            Benchmark report:{" "}
            <code>benchmark/runs/{hints.benchmarkReportFile}</code>
          </li>
        )}
        {hints.hasScreenshots && (
          <li>
            Screenshots:{" "}
            <code>{hints.screenshotsRel ?? "worker/.debug-screenshots/"}</code>
          </li>
        )}
      </ul>
    </details>
  );
}

function MarkdownBlock({ markdown }: { markdown: string }) {
  return (
    <details className="rfor__block" open>
      <summary>Paste-ready markdown bug report</summary>
      <CopyButton label="Copy markdown" value={markdown} />
      <textarea
        readOnly
        className="rfor__markdown"
        value={markdown}
        rows={Math.min(40, markdown.split("\n").length + 2)}
      />
    </details>
  );
}

/* --- Copy button --------------------------------------------------- */

function CopyButton({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // Clipboard API unavailable - leave state alone; user can manually
      // select the textarea.
    }
  }, [value]);
  return (
    <button
      type="button"
      className={
        small ? "rfor__btn-tiny" : "rfor__btn"
      }
      onClick={onClick}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/* --- Helpers ------------------------------------------------------- */

function formatAge(ageSeconds: number | null): string {
  if (ageSeconds === null) return "-";
  if (ageSeconds < 60) return `${ageSeconds}s`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h`;
  return `${Math.floor(ageSeconds / 86400)}d`;
}

/* --- Inline styles ------------------------------------------------- */

function RuntimeForensicsStyles() {
  return (
    <style jsx global>{`
      .rfor {
        max-width: 1480px;
        margin: 0 auto;
        padding: 24px 32px 64px;
        font: 14px / 1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          sans-serif;
        color: #111;
      }
      .rfor__breadcrumb {
        font-size: 13px;
        color: #666;
        margin-bottom: 12px;
      }
      .rfor__breadcrumb a {
        color: #2563eb;
        text-decoration: none;
      }
      .rfor__title {
        font-size: 26px;
        margin: 0 0 8px;
      }
      .rfor__subtitle {
        margin: 0 0 12px;
        color: #444;
      }
      .rfor__caveat {
        background: #fff7ed;
        border: 1px solid #fed7aa;
        padding: 10px 14px;
        border-radius: 6px;
        font-size: 13px;
        color: #7c2d12;
      }
      .rfor__filters {
        margin: 24px 0 16px;
        padding: 16px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
      }
      .rfor__filter-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .rfor__chip-row {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 8px;
      }
      .rfor__chip-row-label {
        flex: 0 0 110px;
        font-weight: 600;
        font-size: 12px;
        color: #475569;
        padding-top: 6px;
      }
      .rfor__chips {
        flex: 1;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .rfor__chip {
        background: #fff;
        border: 1px solid #cbd5e1;
        border-radius: 16px;
        padding: 4px 12px;
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
        color: #334155;
      }
      .rfor__chip:hover {
        background: #f1f5f9;
      }
      .rfor__chip--active {
        background: #1e293b;
        color: #fff;
        border-color: #1e293b;
      }
      .rfor__filter-toggles {
        display: flex;
        gap: 24px;
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px dashed #cbd5e1;
        flex-wrap: wrap;
      }
      .rfor__filter-toggles label {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: #334155;
      }
      .rfor__filter-share {
        margin-top: 12px;
        font-size: 12px;
        color: #475569;
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .rfor__hint {
        color: #64748b;
        font-size: 12px;
      }
      .rfor__section {
        margin: 24px 0;
      }
      .rfor__section-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .rfor__section-title {
        font-size: 16px;
        margin: 0 0 8px;
        color: #0f172a;
      }
      .rfor__loading {
        color: #64748b;
        padding: 8px;
      }
      .rfor__error {
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #991b1b;
        padding: 8px 12px;
        border-radius: 6px;
        margin: 8px 0;
      }
      .rfor__warning {
        background: #fffbeb;
        border: 1px solid #fde68a;
        color: #92400e;
        padding: 8px 12px;
        border-radius: 6px;
        margin: 8px 0;
        font-size: 13px;
      }
      .rfor__warning ul {
        margin: 4px 0 0;
        padding-left: 18px;
      }
      .rfor__empty {
        background: #f8fafc;
        border: 1px dashed #cbd5e1;
        padding: 16px;
        border-radius: 8px;
        color: #475569;
      }
      .rfor__empty-list {
        margin: 8px 0 0;
        padding-left: 20px;
      }
      .rfor__loader-notes {
        margin-top: 10px;
        font-size: 12px;
      }
      .rfor__table-wrap {
        overflow-x: auto;
      }
      .rfor__table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        overflow: hidden;
      }
      .rfor__table th,
      .rfor__table td {
        text-align: left;
        padding: 8px 10px;
        border-bottom: 1px solid #f1f5f9;
        vertical-align: top;
      }
      .rfor__table th {
        background: #f8fafc;
        font-weight: 600;
        color: #475569;
      }
      .rfor__sort-header {
        background: none;
        border: 0;
        padding: 0;
        font: inherit;
        color: inherit;
        cursor: pointer;
        font-weight: 600;
      }
      .rfor__sort-header--active {
        color: #1e293b;
      }
      .rfor__sort-indicator {
        font-family: ui-monospace, monospace;
        color: #94a3b8;
      }
      .rfor__row--p0 td {
        background: #fef2f2;
        border-bottom: 1px solid #fecaca;
      }
      .rfor__row--active td {
        background: #eff6ff;
      }
      .rfor__cell-mono {
        font-family: ui-monospace, monospace;
        font-size: 12px;
      }
      .rfor__pill {
        display: inline-block;
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 12px;
        font-weight: 600;
      }
      .rfor__pill--bad {
        background: #fee2e2;
        color: #991b1b;
      }
      .rfor__pill--warn {
        background: #fef3c7;
        color: #92400e;
      }
      .rfor__pill--good {
        background: #d1fae5;
        color: #065f46;
      }
      .rfor__pill--neutral {
        background: #e2e8f0;
        color: #1e293b;
      }
      .rfor__pill--fixture {
        background: #ede9fe;
        color: #5b21b6;
      }
      .rfor__sev {
        display: inline-block;
        font-family: ui-monospace, monospace;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 3px;
        font-weight: 600;
      }
      .rfor__sev--p0 {
        background: #991b1b;
        color: #fff;
      }
      .rfor__sev--p1 {
        background: #b45309;
        color: #fff;
      }
      .rfor__sev--p2 {
        background: #075985;
        color: #fff;
      }
      .rfor__sev--p3 {
        background: #4b5563;
        color: #fff;
      }
      .rfor__sev--info {
        background: #d1d5db;
        color: #1f2937;
      }
      .rfor__tag {
        display: inline-block;
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 3px;
        font-weight: 700;
        margin-right: 4px;
        font-family: ui-monospace, monospace;
      }
      .rfor__tag--fixture {
        background: #c4b5fd;
        color: #4c1d95;
      }
      .rfor__btn {
        background: #1e293b;
        color: #fff;
        border: 0;
        padding: 6px 14px;
        font-size: 13px;
        border-radius: 6px;
        cursor: pointer;
        font-family: inherit;
      }
      .rfor__btn:hover {
        background: #0f172a;
      }
      .rfor__btn-tiny {
        background: #fff;
        border: 1px solid #cbd5e1;
        color: #1e293b;
        padding: 2px 10px;
        font-size: 11px;
        border-radius: 4px;
        cursor: pointer;
        font-family: inherit;
      }
      .rfor__btn-tiny:hover {
        background: #f1f5f9;
      }
      .rfor__link {
        color: #2563eb;
        text-decoration: none;
      }
      .rfor__link:hover {
        text-decoration: underline;
      }
      .rfor__meta {
        margin-top: 8px;
        font-size: 12px;
        color: #64748b;
      }
      .rfor__meta-good {
        color: #047857;
      }
      .rfor__meta-warn {
        color: #b45309;
      }
      .rfor__meta-inline {
        font-size: 12px;
        color: #475569;
      }
      .rfor__detail {
        background: #fff;
        border: 1px solid #e2e8f0;
        padding: 16px;
        border-radius: 8px;
      }
      .rfor__sot {
        background: #f0fdf4;
        border-left: 3px solid #16a34a;
        padding: 12px 14px;
        border-radius: 4px;
        margin-bottom: 16px;
        font-size: 12px;
        color: #166534;
      }
      .rfor__sot-list {
        margin: 6px 0 0;
        padding-left: 22px;
      }
      .rfor__sot-fixture {
        margin-top: 8px;
        background: #ede9fe;
        color: #5b21b6;
        padding: 6px 10px;
        border-radius: 4px;
        font-weight: 600;
      }
      .rfor__detail-head {
        margin-bottom: 16px;
      }
      .rfor__detail-title {
        font-size: 18px;
        margin: 0 0 8px;
      }
      .rfor__detail-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        font-size: 12px;
        color: #475569;
      }
      .rfor__rec {
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        padding: 12px 16px;
        border-radius: 6px;
        margin-bottom: 16px;
      }
      .rfor__rec h4 {
        margin: 0 0 8px;
        font-size: 14px;
        color: #1e3a8a;
      }
      .rfor__rec-list {
        margin: 0 0 12px;
        padding-left: 22px;
      }
      .rfor__rec-pointers,
      .rfor__rec-cmds {
        margin-top: 12px;
      }
      .rfor__rec-cmds ul,
      .rfor__rec-pointers ul {
        margin: 6px 0 0;
        padding-left: 0;
        list-style: none;
      }
      .rfor__cmd {
        margin-bottom: 10px;
      }
      .rfor__cmd-desc {
        font-size: 12px;
        color: #475569;
        margin-bottom: 4px;
      }
      .rfor__cmd-code {
        font-family: ui-monospace, monospace;
        font-size: 12px;
        background: #0f172a;
        color: #e2e8f0;
        padding: 8px 10px;
        border-radius: 4px;
        margin: 0 0 4px;
        white-space: pre-wrap;
        word-break: break-all;
      }
      .rfor__ptr-kind {
        display: inline-block;
        font-family: ui-monospace, monospace;
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 3px;
        background: #e0e7ff;
        color: #3730a3;
      }
      .rfor__ptr-kind--file {
        background: #fef3c7;
        color: #78350f;
      }
      .rfor__ptr-kind--doc {
        background: #d1fae5;
        color: #064e3b;
      }
      .rfor__ptr-kind--screenshot {
        background: #fce7f3;
        color: #831843;
      }
      .rfor__ptr-kind--db {
        background: #dbeafe;
        color: #1e3a8a;
      }
      .rfor__block {
        margin-top: 16px;
      }
      .rfor__block summary {
        cursor: pointer;
        font-weight: 600;
        padding: 6px 0;
      }
      .rfor__weights {
        margin: 8px 0;
        font-size: 12px;
        color: #475569;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .rfor__weight {
        background: #f1f5f9;
        padding: 2px 8px;
        border-radius: 3px;
        font-family: ui-monospace, monospace;
      }
      .rfor__source-group {
        margin-top: 8px;
      }
      .rfor__source-group h5 {
        font-size: 12px;
        text-transform: uppercase;
        color: #475569;
        margin: 8px 0 4px;
        letter-spacing: 0.05em;
      }
      .rfor__source-group ul {
        margin: 0;
        padding-left: 18px;
      }
      .rfor__signal-weight {
        font-family: ui-monospace, monospace;
        color: #64748b;
        font-size: 11px;
      }
      .rfor__excerpt {
        font-family: ui-monospace, monospace;
        font-size: 11px;
        background: #f8fafc;
        color: #1e293b;
        padding: 6px 8px;
        border-radius: 3px;
        margin: 4px 0 0;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .rfor__step-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        margin-top: 8px;
      }
      .rfor__step-table th,
      .rfor__step-table td {
        text-align: left;
        padding: 6px 8px;
        border-bottom: 1px solid #f1f5f9;
        vertical-align: top;
      }
      .rfor__step-row--missing td {
        background: #fef2f2;
      }
      .rfor__ok {
        color: #047857;
        font-weight: 600;
      }
      .rfor__bad {
        color: #991b1b;
        font-weight: 700;
      }
      .rfor__quotes {
        margin-top: 8px;
        font-size: 12px;
      }
      .rfor__quotes ul {
        margin: 4px 0 0;
        padding-left: 18px;
      }
      .rfor__log-excerpts {
        margin: 6px 0 0;
        padding-left: 18px;
        font-size: 12px;
      }
      .rfor__log-excerpts code {
        font-size: 11px;
        color: #64748b;
      }
      .rfor__markdown {
        width: 100%;
        font-family: ui-monospace, monospace;
        font-size: 12px;
        background: #0f172a;
        color: #e2e8f0;
        padding: 12px;
        border-radius: 6px;
        margin-top: 8px;
        border: 1px solid #1e293b;
      }
      pre {
        margin: 4px 0;
        white-space: pre-wrap;
        word-break: break-word;
      }
    `}</style>
  );
}
