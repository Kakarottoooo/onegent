"use client";

/**
 * /dev/resy-run-analysis — Phase 0A live debug workbench.
 *
 * Reads:
 *   GET /api/dev/resy-run-analysis — single aggregated summary
 *
 * Answers four questions for codex/founder, no terminal log paste required:
 *
 *   1. Where is the live debug stuck (probe / slot / form / OTP / confirm)?
 *      → top verdict card + failure-stage funnel
 *   2. Which strategies were tried, which succeeded, which failed?
 *      → strategy ladder matrix (rows=strategy id, cols=ok/fail/...)
 *   3. What's the next safe case (or do we probe first)?
 *      → "Next safe command" copy block, populated only when verdict === RUN
 *   4. What does the founder need to provide manually?
 *      → "Founder inputs" list (OTP / CAPTCHA / final-confirm decision)
 *
 * No "run live" button on this page — only copy-paste commands. Live
 * spend stays a manual step in a terminal codex/founder controls.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  ResyAnalysisVerdict,
  ResyFailureStage,
  ResyRunAnalysisSummary,
  ResyRunCaseAnalysis,
  ResyStrategyAttempt,
} from "@/lib/benchmark/resy-run-analysis";
import {
  FAILURE_STAGE_FUNNEL,
  FAILURE_STAGE_LABEL,
  FAILURE_STAGE_TONE,
  VERDICT_LABEL,
  VERDICT_TONE,
} from "@/lib/benchmark/resy-run-analysis";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

export default function ResyRunAnalysisPage() {
  const [summary, setSummary] = useState<ResyRunAnalysisSummary | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/dev/resy-run-analysis", {
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(
            "Resy run-analysis API not available. Set ENABLE_DEV_BENCHMARK_API=1 in non-dev environments.",
          );
        }
        throw new Error(`Failed to load run analysis (${res.status})`);
      }
      const json = (await res.json()) as ResyRunAnalysisSummary;
      setSummary(json);
      setState({ status: "ready" });
    } catch (err) {
      setState({
        status: "error",
        message:
          err instanceof Error ? err.message : "Could not load run analysis.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCopy = useCallback(async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTag(tag);
      setTimeout(
        () => setCopiedTag((prev) => (prev === tag ? null : prev)),
        1500,
      );
    } catch {
      /* clipboard might be blocked; user can hand-copy */
    }
  }, []);

  return (
    <main className="rrun">
      <header className="rrun__top">
        <p className="rrun__crumb">
          <Link href="/dev">← /dev</Link>
        </p>
        <h1 className="rrun__title">Resy run analysis workbench</h1>
        <p className="rrun__sub">
          Offline analysis of the latest Phase 0A live debug. Aggregates
          benchmark report, Resy probe, debug-screenshot summaries + parses{" "}
          <code>[resy][strategy …]</code> lines into a per-strategy ladder
          matrix. Read-only — no &quot;run live&quot; button, only copy
          commands.
        </p>
        <p className="rrun__related">
          Cross-links:{" "}
          <Link className="rrun__related-link" href="/dev/restaurant-readiness">
            /dev/restaurant-readiness
          </Link>{" "}
          ·{" "}
          <Link className="rrun__related-link" href="/dev/benchmark-runs">
            /dev/benchmark-runs
          </Link>{" "}
          ·{" "}
          <Link className="rrun__related-link" href="/dev/resy-probe-runs">
            /dev/resy-probe-runs
          </Link>{" "}
          ·{" "}
          <Link className="rrun__related-link" href="/dev/debug-artifacts">
            /dev/debug-artifacts
          </Link>
        </p>
      </header>

      {state.status === "loading" && (
        <p className="rrun__muted">Loading run analysis…</p>
      )}
      {state.status === "error" && (
        <p className="rrun__error">
          {state.message}{" "}
          <button type="button" className="rrun__retry" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}

      {state.status === "ready" && summary && (
        <>
          <VerdictCard
            summary={summary}
            copiedTag={copiedTag}
            onCopy={onCopy}
          />

          <section className="rrun__section">
            <h2 className="rrun__h2">Failure-stage funnel</h2>
            <FunnelStrip distribution={summary.failureStageDistribution} />
          </section>

          <section className="rrun__section">
            <h2 className="rrun__h2">
              Latest case table{" "}
              <span className="rrun__muted-sm">
                ({summary.caseAnalyses.length} case{summary.caseAnalyses.length === 1 ? "" : "s"})
              </span>
            </h2>
            <CaseTable cases={summary.caseAnalyses} />
          </section>

          <section className="rrun__section">
            <h2 className="rrun__h2">
              Strategy ladder matrix{" "}
              <span className="rrun__muted-sm">
                ({summary.strategyLadder.length} strateg{summary.strategyLadder.length === 1 ? "y" : "ies"})
              </span>
            </h2>
            <StrategyLadderMatrix ladder={summary.strategyLadder} />
          </section>

          <section className="rrun__section">
            <h2 className="rrun__h2">Founder inputs needed</h2>
            <FounderInputsList inputs={summary.founderInputs} />
          </section>

          <footer className="rrun__foot">
            <p className="rrun__muted-sm">
              Generated at {new Date(summary.generatedAt).toLocaleString()}
              {summary.latestBenchmarkFile && (
                <>
                  {" · benchmark: "}
                  <code>{summary.latestBenchmarkFile}</code>
                </>
              )}
              {summary.latestProbeFile && (
                <>
                  {" · probe: "}
                  <code>{summary.latestProbeFile}</code>
                </>
              )}
              {" · "}
              <button
                type="button"
                onClick={() => void load()}
                className="rrun__retry"
              >
                Refresh
              </button>
            </p>
          </footer>
        </>
      )}

      <RunStyles />
    </main>
  );
}

