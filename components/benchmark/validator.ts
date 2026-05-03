/**
 * Benchmark report validator — turns "etrange JSON" into a list of
 * actionable issues before the dashboard tries to render it.
 *
 * Why: per `.coordination/claude.md` Q2 answer, the first real R-003
 * report from codex's runner could differ from the committed sample
 * fixture in shape edge cases. Three specific concerns Track B flagged:
 *
 *   1. `taxonomyCode === ""` vs missing — dashboard groups missing
 *      taxonomy as "uncategorized"; emitting "" instead would surface
 *      as a separate empty-named bucket and skew the chart
 *   2. `currentJobId` nullability — drawer assumes it can be missing,
 *      but a runner that emits `null` vs omitting the field requires
 *      slightly different defensive code
 *   3. `createdAt` ISO format — `formatTimestamp` falls back to the raw
 *      string when it can't parse, which is silent failure
 *
 * Plus general schema integrity (schemaVersion, required fields, enums,
 * cross-field consistency).
 *
 * Pure functions only — no React, no fetch. Consumers: the main
 * dashboard's "Validate" panel + dedicated `/dev/benchmark-runs` use.
 */

import {
  OUTCOME_BUCKET_ORDER,
  SEVERE_TAXONOMY_PREFIX,
  TAXONOMY_LABEL,
  isSevereTaxonomy,
  type Phase0OutcomeBucket,
} from "./types";

/**
 * Known taxonomy codes (drawn from TAXONOMY_LABEL keys, excluding the
 * `uncategorized` sentinel). Used to flag unknown codes as warnings —
 * runner could be emitting a typo or a brand-new code we should add.
 */
const KNOWN_TAXONOMY_CODES = Object.keys(TAXONOMY_LABEL).filter(
  (k) => k !== "uncategorized",
);

/* ─── Result shape ─────────────────────────────────────────────────── */

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  /** Worst → least: error blocks render; warning is a contract drift; info is FYI. */
  severity: ValidationSeverity;
  /**
   * JSON path to the offending field, dot/bracket notation.
   * Examples: "schemaVersion", "results[3].taxonomyCode",
   * "metrics.bookingReadyRate".
   */
  path: string;
  /** Short human-readable headline. */
  message: string;
  /** Optional context — actual value, expected value, sample case IDs, etc. */
  detail?: string;
}

export interface ValidationResult {
  /** True iff there are no `error`-severity issues. */
  ok: boolean;
  /** Counts by severity for the summary banner. */
  counts: Record<ValidationSeverity, number>;
  /** All issues, flattened. */
  issues: ValidationIssue[];
}

/* ─── Public API ───────────────────────────────────────────────────── */

/**
 * Validate a parsed JSON value against the `Phase0BenchmarkReport` contract.
 *
 * Pass it the raw value from `JSON.parse()` (or a runner output). Returns
 * a `ValidationResult` listing every issue found. Always returns — never
 * throws on malformed input.
 *
 * Severity rubric:
 *   - error   → dashboard renders blank or crashes; codex must fix
 *   - warning → dashboard renders something, but contract is violated
 *               (e.g. `taxonomyCode === ""`, mixed null/undefined)
 *   - info    → just an observation (e.g. unusual duration distribution)
 */
export function validateBenchmarkReport(raw: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const ctx = { issues };

  if (!isObject(raw)) {
    issues.push({
      severity: "error",
      path: "(root)",
      message: "Report is not a JSON object",
      detail: `Got ${describeType(raw)}`,
    });
    return finalize(issues);
  }

  validateTopLevel(raw, ctx);
  validateMetrics(raw.metrics, ctx);
  validateResults(raw.results, raw.metrics, ctx);
  validateCrossFieldConsistency(raw, ctx);

  return finalize(issues);
}

/* ─── Top-level fields ─────────────────────────────────────────────── */

interface Ctx {
  issues: ValidationIssue[];
}

