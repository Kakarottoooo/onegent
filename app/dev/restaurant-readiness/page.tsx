"use client";

/**
 * /dev/restaurant-readiness — burn-token go/no-go control center.
 *
 * Reads:
 *   GET /api/dev/restaurant-readiness — single aggregated summary
 *
 * Why this page exists
 * ────────────────────
 * R-003 burned a live OpenAI token chasing a Resy case that had zero
 * availability slots — the agent did the right thing (correct
 * `no_availability_correct`) but you can't validate fill/OTP closure
 * on a no-slot case. The probe-first protocol added a separate dashboard
 * (/dev/resy-probe-runs) for "which case has slots". Then the benchmark
 * dashboard (/dev/benchmark-runs) tells you "did the live run pass".
 * Then the debug-artifacts viewer (/dev/debug-artifacts) tells you
 * "what did the page look like at failure".
 *
 * **Three dashboards is one too many for a single decision.** This page
 * is the single front door: ONE verdict (`READY TO BURN ONE CASE` /
 * `DO NOT BURN` / `NEEDS PROBE`), the recommended live cases pre-baked
 * with copy commands, and pointers to the per-source dashboards when the
 * founder wants to drill in.
 *
 * Explicitly NOT a "run live" button — only copy-paste commands. The
 * actual live spend is still a manual step in a terminal codex/founder
 * controls.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  ReadinessGoNoGo,
  ReadinessRecommendedCase,
  RestaurantReadinessSummary,
} from "@/lib/benchmark/restaurant-readiness";

const GO_NO_GO_LABEL: Record<ReadinessGoNoGo, string> = {
  ready_for_single_live: "READY TO BURN ONE CASE",
  needs_probe: "NEEDS PROBE",
  blocked_no_slots: "DO NOT BURN - NO SLOTS",
  blocked_no_artifacts: "DO NOT BURN - NO ARTIFACTS",
  unknown: "DO NOT BURN - PROBE BLOCKED",
};

const GO_NO_GO_TONE: Record<ReadinessGoNoGo, "good" | "warn" | "bad" | "neutral"> = {
  ready_for_single_live: "good",
  needs_probe: "neutral",
  blocked_no_slots: "warn",
  blocked_no_artifacts: "warn",
  unknown: "bad",
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready" };

export default function RestaurantReadinessPage() {
  const [summary, setSummary] = useState<RestaurantReadinessSummary | null>(null);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/dev/restaurant-readiness", {
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(
            "Readiness API not available. Set ENABLE_DEV_BENCHMARK_API=1 in non-dev environments.",
          );
        }
        throw new Error(`Failed to load readiness summary (${res.status})`);
      }
      const json = (await res.json()) as RestaurantReadinessSummary;
      setSummary(json);
      setState({ status: "ready" });
    } catch (err) {
      setState({
        status: "error",
        message:
          err instanceof Error ? err.message : "Could not load readiness summary.",
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
    <main className="rready">
      <header className="rready__top">
        <p className="rready__crumb">
          <Link href="/dev">← /dev</Link>
        </p>
        <h1 className="rready__title">Restaurant readiness control center</h1>
        <p className="rready__sub">
          One-page go/no-go before burning a live restaurant case. Aggregates
          the latest probe (<code>/dev/resy-probe-runs</code>), benchmark
          report (<code>/dev/benchmark-runs</code>), and worker debug
          artifacts (<code>/dev/debug-artifacts</code>) into a single
          verdict + copy-paste live command. Read-only — no &quot;run live&quot;
          button on purpose.
        </p>
      </header>

      {state.status === "loading" && (
        <p className="rready__muted">Loading readiness summary…</p>
      )}
      {state.status === "error" && (
        <p className="rready__error">
          {state.message}{" "}
          <button type="button" className="rready__retry" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}

      {state.status === "ready" && summary && (
        <>
          <VerdictCard
            goNoGo={summary.goNoGo}
            reason={summary.goNoGoReason}
            nextCommand={summary.nextCommand}
            warnings={summary.warnings}
            copiedTag={copiedTag}
            onCopy={onCopy}
          />

          <section className="rready__section">
            <h2 className="rready__h2">Recommended live cases</h2>
            <RecommendedCasesTable
              cases={summary.recommendedCases}
              copiedTag={copiedTag}
              onCopy={onCopy}
            />
          </section>

          <div className="rready__row2">
            <section className="rready__section">
              <h2 className="rready__h2">Latest benchmark</h2>
              <BenchmarkPanel benchmark={summary.latestBenchmark} />
            </section>
            <section className="rready__section">
              <h2 className="rready__h2">Latest debug artifacts</h2>
              <ArtifactsPanel artifacts={summary.latestDebugArtifacts} />
            </section>
          </div>

          <StopRulesCard />

          <footer className="rready__foot">
            <p className="rready__muted-sm">
              Generated at {new Date(summary.generatedAt).toLocaleString()}.{" "}
              <button
                type="button"
                onClick={() => void load()}
                className="rready__retry"
              >
                Refresh
              </button>
            </p>
          </footer>
        </>
      )}

      <ReadyStyles />
    </main>
  );
}

/* ─── Verdict card ────────────────────────────────────────────────── */