/* ─── Verdict card ──────────────────────────────────────────────────── */

function VerdictCard({
  summary,
  copiedTag,
  onCopy,
}: {
  summary: ResyRunAnalysisSummary;
  copiedTag: string | null;
  onCopy: (text: string, tag: string) => void;
}) {
  const tone = VERDICT_TONE[summary.verdict];
  return (
    <section className={`rrun__verdict rrun__verdict--${tone}`} aria-live="polite">
      <div className="rrun__verdict-row">
        <h2 className="rrun__verdict-label">{VERDICT_LABEL[summary.verdict]}</h2>
        <code className="rrun__verdict-code">{summary.verdict}</code>
      </div>
      <p className="rrun__verdict-reason">{summary.verdictReason}</p>
      {summary.nextSafeCommand && (
        <div className="rrun__cmd">
          <code className="rrun__cmd-text">{summary.nextSafeCommand}</code>
          <button
            type="button"
            className="rrun__cmd-copy"
            onClick={() => onCopy(summary.nextSafeCommand ?? "", "verdict-cmd")}
          >
            {copiedTag === "verdict-cmd" ? "Copied!" : "Copy"}
          </button>
        </div>
      )}
    </section>
  );
}

/* ─── Funnel strip ─────────────────────────────────────────────────── */

function FunnelStrip({
  distribution,
}: {
  distribution: Record<ResyFailureStage, number>;
}) {
  return (
    <ol className="rrun__funnel">
      {FAILURE_STAGE_FUNNEL.map((stage) => {
        const count = distribution[stage] ?? 0;
        const tone = FAILURE_STAGE_TONE[stage];
        return (
          <li key={stage} className={`rrun__funnel-step rrun__funnel-step--${tone}`}>
            <div className="rrun__funnel-count">{count}</div>
            <div className="rrun__funnel-label">{FAILURE_STAGE_LABEL[stage]}</div>
          </li>
        );
      })}
      {distribution.unknown > 0 && (
        <li className="rrun__funnel-step rrun__funnel-step--neutral">
          <div className="rrun__funnel-count">{distribution.unknown}</div>
          <div className="rrun__funnel-label">{FAILURE_STAGE_LABEL.unknown}</div>
        </li>
      )}
    </ol>
  );
}

/* ─── Case table ───────────────────────────────────────────────────── */

function CaseTable({ cases }: { cases: ResyRunCaseAnalysis[] }) {
  if (cases.length === 0) {
    return (
      <p className="rrun__muted">
        No cases to analyze. Run a probe (<code>npm run probe:resy</code>) or
        a benchmark first.
      </p>
    );
  }
  return (
    <table className="rrun__cases">
      <thead>
        <tr>
          <th>Case</th>
          <th>Source</th>
          <th>Outcome</th>
          <th>Stage</th>
          <th>Strategies</th>
          <th>Probe</th>
          <th>Artifacts</th>
        </tr>
      </thead>
      <tbody>
        {cases.map((c) => (
          <CaseRow key={`${c.source}-${c.caseId}-${c.sourceFile}`} c={c} />
        ))}
      </tbody>
    </table>
  );
}

