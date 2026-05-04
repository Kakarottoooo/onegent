// lib/founder-e2e/runner-report.ts
//
// Pure converter: autonomous-runner probe results → Founder QA run.
//
// scripts/run-founder-e2e.mjs runs each probe, then hands the array to
// `buildAutoRunFromProbes()`. This module has zero IO. Tests in
// lib/__tests__/founder-e2e.test.ts pin the shape contracts.

import {
  FOUNDER_E2E_KIND,
  FOUNDER_E2E_SCHEMA_VERSION,
  buildEmptyRun,
  decideExit,
  deriveRunnerVerdict,
  exitCodeForVerdict,
  formatRunAsBugReport,
  isFailingStatus,
  listAllSteps,
  recomputeRun,
  sanitizeResult,
  summarizeResults,
  type ChecklistPath,
  type ExitCriterionDefinition,
  type QaRun,
  type RunSource,
  type RunnerMeta,
  type RunnerVerdict,
  type Severity,
  type StepResult,
  type StepStatus,
} from "./checklist";
import { FOUNDER_E2E_PATHS, getExitCriteriaForPath } from "./fixtures";

// -----------------------------------------------------------------------------
// Probe result shape — what the runner emits per step.
// -----------------------------------------------------------------------------

export interface ProbeResult {
  /** Must match a step id in FOUNDER_E2E_PATHS.auto. */
  stepId: string;
  /** Outcome status. */
  status: StepStatus;
  /** One-line observation describing what the runner saw. */
  actual?: string;
  /** Optional severity override (defaults to step.severityOnFail). */
  severity?: Severity;
  /** URL the runner exercised. */
  url?: string;
  /** Relative screenshot path under benchmark/runs/founder-e2e-assets/<runId>/ */
  screenshotPath?: string;
  /** Free-form notes (e.g. response headers). */
  notes?: string;
  /** Captured console errors collected during the probe. */
  consoleError?: string;
  /** Captured network log excerpt for the probe. */
  networkLog?: string;
  /** Captured server log line referenced by timestamp. */
  serverLog?: string;
  /** Per-probe duration in ms — folded into the runner duration. */
  durationMs?: number;
}

// -----------------------------------------------------------------------------
// Public API — pure constructors
// -----------------------------------------------------------------------------

export interface BuildAutoRunOptions {
  probes: ReadonlyArray<ProbeResult>;
  runnerMeta: RunnerMeta;
  runId?: string;
  branchSha?: string;
  noteAtStart?: string;
  noteAtEnd?: string;
  now?: () => string;
}

/**
 * Convert a probe-result array into a fully-recomputed QaRun against the auto
 * path. Pure: deterministic given inputs.
 */
export function buildAutoRunFromProbes(opts: BuildAutoRunOptions): QaRun {
  const pathDef = FOUNDER_E2E_PATHS.auto;
  const exitDefs = getExitCriteriaForPath("auto");
  const empty = buildEmptyRun(pathDef, exitDefs, {
    id: opts.runId,
    branchSha: opts.branchSha,
    noteAtStart: opts.noteAtStart,
    source: "automated",
    runnerMeta: opts.runnerMeta,
    now: opts.now,
  });

  // Apply each probe to the matching step. Unknown step ids are dropped — the
  // runner controls them, drift here means a typo in scripts/run-founder-e2e.mjs.
  const knownStepIds = new Set(listAllSteps(pathDef).map((s) => s.id));
  const results: Record<string, StepResult> = { ...empty.results };
  for (const probe of opts.probes) {
    if (!knownStepIds.has(probe.stepId)) continue;
    const step = listAllSteps(pathDef).find((s) => s.id === probe.stepId);
    if (!step) continue;
    const sanitized = sanitizeResult(step, {
      stepId: probe.stepId,
      status: probe.status,
      actual: probe.actual,
      severity: probe.severity,
      url: probe.url,
      screenshotPath: probe.screenshotPath,
      notes: probe.notes,
      consoleError: probe.consoleError,
      networkLog: probe.networkLog,
      serverLog: probe.serverLog,
      updatedAt: opts.now ? opts.now() : new Date().toISOString(),
      browser: opts.runnerMeta.browser,
    });
    results[probe.stepId] = sanitized;
  }

  const summary = summarizeResults(pathDef, results);
  const exit = decideExit(pathDef, results, exitDefs);
  const noteAtEnd = opts.noteAtEnd;
  const partial: QaRun = {
    schemaVersion: FOUNDER_E2E_SCHEMA_VERSION,
    kind: FOUNDER_E2E_KIND,
    id: empty.id,
    pathId: "auto",
    startedAt: empty.startedAt,
    updatedAt: empty.startedAt,
    branchSha: opts.branchSha,
    noteAtStart: opts.noteAtStart,
    noteAtEnd,
    source: "automated",
    runnerMeta: opts.runnerMeta,
    runnerVerdict: undefined,
    results,
    summary,
    exit,
  };
  partial.runnerVerdict = deriveRunnerVerdict({
    summary,
    exit,
    run: partial,
    pathDef,
  });
  return partial;
}

