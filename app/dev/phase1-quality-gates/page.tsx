/**
 * /dev/phase1-quality-gates — dashboard for the Phase 1 Quality Gate.
 *
 * Reads from /api/dev/phase1-quality-gates (the dev-gated API).
 * Renders:
 *   - copy-paste command rail (the 3 most useful invocations).
 *   - latest run verdict card with check tally.
 *   - checks table (id / requirement / status / severity / duration / command).
 *   - per-check tail viewer (stdout / stderr) on click.
 *   - saved runs list, newest-first, with click-to-load.
 *
 * No live booking buttons. No live OpenAI invocation. This page
 * exists to surface ALREADY-GENERATED gate runs. The runner is
 * `npm run gate:phase1`, run from the operator's terminal.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  GATE_SEVERITY_LABEL,
  GATE_STATUS_LABEL,
  GATE_STATUS_TONE,
  GATE_VERDICT_LABEL,
  GATE_VERDICT_TONE,
  formatQualityGateMarkdown,
  type GateCheck,
  type QualityGateRun,
  type QualityGateRunSummary,
} from "@/lib/quality-gate/report";

const COPY_COMMANDS: { label: string; command: string; blurb: string }[] = [
  {
    label: "Default gate",
    command: "npm run gate:phase1",
    blurb:
      "Run the required-only gate (tsc + targeted vitest + check-drift). No dev server needed.",
  },
  {
    label: "+ Smoke (Phase 1 surfaces)",
    command: "npm run gate:phase1 -- --include-smoke",
    blurb: "Adds smoke:phase1. Requires the dev server at http://localhost:3000.",
  },
  {
    label: "+ Founder E2E (autonomous)",
    command: "npm run gate:phase1 -- --include-e2e",
    blurb: "Adds preflight:founder-e2e + e2e:founder. Requires dev server. Heavier — Playwright + chromium.",
  },
  {
    label: "JSON to stdout",
    command: "npm run gate:phase1 -- --json",
    blurb: "Same checks; emits a single JSON to stdout (in addition to writing the run file).",
  },
  {
    label: "Allow known drift",
    command: "npm run gate:phase1 -- --allow-known-drift",
    blurb:
      "Treat a check-drift fail as known_existing_failure. Use when drift is a pre-existing codex-domain issue.",
  },
];

interface ListResponse {
  runs: QualityGateRunSummary[];
  total: number;
}

export default function Phase1QualityGatesPage() {
  const [summaries, setSummaries] = useState<QualityGateRunSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<QualityGateRun | null>(null);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);
  const [expandedCheckId, setExpandedCheckId] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch("/api/dev/phase1-quality-gates", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`GET list failed: ${res.status}`);
      }
      const data = (await res.json()) as ListResponse;
      setSummaries(data.runs);
      // Auto-load the newest run if none is selected.
      if (!activeFile && data.runs.length > 0) {
        void loadRun(data.runs[0].fileName);
      }
    } catch (err) {
      setListError((err as Error).message);
    } finally {
      setListLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile]);

  const loadRun = useCallback(async (fileName: string) => {
    setActiveLoading(true);
    setActiveError(null);
    setActiveFile(fileName);
    setExpandedCheckId(null);
    try {
      const res = await fetch(
        `/api/dev/phase1-quality-gates?file=${encodeURIComponent(fileName)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(`GET file failed: ${res.status} ${body?.error?.message ?? ""}`);
      }
      const data = (await res.json()) as { run: QualityGateRun };
      setActiveRun(data.run);
    } catch (err) {
      setActiveError((err as Error).message);
      setActiveRun(null);
    } finally {
      setActiveLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  return (
    <main className="qgate">
      <header className="qgate__top">
        <div className="qgate__breadcrumb">
          <a href="/dev">/dev</a>
          <span> · </span>
          <span>phase1-quality-gates</span>
        </div>
        <h1 className="qgate__title">Phase 1 Quality Gate</h1>
        <p className="qgate__subtitle">
          One-command verdict on whether today&apos;s build keeps Phase 1
          shippable. No tokens, no providers, no payments, no OTP.
          Gate runs locally; this page surfaces saved runs.
        </p>
      </header>

      <section className="qgate__section">
        <h2 className="qgate__section-title">Run the gate</h2>
        <div className="qgate__commands">
          {COPY_COMMANDS.map((c) => (
            <CopyCommand key={c.command} {...c} />
          ))}
        </div>
        <p className="qgate__hint">
          The gate writes <code>benchmark/runs/phase1-quality-gate-&lt;id&gt;.json</code> +{" "}
          <code>.md</code>. With <code>--save-to-api</code> it POSTs here too.
        </p>
      </section>

      <section className="qgate__section">
        <h2 className="qgate__section-title">Latest run</h2>
        {activeLoading && <div className="qgate__loading">Loading run…</div>}
        {activeError && <div className="qgate__error">Couldn&apos;t load run: {activeError}</div>}
        {activeRun && (
          <ActiveRunPanel
            run={activeRun}
            expandedCheckId={expandedCheckId}
            onToggleExpand={(id) =>
              setExpandedCheckId((prev) => (prev === id ? null : id))
            }
          />
        )}
        {!activeLoading && !activeRun && !activeError && (
          <div className="qgate__empty">
            <p>
              No runs yet. Run <code>npm run gate:phase1</code> in your repo terminal,
              then refresh this page.
            </p>
          </div>
        )}
      </section>

      <section className="qgate__section">
        <h2 className="qgate__section-title">Saved runs</h2>
        {listLoading && <div className="qgate__loading">Loading…</div>}
        {listError && <div className="qgate__error">{listError}</div>}
        {!listLoading && summaries.length === 0 && !listError && (
          <div className="qgate__empty">
            <p>
              No saved runs. The gate writes JSON files into{" "}
              <code>benchmark/runs/</code>; they show up here once you run it.
            </p>
          </div>
        )}
        {summaries.length > 0 && (
          <SavedRunsTable
            summaries={summaries}
            activeFile={activeFile}
            onSelect={(file) => void loadRun(file)}
          />
        )}
      </section>

      <QualityGateStyles />
    </main>
  );
}

/* ─── Active run ──────────────────────────────────────────────────── */