function validateTopLevel(raw: Record<string, unknown>, ctx: Ctx): void {
  // schemaVersion
  if (raw.schemaVersion !== 1) {
    ctx.issues.push({
      severity: "error",
      path: "schemaVersion",
      message: "schemaVersion must be 1",
      detail: `Got ${describeValue(raw.schemaVersion)}`,
    });
  }

  // reportKind
  if (raw.reportKind !== "phase0-resy-benchmark-report") {
    ctx.issues.push({
      severity: "error",
      path: "reportKind",
      message: 'reportKind must be "phase0-resy-benchmark-report"',
      detail: `Got ${describeValue(raw.reportKind)}`,
    });
  }

  // runId / suiteId
  for (const field of ["runId", "suiteId"] as const) {
    if (!isNonEmptyString(raw[field])) {
      ctx.issues.push({
        severity: "error",
        path: field,
        message: `${field} must be a non-empty string`,
        detail: `Got ${describeValue(raw[field])}`,
      });
    }
  }

  // suiteVersion
  if (typeof raw.suiteVersion !== "number" || raw.suiteVersion < 1) {
    ctx.issues.push({
      severity: "error",
      path: "suiteVersion",
      message: "suiteVersion must be a positive number",
      detail: `Got ${describeValue(raw.suiteVersion)}`,
    });
  }

  // createdAt
  if (!isNonEmptyString(raw.createdAt)) {
    ctx.issues.push({
      severity: "error",
      path: "createdAt",
      message: "createdAt is required (ISO 8601 string)",
    });
  } else if (!isParseableDate(raw.createdAt as string)) {
    // Specific concern from Q2: dashboard's formatTimestamp silently falls
    // back to the raw string. Catch it here so dashboard doesn't render
    // garbage in the meta row.
    ctx.issues.push({
      severity: "error",
      path: "createdAt",
      message: "createdAt is not parseable as ISO 8601",
      detail: `Got "${raw.createdAt}". Expected e.g. "2026-05-03T01:23:45.000Z"`,
    });
  }

  // dryRun / dispatchOnly
  for (const field of ["dryRun", "dispatchOnly"] as const) {
    if (raw[field] !== undefined && typeof raw[field] !== "boolean") {
      ctx.issues.push({
        severity: "warning",
        path: field,
        message: `${field} should be a boolean (or omitted)`,
        detail: `Got ${describeValue(raw[field])}`,
      });
    }
  }

  // baseUrl — optional but if present should be a URL-ish string
  if (raw.baseUrl !== undefined && !isNonEmptyString(raw.baseUrl)) {
    ctx.issues.push({
      severity: "warning",
      path: "baseUrl",
      message: "baseUrl should be a non-empty string when present",
    });
  }
}

/* ─── metrics ──────────────────────────────────────────────────────── */

function validateMetrics(rawMetrics: unknown, ctx: Ctx): void {
  if (!isObject(rawMetrics)) {
    ctx.issues.push({
      severity: "error",
      path: "metrics",
      message: "metrics is required and must be an object",
      detail: `Got ${describeType(rawMetrics)}`,
    });
    return;
  }

  const m = rawMetrics;

  // Required count fields
  const countFields = ["total", "bookingReady", "safe", "severe", "taxonomyNeeded", "taxonomyCovered"] as const;
  for (const f of countFields) {
    if (typeof m[f] !== "number" || !Number.isFinite(m[f]) || (m[f] as number) < 0) {
      ctx.issues.push({
        severity: "error",
        path: `metrics.${f}`,
        message: `metrics.${f} must be a non-negative number`,
        detail: `Got ${describeValue(m[f])}`,
      });
    }
  }

  // Required rate fields
  const rateFields = ["bookingReadyRate", "safeOutcomeRate", "severeErrorRate", "taxonomyCoverageRate"] as const;
  for (const f of rateFields) {
    if (typeof m[f] !== "number" || !Number.isFinite(m[f])) {
      ctx.issues.push({
        severity: "error",
        path: `metrics.${f}`,
        message: `metrics.${f} must be a finite number`,
        detail: `Got ${describeValue(m[f])}`,
      });
    } else if ((m[f] as number) < 0 || (m[f] as number) > 1) {
      ctx.issues.push({
        severity: "error",
        path: `metrics.${f}`,
        message: `metrics.${f} must be between 0 and 1 (inclusive)`,
        detail: `Got ${m[f]}`,
      });
    }
  }

  // passed
  if (typeof m.passed !== "boolean") {
    ctx.issues.push({
      severity: "error",
      path: "metrics.passed",
      message: "metrics.passed must be a boolean",
      detail: `Got ${describeValue(m.passed)}`,
    });
  }
}

/* ─── results[] ───────────────────────────────────────────────────── */

