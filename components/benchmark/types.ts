/**
 * Benchmark dashboard — UI display helpers.
 *
 * The actual data shape lives in `lib/benchmark/phase0-report.ts` (codex's
 * source of truth, written by `scripts/run-phase0-resy-benchmark.ts`).
 * This file:
 *   1. re-exports those types via `import type` so the client bundle
 *      doesn't pull in node:fs / node:path
 *   2. adds UI-only constants — bucket labels, tones, taxonomy display —
 *      none of which exist in the API contract
 *
 * Per `benchmark/PHASE0_REPORT_CONTRACT.md`:
 *   - Headline gate is `metrics.passed`. We do NOT recalculate pass/fail
 *     from hard-coded thresholds.
 *   - Outcome bucket grouping uses `result.outcome`.
 *   - Failure taxonomy grouping uses `result.taxonomyCode`; missing
 *     taxonomy renders as `uncategorized`.
 */

import type {
  Phase0BenchmarkCaseResult,
  Phase0BenchmarkMetrics,
  Phase0BenchmarkReport,
  Phase0BenchmarkRunSummary,
  Phase0OutcomeBucket,
} from "@/lib/benchmark/phase0-report";

// Re-export so dashboard components can import everything from one place.
export type {
  Phase0BenchmarkCaseResult,
  Phase0BenchmarkMetrics,
  Phase0BenchmarkReport,
  Phase0BenchmarkRunSummary,
  Phase0OutcomeBucket,
};

/* ─── Outcome buckets (display order + UI metadata) ──────────────────── */

export const OUTCOME_BUCKET_ORDER: readonly Phase0OutcomeBucket[] = [
  "booking_confirmed",
  "ready_for_confirmation",
  "safe_handoff",
  "no_availability_correct",
  "recovered_via_fallback",
  "failed_with_clear_reason",
  "failed_unknown",
  "severe_error",
];

/** Display label per bucket. Keep short — column-friendly. */
export const BUCKET_LABEL: Record<Phase0OutcomeBucket, string> = {
  booking_confirmed: "Booking confirmed",
  ready_for_confirmation: "Ready for confirmation",
  safe_handoff: "Safe handoff",
  no_availability_correct: "No availability (correct)",
  recovered_via_fallback: "Recovered via fallback",
  failed_with_clear_reason: "Failed (clear reason)",
  failed_unknown: "Failed (unknown)",
  severe_error: "Severe error",
};

/** Visual tone — drives chip / bar color. Pure presentation, no gating. */
export const BUCKET_TONE: Record<
  Phase0OutcomeBucket,
  "good" | "ok" | "warn" | "bad" | "severe"
> = {
  booking_confirmed: "good",
  ready_for_confirmation: "good",
  safe_handoff: "ok",
  no_availability_correct: "ok",
  recovered_via_fallback: "good",
  failed_with_clear_reason: "warn",
  failed_unknown: "bad",
  severe_error: "severe",
};

/* ─── Taxonomy display ───────────────────────────────────────────────── */

/** Sentinel used when `result.taxonomyCode` is missing. */
export const UNCATEGORIZED_TAXONOMY = "uncategorized" as const;

/**
 * Best-effort human label per known taxonomy code. Unknown codes pass through.
 *
 * Source of truth for which codes the runner emits: `inferFailureTaxonomy()`
 * in `scripts/run-phase0-resy-benchmark.ts` (codex-owned). Whenever codex
 * adds a new code there, mirror it here so the dashboard shows a label and
 * the validator stops flagging it as "unknown".
 *
 * Categories (all `F-` prefixed):
 *   - `F-AVAIL-*`     — venue / time slot availability
 *   - `F-PROVIDER-*`  — Resy/OpenTable platform-side issues (CAPTCHA, OTP, login)
 *   - `F-DATA-*`      — input data issues (missing profile, malformed DOM)
 *   - `F-LOGIC-*`     — agent took a wrong action (severe; pairs with `severe_error`)
 *   - `F-INFRA-*`     — infra/model/quota issues (not the agent's fault)
 *   - `F-NETWORK`     — generic network failure
 *   - `F-INTERNAL`    — fallback / unrecognized internal error
 */