interface ActiveRunPanelProps {
  run: QualityGateRun;
  expandedCheckId: string | null;
  onToggleExpand: (id: string) => void;
}

function ActiveRunPanel({ run, expandedCheckId, onToggleExpand }: ActiveRunPanelProps) {
  const tone = GATE_VERDICT_TONE[run.verdict];
  const verdictLabel = GATE_VERDICT_LABEL[run.verdict];
  const passCount = run.checks.filter((c) => c.status === "pass").length;
  const failCount = run.checks.filter((c) => c.status === "fail").length;
  const skippedCount = run.checks.filter((c) => c.status === "skipped").length;
  const knownCount = run.checks.filter((c) => c.status === "known_existing_failure").length;

  const markdown = useMemo(() => formatQualityGateMarkdown(run), [run]);

  return (
    <div className={`qgate__verdict-card qgate__tone--${tone}`}>
      <div className="qgate__verdict-row">
        <div className="qgate__verdict-headline">
          <span className={`qgate__verdict-pill qgate__pill--${tone}`}>{verdictLabel}</span>
          <span className="qgate__verdict-runid">{run.runId}</span>
        </div>
        <div className="qgate__verdict-meta">
          <Stat label="Pass" value={passCount} tone="good" />
          <Stat label="Fail" value={failCount} tone={failCount > 0 ? "bad" : "neutral"} />
          <Stat label="Skipped" value={skippedCount} tone="neutral" />
          <Stat label="Known existing" value={knownCount} tone={knownCount > 0 ? "warn" : "neutral"} />
          <Stat label="Exit" value={run.exitCode} tone={run.exitCode === 0 ? "good" : "bad"} />
        </div>
      </div>
      <dl className="qgate__verdict-dl">
        <div>
          <dt>Command</dt>
          <dd>
            <code>{run.runnerMeta.command}</code>
          </dd>
        </div>
        {run.runnerMeta.baseUrl && (
          <div>
            <dt>Base URL</dt>
            <dd>{run.runnerMeta.baseUrl}</dd>
          </div>
        )}
        {run.runnerMeta.label && (
          <div>
            <dt>Label</dt>
            <dd>{run.runnerMeta.label}</dd>
          </div>
        )}
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(run.runnerMeta.durationMs)}</dd>
        </div>
        <div>
          <dt>Node</dt>
          <dd>
            <code>{run.runnerMeta.nodeVersion}</code>
          </dd>
        </div>
        <div>
          <dt>Generated</dt>
          <dd>{run.generatedAt}</dd>
        </div>
      </dl>

      <h3 className="qgate__sub-title">Checks ({run.checks.length})</h3>
      <ul className="qgate__check-list">
        {run.checks.map((c) => (
          <CheckRow
            key={c.id}
            check={c}
            expanded={expandedCheckId === c.id}
            onToggle={() => onToggleExpand(c.id)}
          />
        ))}
      </ul>

      <h3 className="qgate__sub-title">Markdown report (paste-ready)</h3>
      <textarea
        className="qgate__markdown"
        readOnly
        value={markdown}
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}