function validateResults(rawResults: unknown, rawMetrics: unknown, ctx: Ctx): void {
  if (!Array.isArray(rawResults)) {
    ctx.issues.push({
      severity: "error",
      path: "results",
      message: "results must be an array",
      detail: `Got ${describeType(rawResults)}`,
    });
    return;
  }

  if (rawResults.length === 0) {
    ctx.issues.push({
      severity: "warning",
      path: "results",
      message: "results array is empty (no cases ran)",
    });
  }

  // Mixed-shape detection — if some cases have currentJobId: null and
  // others have currentJobId omitted, flag the inconsistency. Dashboard
  // handles both, but consistency lets future code rely on one form.
  let nullJobIds = 0;
  let undefinedJobIds = 0;
  let emptyTaxonomyStrings = 0;
  const unknownTaxonomies: string[] = [];

  rawResults.forEach((rawCase, i) => {
    const path = `results[${i}]`;
    if (!isObject(rawCase)) {
      ctx.issues.push({
        severity: "error",
        path,
        message: "case must be an object",
        detail: `Got ${describeType(rawCase)}`,
      });
      return;
    }

    // caseId
    if (!isNonEmptyString(rawCase.caseId)) {
      ctx.issues.push({
        severity: "error",
        path: `${path}.caseId`,
        message: "caseId must be a non-empty string",
      });
    }

    // prompt
    if (!isNonEmptyString(rawCase.prompt)) {
      ctx.issues.push({
        severity: "error",
        path: `${path}.prompt`,
        message: "prompt must be a non-empty string",
      });
    }

    // outcome — must be one of the 8 canonical buckets
    if (!isPhase0OutcomeBucket(rawCase.outcome)) {
      ctx.issues.push({
        severity: "error",
        path: `${path}.outcome`,
        message: "outcome must be one of the 8 canonical buckets",
        detail: `Got ${describeValue(rawCase.outcome)}; expected one of: ${OUTCOME_BUCKET_ORDER.join(", ")}`,
      });
    }

    // expectedOutcomes — must be an array of valid buckets
    if (!Array.isArray(rawCase.expectedOutcomes)) {
      ctx.issues.push({
        severity: "error",
        path: `${path}.expectedOutcomes`,
        message: "expectedOutcomes must be an array",
        detail: `Got ${describeType(rawCase.expectedOutcomes)}`,
      });
    } else {
      rawCase.expectedOutcomes.forEach((o: unknown, j: number) => {
        if (!isPhase0OutcomeBucket(o)) {
          ctx.issues.push({
            severity: "error",
            path: `${path}.expectedOutcomes[${j}]`,
            message: "expectedOutcomes entry is not a canonical bucket",
            detail: `Got ${describeValue(o)}`,
          });
        }
      });
    }

    // acceptableFailureTaxonomy — array of strings (codes can be any string,
    // but warn on unknown codes since they likely indicate typos)
    if (!Array.isArray(rawCase.acceptableFailureTaxonomy)) {
      ctx.issues.push({
        severity: "error",
        path: `${path}.acceptableFailureTaxonomy`,
        message: "acceptableFailureTaxonomy must be an array",
        detail: `Got ${describeType(rawCase.acceptableFailureTaxonomy)}`,
      });
    }

    // taxonomyCode — Q2 concern: empty string vs missing
    if (typeof rawCase.taxonomyCode === "string") {
      if (rawCase.taxonomyCode === "") {
        emptyTaxonomyStrings++;
      } else if (!isKnownFailureTag(rawCase.taxonomyCode)) {
        if (!unknownTaxonomies.includes(rawCase.taxonomyCode)) {
          unknownTaxonomies.push(rawCase.taxonomyCode);
        }
      }
    } else if (rawCase.taxonomyCode !== undefined) {
      ctx.issues.push({
        severity: "warning",
        path: `${path}.taxonomyCode`,
        message: "taxonomyCode should be a string or undefined",
        detail: `Got ${describeType(rawCase.taxonomyCode)}`,
      });
    }

    // currentJobId — Q2 concern: null vs undefined consistency
    if (rawCase.currentJobId === null) {
      nullJobIds++;
    } else if (rawCase.currentJobId === undefined) {
      undefinedJobIds++;
    } else if (!isNonEmptyString(rawCase.currentJobId)) {
      ctx.issues.push({
        severity: "warning",
        path: `${path}.currentJobId`,
        message: "currentJobId should be a non-empty string, null, or omitted",
        detail: `Got ${describeValue(rawCase.currentJobId)}`,
      });
    }

    // safe / bookingReady / severe / expectedOutcomeMatched / taxonomyAccepted
    for (const f of ["safe", "bookingReady", "severe", "expectedOutcomeMatched", "taxonomyAccepted"] as const) {
      if (typeof rawCase[f] !== "boolean") {
        ctx.issues.push({
          severity: "error",
          path: `${path}.${f}`,
          message: `${f} must be a boolean`,
          detail: `Got ${describeValue(rawCase[f])}`,
        });
      }
    }

    // durationMs
    if (typeof rawCase.durationMs !== "number" || !Number.isFinite(rawCase.durationMs) || rawCase.durationMs < 0) {
      ctx.issues.push({
        severity: "error",
        path: `${path}.durationMs`,
        message: "durationMs must be a non-negative finite number",
        detail: `Got ${describeValue(rawCase.durationMs)}`,
      });
    }

    // Severity invariant — severe outcome must pair with a severe taxonomy.
    // "Severe" = any F-LOGIC-* code (the agent took a wrong action). This
    // covers F-LOGIC-WRONG-{VENUE,TIME,PARTY,CARD} plus
    // F-LOGIC-UNAUTHORIZED-PAYMENT and F-LOGIC-HALLUCINATED-CONFIRM.
    if (rawCase.outcome === "severe_error") {
      const tag = rawCase.taxonomyCode;
      if (typeof tag !== "string" || !isSevereTaxonomy(tag)) {
        ctx.issues.push({
          severity: "warning",
          path,
          message: `severe_error outcome should pair with ${SEVERE_TAXONOMY_PREFIX}* taxonomy`,
          detail: `caseId=${rawCase.caseId}, taxonomyCode=${describeValue(tag)}. Per BENCHMARK_RESTAURANT_100.md, severe is reserved for wrong-action cases (any F-LOGIC-* code).`,
        });
      }
    } else if (typeof rawCase.taxonomyCode === "string" && isSevereTaxonomy(rawCase.taxonomyCode)) {
      ctx.issues.push({
        severity: "warning",
        path,
        message: `${SEVERE_TAXONOMY_PREFIX}* taxonomy used outside severe_error outcome`,
        detail: `caseId=${rawCase.caseId}, outcome=${describeValue(rawCase.outcome)}, taxonomyCode=${rawCase.taxonomyCode}. Severity-pair invariant — F-LOGIC-* taxonomies must pair with severe_error.`,
      });
    }

    // Phase 0 OTP transitional rule (BENCHMARK_RESTAURANT_100 § 3.2 + § 7.5).
    // F-PROVIDER-OTP cases should land in `safe_handoff` bucket. Cases shaped
    // as `failed_with_clear_reason` + F-PROVIDER-OTP almost certainly reflect
    // a runner-side bucketing bug — the agent did the right thing (reached
    // OTP wall, surfaced it cleanly), so the bucket should be `safe_handoff`.
    if (
      rawCase.taxonomyCode === "F-PROVIDER-OTP" &&
      rawCase.outcome === "failed_with_clear_reason"
    ) {
      ctx.issues.push({
        severity: "warning",
        path,
        message: "F-PROVIDER-OTP should pair with `safe_handoff` outcome (Phase 0 § 7.5)",
        detail: `caseId=${rawCase.caseId}. Per BENCHMARK_RESTAURANT_100.md § 3.2 and § 7.5, OTP-blocked cases are clean handoffs (the agent stopped at an external auth wall, not a failure). The runner should emit \`outcome: "safe_handoff"\` whenever \`task.state === "awaiting_otp"\`.`,
      });
    }
  });

  // Aggregate: empty taxonomy strings (Q2)
  if (emptyTaxonomyStrings > 0) {
    ctx.issues.push({
      severity: "warning",
      path: "results[*].taxonomyCode",
      message: `taxonomyCode is empty string ("") in ${emptyTaxonomyStrings} case(s) — should be omitted instead`,
      detail: 'Per BENCHMARK_RUNNER_OUTPUT contract, missing taxonomy is marked by OMITTING the field. Empty string would render as a separate empty-named bucket in the failure-taxonomy chart.',
    });
  }

  // Aggregate: null + undefined jobIds mixed (Q2)
  if (nullJobIds > 0 && undefinedJobIds > 0) {
    ctx.issues.push({
      severity: "info",
      path: "results[*].currentJobId",
      message: `currentJobId mixes null (${nullJobIds}) and undefined (${undefinedJobIds}) across cases`,
      detail: 'Dashboard handles both, but consistency lets consumers rely on one form. Pick one and stick to it.',
    });
  }

  // Aggregate: unknown taxonomies (typos?)
  if (unknownTaxonomies.length > 0) {
    ctx.issues.push({
      severity: "warning",
      path: "results[*].taxonomyCode",
      message: `${unknownTaxonomies.length} unknown taxonomyCode value(s)`,
      detail: `Unknown codes (likely typos or new tags): ${unknownTaxonomies.join(", ")}. Known tags: ${KNOWN_TAXONOMY_CODES.join(", ")}.`,
    });
  }

  // Cross-check against metrics.total
  if (
    isObject(rawMetrics) &&
    typeof rawMetrics.total === "number" &&
    Array.isArray(rawResults) &&
    rawMetrics.total !== rawResults.length
  ) {
    ctx.issues.push({
      severity: "error",
      path: "results",
      message: "results.length does not match metrics.total",
      detail: `metrics.total=${rawMetrics.total}, results.length=${rawResults.length}`,
    });
  }
}