function CaseRow({ c }: { c: ResyRunCaseAnalysis }) {
  const tone = FAILURE_STAGE_TONE[c.failureStage];
  return (
    <tr className={`rrun__row rrun__row--${tone}`}>
      <td className="rrun__cell-id">{c.caseId}</td>
      <td>
        <code className="rrun__cell-src">{c.source}</code>
      </td>
      <td>
        {c.outcome ? (
          <span className="rrun__pill rrun__pill--neutral">{c.outcome}</span>
        ) : (
          <span className="rrun__muted-sm">—</span>
        )}
        {c.taxonomyCode && (
          <div className="rrun__muted-sm">
            <code>{c.taxonomyCode}</code>
          </div>
        )}
      </td>
      <td>
        <span className={`rrun__pill rrun__pill--${tone}`}>
          {FAILURE_STAGE_LABEL[c.failureStage]}
        </span>
        <div className="rrun__cell-reason">{c.failureStageReason}</div>
      </td>
      <td>
        <div className="rrun__cell-strats">
          {c.strategyAttempts.length === 0 ? (
            <span className="rrun__muted-sm">—</span>
          ) : (
            c.strategyAttempts.map((a) => (
              <span
                key={a.strategyId}
                className={
                  a.failCount > 0 && a.okCount === 0
                    ? "rrun__strat rrun__strat--bad"
                    : a.okCount > 0
                      ? "rrun__strat rrun__strat--good"
                      : "rrun__strat rrun__strat--neutral"
                }
                title={`ok=${a.okCount} fail=${a.failCount} total=${a.totalLines}`}
              >
                {a.strategyId}
              </span>
            ))
          )}
        </div>
      </td>
      <td>
        {c.matchingProbeRecommendation ? (
          <code className="rrun__muted-sm">{c.matchingProbeRecommendation}</code>
        ) : (
          <span className="rrun__muted-sm">—</span>
        )}
      </td>
      <td>
        <ul className="rrun__cell-links">
          {c.artifactLinks.map((l, i) => (
            <li key={i}>
              {l.href ? (
                <Link className="rrun__related-link" href={l.href}>
                  {l.kind}
                </Link>
              ) : (
                <code className="rrun__muted-sm">{l.kind}</code>
              )}
            </li>
          ))}
        </ul>
      </td>
    </tr>
  );
}

/* ─── Strategy ladder matrix ─────────────────────────────────────────── */

