"use client";

/**
 * /dev/resy-probe-runs — Resy availability probe dashboard.
 *
 * Reads dev-only endpoints:
 *   GET /api/dev/resy-probe-runs            — list of probe runs
 *   GET /api/dev/resy-probe-runs/{file}     — full run content
 *
 * The probe runner (codex's `scripts/probe-resy-availability.ts`, in
 * flight at the time of this page's first ship) writes one JSON file per
 * run to `benchmark/runs/resy-availability-probe-<ts>.json`. Schema lives
 * in `lib/benchmark/resy-probe-report.ts`.
 *
 * Why this exists
 * ───────────────
 * R-003 burned a live OpenAI token chasing a Resy case that had zero
 * availability slots on the requested date — the agent did the right
 * thing (`no_availability_correct`) but you can't validate fill/OTP
 * closure on a no-slot case. Probe-first surfaces which cases actually
 * have live availability so the next live token spend is on a case that
 * can prove fill/OTP works.
 *
 * Founder doesn't read terminal JSON anymore — this page is the
 * single-screen answer to "which case should I run live next?".
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  ResyProbeCase,
  ResyProbeRun,
  ResyProbeRunSummary,
} from "@/lib/benchmark/resy-probe-report";
import {
  RECOMMENDATION_LABEL,
  RECOMMENDATION_TONE,
} from "@/lib/benchmark/resy-probe-report";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

interface ListResp {
  runs: ResyProbeRunSummary[];
  total: number;
}
interface SingleResp {
  run: ResyProbeRun;
}

export default function ResyProbeRunsPage() {
  const [runs, setRuns] = useState<ResyProbeRunSummary[]>([]);
  const [listState, setListState] = useState<LoadState>({ status: "loading" });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [run, setRun] = useState<ResyProbeRun | null>(null);
  const [runState, setRunState] = useState<LoadState>({ status: "loading" });
  const [copied, setCopied] = useState(false);

  /* ─── Loaders ─────────────────────────────────────────────────────── */

  const loadList = useCallback(async () => {
    setListState({ status: "loading" });
    try {
      const res = await fetch("/api/dev/resy-probe-runs", { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error("Probe API not available. Set ENABLE_DEV_BENCHMARK_API=1 in non-dev environments.");
        }
        throw new Error(`Failed to load run list (${res.status})`);
      }
      const json = (await res.json()) as ListResp;
      setRuns(json.runs);
      setListState({ status: "ready" });
      setSelectedFile((prev) => prev ?? json.runs[0]?.file ?? null);
    } catch (err) {
      setListState({
        status: "error",
        message: err instanceof Error ? err.message : "Could not load run list.",
      });
    }
  }, []);

  const loadRun = useCallback(async (file: string) => {
    setRunState({ status: "loading" });
    setRun(null);
    try {
      const res = await fetch(`/api/dev/resy-probe-runs/${encodeURIComponent(file)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Failed to load probe run (${res.status})`);
      }
      const json = (await res.json()) as SingleResp;
      setRun(json.run);
      setRunState({ status: "ready" });
    } catch (err) {
      setRunState({
        status: "error",
        message: err instanceof Error ? err.message : "Could not load probe run.",
      });
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedFile) void loadRun(selectedFile);
  }, [selectedFile, loadRun]);

  const copyCommand = useCallback(async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop — clipboard might be blocked; user can hand-copy */
    }
  }, []);

  /* ─── Render ──────────────────────────────────────────────────────── */

  return (
    <main className="rprobe">
      <header className="rprobe__top">
        <p className="rprobe__crumb">
          <Link href="/dev">← /dev</Link>
        </p>
        <h1 className="rprobe__title">Resy availability probe runs</h1>
        <p className="rprobe__sub">
          Cheap no-token probe of Resy availability for Phase 0 fixture cases.
          Probe-first protocol: don&apos;t spend a live token on a case unless
          this dashboard says it has matching slots. Source: <code>benchmark/runs/resy-availability-probe-*.json</code>.
        </p>
      </header>

      <section className="rprobe__layout">
        <aside className="rprobe__list">
          <h2 className="rprobe__h2">Runs</h2>
          {listState.status === "loading" && <p className="rprobe__muted">Loading…</p>}
          {listState.status === "error" && (
            <p className="rprobe__error">
              {listState.message}{" "}
              <button type="button" onClick={() => void loadList()} className="rprobe__retry">
                Retry
              </button>
            </p>
          )}
          {listState.status === "ready" && runs.length === 0 && (
            <div className="rprobe__empty">
              <p>No probe runs yet.</p>
              <p>
                Generate one (codex domain):
                <br />
                <code>npx tsx scripts/probe-resy-availability.ts</code>
              </p>
            </div>
          )}
          {listState.status === "ready" && runs.length > 0 && (
            <ol className="rprobe__list-items">
              {runs.map((r) => (
                <li
                  key={r.file}
                  className={
                    r.file === selectedFile
                      ? "rprobe__list-item rprobe__list-item--active"
                      : "rprobe__list-item"
                  }
                >
                  <button
                    type="button"
                    onClick={() => setSelectedFile(r.file)}
                    className="rprobe__list-btn"
                  >
                    <div className="rprobe__list-when">
                      {r.startedAt ? new Date(r.startedAt).toLocaleString() : r.file}
                    </div>
                    <div className="rprobe__list-meta">
                      {r.live_ok ?? "?"}/{r.total ?? "?"} live_ok ·{" "}
                      <span className="rprobe__rec-id">
                        rec: {r.recommendedCaseId ?? "—"}
                      </span>
                    </div>
                    <code className="rprobe__list-file">{r.file}</code>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </aside>

        <section className="rprobe__main">
          {runState.status === "loading" && <p className="rprobe__muted">Loading run…</p>}
          {runState.status === "error" && (
            <p className="rprobe__error">{runState.message}</p>
          )}
          {runState.status === "ready" && run && (
            <>
              <RecommendedCard run={run} copied={copied} onCopy={copyCommand} />
              <SummaryStrip run={run} />
              <RunnerNotes run={run} />
              <CasesTable cases={run.cases} />
            </>
          )}
        </section>
      </section>

      <ResyProbeStyles />
    </main>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────── */

function RecommendedCard({
  run,
  copied,
  onCopy,
}: {
  run: ResyProbeRun;
  copied: boolean;
  onCopy: (cmd: string) => void;
}) {
  return (
    <div className="rprobe__rec">
      <div className="rprobe__rec-row">
        <h2 className="rprobe__rec-title">Recommended next live case</h2>
        <span
          className={
            run.recommendedCase.caseId
              ? "rprobe__rec-badge rprobe__rec-badge--ok"
              : "rprobe__rec-badge rprobe__rec-badge--none"
          }
        >
          {run.recommendedCase.caseId ?? "no case qualifies"}
        </span>
      </div>
      <p className="rprobe__rec-rationale">{run.recommendedCase.rationale}</p>
      <div className="rprobe__cmd">
        <code className="rprobe__cmd-text">{run.recommendedCase.nextLiveCommand}</code>
        <button
          type="button"
          className="rprobe__cmd-copy"
          onClick={() => onCopy(run.recommendedCase.nextLiveCommand)}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function SummaryStrip({ run }: { run: ResyProbeRun }) {
  return (
    <div className="rprobe__summary">
      <SummaryStat label="Total cases" value={run.summary.total} tone="neutral" />
      <SummaryStat label="Live OK" value={run.summary.live_ok} tone="good" />
      <SummaryStat
        label="No slots (correct)"
        value={run.summary.live_no_slots_correct}
        tone="ok"
      />
      <SummaryStat label="Skip / blocker" value={run.summary.skip} tone="warn" />
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "good" | "ok" | "warn";
}) {
  return (
    <div className={`rprobe__stat rprobe__stat--${tone}`}>
      <div className="rprobe__stat-value">{value}</div>
      <div className="rprobe__stat-label">{label}</div>
    </div>
  );
}

function RunnerNotes({ run }: { run: ResyProbeRun }) {
  if (run.runnerNotes.length === 0) return null;
  return (
    <details className="rprobe__notes">
      <summary>Runner notes ({run.runnerNotes.length})</summary>
      <ul>
        {run.runnerNotes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </details>
  );
}

function CasesTable({ cases }: { cases: ResyProbeCase[] }) {
  return (
    <table className="rprobe__cases">
      <thead>
        <tr>
          <th>Case</th>
          <th>Restaurant</th>
          <th>Date / time / covers</th>
          <th>Slots / matching</th>
          <th>Signals</th>
          <th>Verdict</th>
        </tr>
      </thead>
      <tbody>
        {cases.map((c) => (
          <CaseRow key={c.caseId} c={c} />
        ))}
      </tbody>
    </table>
  );
}

function CaseRow({ c }: { c: ResyProbeCase }) {
  const tone = RECOMMENDATION_TONE[c.recommendation];
  return (
    <tr className={`rprobe__row rprobe__row--${tone}`}>
      <td className="rprobe__cell-id">{c.caseId}</td>
      <td>{c.restaurant}</td>
      <td className="rprobe__cell-when">
        {c.date} · {c.time || "any"} · {c.covers}p
      </td>
      <td className="rprobe__cell-slots">
        <strong>{c.slots.length}</strong> total / <strong>{c.matchingSlots.length}</strong> match
        {c.matchingSlots.length > 0 && (
          <div className="rprobe__chip-row">
            {c.matchingSlots.slice(0, 5).map((s, i) => (
              <span key={i} className="rprobe__chip">
                {s.time}
                {s.type ? ` · ${s.type}` : ""}
              </span>
            ))}
            {c.matchingSlots.length > 5 && (
              <span className="rprobe__chip-more">+{c.matchingSlots.length - 5}</span>
            )}
          </div>
        )}
      </td>
      <td className="rprobe__cell-sig">
        {c.noAvailabilitySignals.map((s) => (
          <span key={s} className="rprobe__sig rprobe__sig--no-avail">
            {s}
          </span>
        ))}
        {c.blockerSignals.map((s) => (
          <span key={s} className="rprobe__sig rprobe__sig--blocker">
            ⚠ {s}
          </span>
        ))}
        {c.note && <div className="rprobe__note">{c.note}</div>}
      </td>
      <td>
        <span className={`rprobe__verdict rprobe__verdict--${tone}`}>
          {RECOMMENDATION_LABEL[c.recommendation]}
        </span>
      </td>
    </tr>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────── */

function ResyProbeStyles() {
  return (
    <style>{`
      .rprobe {
        --ink-9: #111827; --ink-7: #4b5563; --ink-6: #6b7280; --ink-3: #e5e7eb; --ink-2: #f3f4f6;
        --card: #ffffff; --bg: #fafafa;
        --good: #16a34a; --good-bg: rgba(22,163,74,0.10); --good-bd: rgba(22,163,74,0.30);
        --ok: #0ea5e9; --ok-bg: rgba(14,165,233,0.10); --ok-bd: rgba(14,165,233,0.30);
        --warn: #f59e0b; --warn-bg: rgba(245,158,11,0.12); --warn-bd: rgba(245,158,11,0.32);
        max-width: 1280px; margin: 0 auto; padding: 32px 24px 64px;
        font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg); min-height: 100vh; color: var(--ink-9);
      }
      .rprobe__top { margin-bottom: 24px; }
      .rprobe__crumb a { color: var(--ink-6); font-size: 13px; text-decoration: none; }
      .rprobe__crumb a:hover { color: var(--ink-9); }
      .rprobe__title { margin: 8px 0 4px; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
      .rprobe__sub { margin: 0; font-size: 13.5px; color: var(--ink-7); line-height: 1.55; max-width: 800px; }
      .rprobe__sub code { background: var(--ink-2); padding: 1px 5px; border-radius: 3px; font-size: 12px; }

      .rprobe__layout {
        display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 20px; margin-top: 20px;
      }
      @media (max-width: 900px) { .rprobe__layout { grid-template-columns: 1fr; } }

      .rprobe__list { background: var(--card); border: 1px solid var(--ink-3); border-radius: 10px; padding: 14px; }
      .rprobe__h2 { margin: 0 0 10px; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-7); }
      .rprobe__list-items { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
      .rprobe__list-item--active .rprobe__list-btn { background: var(--ok-bg); border-color: var(--ok-bd); }
      .rprobe__list-btn { width: 100%; text-align: left; padding: 10px 12px; border: 1px solid var(--ink-3); border-radius: 8px; background: var(--card); cursor: pointer; transition: border-color 120ms; font: inherit; color: inherit; }
      .rprobe__list-btn:hover { border-color: var(--ok); }
      .rprobe__list-when { font-size: 12px; font-weight: 600; }
      .rprobe__list-meta { font-size: 11.5px; color: var(--ink-6); margin-top: 2px; }
      .rprobe__rec-id { color: var(--good); font-weight: 600; }
      .rprobe__list-file { display: block; margin-top: 4px; font-size: 10px; color: var(--ink-6); font-family: ui-monospace, monospace; word-break: break-all; }

      .rprobe__main { display: flex; flex-direction: column; gap: 14px; }

      .rprobe__rec { background: var(--card); border: 1px solid var(--good-bd); border-radius: 12px; padding: 18px 20px; }
      .rprobe__rec-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .rprobe__rec-title { margin: 0; font-size: 15px; font-weight: 600; }
      .rprobe__rec-badge { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 3px 10px; border-radius: 999px; }
      .rprobe__rec-badge--ok { background: var(--good-bg); color: var(--good); border: 1px solid var(--good-bd); }
      .rprobe__rec-badge--none { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn-bd); }
      .rprobe__rec-rationale { margin: 8px 0 12px; font-size: 13px; color: var(--ink-7); line-height: 1.55; }
      .rprobe__cmd { display: flex; align-items: stretch; gap: 0; }
      .rprobe__cmd-text { flex: 1; padding: 10px 12px; background: var(--ink-2); border: 1px solid var(--ink-3); border-right: none; border-radius: 6px 0 0 6px; font-size: 12px; font-family: ui-monospace, monospace; word-break: break-all; }
      .rprobe__cmd-copy { padding: 10px 14px; background: var(--ink-9); color: #fff; border: 1px solid var(--ink-9); border-radius: 0 6px 6px 0; cursor: pointer; font-size: 12px; font-weight: 600; }
      .rprobe__cmd-copy:hover { background: #000; }

      .rprobe__summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
      @media (max-width: 700px) { .rprobe__summary { grid-template-columns: repeat(2, 1fr); } }
      .rprobe__stat { background: var(--card); border: 1px solid var(--ink-3); border-radius: 10px; padding: 12px 14px; }
      .rprobe__stat-value { font-size: 22px; font-weight: 700; line-height: 1.1; }
      .rprobe__stat-label { font-size: 11px; color: var(--ink-6); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
      .rprobe__stat--good .rprobe__stat-value { color: var(--good); }
      .rprobe__stat--ok .rprobe__stat-value { color: var(--ok); }
      .rprobe__stat--warn .rprobe__stat-value { color: var(--warn); }

      .rprobe__notes { background: var(--card); border: 1px solid var(--ink-3); border-radius: 10px; padding: 10px 14px; font-size: 13px; }
      .rprobe__notes summary { cursor: pointer; font-weight: 600; }
      .rprobe__notes ul { margin: 8px 0 0; padding-left: 20px; color: var(--ink-7); }

      .rprobe__cases { width: 100%; border-collapse: separate; border-spacing: 0; background: var(--card); border: 1px solid var(--ink-3); border-radius: 10px; overflow: hidden; font-size: 12.5px; }
      .rprobe__cases thead th { background: var(--ink-2); padding: 10px 12px; text-align: left; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-7); border-bottom: 1px solid var(--ink-3); }
      .rprobe__cases tbody td { padding: 10px 12px; border-top: 1px solid var(--ink-2); vertical-align: top; }
      .rprobe__row--good { background: rgba(22,163,74,0.03); }
      .rprobe__row--warn { background: rgba(245,158,11,0.04); }
      .rprobe__cell-id { font-family: ui-monospace, monospace; font-weight: 600; }
      .rprobe__cell-when { color: var(--ink-7); white-space: nowrap; }
      .rprobe__cell-slots strong { font-weight: 600; }
      .rprobe__chip-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
      .rprobe__chip { padding: 2px 7px; border-radius: 999px; background: var(--good-bg); color: var(--good); border: 1px solid var(--good-bd); font-size: 10.5px; font-weight: 600; }
      .rprobe__chip-more { padding: 2px 7px; border-radius: 999px; background: var(--ink-2); color: var(--ink-6); font-size: 10.5px; }
      .rprobe__cell-sig { color: var(--ink-7); }
      .rprobe__sig { display: inline-block; padding: 2px 7px; border-radius: 999px; font-size: 10.5px; margin: 0 4px 4px 0; font-weight: 600; }
      .rprobe__sig--no-avail { background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok-bd); }
      .rprobe__sig--blocker { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn-bd); }
      .rprobe__note { font-size: 11px; color: var(--ink-6); margin-top: 4px; font-style: italic; }
      .rprobe__verdict { padding: 3px 10px; border-radius: 999px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
      .rprobe__verdict--good { background: var(--good-bg); color: var(--good); border: 1px solid var(--good-bd); }
      .rprobe__verdict--ok { background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok-bd); }
      .rprobe__verdict--warn { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn-bd); }

      .rprobe__muted { color: var(--ink-6); font-size: 13px; }
      .rprobe__error { color: var(--warn); font-size: 13px; }
      .rprobe__retry { margin-left: 8px; padding: 2px 10px; font-size: 11px; border: 1px solid var(--ink-3); border-radius: 4px; background: var(--card); cursor: pointer; }
      .rprobe__empty { text-align: center; padding: 18px 6px; color: var(--ink-6); font-size: 13px; }
      .rprobe__empty code { background: var(--ink-2); padding: 1px 5px; border-radius: 3px; }
    `}</style>
  );
}