/* ─── Cross-field consistency ──────────────────────────────────────── */

function validateCrossFieldConsistency(raw: Record<string, unknown>, ctx: Ctx): void {
  const m = raw.metrics;
  const r = raw.results;
  if (!isObject(m) || !Array.isArray(r) || r.length === 0) return;

  const total = typeof m.total === "number" ? m.total : r.length;
  if (total === 0) return;

  // Recount the boolean-flag fields and compare
  let bookingReadyCount = 0;
  let safeCount = 0;
  let severeCount = 0;
  for (const rawCase of r) {
    if (!isObject(rawCase)) continue;
    if (rawCase.bookingReady === true) bookingReadyCount++;
    if (rawCase.safe === true) safeCount++;
    if (rawCase.severe === true) severeCount++;
  }

  checkCount(ctx, "metrics.bookingReady", m.bookingReady, bookingReadyCount, "results[*].bookingReady");
  checkCount(ctx, "metrics.safe", m.safe, safeCount, "results[*].safe");
  checkCount(ctx, "metrics.severe", m.severe, severeCount, "results[*].severe");

  // Rate consistency (allow rounding tolerance ±0.005)
  if (typeof m.bookingReadyRate === "number") {
    const expectedRate = bookingReadyCount / total;
    if (Math.abs(m.bookingReadyRate - expectedRate) > 0.005) {
      ctx.issues.push({
        severity: "warning",
        path: "metrics.bookingReadyRate",
        message: "bookingReadyRate doesn't match the booking-ready / total ratio from results[]",
        detail: `Reported ${m.bookingReadyRate}, recomputed ${expectedRate.toFixed(4)} (${bookingReadyCount}/${total})`,
      });
    }
  }

  // passed sanity: if metrics.passed === false, expect at least one failure signal
  if (m.passed === false && severeCount === 0 && safeCount === total && bookingReadyCount === total) {
    ctx.issues.push({
      severity: "info",
      path: "metrics.passed",
      message: "passed=false but every case is booking-ready, safe, and non-severe",
      detail: "Either the runner's gate logic uses external thresholds we can't see from the report, or this is a mis-reported run.",
    });
  }
}