interface CheckRowProps {
  check: GateCheck;
  expanded: boolean;
  onToggle: () => void;
}

function CheckRow({ check, expanded, onToggle }: CheckRowProps) {
  const tone = GATE_STATUS_TONE[check.status];
  return (
    <li className={`qgate__check qgate__tone--${tone}`}>
      <button
        type="button"
        className="qgate__check-head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className={`qgate__check-status qgate__pill--${tone}`}>
          {GATE_STATUS_LABEL[check.status]}
        </span>
        <span className="qgate__check-id">
          <code>{check.id}</code>
        </span>
        <span className="qgate__check-req">{check.requirement}</span>
        <span className="qgate__check-sev">{GATE_SEVERITY_LABEL[check.severity]}</span>
        <span className="qgate__check-dur">{formatDuration(check.durationMs)}</span>
        <span className="qgate__check-toggle">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div className="qgate__check-detail">
          <p className="qgate__check-label">{check.label}</p>
          <p>
            <strong>Command</strong>: <code>{check.command}</code>
          </p>
          <p>
            <strong>Started</strong>: {check.startedAt}
          </p>
          {typeof check.exitCode === "number" && (
            <p>
              <strong>Exit code</strong>: <code>{check.exitCode}</code>
            </p>
          )}
          {check.notes && (
            <p>
              <strong>Notes</strong>: {check.notes}
            </p>
          )}
          {check.stdoutTail && (
            <details>
              <summary>stdout (tail)</summary>
              <pre className="qgate__pre">{check.stdoutTail}</pre>
            </details>
          )}
          {check.stderrTail && (
            <details>
              <summary>stderr (tail)</summary>
              <pre className="qgate__pre">{check.stderrTail}</pre>
            </details>
          )}
        </div>
      )}
    </li>
  );
}

/* ─── Saved runs table ────────────────────────────────────────────── */

interface SavedRunsTableProps {
  summaries: QualityGateRunSummary[];
  activeFile: string | null;
  onSelect: (file: string) => void;
}