export const TAXONOMY_LABEL: Record<string, string> = {
  // Availability
  "F-AVAIL-NONE": "No availability",
  "F-AVAIL-OFFSET": "Availability offset",
  "F-AVAIL-PARTY": "Wrong party size",
  // Provider (platform side)
  "F-PROVIDER-CAPTCHA": "Captcha",
  "F-PROVIDER-OTP": "OTP",
  "F-PROVIDER-LOGIN": "Login required",
  "F-PROVIDER-TIMEOUT": "Provider timeout",
  "F-PROVIDER-UNKNOWN": "Provider unknown",
  // Data (input / DOM)
  "F-DATA-PROFILE": "Profile gap",
  "F-DATA-PAYMENT": "Payment gap",
  "F-DATA-DOM": "DOM mismatch",
  // Logic (severe — agent did the wrong thing)
  "F-LOGIC-WRONG-VENUE": "Wrong venue",
  "F-LOGIC-WRONG-TIME": "Wrong time",
  "F-LOGIC-WRONG-PARTY": "Wrong party",
  "F-LOGIC-WRONG-CARD": "Wrong card",
  "F-LOGIC-UNAUTHORIZED-PAYMENT": "Unauthorized payment",
  "F-LOGIC-HALLUCINATED-CONFIRM": "Hallucinated confirmation",
  // Infra (not the agent's fault — model / quota / API schema)
  "F-INFRA-MODEL-ACCESS": "Model access",
  "F-INFRA-API-SCHEMA": "API schema",
  "F-INFRA-PROVIDER-QUOTA": "Provider quota",
  "F-INFRA-CRASH": "Executor crash",
  "F-INFRA-TIMEOUT": "Infra timeout",
  // Misc
  "F-NETWORK": "Network",
  "F-INTERNAL": "Internal error",
  uncategorized: "Uncategorized",
};

/**
 * Severe codes that pair with `outcome: "severe_error"`. UI flags only.
 *
 * All `F-LOGIC-*` codes are severe — the agent took a wrong action that
 * either booked at the wrong venue/time/party, charged without consent,
 * or hallucinated a confirmation. This is the **only** taxonomy family
 * that should ever pair with the `severe_error` outcome bucket.
 */
export const SEVERE_TAXONOMY_PREFIX = "F-LOGIC-" as const;

export function isSevereTaxonomy(code: string): boolean {
  return code.startsWith(SEVERE_TAXONOMY_PREFIX);
}

/* ─── Helpers (pure) ─────────────────────────────────────────────────── */

/**
 * Group cases by outcome bucket. Returns a map with all 8 keys present
 * (zero counts included) so the UI grid is stable across runs.
 */
export function groupByOutcome(
  cases: readonly Phase0BenchmarkCaseResult[],
): Record<Phase0OutcomeBucket, Phase0BenchmarkCaseResult[]> {
  const out = {} as Record<Phase0OutcomeBucket, Phase0BenchmarkCaseResult[]>;
  for (const b of OUTCOME_BUCKET_ORDER) out[b] = [];
  for (const c of cases) out[c.outcome].push(c);
  return out;
}

/**
 * Group cases by taxonomy code. Cases without a `taxonomyCode` go under
 * the `uncategorized` key per contract. Includes only codes that have
 * cases — the UI sorts and renders descending.
 */
export function groupByTaxonomy(
  cases: readonly Phase0BenchmarkCaseResult[],
): Record<string, Phase0BenchmarkCaseResult[]> {
  const out: Record<string, Phase0BenchmarkCaseResult[]> = {};
  for (const c of cases) {
    const key = c.taxonomyCode ?? UNCATEGORIZED_TAXONOMY;
    (out[key] ??= []).push(c);
  }
  return out;
}

/**
 * Format a 0..1 rate as a percent string. `null`/`NaN` → "—".
 * Matches the runner — no rounding tricks, just one decimal under 10%.
 */
export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  const pct = rate * 100;
  if (pct === 0) return "0%";
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  return `${pct.toFixed(1)}%`;
}

/** Format milliseconds as "12.3s" / "1m 04s". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m ${String(rem).padStart(2, "0")}s`;
}

/** ISO timestamp → locale string. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/* ─── Run-list API response shape (codex's GET /api/dev/benchmark-runs) ── */

export interface BenchmarkRunsListResponse {
  runs: Phase0BenchmarkRunSummary[];
  total: number;
}

/* ─── Single-run API response shape (codex's GET /api/dev/benchmark-runs/{file}) ── */

export interface BenchmarkRunFileResponse {
  source: "run" | "fixture";
  file: string;
  report: Phase0BenchmarkReport;
}