function checkCount(
  ctx: Ctx,
  metricPath: string,
  reported: unknown,
  recomputed: number,
  source: string,
): void {
  if (typeof reported !== "number") return; // already reported as error elsewhere
  if (reported !== recomputed) {
    ctx.issues.push({
      severity: "warning",
      path: metricPath,
      message: `${metricPath} doesn't match ${source} count`,
      detail: `Reported ${reported}, recomputed ${recomputed}`,
    });
  }
}

/* ─── Type guards ──────────────────────────────────────────────────── */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isParseableDate(v: string): boolean {
  const ms = Date.parse(v);
  return !Number.isNaN(ms);
}

function isPhase0OutcomeBucket(v: unknown): v is Phase0OutcomeBucket {
  return typeof v === "string" && (OUTCOME_BUCKET_ORDER as readonly string[]).includes(v);
}

function isKnownFailureTag(v: string): boolean {
  return KNOWN_TAXONOMY_CODES.includes(v);
}

function describeType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function describeValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === "object") return "object";
  return String(v);
}

/* ─── Finalize ─────────────────────────────────────────────────────── */

function finalize(issues: ValidationIssue[]): ValidationResult {
  const counts: Record<ValidationSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
  };
  for (const issue of issues) {
    counts[issue.severity]++;
  }
  return {
    ok: counts.error === 0,
    counts,
    issues,
  };
}