function StrategyLadderMatrix({ ladder }: { ladder: ResyStrategyAttempt[] }) {
  if (ladder.length === 0) {
    return (
      <p className="rrun__muted">
        No <code>[resy][strategy …]</code> lines parsed from the latest
        benchmark. Either codex hasn&apos;t run a live case yet, or the
        terminalReason field doesn&apos;t carry strategy traces.
      </p>
    );
  }
  return (
    <table className="rrun__matrix">
      <thead>
        <tr>
          <th>Strategy</th>
          <th>Family</th>
          <th>OK</th>
          <th>Fail</th>
          <th>Steps</th>
          <th>Filled</th>
          <th>Latest detail</th>
          <th>Cases</th>
        </tr>
      </thead>
      <tbody>
        {ladder.map((a) => (
          <tr key={a.strategyId} className={`rrun__matrix-row rrun__matrix-row--${a.family}`}>
            <td className="rrun__cell-id">{a.strategyId}</td>
            <td>
              <code>{a.family}</code>
            </td>
            <td className={a.okCount > 0 ? "rrun__num rrun__num--good" : "rrun__num"}>
              {a.okCount}
            </td>
            <td className={a.failCount > 0 ? "rrun__num rrun__num--bad" : "rrun__num"}>
              {a.failCount}
            </td>
            <td>{a.steps.length > 0 ? a.steps.join(", ") : "—"}</td>
            <td>{a.filledFields.length > 0 ? a.filledFields.join(", ") : "—"}</td>
            <td className="rrun__cell-detail">
              {a.latestError ? (
                <span className="rrun__detail-fail">fail: {a.latestError}</span>
              ) : a.latestSuccess ? (
                <span className="rrun__detail-ok">ok: {a.latestSuccess}</span>
              ) : (
                <span className="rrun__muted-sm">—</span>
              )}
            </td>
            <td>
              <code className="rrun__muted-sm">
                {a.caseIds.join(", ")}
              </code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ─── Founder inputs ──────────────────────────────────────────────── */

function FounderInputsList({ inputs }: { inputs: string[] }) {
  if (inputs.length === 0) {
    return (
      <p className="rrun__muted">
        No founder action required for the latest run. Codex / runner can
        proceed without manual input.
      </p>
    );
  }
  return (
    <ul className="rrun__founder">
      {inputs.map((i, idx) => (
        <li key={idx}>{i}</li>
      ))}
    </ul>
  );
}

/* ─── Styles ───────────────────────────────────────────────────────── */

function RunStyles() {
  return (
    <style>{`
      .rrun {
        --ink-9: #111827; --ink-7: #4b5563; --ink-6: #6b7280; --ink-3: #e5e7eb; --ink-2: #f3f4f6;
        --card: #ffffff; --bg: #fafafa;
        --good: #16a34a; --good-bg: rgba(22,163,74,0.10); --good-bd: rgba(22,163,74,0.30);
        --ok: #0ea5e9; --ok-bg: rgba(14,165,233,0.10); --ok-bd: rgba(14,165,233,0.30);
        --warn: #f59e0b; --warn-bg: rgba(245,158,11,0.12); --warn-bd: rgba(245,158,11,0.32);
        --bad: #ef4444; --bad-bg: rgba(239,68,68,0.10); --bad-bd: rgba(239,68,68,0.30);
        --neutral: #6b7280; --neutral-bg: rgba(107,114,128,0.08); --neutral-bd: rgba(107,114,128,0.25);
        max-width: 1320px; margin: 0 auto; padding: 32px 24px 64px;
        font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg); min-height: 100vh; color: var(--ink-9);
      }
      .rrun__top { margin-bottom: 18px; }
      .rrun__crumb a { color: var(--ink-6); font-size: 13px; text-decoration: none; }
      .rrun__crumb a:hover { color: var(--ink-9); }
      .rrun__title { margin: 8px 0 4px; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
      .rrun__sub { margin: 0; font-size: 13.5px; color: var(--ink-7); line-height: 1.55; max-width: 880px; }
      .rrun__sub code { background: var(--ink-2); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
      .rrun__related { margin: 8px 0 0; font-size: 12px; color: var(--ink-7); }
      .rrun__related-link { color: var(--ok); text-decoration: none; font-family: ui-monospace, SFMono-Regular, monospace; font-weight: 600; font-size: 12px; }
      .rrun__related-link:hover { text-decoration: underline; }

      .rrun__muted { color: var(--ink-6); font-size: 13px; }
      .rrun__muted-sm { color: var(--ink-6); font-size: 11.5px; }
      .rrun__error { color: var(--warn); font-size: 13px; }
      .rrun__retry { padding: 2px 10px; font-size: 11px; border: 1px solid var(--ink-3); border-radius: 4px; background: var(--card); cursor: pointer; }

      .rrun__h2 { margin: 0 0 10px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-7); }
      .rrun__section { background: var(--card); border: 1px solid var(--ink-3); border-radius: 10px; padding: 14px 18px; margin: 14px 0; }

      /* Verdict */
      .rrun__verdict { padding: 20px 24px; border-radius: 14px; margin: 16px 0; border: 2px solid var(--ink-3); background: var(--card); }
      .rrun__verdict--good { border-color: var(--good); background: linear-gradient(180deg, var(--good-bg) 0%, var(--card) 80%); }
      .rrun__verdict--warn { border-color: var(--warn); background: linear-gradient(180deg, var(--warn-bg) 0%, var(--card) 80%); }
      .rrun__verdict--bad { border-color: var(--bad); background: linear-gradient(180deg, var(--bad-bg) 0%, var(--card) 80%); }
      .rrun__verdict--neutral { border-color: var(--neutral); }
      .rrun__verdict-row { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .rrun__verdict-label { margin: 0; font-size: 22px; font-weight: 800; }
      .rrun__verdict-code { font-family: ui-monospace, monospace; font-size: 11.5px; color: var(--ink-6); background: var(--ink-2); padding: 2px 8px; border-radius: 4px; }
      .rrun__verdict-reason { margin: 8px 0 12px; font-size: 14px; color: var(--ink-7); line-height: 1.55; }

      .rrun__cmd { display: flex; align-items: stretch; gap: 0; }
      .rrun__cmd-text { flex: 1; padding: 10px 12px; background: var(--ink-2); border: 1px solid var(--ink-3); border-right: none; border-radius: 6px 0 0 6px; font-size: 12px; font-family: ui-monospace, monospace; word-break: break-all; }
      .rrun__cmd-copy { padding: 10px 14px; background: var(--ink-9); color: #fff; border: 1px solid var(--ink-9); border-radius: 0 6px 6px 0; cursor: pointer; font-size: 12px; font-weight: 600; white-space: nowrap; }
      .rrun__cmd-copy:hover { background: #000; }

      /* Funnel */
      .rrun__funnel { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
      @media (max-width: 1100px) { .rrun__funnel { grid-template-columns: repeat(4, 1fr); } }
      .rrun__funnel-step { padding: 12px 10px; border: 1px solid var(--ink-3); border-radius: 8px; background: var(--card); text-align: center; }
      .rrun__funnel-step--good { background: var(--good-bg); border-color: var(--good-bd); }
      .rrun__funnel-step--ok { background: var(--ok-bg); border-color: var(--ok-bd); }
      .rrun__funnel-step--warn { background: var(--warn-bg); border-color: var(--warn-bd); }
      .rrun__funnel-step--bad { background: var(--bad-bg); border-color: var(--bad-bd); }
      .rrun__funnel-step--neutral { background: var(--neutral-bg); border-color: var(--neutral-bd); }
      .rrun__funnel-count { font-size: 26px; font-weight: 800; line-height: 1; }
      .rrun__funnel-label { font-size: 11px; color: var(--ink-7); margin-top: 6px; }

      /* Case table + ladder matrix shared */
      .rrun__cases, .rrun__matrix { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
      .rrun__cases thead th, .rrun__matrix thead th { background: var(--ink-2); padding: 8px 10px; text-align: left; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-7); border-bottom: 1px solid var(--ink-3); }
      .rrun__cases tbody td, .rrun__matrix tbody td { padding: 8px 10px; border-top: 1px solid var(--ink-2); vertical-align: top; }
      .rrun__row--good { background: rgba(22,163,74,0.04); }
      .rrun__row--warn { background: rgba(245,158,11,0.05); }
      .rrun__row--bad { background: rgba(239,68,68,0.04); }
      .rrun__cell-id { font-family: ui-monospace, monospace; font-weight: 600; }
      .rrun__cell-src { font-family: ui-monospace, monospace; font-size: 10.5px; background: var(--ink-2); padding: 1px 5px; border-radius: 3px; }
      .rrun__cell-reason { font-size: 11px; color: var(--ink-6); margin-top: 4px; max-width: 260px; }
      .rrun__cell-strats { display: flex; flex-wrap: wrap; gap: 3px; max-width: 260px; }
      .rrun__strat { font-family: ui-monospace, monospace; font-size: 10.5px; padding: 1px 5px; border-radius: 3px; border: 1px solid var(--ink-3); }
      .rrun__strat--good { background: var(--good-bg); border-color: var(--good-bd); color: var(--good); }
      .rrun__strat--bad { background: var(--bad-bg); border-color: var(--bad-bd); color: var(--bad); }
      .rrun__strat--neutral { background: var(--ink-2); }
      .rrun__cell-links { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
      .rrun__cell-detail { max-width: 240px; word-break: break-word; }
      .rrun__detail-fail { color: var(--bad); font-size: 11px; }
      .rrun__detail-ok { color: var(--good); font-size: 11px; }

      .rrun__matrix-row--slot td { background: rgba(245,158,11,0.02); }
      .rrun__matrix-row--phone td { background: rgba(14,165,233,0.02); }
      .rrun__matrix-row--confirm td { background: rgba(22,163,74,0.02); }
      .rrun__num { font-variant-numeric: tabular-nums; font-weight: 600; }
      .rrun__num--good { color: var(--good); }
      .rrun__num--bad { color: var(--bad); }

      .rrun__pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; }
      .rrun__pill--good { background: var(--good-bg); color: var(--good); border: 1px solid var(--good-bd); }
      .rrun__pill--ok { background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok-bd); }
      .rrun__pill--warn { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn-bd); }
      .rrun__pill--bad { background: var(--bad-bg); color: var(--bad); border: 1px solid var(--bad-bd); }
      .rrun__pill--neutral { background: var(--ink-2); color: var(--ink-7); border: 1px solid var(--ink-3); }

      .rrun__founder { margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.7; color: var(--ink-7); }
      .rrun__founder li { margin-bottom: 4px; }

      .rrun__foot { margin-top: 24px; }
      .rrun__foot code { background: var(--ink-2); padding: 1px 5px; border-radius: 3px; font-size: 11px; }
    `}</style>
  );
}

// Compile-time happy if these are referenced; the page imports the type
// but the alias keeps tree-shaking obvious to the next maintainer.
export type { ResyAnalysisVerdict };
