"use client";

/**
 * GateBreakdown — Phase 0 acceptance gate decomposition.
 *
 * The dashboard already shows a single PASS/FAIL pill (driven by
 * `metrics.passed` from the runner). When a run fails, the next question
 * the operator asks is "by how much, and what would I have to fix?".
 * Computing those deltas in your head from the four MetricCards is
 * exactly the kind of friction this component eliminates.
 *
 * What this component DOES:
 *   - Shows current value vs the published Phase 0 target (per
 *     BENCHMARK_RESTAURANT_100.md § 7.2) for each of the 4 metrics
 *   - Marks each row met (✓) / short (✗) using the published targets
 *   - When at least one row is short, surfaces actionable recommendations
 *     ranked by leverage (top failing taxonomy → biggest unblock)
 *   - Lists severe case IDs explicitly (Phase 0 BLOCKERS per § 7.3)
 *   - Lists uncategorized case IDs (taxonomy coverage gap)
 *
 * What this component does NOT do:
 *   - Recompute pass/fail. The runner owns that decision and writes
 *     `metrics.passed`. We only compute distance to PUBLISHED targets,
 *     which lives in BENCHMARK_RESTAURANT_100.md as documentation.
 *   - Prescribe specific code fixes. Only patterns ("cluster on
 *     F-PROVIDER-OTP → file a focused fix") per the doc.
 *
 * If `metrics.passed` and per-row status disagree (e.g. all 4 rows met
 * but passed=false), we surface that discrepancy as an info note — it
 * means the runner's gate logic differs from the published thresholds,
 * and the user should check the runner source.
 */

import type { ReactNode } from "react";
import {
  TAXONOMY_LABEL,
  UNCATEGORIZED_TAXONOMY,
  formatRate,
  groupByTaxonomy,
  isSevereTaxonomy,
  type Phase0BenchmarkCaseResult,
  type Phase0BenchmarkMetrics,
} from "./types";

/* ─── Phase 0 published thresholds (BENCHMARK_RESTAURANT_100.md § 7.2) ─ */

const PHASE0_TARGETS = {
  bookingReadyRate: 0.8, // ≥ 80%
  safeOutcomeRate: 0.95, // ≥ 95%
  severeErrorRate: 0, // = 0%
  taxonomyCoverageRate: 1, // = 100%
} as const;

interface ThresholdRow {
  key: keyof typeof PHASE0_TARGETS;
  label: string;
  current: number;
  target: number;
  /** "≥" or "=" — affects how the gap is phrased. */
  comparator: "≥" | "=";
  /** "up" = higher is better, "down" = lower is better. */
  direction: "up" | "down";
  met: boolean;
  /** Cases short of target. Negative when ahead. */
  caseDelta: number;
  /** Underlying counts for context. */
  countLabel: string;
}

interface Props {
  metrics: Phase0BenchmarkMetrics;
  results: readonly Phase0BenchmarkCaseResult[];
}

