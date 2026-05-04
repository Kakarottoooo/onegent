"use client";

/**
 * /dev/founder-e2e — Phase 1.5 Founder QA Suite.
 *
 * Turns PHASE_1_FOUNDER_E2E.md into a runnable, recordable, replayable
 * workbench. Founder loads a path (Quick / Full), walks each step, marks
 * pass / fail / blocker / skipped, fills artifacts, exports markdown bug
 * report or JSON.
 *
 * Constraints:
 *   - Read-only with respect to providers / runtime / live tokens.
 *   - All persistence is local to benchmark/runs/ via the dev API.
 *   - Renders meaningfully even when dev API is gated off.
 *   - No "run live" button, no "auto-fill" button — every status flip is
 *     manual.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  FOUNDER_E2E_PATHS,
  PATH_LABEL,
  SEVERITY_GUIDANCE,
  SEVERITY_LABEL,
  STEP_STATUS_LABEL,
  buildEmptyRun,
  countFailuresBySeverity,
  formatRunAsBugReport,
  formatStepAsBugReport,
  getExitCriteriaForPath,
  getPathDef,
  isFailingStatus,
  listAllSteps,
  recomputeRun,
  sanitizeResult,
  type ChecklistPath,
  type ChecklistStep,
  type FounderRunSummary,
  type PathId,
  type QaRun,
  type Severity,
  type StepResult,
  type StepStatus,
} from "@/lib/founder-e2e";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "ok"; file: string }
  | { status: "error"; message: string };

const STATUS_OPTIONS: ReadonlyArray<{ status: StepStatus; tone: string }> = [
  { status: "pending", tone: "is-pending" },
  { status: "pass", tone: "is-pass" },
  { status: "fail", tone: "is-fail" },
  { status: "blocker", tone: "is-blocker" },
  { status: "skipped", tone: "is-skipped" },
];

const SEVERITY_OPTIONS: ReadonlyArray<Severity> = ["P0", "P1", "P2", "P3"];

export default function FounderE2ePage() {
  const [pathId, setPathId] = useState<PathId>("quick");
  const pathDef = useMemo<ChecklistPath>(() => getPathDef(pathId), [pathId]);
  const exitDefs = useMemo(() => getExitCriteriaForPath(pathId), [pathId]);

  const [run, setRun] = useState<QaRun>(() => buildEmptyRun(pathDef, exitDefs));
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [savedRuns, setSavedRuns] = useState<FounderRunSummary[]>([]);
  const [listState, setListState] = useState<LoadState>({ status: "idle" });
  const [activeStepId, setActiveStepId] = useState<string | null>(null);

  // When the path id changes, reset to a fresh empty run.
  useEffect(() => {
    setRun(buildEmptyRun(pathDef, exitDefs));
    setActiveStepId(null);
    setSaveState({ status: "idle" });
  }, [pathDef, exitDefs]);

  /* ─── Load saved runs list ────────────────────────────────────────── */

  const loadSavedRuns = useCallback(async () => {
    setListState({ status: "loading" });
    try {
      const res = await fetch("/api/dev/founder-e2e-runs", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(
            "Founder QA API not available. Set ENABLE_DEV_BENCHMARK_API=1 in non-dev environments.",
          );
        }
        throw new Error(`Failed to load saved runs (${res.status})`);
      }
      const json = (await res.json()) as { runs: FounderRunSummary[]; total: number };
      setSavedRuns(json.runs);
      setListState({ status: "ready" });
    } catch (err) {
      setListState({
        status: "error",
        message: err instanceof Error ? err.message : "Could not load saved runs.",
      });
      setSavedRuns([]);
    }
  }, []);

  useEffect(() => {
    void loadSavedRuns();
  }, [loadSavedRuns]);

  /* ─── Mutations ───────────────────────────────────────────────────── */

  const updateResult = useCallback(
    (stepId: string, patch: Partial<StepResult>) => {
      setRun((prev) => {
        const step = listAllSteps(pathDef).find((s) => s.id === stepId);
        if (!step) return prev;
        const previous = prev.results[stepId] ?? { stepId, status: "pending" as const };
        const next = sanitizeResult(step, {
          ...previous,
          ...patch,
          stepId,
          status: patch.status ?? previous.status,
        });
        const nextResults = { ...prev.results, [stepId]: next };
        return recomputeRun(
          pathDef,
          { ...prev, results: nextResults },
          exitDefs,
        );
      });
    },
    [pathDef, exitDefs],
  );

  const setStatus = useCallback(
    (stepId: string, status: StepStatus) => {
      updateResult(stepId, {
        status,
        updatedAt: new Date().toISOString(),
      });
    },
    [updateResult],
  );

  const resetRun = useCallback(() => {
    setRun(buildEmptyRun(pathDef, exitDefs));
    setActiveStepId(null);
    setSaveState({ status: "idle" });
  }, [pathDef, exitDefs]);

  /* ─── Persistence ────────────────────────────────────────────────── */

  const saveRun = useCallback(async () => {
    setSaveState({ status: "saving" });
    try {
      const res = await fetch("/api/dev/founder-e2e-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(run),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMessage =
          (json && (json.error?.message as string | undefined)) ?? `HTTP ${res.status}`;
        throw new Error(errMessage);
      }
      setSaveState({ status: "ok", file: (json as { file: string }).file });
      void loadSavedRuns();
    } catch (err) {
      setSaveState({
        status: "error",
        message: err instanceof Error ? err.message : "Could not save run.",
      });
    }
  }, [run, loadSavedRuns]);

  /* ─── Exports ────────────────────────────────────────────────────── */

  const downloadJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" });
    triggerDownload(blob, `${run.id}.json`);
  }, [run]);

  const downloadMarkdown = useCallback(() => {
    const md = formatRunAsBugReport(pathDef, run);
    const blob = new Blob([md], { type: "text/markdown" });
    triggerDownload(blob, `${run.id}.md`);
  }, [pathDef, run]);

  const copyMarkdown = useCallback(async () => {
    const md = formatRunAsBugReport(pathDef, run);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(md);
    }
  }, [pathDef, run]);

  /* ─── Derived view models ────────────────────────────────────────── */

  const failingSteps = useMemo(() => {
    return listAllSteps(pathDef)
      .map((step) => ({ step, result: run.results[step.id] }))
      .filter(({ result }) => result && isFailingStatus(result.status));
  }, [pathDef, run]);

  const sevCounts = useMemo(
    () => countFailuresBySeverity(pathDef, run.results),
    [pathDef, run.results],
  );

  const activeStep = activeStepId
    ? listAllSteps(pathDef).find((s) => s.id === activeStepId)
    : null;

  /* ─── Render ─────────────────────────────────────────────────────── */

  return (
    <div className="qa-page">
      <FounderE2eStyles />

      <header className="qa-header">
        <div>
          <p className="qa-eyebrow">Phase 1.5 / Track B observability</p>
          <h1>Founder QA Suite</h1>
          <p className="qa-subtitle">
            Make PHASE_1_FOUNDER_E2E.md runnable, recordable, replayable. Walk each step,
            mark pass/fail/blocker, paste artifacts, export bug report. No live providers,
            no token spend, no automation.
          </p>
        </div>
        <div className="qa-related">
          <strong>Related dashboards</strong>
          <ul>
            <li>
              <a href="/dev/benchmark-runs">/dev/benchmark-runs</a>
            </li>
            <li>
              <a href="/dev">/dev landing</a>
            </li>
            <li>
              <a href="/tasks/demo-executing">/tasks/demo-executing</a>
            </li>
          </ul>
        </div>
      </header>

      {/* Top row: path picker + verdict + save controls */}
      <section className="qa-toprow">
        <fieldset className="qa-pathpicker" aria-label="Path picker">
          <legend>Path</legend>
          {(["quick", "full"] as const).map((id) => (
            <label key={id} className={pathId === id ? "is-active" : ""}>
              <input
                type="radio"
                name="path"
                value={id}
                checked={pathId === id}
                onChange={() => setPathId(id)}
              />
              <span className="qa-pathpicker-title">{PATH_LABEL[id]}</span>
              <span className="qa-pathpicker-blurb">{FOUNDER_E2E_PATHS[id].description}</span>
            </label>
          ))}
        </fieldset>

        <VerdictCard run={run} sevCounts={sevCounts} />

        <div className="qa-savecard">
          <h3>Save / export</h3>
          <button
            type="button"
            className="qa-btn qa-btn-primary"
            onClick={() => void saveRun()}
            disabled={saveState.status === "saving"}
          >
            {saveState.status === "saving" ? "Saving…" : "Save run"}
          </button>
          <button type="button" className="qa-btn" onClick={downloadMarkdown}>
            Export Markdown
          </button>
          <button type="button" className="qa-btn" onClick={downloadJson}>
            Export JSON
          </button>
          <button type="button" className="qa-btn qa-btn-ghost" onClick={() => void copyMarkdown()}>
            Copy MD
          </button>
          <button type="button" className="qa-btn qa-btn-warn" onClick={resetRun}>
            Reset
          </button>
          <SaveBanner saveState={saveState} />
        </div>
      </section>

      {/* Severity tally */}
      <section className="qa-sevrow" aria-label="Failure severity tally">
        {(Object.keys(sevCounts) as Severity[]).map((sev) => (
          <div key={sev} className={`qa-sev-pill is-${sev.toLowerCase()}`}>
            <span className="qa-sev-pill-label">{SEVERITY_LABEL[sev]}</span>
            <span className="qa-sev-pill-count">{sevCounts[sev]}</span>
            <span className="qa-sev-pill-help">{SEVERITY_GUIDANCE[sev]}</span>
          </div>
        ))}
      </section>

      {/* Sections + steps */}
      <section className="qa-sections">
        {pathDef.sections.map((section) => (
          <article key={section.id} className="qa-section">
            <header>
              <h2>{section.title}</h2>
              {section.blurb ? <p>{section.blurb}</p> : null}
            </header>
            <ul>
              {section.steps.map((step) => {
                const result = run.results[step.id] ?? { stepId: step.id, status: "pending" };
                return (
                  <li
                    key={step.id}
                    className={`qa-step is-${result.status} ${activeStepId === step.id ? "is-active" : ""}`}
                  >
                    <StepRow
                      step={step}
                      result={result}
                      onSetStatus={(s) => setStatus(step.id, s)}
                      onPick={() =>
                        setActiveStepId((id) => (id === step.id ? null : step.id))
                      }
                      isActive={activeStepId === step.id}
                    />
                    {activeStepId === step.id ? (
                      <StepEditor
                        step={step}
                        result={result}
                        onPatch={(patch) => updateResult(step.id, patch)}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </article>
        ))}
      </section>

      {/* Active step bug-report preview */}
      {activeStep ? (
        <BugReportPreview
          step={activeStep}
          result={run.results[activeStep.id] ?? { stepId: activeStep.id, status: "pending" }}
          run={run}
        />
      ) : null}

      {/* Saved runs */}
      <section className="qa-saved">
        <header>
          <h2>Saved runs</h2>
          <button
            type="button"
            className="qa-btn qa-btn-ghost"
            onClick={() => void loadSavedRuns()}
          >
            Refresh
          </button>
        </header>
        {listState.status === "loading" ? <p>Loading…</p> : null}
        {listState.status === "error" ? (
          <p className="qa-error">{listState.message}</p>
        ) : null}
        {listState.status === "ready" && savedRuns.length === 0 ? (
          <p className="qa-empty">
            No founder QA runs saved yet. After a walkthrough, click <strong>Save run</strong>{" "}
            above and a JSON file lands in <code>benchmark/runs/</code>.
          </p>
        ) : null}
        {savedRuns.length > 0 ? (
          <table className="qa-saved-table">
            <thead>
              <tr>
                <th>Run id</th>
                <th>Path</th>
                <th>Started</th>
                <th>Pass</th>
                <th>Fail</th>
                <th>Blocker</th>
                <th>P0</th>
                <th>P1</th>
                <th>Bar</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {savedRuns.map((s) => (
                <tr key={s.file}>
                  <td>
                    <code>{s.runId}</code>
                  </td>
                  <td>{PATH_LABEL[s.pathId]}</td>
                  <td>{s.startedAt}</td>
                  <td>{s.pass}</td>
                  <td>{s.fail}</td>
                  <td>{s.blocker}</td>
                  <td>{s.p0Count}</td>
                  <td>{s.p1Count}</td>
                  <td>{s.meetsBar ? "✅" : "❌"}</td>
                  <td>
                    <a href={`/api/dev/founder-e2e-runs?file=${encodeURIComponent(s.file)}`}>
                      raw
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {/* Failing summary */}
      {failingSteps.length > 0 ? (
        <section className="qa-failing">
          <h2>Failing rows ({failingSteps.length})</h2>
          <ol>
            {failingSteps.map(({ step, result }) => (
              <li key={step.id}>
                <code>{step.id}</code> — <strong>{step.title}</strong> ({STEP_STATUS_LABEL[result!.status]} ·{" "}
                {SEVERITY_LABEL[(result!.severity ?? step.severityOnFail) as Severity]})
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <footer className="qa-footer">
        <p>
          Path coverage: {listAllSteps(pathDef).length} steps across {pathDef.sections.length} sections.
          Quick path is for first-pass smoke; Full path is the Phase 1 #8 sign-off bar.
        </p>
        <p>
          See <code>FOUNDER_E2E_BUG_TRIAGE.md</code> for the severity playbook + how exported bug reports flow into codex / Claude triage.
        </p>
      </footer>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────── */

function VerdictCard({
  run,
  sevCounts,
}: {
  run: QaRun;
  sevCounts: Record<Severity, number>;
}) {
  const tone = run.exit.meetsBar
    ? "is-ready"
    : sevCounts.P0 > 0
      ? "is-blocked"
      : run.summary.pending === run.summary.total
        ? "is-pending"
        : "is-progress";
  const headline = run.exit.meetsBar
    ? "READY TO DECLARE"
    : sevCounts.P0 > 0
      ? "DO NOT DECLARE — P0 OPEN"
      : run.summary.pending === run.summary.total
        ? "WALKTHROUGH NOT STARTED"
        : "IN PROGRESS";
  return (
    <article className={`qa-verdict ${tone}`}>
      <header>
        <span className="qa-verdict-eyebrow">Phase 1 #8 exit bar</span>
        <h2>{headline}</h2>
      </header>
      <dl>
        <div>
          <dt>Criteria satisfied</dt>
          <dd>
            {run.exit.satisfiedCount} / {run.exit.criteria.length}
          </dd>
        </div>
        <div>
          <dt>Pass</dt>
          <dd>{run.summary.pass}</dd>
        </div>
        <div>
          <dt>Fail / Blocker</dt>
          <dd>
            {run.summary.fail} / {run.summary.blocker}
          </dd>
        </div>
        <div>
          <dt>P0 outstanding</dt>
          <dd className={sevCounts.P0 > 0 ? "is-warn" : ""}>{sevCounts.P0}</dd>
        </div>
      </dl>
      {run.exit.reasonShortBy.length > 0 ? (
        <ul className="qa-verdict-gaps">
          {run.exit.reasonShortBy.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      ) : (
        <p className="qa-verdict-clear">
          0 P0 ship-blockers. ≤3 P1 budget respected. Ready to declare Phase 1 #8 done.
        </p>
      )}
    </article>
  );
}

function StepRow({
  step,
  result,
  onSetStatus,
  onPick,
  isActive,
}: {
  step: ChecklistStep;
  result: StepResult;
  onSetStatus: (s: StepStatus) => void;
  onPick: () => void;
  isActive: boolean;
}) {
  const sev = (result.severity ?? step.severityOnFail) as Severity;
  return (
    <div className="qa-steprow">
      <button type="button" className="qa-steprow-title" onClick={onPick}>
        <span className="qa-steprow-section">{step.section}</span>
        <span className="qa-steprow-name">{step.title}</span>
        <span className={`qa-sev-tag is-${sev.toLowerCase()}`}>{sev}</span>
        <span className="qa-steprow-arrow">{isActive ? "▾" : "▸"}</span>
      </button>
      <div className="qa-steprow-statuses" role="group" aria-label={`Status for ${step.title}`}>
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.status}
            type="button"
            className={`qa-statusbtn ${opt.tone} ${result.status === opt.status ? "is-on" : ""}`}
            onClick={() => onSetStatus(opt.status)}
            aria-pressed={result.status === opt.status}
          >
            {STEP_STATUS_LABEL[opt.status]}
          </button>
        ))}
      </div>
    </div>
  );
}

function StepEditor({
  step,
  result,
  onPatch,
}: {
  step: ChecklistStep;
  result: StepResult;
  onPatch: (p: Partial<StepResult>) => void;
}) {
  return (
    <div className="qa-editor">
      <div className="qa-editor-cols">
        <section>
          <h4>What to do</h4>
          <pre className="qa-pre">{step.whatToDo}</pre>
          <h4>Expected</h4>
          <p>{step.expected}</p>
          {step.warn ? (
            <>
              <h4>Watch out</h4>
              <p className="qa-warn">{step.warn}</p>
            </>
          ) : null}
          {step.surfaces?.length ? (
            <>
              <h4>Surfaces</h4>
              <ul className="qa-surfaces">
                {step.surfaces.map((s) => (
                  <li key={s}>
                    {s.startsWith("/") || s.startsWith("http") ? (
                      <a href={s} target="_blank" rel="noreferrer">
                        {s}
                      </a>
                    ) : (
                      <code>{s}</code>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {step.refs?.length ? (
            <>
              <h4>References</h4>
              <ul>
                {step.refs.map((ref) => (
                  <li key={ref}>{ref}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
        <section>
          <h4>Founder observations</h4>
          <label className="qa-field">
            <span>Actual</span>
            <textarea
              rows={3}
              value={result.actual ?? ""}
              onChange={(e) => onPatch({ actual: e.target.value })}
            />
          </label>
          <label className="qa-field">
            <span>Notes</span>
            <textarea
              rows={2}
              value={result.notes ?? ""}
              onChange={(e) => onPatch({ notes: e.target.value })}
            />
          </label>
          <div className="qa-grid">
            <label className="qa-field">
              <span>Task id</span>
              <input
                type="text"
                value={result.taskId ?? ""}
                onChange={(e) => onPatch({ taskId: e.target.value })}
              />
            </label>
            <label className="qa-field">
              <span>URL</span>
              <input
                type="text"
                value={result.url ?? ""}
                onChange={(e) => onPatch({ url: e.target.value })}
              />
            </label>
            <label className="qa-field">
              <span>Screenshot path</span>
              <input
                type="text"
                value={result.screenshotPath ?? ""}
                onChange={(e) => onPatch({ screenshotPath: e.target.value })}
              />
            </label>
            <label className="qa-field">
              <span>Account</span>
              <input
                type="text"
                value={result.account ?? ""}
                placeholder="ziweiA / ziweiB / ziweiC"
                onChange={(e) => onPatch({ account: e.target.value })}
              />
            </label>
            <label className="qa-field">
              <span>Browser</span>
              <input
                type="text"
                value={result.browser ?? ""}
                placeholder="Chrome 120 / Safari 17"
                onChange={(e) => onPatch({ browser: e.target.value })}
              />
            </label>
            <label className="qa-field">
              <span>Reproducibility</span>
              <input
                type="text"
                value={result.reproducibility ?? ""}
                placeholder="100% / 3 of 5 / once"
                onChange={(e) => onPatch({ reproducibility: e.target.value })}
              />
            </label>
            <label className="qa-field">
              <span>Severity override</span>
              <select
                value={result.severity ?? step.severityOnFail}
                onChange={(e) => onPatch({ severity: e.target.value as Severity })}
              >
                {SEVERITY_OPTIONS.map((sev) => (
                  <option key={sev} value={sev}>
                    {SEVERITY_LABEL[sev]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="qa-field">
            <span>Console error</span>
            <textarea
              rows={2}
              value={result.consoleError ?? ""}
              onChange={(e) => onPatch({ consoleError: e.target.value })}
            />
          </label>
          <label className="qa-field">
            <span>Server log excerpt</span>
            <textarea
              rows={2}
              value={result.serverLog ?? ""}
              onChange={(e) => onPatch({ serverLog: e.target.value })}
            />
          </label>
        </section>
      </div>
    </div>
  );
}

function BugReportPreview({
  step,
  result,
  run,
}: {
  step: ChecklistStep;
  result: StepResult;
  run: QaRun;
}) {
  if (!isFailingStatus(result.status)) {
    return (
      <section className="qa-preview">
        <h3>Bug report preview ({step.id})</h3>
        <p className="qa-empty">
          Status is <strong>{STEP_STATUS_LABEL[result.status]}</strong>. Mark this step{" "}
          <strong>fail</strong> or <strong>blocker</strong> to render the bug-report ticket.
        </p>
      </section>
    );
  }
  const md = formatStepAsBugReport(step, result, {
    branchSha: run.branchSha,
    pathLabel: PATH_LABEL[run.pathId],
    runId: run.id,
  });
  return (
    <section className="qa-preview">
      <h3>Bug report preview ({step.id})</h3>
      <pre className="qa-pre qa-pre-md">{md}</pre>
    </section>
  );
}

function SaveBanner({ saveState }: { saveState: SaveState }) {
  if (saveState.status === "ok") {
    return (
      <p className="qa-save-ok">
        Saved to <code>benchmark/runs/{saveState.file}</code>.
      </p>
    );
  }
  if (saveState.status === "error") {
    return <p className="qa-save-err">{saveState.message}</p>;
  }
  return null;
}

function triggerDownload(blob: Blob, filename: string): void {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 200);
}

/* ─── Inline styles ──────────────────────────────────────────────────── */

function FounderE2eStyles() {
  return (
    <style jsx global>{`
      .qa-page {
        --qa-bg: #fbfbfd;
        --qa-fg: #1d1d1f;
        --qa-muted: #6e6e73;
        --qa-border: #e5e5ea;
        --qa-pass: #16a34a;
        --qa-fail: #dc2626;
        --qa-blocker: #b45309;
        --qa-skip: #6b7280;
        --qa-pending: #9ca3af;
        --qa-accent: #1d4ed8;
        max-width: 1240px;
        margin: 0 auto;
        padding: 32px 24px 96px;
        color: var(--qa-fg);
        background: var(--qa-bg);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif;
      }
      .qa-eyebrow {
        margin: 0;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--qa-muted);
      }
      .qa-header {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 24px;
        align-items: end;
        margin-bottom: 24px;
      }
      .qa-header h1 {
        font-size: 28px;
        margin: 4px 0 8px;
      }
      .qa-subtitle {
        margin: 0;
        max-width: 760px;
        color: var(--qa-muted);
        line-height: 1.45;
      }
      .qa-related {
        font-size: 13px;
        color: var(--qa-muted);
        text-align: right;
      }
      .qa-related ul {
        list-style: none;
        margin: 4px 0 0;
        padding: 0;
      }
      .qa-related a {
        color: var(--qa-accent);
        text-decoration: none;
      }
      .qa-related a:hover {
        text-decoration: underline;
      }
      .qa-toprow {
        display: grid;
        grid-template-columns: 1fr 1.4fr 1fr;
        gap: 16px;
        margin-bottom: 16px;
      }
      .qa-pathpicker {
        background: #fff;
        border: 1px solid var(--qa-border);
        border-radius: 12px;
        padding: 16px;
      }
      .qa-pathpicker legend {
        font-weight: 600;
        padding: 0 6px;
      }
      .qa-pathpicker label {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 8px;
        align-items: start;
        padding: 8px;
        border-radius: 8px;
        cursor: pointer;
      }
      .qa-pathpicker label.is-active {
        background: #eef2ff;
      }
      .qa-pathpicker-title {
        grid-column: 2;
        font-weight: 600;
      }
      .qa-pathpicker-blurb {
        grid-column: 2;
        font-size: 12px;
        color: var(--qa-muted);
      }
      .qa-verdict {
        background: #fff;
        border: 1px solid var(--qa-border);
        border-left-width: 6px;
        border-radius: 12px;
        padding: 16px;
      }
      .qa-verdict.is-ready {
        border-left-color: var(--qa-pass);
      }
      .qa-verdict.is-blocked {
        border-left-color: var(--qa-fail);
      }
      .qa-verdict.is-progress {
        border-left-color: var(--qa-accent);
      }
      .qa-verdict.is-pending {
        border-left-color: var(--qa-pending);
      }
      .qa-verdict h2 {
        font-size: 22px;
        margin: 4px 0 12px;
      }
      .qa-verdict-eyebrow {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--qa-muted);
      }
      .qa-verdict dl {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px 16px;
        margin: 8px 0 0;
      }
      .qa-verdict dl > div {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
      }
      .qa-verdict dt {
        color: var(--qa-muted);
      }
      .qa-verdict dd {
        margin: 0;
        font-weight: 600;
      }
      .qa-verdict dd.is-warn {
        color: var(--qa-fail);
      }
      .qa-verdict-gaps {
        margin: 12px 0 0;
        padding-left: 18px;
        font-size: 12px;
        color: var(--qa-muted);
      }
      .qa-verdict-clear {
        margin: 12px 0 0;
        font-size: 12px;
        color: var(--qa-pass);
      }
      .qa-savecard {
        background: #fff;
        border: 1px solid var(--qa-border);
        border-radius: 12px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .qa-savecard h3 {
        margin: 0 0 4px;
      }
      .qa-btn {
        background: #fff;
        border: 1px solid var(--qa-border);
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
      }
      .qa-btn:hover {
        background: #f3f4f6;
      }
      .qa-btn-primary {
        background: var(--qa-accent);
        color: #fff;
        border-color: var(--qa-accent);
      }
      .qa-btn-primary:hover {
        background: #1e40af;
      }
      .qa-btn-warn {
        color: var(--qa-fail);
      }
      .qa-btn-ghost {
        background: transparent;
        border-color: transparent;
        color: var(--qa-muted);
      }
      .qa-save-ok {
        font-size: 12px;
        color: var(--qa-pass);
        margin: 4px 0 0;
      }
      .qa-save-err {
        font-size: 12px;
        color: var(--qa-fail);
        margin: 4px 0 0;
      }
      .qa-sevrow {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-bottom: 16px;
      }
      .qa-sev-pill {
        background: #fff;
        border: 1px solid var(--qa-border);
        border-radius: 10px;
        padding: 10px 12px;
        display: grid;
        grid-template-columns: 1fr auto;
      }
      .qa-sev-pill-label {
        font-weight: 600;
      }
      .qa-sev-pill-count {
        font-weight: 700;
        color: var(--qa-fg);
        background: #f3f4f6;
        padding: 0 8px;
        border-radius: 999px;
        align-self: start;
      }
      .qa-sev-pill-help {
        grid-column: 1 / -1;
        font-size: 11px;
        color: var(--qa-muted);
        margin-top: 4px;
      }
      .qa-sev-pill.is-p0 {
        border-color: var(--qa-fail);
      }
      .qa-sev-pill.is-p0 .qa-sev-pill-count {
        background: #fee2e2;
        color: var(--qa-fail);
      }
      .qa-sev-pill.is-p1 {
        border-color: var(--qa-blocker);
      }
      .qa-sev-pill.is-p1 .qa-sev-pill-count {
        background: #fef3c7;
        color: var(--qa-blocker);
      }
      .qa-sections {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .qa-section {
        background: #fff;
        border: 1px solid var(--qa-border);
        border-radius: 12px;
        padding: 16px;
      }
      .qa-section header h2 {
        margin: 0;
        font-size: 18px;
      }
      .qa-section header p {
        margin: 4px 0 12px;
        color: var(--qa-muted);
        font-size: 13px;
      }
      .qa-section ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .qa-step {
        border: 1px solid var(--qa-border);
        border-radius: 10px;
        padding: 0;
        background: #fff;
      }
      .qa-step.is-active {
        border-color: var(--qa-accent);
      }
      .qa-step.is-pass {
        border-left: 4px solid var(--qa-pass);
      }
      .qa-step.is-fail {
        border-left: 4px solid var(--qa-fail);
      }
      .qa-step.is-blocker {
        border-left: 4px solid var(--qa-blocker);
      }
      .qa-step.is-skipped {
        border-left: 4px solid var(--qa-skip);
      }
      .qa-step.is-pending {
        border-left: 4px solid var(--qa-pending);
      }
      .qa-steprow {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 12px;
        align-items: center;
        padding: 10px 12px;
      }
      .qa-steprow-title {
        background: transparent;
        border: 0;
        text-align: left;
        cursor: pointer;
        font-size: 14px;
        display: grid;
        grid-template-columns: 64px 1fr auto auto;
        gap: 8px;
        align-items: center;
        color: var(--qa-fg);
      }
      .qa-steprow-section {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        color: var(--qa-muted);
      }
      .qa-steprow-name {
        font-weight: 600;
      }
      .qa-sev-tag {
        font-size: 11px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        background: #e5e7eb;
        color: #1f2937;
      }
      .qa-sev-tag.is-p0 {
        background: #fee2e2;
        color: var(--qa-fail);
      }
      .qa-sev-tag.is-p1 {
        background: #fef3c7;
        color: var(--qa-blocker);
      }
      .qa-sev-tag.is-p2 {
        background: #fde68a;
        color: #92400e;
      }
      .qa-sev-tag.is-p3 {
        background: #dcfce7;
        color: #166534;
      }
      .qa-steprow-arrow {
        color: var(--qa-muted);
        margin-left: 4px;
      }
      .qa-steprow-statuses {
        display: flex;
        gap: 4px;
      }
      .qa-statusbtn {
        background: #fff;
        border: 1px solid var(--qa-border);
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 12px;
        cursor: pointer;
        color: var(--qa-muted);
      }
      .qa-statusbtn.is-on {
        background: #111827;
        color: #fff;
        border-color: #111827;
      }
      .qa-statusbtn.is-on.is-pass {
        background: var(--qa-pass);
        border-color: var(--qa-pass);
      }
      .qa-statusbtn.is-on.is-fail {
        background: var(--qa-fail);
        border-color: var(--qa-fail);
      }
      .qa-statusbtn.is-on.is-blocker {
        background: var(--qa-blocker);
        border-color: var(--qa-blocker);
      }
      .qa-statusbtn.is-on.is-skipped {
        background: var(--qa-skip);
        border-color: var(--qa-skip);
      }
      .qa-editor {
        border-top: 1px solid var(--qa-border);
        padding: 16px;
      }
      .qa-editor-cols {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
      }
      .qa-editor h4 {
        margin: 0 0 4px;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--qa-muted);
      }
      .qa-pre {
        background: #f3f4f6;
        border-radius: 8px;
        padding: 8px 10px;
        white-space: pre-wrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
      }
      .qa-pre-md {
        max-height: 360px;
        overflow: auto;
      }
      .qa-warn {
        color: var(--qa-fail);
        font-size: 13px;
      }
      .qa-surfaces {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .qa-surfaces li {
        font-size: 12px;
      }
      .qa-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        margin-bottom: 8px;
      }
      .qa-field span {
        color: var(--qa-muted);
      }
      .qa-field input,
      .qa-field textarea,
      .qa-field select {
        padding: 6px 8px;
        font-size: 13px;
        border: 1px solid var(--qa-border);
        border-radius: 6px;
        background: #fff;
        color: var(--qa-fg);
        font-family: inherit;
      }
      .qa-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .qa-preview {
        background: #fff;
        border: 1px solid var(--qa-border);
        border-radius: 12px;
        padding: 16px;
        margin-top: 16px;
      }
      .qa-preview h3 {
        margin: 0 0 8px;
      }
      .qa-saved {
        margin-top: 24px;
        background: #fff;
        border: 1px solid var(--qa-border);
        border-radius: 12px;
        padding: 16px;
      }
      .qa-saved header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .qa-saved-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .qa-saved-table th,
      .qa-saved-table td {
        text-align: left;
        padding: 6px 8px;
        border-bottom: 1px solid var(--qa-border);
      }
      .qa-saved-table th {
        color: var(--qa-muted);
        font-weight: 600;
      }
      .qa-empty {
        color: var(--qa-muted);
        font-size: 13px;
      }
      .qa-error {
        color: var(--qa-fail);
        font-size: 13px;
      }
      .qa-failing {
        margin-top: 24px;
        background: #fff;
        border: 1px solid var(--qa-border);
        border-radius: 12px;
        padding: 16px;
      }
      .qa-failing ol {
        margin: 0;
        padding-left: 20px;
        font-size: 13px;
      }
      .qa-footer {
        margin-top: 32px;
        font-size: 12px;
        color: var(--qa-muted);
        line-height: 1.5;
      }
    `}</style>
  );
}