function SavedRunsTable({ summaries, activeFile, onSelect }: SavedRunsTableProps) {
  return (
    <div className="qgate__table-wrap">
      <table className="qgate__table">
        <thead>
          <tr>
            <th>Generated</th>
            <th>Verdict</th>
            <th>Exit</th>
            <th>Pass</th>
            <th>Fail</th>
            <th>Skip</th>
            <th>Known</th>
            <th>Duration</th>
            <th>Label</th>
            <th>File</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => {
            const tone = GATE_VERDICT_TONE[s.verdict];
            const isActive = s.fileName === activeFile;
            return (
              <tr
                key={s.fileName}
                className={isActive ? "qgate__row--active" : undefined}
              >
                <td>{s.generatedAt}</td>
                <td>
                  <span className={`qgate__pill qgate__pill--${tone}`}>
                    {GATE_VERDICT_LABEL[s.verdict]}
                  </span>
                </td>
                <td>
                  <code>{s.exitCode}</code>
                </td>
                <td>{s.passCount}</td>
                <td>{s.failCount}</td>
                <td>{s.skippedCount}</td>
                <td>{s.knownExistingFailureCount}</td>
                <td>{formatDuration(s.durationMs)}</td>
                <td>{s.label ?? "—"}</td>
                <td>
                  <code className="qgate__filename">{s.fileName}</code>
                </td>
                <td>
                  <button
                    type="button"
                    className="qgate__btn-tiny"
                    onClick={() => onSelect(s.fileName)}
                  >
                    {isActive ? "Open" : "Load"}
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

/* ─── Building blocks ─────────────────────────────────────────────── */

function CopyCommand({ label, command, blurb }: { label: string; command: string; blurb: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="qgate__cmd">
      <div className="qgate__cmd-row">
        <strong>{label}</strong>
        <button
          type="button"
          className="qgate__btn-tiny"
          onClick={() => {
            void navigator.clipboard.writeText(command).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code className="qgate__cmd-code">{command}</code>
      <p className="qgate__cmd-blurb">{blurb}</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "good" | "warn" | "bad" | "neutral" }) {
  return (
    <div className={`qgate__stat qgate__tone--${tone}`}>
      <span className="qgate__stat-value">{value}</span>
      <span className="qgate__stat-label">{label}</span>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ─── Styles ──────────────────────────────────────────────────────── */

function QualityGateStyles() {
  return (
    <style jsx global>{`
      .qgate {
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

        max-width: 1200px;
        margin: 0 auto;
        padding: 32px 24px 64px;
        font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        min-height: 100vh;
        color: var(--ink-9);
      }
      .qgate__breadcrumb {
        font-size: 12px;
        color: var(--ink-6);
        margin-bottom: 8px;
      }
      .qgate__breadcrumb a {
        color: var(--ink-7);
        text-decoration: none;
      }
      .qgate__breadcrumb a:hover {
        text-decoration: underline;
      }
      .qgate__title {
        margin: 0 0 6px;
        font-size: 24px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .qgate__subtitle {
        margin: 0;
        font-size: 13px;
        color: var(--ink-7);
        line-height: 1.55;
        max-width: 720px;
      }
      .qgate__section {
        margin-top: 32px;
      }
      .qgate__section-title {
        margin: 0 0 12px;
        font-size: 11.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--ink-7);
      }
      .qgate__commands {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 12px;
      }
      .qgate__cmd {
        background: var(--card);
        border: 1px solid var(--ink-3);
        border-radius: 10px;
        padding: 14px 16px;
      }
      .qgate__cmd-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
        font-size: 13.5px;
      }
      .qgate__cmd-code {
        display: block;
        background: var(--ink-2);
        padding: 6px 10px;
        border-radius: 6px;
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 12px;
        margin-bottom: 6px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .qgate__cmd-blurb {
        margin: 0;
        font-size: 11.5px;
        color: var(--ink-6);
        line-height: 1.5;
      }
      .qgate__btn-tiny {
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
      .qgate__btn-tiny:hover {
        border-color: var(--good);
      }
      .qgate__hint {
        margin: 8px 0 0;
        font-size: 11.5px;
        color: var(--ink-6);
      }
      .qgate__hint code {
        background: var(--ink-2);
        padding: 1px 5px;
        border-radius: 3px;
        font-family: ui-monospace, monospace;
        font-size: 11px;
      }

      .qgate__verdict-card {
        background: var(--card);
        border: 1px solid var(--ink-3);
        border-radius: 12px;
        padding: 18px 20px;
      }
      .qgate__tone--good { border-color: var(--good-border); }
      .qgate__tone--warn { border-color: var(--warn-border); }
      .qgate__tone--bad { border-color: var(--bad-border); }
      .qgate__tone--neutral { border-color: var(--neutral-border); }

      .qgate__verdict-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .qgate__verdict-headline {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .qgate__verdict-runid {
        font-family: ui-monospace, monospace;
        font-size: 12px;
        color: var(--ink-6);
      }
      .qgate__verdict-meta {
        display: flex;
        gap: 12px;
      }
      .qgate__stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 6px 12px;
        border-radius: 8px;
        background: var(--ink-2);
        min-width: 56px;
      }
      .qgate__stat-value {
        font-size: 16px;
        font-weight: 700;
      }
      .qgate__stat-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ink-6);
      }
      .qgate__stat.qgate__tone--good { background: var(--good-bg); color: var(--good); }
      .qgate__stat.qgate__tone--warn { background: var(--warn-bg); color: var(--warn); }
      .qgate__stat.qgate__tone--bad { background: var(--bad-bg); color: var(--bad); }

      .qgate__verdict-dl {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px;
        margin: 0 0 16px;
      }
      .qgate__verdict-dl > div { font-size: 12.5px; }
      .qgate__verdict-dl dt {
        font-weight: 600;
        color: var(--ink-7);
        margin-bottom: 2px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .qgate__verdict-dl dd {
        margin: 0;
        color: var(--ink-9);
      }
      .qgate__verdict-dl code {
        font-family: ui-monospace, monospace;
        font-size: 11.5px;
        background: var(--ink-2);
        padding: 1px 5px;
        border-radius: 3px;
      }

      .qgate__verdict-pill,
      .qgate__pill {
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
      .qgate__pill--good {
        color: var(--good);
        background: var(--good-bg);
        border: 1px solid var(--good-border);
      }
      .qgate__pill--warn {
        color: var(--warn);
        background: var(--warn-bg);
        border: 1px solid var(--warn-border);
      }
      .qgate__pill--bad {
        color: var(--bad);
        background: var(--bad-bg);
        border: 1px solid var(--bad-border);
      }
      .qgate__pill--neutral {
        color: var(--neutral);
        background: var(--neutral-bg);
        border: 1px solid var(--neutral-border);
      }

      .qgate__sub-title {
        margin: 16px 0 8px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ink-7);
      }

      .qgate__check-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .qgate__check {
        background: var(--card);
        border: 1px solid var(--ink-3);
        border-radius: 8px;
      }
      .qgate__check.qgate__tone--bad { border-color: var(--bad-border); }
      .qgate__check.qgate__tone--warn { border-color: var(--warn-border); }
      .qgate__check.qgate__tone--good { border-color: var(--good-border); }
      .qgate__check-head {
        appearance: none;
        background: transparent;
        border: 0;
        padding: 8px 12px;
        width: 100%;
        cursor: pointer;
        display: grid;
        grid-template-columns: 110px 1fr 80px 60px 80px 24px;
        gap: 10px;
        align-items: center;
        font-size: 12px;
        text-align: left;
      }
      .qgate__check-id code {
        font-family: ui-monospace, monospace;
        font-size: 11.5px;
        color: var(--ink-9);
      }
      .qgate__check-req,
      .qgate__check-sev,
      .qgate__check-dur {
        font-size: 11px;
        color: var(--ink-6);
      }
      .qgate__check-toggle {
        font-weight: 600;
        color: var(--ink-7);
        text-align: center;
      }
      .qgate__check-detail {
        padding: 10px 14px 14px;
        border-top: 1px dashed var(--ink-3);
        font-size: 12px;
        color: var(--ink-8);
      }
      .qgate__check-detail p { margin: 4px 0; }
      .qgate__check-detail code {
        font-family: ui-monospace, monospace;
        font-size: 11px;
        background: var(--ink-2);
        padding: 1px 5px;
        border-radius: 3px;
      }
      .qgate__check-label {
        font-weight: 600;
        color: var(--ink-9);
      }
      .qgate__pre {
        background: var(--ink-2);
        border-radius: 6px;
        padding: 8px;
        font-family: ui-monospace, monospace;
        font-size: 11px;
        max-height: 240px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .qgate__markdown {
        width: 100%;
        min-height: 220px;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid var(--ink-3);
        background: var(--ink-2);
        font-family: ui-monospace, monospace;
        font-size: 11.5px;
        resize: vertical;
      }

      .qgate__table-wrap {
        overflow-x: auto;
        background: var(--card);
        border: 1px solid var(--ink-3);
        border-radius: 10px;
      }
      .qgate__table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .qgate__table th,
      .qgate__table td {
        padding: 8px 10px;
        text-align: left;
        border-bottom: 1px solid var(--ink-3);
      }
      .qgate__table th {
        font-size: 10.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ink-6);
        background: var(--ink-2);
      }
      .qgate__row--active {
        background: rgba(22, 163, 74, 0.05);
      }
      .qgate__filename {
        font-family: ui-monospace, monospace;
        font-size: 11px;
        color: var(--ink-7);
      }
      .qgate__loading,
      .qgate__error,
      .qgate__empty {
        padding: 12px 14px;
        background: var(--card);
        border: 1px dashed var(--ink-3);
        border-radius: 8px;
        font-size: 12.5px;
        color: var(--ink-7);
      }
      .qgate__error {
        border-color: var(--bad-border);
        color: var(--bad);
      }
    `}</style>
  );
}