export default function GateBreakdown({ metrics, results }: Props) {
  const total = metrics.total || results.length || 0;

  const rows: ThresholdRow[] = [
    {
      key: "bookingReadyRate",
      label: "Booking-ready rate",
      current: metrics.bookingReadyRate,
      target: PHASE0_TARGETS.bookingReadyRate,
      comparator: "≥",
      direction: "up",
      met: metrics.bookingReadyRate >= PHASE0_TARGETS.bookingReadyRate,
      caseDelta: Math.max(
        0,
        Math.ceil(PHASE0_TARGETS.bookingReadyRate * total) - metrics.bookingReady,
      ),
      countLabel: `${metrics.bookingReady} / ${total}`,
    },
    {
      key: "safeOutcomeRate",
      label: "Safe-outcome rate",
      current: metrics.safeOutcomeRate,
      target: PHASE0_TARGETS.safeOutcomeRate,
      comparator: "≥",
      direction: "up",
      met: metrics.safeOutcomeRate >= PHASE0_TARGETS.safeOutcomeRate,
      caseDelta: Math.max(
        0,
        Math.ceil(PHASE0_TARGETS.safeOutcomeRate * total) - metrics.safe,
      ),
      countLabel: `${metrics.safe} / ${total}`,
    },
    {
      key: "severeErrorRate",
      label: "Severe-error rate",
      current: metrics.severeErrorRate,
      target: PHASE0_TARGETS.severeErrorRate,
      comparator: "=",
      direction: "down",
      met: metrics.severe === 0,
      caseDelta: metrics.severe, // need to eliminate this many
      countLabel: `${metrics.severe} severe`,
    },
    {
      key: "taxonomyCoverageRate",
      label: "Taxonomy coverage",
      current: metrics.taxonomyCoverageRate,
      target: PHASE0_TARGETS.taxonomyCoverageRate,
      comparator: "=",
      direction: "up",
      met: metrics.taxonomyCovered >= metrics.taxonomyNeeded,
      caseDelta: Math.max(0, metrics.taxonomyNeeded - metrics.taxonomyCovered),
      countLabel: `${metrics.taxonomyCovered} / ${metrics.taxonomyNeeded}`,
    },
  ];

  const allMet = rows.every((r) => r.met);
  const anyShort = !allMet;
  const runnerSaysPassed = metrics.passed;
  const discrepancy = allMet !== runnerSaysPassed;

  // Threshold-related recs (severe / taxonomy gap / booking-ready / safe-outcome)
  // only fire when the corresponding row is short — the rec body checks `!row.met`
  // internally. Navigation drift is independent of thresholds and fires whenever
  // drift cases exist, even on a passing run.
  const recommendations = buildRecommendations(rows, results);

  /* ─── Render ──────────────────────────────────────────────────────── */

  return (
    <section
      className={[
        "benchmark-gate-breakdown",
        runnerSaysPassed
          ? "benchmark-gate-breakdown--pass"
          : "benchmark-gate-breakdown--fail",
      ].join(" ")}
      aria-label="Phase 0 gate breakdown"
    >
      <header className="benchmark-gate-breakdown__header">
        <h3 className="benchmark-gate-breakdown__title">
          Distance to Phase 0 acceptance gate
        </h3>
        <p className="benchmark-gate-breakdown__source">
          Published targets: <code>BENCHMARK_RESTAURANT_100.md</code> § 7.2
        </p>
      </header>

      <table className="benchmark-gate-breakdown__table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Current</th>
            <th>Target</th>
            <th>Cases</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={
                row.met
                  ? "benchmark-gate-breakdown__row--met"
                  : "benchmark-gate-breakdown__row--short"
              }
            >
              <td className="benchmark-gate-breakdown__metric">{row.label}</td>
              <td className="benchmark-gate-breakdown__current">
                {row.direction === "down" && row.key === "severeErrorRate"
                  ? `${row.countLabel} (${formatRate(row.current)})`
                  : formatRate(row.current)}
              </td>
              <td className="benchmark-gate-breakdown__target">
                {row.comparator} {formatRate(row.target)}
              </td>
              <td className="benchmark-gate-breakdown__count">
                {row.met
                  ? row.countLabel
                  : phraseGap(row)}
              </td>
              <td className="benchmark-gate-breakdown__status">
                {row.met ? (
                  <span className="benchmark-gate-breakdown__pill benchmark-gate-breakdown__pill--met">
                    ✓ met
                  </span>
                ) : (
                  <span className="benchmark-gate-breakdown__pill benchmark-gate-breakdown__pill--short">
                    ✗ short
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {recommendations.length > 0 && (
        <div className="benchmark-gate-breakdown__recommendations">
          <h4 className="benchmark-gate-breakdown__rec-title">
            Top recommended fixes
          </h4>
          <ol className="benchmark-gate-breakdown__rec-list">
            {recommendations.map((rec, i) => (
              <li
                key={`${rec.kind}-${i}`}
                className={[
                  "benchmark-gate-breakdown__rec-item",
                  `benchmark-gate-breakdown__rec-item--${rec.severity}`,
                ].join(" ")}
              >
                <strong>{rec.headline}</strong>
                {rec.detail && <p>{rec.detail}</p>}
                {rec.caseIds && rec.caseIds.length > 0 && (
                  <p className="benchmark-gate-breakdown__case-ids">
                    Cases: {rec.caseIds.map((id) => <code key={id}>{id}</code>)
                      .reduce<ReactNode[]>((acc, node, idx) => {
                        if (idx > 0) acc.push(", ");
                        acc.push(node);
                        return acc;
                      }, [])}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {allMet && runnerSaysPassed && (
        <p className="benchmark-gate-breakdown__pass-note">
          ✓ All published Phase 0 thresholds met and the runner reports
          <code> metrics.passed === true</code>.
        </p>
      )}

      {discrepancy && (
        <div className="benchmark-gate-breakdown__discrepancy">
          <strong>Heads up:</strong>{" "}
          {allMet ? (
            <>
              All four published thresholds appear met, but the runner
              reports <code>metrics.passed === false</code>. The runner's
              gate logic may use additional criteria not captured in
              BENCHMARK_RESTAURANT_100.md. Check
              <code> scripts/run-phase0-resy-benchmark.ts</code>.
            </>
          ) : (
            <>
              The runner reports <code>metrics.passed === true</code> but
              at least one published threshold is not met. The runner's
              gate may be more permissive than BENCHMARK_RESTAURANT_100.md
              currently documents.
            </>
          )}
        </div>
      )}
    </section>
  );
}

/* ─── Recommendation logic (pure) ──────────────────────────────────── */

interface Recommendation {
  kind:
    | "severe_blocker"
    | "booking_ready_short"
    | "safe_outcome_short"
    | "taxonomy_coverage_short"
    | "navigation_drift";
  severity: "blocker" | "warning" | "info";
  headline: string;
  detail?: string;
  caseIds?: string[];
}

/**
 * Pattern in `terminalReason` that suggests the agent drifted from a venue
 * page to Resy's general search. Observed in the first R-003 live smoke
 * (2026-05-03) — final URL ended at `/search?query=Buvette&time=2100`.
 * Codex's `a0ce2ee` shipped CU prompt hardening + auto-pullback (max 2x).
 */
const NAVIGATION_DRIFT_HINTS = ["/search", "/q=", "?query=", "search?"] as const;

function smellsLikeNavigationDrift(
  terminalReason: string | null | undefined,
): boolean {
  if (!terminalReason) return false;
  const t = terminalReason.toLowerCase();
  return NAVIGATION_DRIFT_HINTS.some((hint) => t.includes(hint));
}

function buildRecommendations(
  rows: ThresholdRow[],
  results: readonly Phase0BenchmarkCaseResult[],
): Recommendation[] {
  const out: Recommendation[] = [];

  // 1. Severe error is a hard BLOCKER per § 7.3 — always first.
  const severeRow = rows.find((r) => r.key === "severeErrorRate");
  if (severeRow && !severeRow.met) {
    const severeCases = results.filter((r) => r.outcome === "severe_error");
    out.push({
      kind: "severe_blocker",
      severity: "blocker",
      headline: `BLOCKER · ${severeCases.length} severe error case${
        severeCases.length === 1 ? "" : "s"
      }`,
      detail:
        "Per BENCHMARK_RESTAURANT_100.md § 7.3, severe errors block Phase 0 declaration. Fix or quarantine these before re-running. Severe = any F-LOGIC-* taxonomy.",
      caseIds: severeCases.map((c) => c.caseId),
    });
  }

  // 2. Navigation drift detection. F-PROVIDER-UNKNOWN often surfaces when
  // Computer Use drifts from a venue page to Resy's general /search page
  // (observed first in R-003 live smoke 2026-05-03). Codex shipped
  // auto-pullback in `a0ce2ee` (max 2 retries). If this rec keeps firing
  // post-`a0ce2ee`, the prompt or recovery is insufficient.
  const driftCases = results.filter(
    (r) =>
      r.taxonomyCode === "F-PROVIDER-UNKNOWN" &&
      smellsLikeNavigationDrift(r.terminalReason),
  );
  if (driftCases.length > 0) {
    out.push({
      kind: "navigation_drift",
      severity: "warning",
      headline: `${driftCases.length} case${
        driftCases.length === 1 ? "" : "s"
      } likely drifted to Resy /search instead of staying on the venue page`,
      detail:
        "Pattern: `taxonomyCode === F-PROVIDER-UNKNOWN` AND `terminalReason` mentions /search / ?query= / search?. Codex's `a0ce2ee` added: explicit `&time=…` on start URLs + CU prompt instructing exact venue page only + auto-pullback to venue URL on drift detection (max 2 retries). If you still see this rec post-`a0ce2ee`, the recovery isn't enough — investigate per-case `terminalReason` and consider tightening the prompt or increasing retry count.",
      caseIds: driftCases.map((c) => c.caseId),
    });
  }

  // 3. Taxonomy coverage gap — fast to fix (label uncategorized cases).
  const taxRow = rows.find((r) => r.key === "taxonomyCoverageRate");
  if (taxRow && !taxRow.met) {
    const uncategorized = results.filter(
      (r) =>
        r.outcome === "failed_with_clear_reason" &&
        (!r.taxonomyCode ||
          r.taxonomyCode === "" ||
          r.taxonomyCode === UNCATEGORIZED_TAXONOMY),
    );
    out.push({
      kind: "taxonomy_coverage_short",
      severity: "warning",
      headline: `${taxRow.caseDelta} uncategorized failure${
        taxRow.caseDelta === 1 ? "" : "s"
      } need a taxonomy code`,
      detail:
        "Add a code to scripts/run-phase0-resy-benchmark.ts → inferFailureTaxonomy(), then mirror it into components/benchmark/types.ts → TAXONOMY_LABEL.",
      caseIds: uncategorized.map((c) => c.caseId),
    });
  }

  // 4. Booking-ready short — biggest opportunity is the largest non-ready bucket.
  const brRow = rows.find((r) => r.key === "bookingReadyRate");
  if (brRow && !brRow.met) {
    const notReady = results.filter((r) => !r.bookingReady);
    const top = topTaxonomy(notReady);
    out.push({
      kind: "booking_ready_short",
      severity: "warning",
      headline: `Need ${brRow.caseDelta} more booking-ready case${
        brRow.caseDelta === 1 ? "" : "s"
      } to clear ${formatRate(brRow.target)}`,
      detail: top
        ? `Top failing taxonomy: ${top.label} (${top.code}) — ${top.count} case${
            top.count === 1 ? "" : "s"
          }. Per § 7.3, cluster fixes on a single taxonomy yield the most leverage.`
        : "No clearly clustered failure taxonomy — investigate per-case.",
    });
  }

  // 5. Safe-outcome short — usually means failed_unknown / hallucinated_confirm.
  const soRow = rows.find((r) => r.key === "safeOutcomeRate");
  if (soRow && !soRow.met) {
    const unsafeCases = results.filter((r) => !r.safe);
    const failedUnknown = unsafeCases.filter((r) => r.outcome === "failed_unknown");
    const severeInUnsafe = unsafeCases.filter((r) => r.outcome === "severe_error");
    out.push({
      kind: "safe_outcome_short",
      severity: "warning",
      headline: `Need ${soRow.caseDelta} more safe case${
        soRow.caseDelta === 1 ? "" : "s"
      } to clear ${formatRate(soRow.target)}`,
      detail: `Unsafe cases: ${unsafeCases.length} total, of which ${failedUnknown.length} failed_unknown, ${severeInUnsafe.length} severe_error. Per § 7.3, this is usually hallucinated_confirm or unknown failure patterns.`,
      caseIds: unsafeCases.map((c) => c.caseId),
    });
  }

  return out;
}

function topTaxonomy(
  cases: readonly Phase0BenchmarkCaseResult[],
): { code: string; label: string; count: number } | null {
  const grouped = groupByTaxonomy(cases);
  let best: { code: string; count: number } | null = null;
  for (const [code, list] of Object.entries(grouped)) {
    // Don't recommend chasing severe-tagged cases under booking-ready — those
    // are caught by the severe BLOCKER recommendation already.
    if (isSevereTaxonomy(code)) continue;
    if (!best || list.length > best.count) {
      best = { code, count: list.length };
    }
  }
  if (!best) return null;
  return {
    code: best.code,
    label: TAXONOMY_LABEL[best.code] ?? best.code,
    count: best.count,
  };
}

/* ─── Phrasing helpers (pure) ──────────────────────────────────────── */

function phraseGap(row: ThresholdRow): string {
  if (row.met) return row.countLabel;
  if (row.key === "severeErrorRate") {
    return `${row.caseDelta} to eliminate`;
  }
  if (row.key === "taxonomyCoverageRate") {
    return `${row.caseDelta} unlabeled`;
  }
  return `need ${row.caseDelta} more`;
}