function VerdictCard({
  goNoGo,
  reason,
  nextCommand,
  warnings,
  copiedTag,
  onCopy,
}: {
  goNoGo: ReadinessGoNoGo;
  reason: string;
  nextCommand: string | null;
  warnings: string[];
  copiedTag: string | null;
  onCopy: (text: string, tag: string) => void;
}) {
  const tone = GO_NO_GO_TONE[goNoGo];
  return (
    <section
      className={`rready__verdict rready__verdict--${tone}`}
      aria-live="polite"
    >
      <div className="rready__verdict-row">
        <h2 className="rready__verdict-label">{GO_NO_GO_LABEL[goNoGo]}</h2>
        <code className="rready__verdict-code">{goNoGo}</code>
      </div>
      <p className="rready__verdict-reason">{reason}</p>

      {nextCommand && (
        <div className="rready__cmd">
          <code className="rready__cmd-text">{nextCommand}</code>
          <button
            type="button"
            className="rready__cmd-copy"
            onClick={() => onCopy(nextCommand, "verdict-cmd")}
          >
            {copiedTag === "verdict-cmd" ? "Copied!" : "Copy"}
          </button>
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="rready__warnings">
          {warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─── Recommended cases table ─────────────────────────────────────── */

function RecommendedCasesTable({
  cases,
  copiedTag,
  onCopy,
}: {
  cases: ReadinessRecommendedCase[];
  copiedTag: string | null;
  onCopy: (text: string, tag: string) => void;
}) {
  if (cases.length === 0) {
    return (
      <p className="rready__muted">
        No <code>use_for_live_fill_test</code> cases in the latest probe. Run{" "}
        <code>npm run probe:resy</code> to get a fresh suggestion, or expand
        the fixture (codex domain).
      </p>
    );
  }
  return (
    <table className="rready__cases">
      <thead>
        <tr>
          <th>Case</th>
          <th>Restaurant</th>
          <th>Date / time / covers</th>
          <th>Slots</th>
          <th>Venue</th>
          <th>Live command</th>
        </tr>
      </thead>
      <tbody>
        {cases.map((c) => {
          const tag = `rec-${c.caseId}`;
          return (
            <tr key={c.caseId}>
              <td className="rready__cell-id">{c.caseId}</td>
              <td>{c.restaurantName}</td>
              <td className="rready__cell-when">
                {c.date ?? "—"} · {c.time} · {c.covers ?? "—"}p
              </td>
              <td>
                <strong>{c.matchingSlotsCount}</strong>
              </td>
              <td className="rready__cell-venue">
                {c.exactVenueMatch ? (
                  <span className="rready__pill rready__pill--good">exact</span>
                ) : (
                  <span className="rready__pill rready__pill--warn">
                    mismatch
                  </span>
                )}
              </td>
              <td className="rready__cell-cmd">
                <code className="rready__cmd-inline">{c.liveCommand}</code>
                <button
                  type="button"
                  className="rready__cmd-copy rready__cmd-copy--inline"
                  onClick={() => onCopy(c.liveCommand, tag)}
                >
                  {copiedTag === tag ? "Copied!" : "Copy"}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ─── Benchmark panel ─────────────────────────────────────────────── */

function BenchmarkPanel({
  benchmark,
}: {
  benchmark: RestaurantReadinessSummary["latestBenchmark"];
}) {
  if (!benchmark) {
    return (
      <p className="rready__muted">
        No <code>phase0-*.json</code> benchmark report yet. Codex&apos;s next
        live R-* run will write one.
      </p>
    );
  }
  return (
    <div className="rready__bench">
      <div className="rready__bench-row">
        <span
          className={
            benchmark.passed
              ? "rready__pill rready__pill--good"
              : "rready__pill rready__pill--warn"
          }
        >
          {benchmark.passed ? "GATE PASS" : "GATE FAIL"}
        </span>
        <code>{benchmark.runId}</code>
      </div>
      <p className="rready__muted-sm">
        {new Date(benchmark.createdAt).toLocaleString()} · {benchmark.total}{" "}
        case(s)
      </p>
      <ul className="rready__bench-stats">
        <li>
          ✅ booking-ready: <strong>{percent(benchmark.bookingReadyRate)}</strong>
        </li>
        <li>
          🟦 safe outcome: <strong>{percent(benchmark.safeOutcomeRate)}</strong>
        </li>
        <li>
          🟥 severe error: <strong>{percent(benchmark.severeErrorRate)}</strong>
          {benchmark.severeCount > 0 && (
            <>
              {" "}
              ({benchmark.severeCount} case(s)
              {benchmark.firstSevereCaseId && (
                <>, first <code>{benchmark.firstSevereCaseId}</code></>
              )}
              )
            </>
          )}
        </li>
        <li>
          🟪 taxonomy coverage:{" "}
          <strong>{percent(benchmark.taxonomyCoverageRate)}</strong>
        </li>
        {benchmark.noAvailabilityCorrectCount > 0 && (
          <li>
            no_availability_correct: {benchmark.noAvailabilityCorrectCount}{" "}
            case(s)
          </li>
        )}
        {benchmark.safeFailureCount > 0 && (
          <li>safe failure: {benchmark.safeFailureCount} case(s)</li>
        )}
      </ul>
      <Link className="rready__related-link" href="/dev/benchmark-runs">
        Open /dev/benchmark-runs →
      </Link>
    </div>
  );
}

function percent(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(0)}%`;
}

/* ─── Artifacts panel ─────────────────────────────────────────────── */

function ArtifactsPanel({
  artifacts,
}: {
  artifacts: RestaurantReadinessSummary["latestDebugArtifacts"];
}) {
  if (artifacts.length === 0) {
    return (
      <p className="rready__muted">
        No <code>worker/.debug-screenshots/</code> captures in this worktree.
        Captures land here when a worker run hits a terminal failure.
      </p>
    );
  }
  return (
    <ul className="rready__artifacts">
      {artifacts.map((a) => (
        <li key={`${a.provider}/${a.runId}`} className="rready__artifact">
          <div className="rready__artifact-row">
            <code className="rready__artifact-provider">{a.provider}</code>
            <span className="rready__muted-sm">
              {a.capturedAt ? new Date(a.capturedAt).toLocaleString() : a.runId}
            </span>
          </div>
          <div className="rready__artifact-label">{a.label || "(no label)"}</div>
          {a.summaryError && (
            <div className="rready__artifact-error">
              error: {a.summaryError.slice(0, 140)}
              {a.summaryError.length > 140 ? "…" : ""}
            </div>
          )}
        </li>
      ))}
      <li className="rready__artifact-link-row">
        <Link className="rready__related-link" href="/dev/debug-artifacts">
          Open /dev/debug-artifacts →
        </Link>
      </li>
    </ul>
  );
}

/* ─── Stop-rules card ─────────────────────────────────────────────── */

function StopRulesCard() {
  return (
    <section className="rready__stop">
      <h2 className="rready__h2">Stop rules — when NOT to burn a live token</h2>
      <ul className="rready__stop-list">
        <li>
          <strong>0 matching slots</strong> for the recommended case → don&apos;t
          run live; the result will only re-validate{" "}
          <code>no_availability_correct</code>, not fill / OTP closure.
        </li>
        <li>
          <strong>Outcome was no_availability_correct</strong> on the previous
          live run → don&apos;t patch the provider; instead pick a different
          case with matching slots.
        </li>
        <li>
          <strong>Strategy log shows a specific [resy][strategy …] failure</strong>{" "}
          → fix that strategy first; don&apos;t blind-retry. Open{" "}
          <Link className="rready__related-link" href="/dev/benchmark-runs">
            /dev/benchmark-runs
          </Link>{" "}
          and click the case row to see the strategy log.
        </li>
        <li>
          <strong>OTP wall reached</strong> → Phase 0A counts this as
          <em> safe handoff</em> per § 7.5; warm session decision is{" "}
          <em>待定</em>. Don&apos;t treat as failure.
        </li>
        <li>
          <strong>Probe is &gt;24h old</strong> → slots may have been booked.
          Re-run <code>npm run probe:resy</code> before live spend.
        </li>
      </ul>
    </section>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────── */

function ReadyStyles() {
  return (
    <style>{`
      .rready {
        --ink-9: #111827; --ink-7: #4b5563; --ink-6: #6b7280; --ink-3: #e5e7eb; --ink-2: #f3f4f6;
        --card: #ffffff; --bg: #fafafa;
        --good: #16a34a; --good-bg: rgba(22,163,74,0.10); --good-bd: rgba(22,163,74,0.30);
        --ok: #0ea5e9; --ok-bg: rgba(14,165,233,0.10); --ok-bd: rgba(14,165,233,0.30);
        --warn: #f59e0b; --warn-bg: rgba(245,158,11,0.12); --warn-bd: rgba(245,158,11,0.32);
        --bad: #ef4444; --bad-bg: rgba(239,68,68,0.10); --bad-bd: rgba(239,68,68,0.30);
        --neutral: #6b7280; --neutral-bg: rgba(107,114,128,0.08); --neutral-bd: rgba(107,114,128,0.25);
        max-width: 1280px; margin: 0 auto; padding: 32px 24px 64px;
        font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg); min-height: 100vh; color: var(--ink-9);
      }
      .rready__top { margin-bottom: 18px; }
      .rready__crumb a { color: var(--ink-6); font-size: 13px; text-decoration: none; }
      .rready__crumb a:hover { color: var(--ink-9); }
      .rready__title { margin: 8px 0 4px; font-size: 28px; font-weight: 700; letter-spacing: -0.01em; }
      .rready__sub { margin: 0; font-size: 13.5px; color: var(--ink-7); line-height: 1.55; max-width: 880px; }
      .rready__sub code { background: var(--ink-2); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
      .rready__muted { color: var(--ink-6); font-size: 13px; }
      .rready__muted-sm { color: var(--ink-6); font-size: 11.5px; }
      .rready__error { color: var(--warn); font-size: 13px; }
      .rready__retry { margin-left: 8px; padding: 2px 10px; font-size: 11px; border: 1px solid var(--ink-3); border-radius: 4px; background: var(--card); cursor: pointer; }
      .rready__h2 { margin: 0 0 10px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-7); }
      .rready__related-link { color: var(--ok); text-decoration: none; font-size: 12.5px; font-weight: 600; }
      .rready__related-link:hover { text-decoration: underline; }

      /* Verdict card */
      .rready__verdict { padding: 20px 24px; border-radius: 14px; margin: 18px 0 22px; border: 2px solid var(--ink-3); background: var(--card); }
      .rready__verdict--good { border-color: var(--good); background: linear-gradient(180deg, var(--good-bg) 0%, var(--card) 80%); }
      .rready__verdict--warn { border-color: var(--warn); background: linear-gradient(180deg, var(--warn-bg) 0%, var(--card) 80%); }
      .rready__verdict--bad { border-color: var(--bad); background: linear-gradient(180deg, var(--bad-bg) 0%, var(--card) 80%); }
      .rready__verdict--neutral { border-color: var(--neutral); background: var(--card); }
      .rready__verdict-row { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .rready__verdict-label { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: 0.01em; }
      .rready__verdict-code { font-family: ui-monospace, monospace; font-size: 11.5px; color: var(--ink-6); background: var(--ink-2); padding: 2px 8px; border-radius: 4px; }
      .rready__verdict-reason { margin: 8px 0 14px; font-size: 14px; color: var(--ink-7); line-height: 1.55; }
      .rready__warnings { margin: 12px 0 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; color: var(--warn); }

      /* Command boxes */
      .rready__cmd { display: flex; align-items: stretch; gap: 0; margin-bottom: 8px; }
      .rready__cmd-text { flex: 1; padding: 10px 12px; background: var(--ink-2); border: 1px solid var(--ink-3); border-right: none; border-radius: 6px 0 0 6px; font-size: 12px; font-family: ui-monospace, monospace; word-break: break-all; }
      .rready__cmd-copy { padding: 10px 14px; background: var(--ink-9); color: #fff; border: 1px solid var(--ink-9); border-radius: 0 6px 6px 0; cursor: pointer; font-size: 12px; font-weight: 600; white-space: nowrap; }
      .rready__cmd-copy:hover { background: #000; }
      .rready__cmd-copy--inline { padding: 4px 8px; font-size: 11px; border-radius: 4px; margin-left: 6px; }

      /* Sections */
      .rready__section { background: var(--card); border: 1px solid var(--ink-3); border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; }
      .rready__row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      @media (max-width: 900px) { .rready__row2 { grid-template-columns: 1fr; } }
      .rready__row2 .rready__section { margin-bottom: 0; }

      /* Cases table */
      .rready__cases { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
      .rready__cases thead th { background: var(--ink-2); padding: 8px 10px; text-align: left; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-7); border-bottom: 1px solid var(--ink-3); }
      .rready__cases tbody td { padding: 8px 10px; border-top: 1px solid var(--ink-2); vertical-align: middle; }
      .rready__cell-id { font-family: ui-monospace, monospace; font-weight: 600; }
      .rready__cell-when { color: var(--ink-7); white-space: nowrap; font-variant-numeric: tabular-nums; }
      .rready__cell-venue { white-space: nowrap; }
      .rready__cell-cmd { display: flex; align-items: center; gap: 0; }
      .rready__cmd-inline { font-family: ui-monospace, monospace; font-size: 11px; background: var(--ink-2); padding: 4px 8px; border-radius: 4px; word-break: break-all; max-width: 380px; }

      /* Pills */
      .rready__pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700; }
      .rready__pill--good { background: var(--good-bg); color: var(--good); border: 1px solid var(--good-bd); }
      .rready__pill--warn { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn-bd); }
      .rready__pill--bad { background: var(--bad-bg); color: var(--bad); border: 1px solid var(--bad-bd); }

      /* Benchmark panel */
      .rready__bench-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .rready__bench-row code { font-family: ui-monospace, monospace; font-size: 11.5px; color: var(--ink-7); }
      .rready__bench-stats { margin: 10px 0; padding-left: 0; list-style: none; font-size: 12.5px; line-height: 1.7; color: var(--ink-7); }
      .rready__bench-stats li code { font-family: ui-monospace, monospace; font-size: 11px; background: var(--ink-2); padding: 1px 5px; border-radius: 3px; }
      .rready__bench-stats strong { color: var(--ink-9); font-variant-numeric: tabular-nums; }

      /* Artifacts panel */
      .rready__artifacts { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
      .rready__artifact { background: var(--ink-2); border-radius: 6px; padding: 8px 10px; }
      .rready__artifact-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
      .rready__artifact-provider { font-family: ui-monospace, monospace; font-weight: 700; font-size: 11.5px; color: var(--ink-9); }
      .rready__artifact-label { font-size: 11.5px; color: var(--ink-7); margin-top: 2px; }
      .rready__artifact-error { font-size: 11px; color: var(--warn); margin-top: 4px; }
      .rready__artifact-link-row { background: none; padding: 4px 0 0; }

      /* Stop rules */
      .rready__stop { background: var(--ink-2); border: 1px solid var(--ink-3); border-radius: 10px; padding: 14px 18px; margin: 16px 0 0; }
      .rready__stop-list { margin: 8px 0 0; padding-left: 22px; font-size: 13px; line-height: 1.7; color: var(--ink-7); }
      .rready__stop-list strong { color: var(--ink-9); }
      .rready__stop-list code { background: var(--card); padding: 1px 5px; border-radius: 3px; font-size: 11.5px; }

      .rready__foot { margin-top: 24px; }
    `}</style>
  );
}
