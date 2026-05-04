/**
 * Step-shape audit. Detects the worker-gating bug where a step
 * arrives at the worker without the `__source` marker — symptom
 * "Worker received legacy-shape step (missing __source marker)".
 *
 * This is a P0 verdict because it means the M5 force-gate (at
 * `app/api/booking-jobs/[id]/start/route.ts`) failed to stamp the
 * step before routing, so the worker can't tell which executor
 * pipeline produced it. Workers either reject or run with stale
 * code. Either way: silent breakage. Hard to detect without this
 * audit.
 *
 * Pure module. The classifier consumes this output; no IO here.
 */

import type {
  JobLikeInput,
  StepLikeInput,
  StepShapeAuditResult,
  StepShapeAuditRow,
} from "./types";

/** Phrases in step error / log indicating the legacy-shape bug. */
const LEGACY_SHAPE_PHRASES: ReadonlyArray<RegExp> = [
  /Worker received legacy[-\s]shape step/i,
  /missing\s+__source\s+marker/i,
  /step\s+lacks\s+__source/i,
  /legacy-shape\s+step\s+\(missing\s+__source\)/i,
  /unstamped\s+step/i,
];

/** Phrases that look like a step error mentions the issue. */
export function errorMentionsLegacyShape(text: string | null | undefined): boolean {
  if (!text || typeof text !== "string") return false;
  return LEGACY_SHAPE_PHRASES.some((rx) => rx.test(text));
}

/** Extract the first matching legacy-shape phrase from text. Truncated. */
export function extractLegacyShapeQuote(
  text: string | null | undefined,
): string | null {
  if (!text || typeof text !== "string") return null;
  for (const rx of LEGACY_SHAPE_PHRASES) {
    const m = text.match(rx);
    if (m) {
      return excerpt(text, m.index ?? 0, m[0].length, 200);
    }
  }
  return null;
}

/**
 * Audit each step in a job and produce a per-step report + roll-up.
 *
 * Rules:
 * - `hasSourceMarker` = true iff `__source` is a non-empty string.
 * - `errorMentionsLegacyShape` = true iff `step.error` matches any
 *   LEGACY_SHAPE_PHRASES.
 * - `hasLegacyShapeBug` = true if ANY step matches the legacy-shape
 *   pattern, OR the job-level `errorMessage` / `terminalReason`
 *   matches it (caller passes those via the JobLikeInput too — we
 *   read them directly here for completeness).
 *
 * Tolerates undefined / null steps array (returns zero-row result).
 */
export function auditStepShape(job: JobLikeInput): StepShapeAuditResult {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const rows: StepShapeAuditRow[] = steps.map((s, i) => buildRow(s, i));

  const stepsWithSourceMarker = rows.filter((r) => r.hasSourceMarker).length;
  const stepsMissingSourceMarker = rows.length - stepsWithSourceMarker;

  // Legacy-shape bug detection — multi-source:
  //  1. any step.error mentions the phrase
  //  2. step has hasSourceMarker=false AND the job error mentions the phrase
  //  3. job-level errorMessage / terminalReason mentions the phrase
  //  4. raw worker log excerpt contains the phrase
  const stepsWithLegacyError = rows.some((r) => r.errorMentionsLegacyShape);
  const jobErrorPhrase = errorMentionsLegacyShape(job.errorMessage);
  const terminalReasonPhrase = errorMentionsLegacyShape(job.terminalReason);
  const workerLogPhrase = errorMentionsLegacyShape(job.rawWorkerLogExcerpt);

  const hasLegacyShapeBug =
    stepsWithLegacyError ||
    jobErrorPhrase ||
    terminalReasonPhrase ||
    workerLogPhrase;

  const legacyShapeQuotes: string[] = [];
  for (const r of rows) {
    if (r.errorExcerpt) {
      const q = extractLegacyShapeQuote(r.errorExcerpt);
      if (q) legacyShapeQuotes.push(`step[${r.index}]: ${q}`);
    }
  }
  if (jobErrorPhrase) {
    const q = extractLegacyShapeQuote(job.errorMessage);
    if (q) legacyShapeQuotes.push(`job.errorMessage: ${q}`);
  }
  if (terminalReasonPhrase) {
    const q = extractLegacyShapeQuote(job.terminalReason);
    if (q) legacyShapeQuotes.push(`job.terminalReason: ${q}`);
  }
  if (workerLogPhrase) {
    const q = extractLegacyShapeQuote(job.rawWorkerLogExcerpt);
    if (q) legacyShapeQuotes.push(`worker_log: ${q}`);
  }

  return {
    totalSteps: rows.length,
    stepsWithSourceMarker,
    stepsMissingSourceMarker,
    hasLegacyShapeBug,
    rows,
    legacyShapeQuotes: dedupe(legacyShapeQuotes),
  };
}

function buildRow(step: StepLikeInput | null | undefined, index: number): StepShapeAuditRow {
  if (!step || typeof step !== "object") {
    return {
      index,
      name: "(invalid step)",
      hasSourceMarker: false,
      sourceMarker: undefined,
      errorMentionsLegacyShape: false,
      errorExcerpt: undefined,
    };
  }
  const sourceMarker =
    typeof step.__source === "string" && step.__source.length > 0
      ? step.__source
      : undefined;
  const error = typeof step.error === "string" ? step.error : null;
  return {
    index,
    name:
      typeof step.name === "string" && step.name.length > 0
        ? step.name
        : typeof step.type === "string" && step.type.length > 0
        ? step.type
        : "(unnamed)",
    hasSourceMarker: Boolean(sourceMarker),
    sourceMarker,
    errorMentionsLegacyShape: errorMentionsLegacyShape(error),
    errorExcerpt: error ? truncate(error, 200) : undefined,
  };
}

/* ─── Helpers (also exported for tests) ───────────────────────────── */

export function truncate(s: string, max = 200): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function excerpt(text: string, idx: number, len: number, max: number): string {
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + len + 60);
  let out = text.slice(start, end);
  if (start > 0) out = "..." + out;
  if (end < text.length) out = out + "...";
  return truncate(out, max);
}