// -----------------------------------------------------------------------------
// Verdict + exit code helpers (re-exported from checklist for convenience).
// -----------------------------------------------------------------------------

export { deriveRunnerVerdict, exitCodeForVerdict };

export interface RunnerSummaryView {
  verdict: RunnerVerdict | undefined;
  exitCode: number;
  pass: number;
  fail: number;
  blocker: number;
  skipped: number;
  pending: number;
  total: number;
  p0: number;
  p1: number;
  durationMs?: number;
  failingStepIds: ReadonlyArray<string>;
}

export function summarizeRunForRunner(run: QaRun): RunnerSummaryView {
  const failingStepIds: string[] = [];
  for (const [id, r] of Object.entries(run.results)) {
    if (isFailingStatus(r.status)) failingStepIds.push(id);
  }
  return {
    verdict: run.runnerVerdict,
    exitCode: exitCodeForVerdict(run.runnerVerdict),
    pass: run.summary.pass,
    fail: run.summary.fail,
    blocker: run.summary.blocker,
    skipped: run.summary.skipped,
    pending: run.summary.pending,
    total: run.summary.total,
    p0: run.exit.p0Count,
    p1: run.exit.p1Count,
    durationMs: run.runnerMeta?.durationMs,
    failingStepIds,
  };
}

// -----------------------------------------------------------------------------
// Render helpers
// -----------------------------------------------------------------------------

/**
 * Short ANSI-free terminal banner.
 */
export function formatRunnerBanner(view: RunnerSummaryView): string {
  const verdict = view.verdict ? view.verdict.toUpperCase() : "INDETERMINATE";
  const sym = view.verdict === "pass" ? "✓" : view.verdict === "fail" ? "✗" : "⚠";
  const lines: string[] = [];
  lines.push(`${sym} runner verdict: ${verdict}`);
  lines.push(
    `pass=${view.pass} fail=${view.fail} blocker=${view.blocker} skipped=${view.skipped} pending=${view.pending} total=${view.total}`,
  );
  lines.push(`P0=${view.p0} P1=${view.p1}` + (view.durationMs ? ` duration=${view.durationMs}ms` : ""));
  if (view.failingStepIds.length) {
    lines.push(`failing: ${view.failingStepIds.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * Re-export the existing markdown renderer with the auto path bound — saves
 * the runner script from importing two modules.
 */
export function formatAutoRunMarkdown(run: QaRun): string {
  const pathDef = FOUNDER_E2E_PATHS.auto;
  return formatRunAsBugReport(pathDef, run);
}

// -----------------------------------------------------------------------------
// Screenshot path safety (used by the runner before writing files).
// -----------------------------------------------------------------------------

const RUN_ID_PATTERN = /^founder-e2e-[A-Za-z0-9._-]+$/;
const SCREENSHOT_NAME_PATTERN = /^[A-Za-z0-9._-]+\.(png|jpg|jpeg)$/;

/**
 * Validate runId + filename, returning a relative path safe to use under
 * benchmark/runs/founder-e2e-assets/. Pure, no fs.
 */
export function buildScreenshotRelPath(
  runId: string,
  fileName: string,
): string | undefined {
  if (!RUN_ID_PATTERN.test(runId)) return undefined;
  if (!SCREENSHOT_NAME_PATTERN.test(fileName)) return undefined;
  if (fileName.includes("..")) return undefined;
  return `founder-e2e-assets/${runId}/${fileName}`;
}

/**
 * Pure check: does a string look like a safe runner asset path that the page
 * UI is allowed to render as a link?
 */
export function isSafeRunnerAssetPath(p: unknown): p is string {
  if (typeof p !== "string") return false;
  if (!p.startsWith("founder-e2e-assets/")) return false;
  if (p.includes("..")) return false;
  if (p.includes("\\")) return false;
  // Must look like founder-e2e-assets/<runId>/<file>
  const parts = p.split("/");
  if (parts.length !== 3) return false;
  if (!RUN_ID_PATTERN.test(parts[1])) return false;
  if (!SCREENSHOT_NAME_PATTERN.test(parts[2])) return false;
  return true;
}

// -----------------------------------------------------------------------------
// baseUrl normalization — accepts http(s)://host[:port] forms only.
// -----------------------------------------------------------------------------

const BASE_URL_PATTERN = /^https?:\/\/[A-Za-z0-9.\-_:]+(?:\/.*)?$/;

export function normalizeBaseUrl(input: string | undefined): string {
  const fallback = "http://localhost:3000";
  if (!input) return fallback;
  const trimmed = input.trim();
  if (!BASE_URL_PATTERN.test(trimmed)) return fallback;
  return trimmed.replace(/\/+$/, "");
}

// -----------------------------------------------------------------------------
// Re-export public types for runner consumption
// -----------------------------------------------------------------------------

export type { QaRun, RunSource, RunnerVerdict, RunnerMeta };
