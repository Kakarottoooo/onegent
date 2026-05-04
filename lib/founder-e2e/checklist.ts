// lib/founder-e2e/checklist.ts
//
// Phase 1.5 Founder QA Suite — pure logic, schema, severity rules,
// exit-criteria computation, and bug-report formatter.
//
// This module has zero side effects and zero filesystem access. It is the
// single source of truth for "what does the founder check" and "what does
// passing/failing mean" — the page UI, the API serializer, and the test
// suite all consume it.
//
// Track B contract:
//   - lib/founder-e2e/checklist.ts            (this file — types + helpers)
//   - lib/founder-e2e/fixtures.ts             (Quick + Full path data)
//   - app/api/dev/founder-e2e-runs/route.ts   (dev-gated GET/POST)
//   - app/dev/founder-e2e/page.tsx            (UI)
//   - lib/__tests__/founder-e2e*.test.ts      (40+ vitest cases)

// -----------------------------------------------------------------------------
// Severity model
// -----------------------------------------------------------------------------

export type Severity = "P0" | "P1" | "P2" | "P3";

export const SEVERITY_LABEL: Record<Severity, string> = {
  P0: "P0 ship-blocker",
  P1: "P1 phase-1.5",
  P2: "P2 polish",
  P3: "P3 nice-to-have",
};

export const SEVERITY_TONE: Record<Severity, "danger" | "warning" | "muted" | "info"> = {
  P0: "danger",
  P1: "warning",
  P2: "muted",
  P3: "info",
};

export const SEVERITY_GUIDANCE: Record<Severity, string> = {
  P0: "Ship-blocker: stop the walkthrough; ping codex/claude immediately; do not declare phase complete.",
  P1: "Phase 1.5 polish queue: record and continue; not a blocker for shipping.",
  P2: "UX polish: log it for batch fix-up after sign-off.",
  P3: "Nice-to-have: low priority; safe to defer past Phase 1.5.",
};

const SEVERITY_RANK: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/**
 * Pick the worst (most severe) severity from a list. Returns undefined if the
 * list is empty.
 */
export function maxSeverity(severities: ReadonlyArray<Severity>): Severity | undefined {
  if (!severities.length) return undefined;
  return [...severities].sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0];
}

// -----------------------------------------------------------------------------
// Step status model
// -----------------------------------------------------------------------------

export type StepStatus = "pending" | "pass" | "fail" | "blocker" | "skipped";

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: "Pending",
  pass: "Pass",
  fail: "Fail",
  blocker: "Blocker",
  skipped: "Skipped",
};

export const STEP_STATUS_TONE: Record<StepStatus, "neutral" | "success" | "danger" | "warning" | "muted"> = {
  pending: "neutral",
  pass: "success",
  fail: "danger",
  blocker: "warning",
  skipped: "muted",
};

const TERMINAL_BAD_STATUSES: ReadonlySet<StepStatus> = new Set<StepStatus>(["fail", "blocker"]);

export function isFailingStatus(status: StepStatus): boolean {
  return TERMINAL_BAD_STATUSES.has(status);
}

// -----------------------------------------------------------------------------
// Checklist schema
// -----------------------------------------------------------------------------

export type PathId = "quick" | "full";

export const PATH_LABEL: Record<PathId, string> = {
  quick: "Quick path (10 min)",
  full: "Full path (60-90 min)",
};

export interface ChecklistStep {
  /** Stable id used as result key. Format: "<pathId>:<sectionId>:<order>". */
  id: string;
  /** Section id like "A.1", "0.4", "2.2", "5". Mirrors the doc structure. */
  section: string;
  /** Short human title — what the founder is testing. */
  title: string;
  /** "怎么做" — concrete steps (numbered or single line). */
  whatToDo: string;
  /** "预期看到" — what counts as pass. */
  expected: string;
  /** "要警惕" — what should trigger a fail/blocker. */
  warn?: string;
  /** Surfaces this step touches (URLs, commands). For preflight + linking. */
  surfaces?: ReadonlyArray<string>;
  /** Default severity if the founder marks fail without overriding. */
  severityOnFail: Severity;
  /** Doc reference pointers (file § section). Optional. */
  refs?: ReadonlyArray<string>;
  /** Default severity if status is "blocker" (default = bump to P0). */
  severityOnBlocker?: Severity;
}

export interface ChecklistSection {
  id: string;
  title: string;
  /** Brief one-line description. */
  blurb?: string;
  steps: ReadonlyArray<ChecklistStep>;
}

export interface ChecklistPath {
  id: PathId;
  title: string;
  description: string;
  /** Estimated minutes. */
  durationMin: number;
  durationMax: number;
  sections: ReadonlyArray<ChecklistSection>;
}

// -----------------------------------------------------------------------------
// Result schema (per step)
// -----------------------------------------------------------------------------

export interface StepResult {
  stepId: string;
  status: StepStatus;
  /** Founder-typed actual observation; only meaningful when fail/blocker. */
  actual?: string;
  /** Optional override of the step's expected (founder rarely needs this). */
  expectedOverride?: string;
  /** Free-form notes. */
  notes?: string;
  /** Artifact pointers for triage. */
  taskId?: string;
  url?: string;
  screenshotPath?: string;
  consoleError?: string;
  networkLog?: string;
  serverLog?: string;
  /** Founder-set severity (defaults to step.severityOnFail). */
  severity?: Severity;
  /** When this step was last marked. ISO 8601 UTC. */
  updatedAt?: string;
  /** Account used (ziweiA/B/C). */
  account?: string;
  /** Browser identifier (Chrome 120 / Safari 17 / etc). */
  browser?: string;
  /** Reproducibility (e.g. "100%", "3/5"). */
  reproducibility?: string;
}

// -----------------------------------------------------------------------------
// Run schema (one founder QA pass)
// -----------------------------------------------------------------------------

export const FOUNDER_E2E_SCHEMA_VERSION = 1;
export const FOUNDER_E2E_KIND = "founder-e2e-run";

export interface QaRunSummary {
  pass: number;
  fail: number;
  blocker: number;
  skipped: number;
  pending: number;
  /** total = sum of all status buckets above. */
  total: number;
  /** failing = fail + blocker. */
  failing: number;
}

export interface ExitCriterion {
  id: string;
  title: string;
  /** Predicate that returns whether this criterion is satisfied. */
  satisfied: boolean;
  detail?: string;
}

export interface ExitVerdict {
  /** True iff Phase 1 #8 exit bar met: ≥6 of 8 criteria satisfied AND P0 == 0. */
  meetsBar: boolean;
  satisfiedCount: number;
  requiredCount: number;
  p0Count: number;
  p1Count: number;
  /** Human-readable list of gaps. */
  reasonShortBy: ReadonlyArray<string>;
  criteria: ReadonlyArray<ExitCriterion>;
}

export interface QaRun {
  schemaVersion: typeof FOUNDER_E2E_SCHEMA_VERSION;
  kind: typeof FOUNDER_E2E_KIND;
  /** Stable id; conventionally "founder-e2e-<ISO>". */
  id: string;
  pathId: PathId;
  startedAt: string;
  updatedAt: string;
  /** Optional commit SHA captured at run start. */
  branchSha?: string;
  /** Optional founder note attached to the whole run. */
  noteAtStart?: string;
  /** Optional founder note attached at completion. */
  noteAtEnd?: string;
  /** Keyed by stepId; not every step needs an entry. */
  results: Record<string, StepResult>;
  /** Computed at save time, but persisted so list views stay cheap. */
  summary: QaRunSummary;
  /** Computed at save time. */
  exit: ExitVerdict;
}

// -----------------------------------------------------------------------------
// Default exit criteria — mirrors PHASE_1_FOUNDER_E2E.md § 10.
// -----------------------------------------------------------------------------

export interface ExitCriterionDefinition {
  id: string;
  title: string;
  /** Step ids whose pass status counts towards this criterion. */
  requiresStepIds: ReadonlyArray<string>;
  /** Min pass count required (default = all listed step ids). */
  minPass?: number;
}

// -----------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------

export function listAllSteps(path: ChecklistPath): ReadonlyArray<ChecklistStep> {
  const out: ChecklistStep[] = [];
  for (const section of path.sections) {
    for (const step of section.steps) {
      out.push(step);
    }
  }
  return out;
}

export function findStep(path: ChecklistPath, stepId: string): ChecklistStep | undefined {
  for (const section of path.sections) {
    const hit = section.steps.find((s) => s.id === stepId);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Normalize a partial result map into a complete one (every step gets at
 * least { status: "pending" }). Pure: returns a new object.
 */
export function normalizeResults(
  pathDef: ChecklistPath,
  partial: Record<string, StepResult> = {},
): Record<string, StepResult> {
  const out: Record<string, StepResult> = {};
  for (const step of listAllSteps(pathDef)) {
    const existing = partial[step.id];
    if (existing) {
      out[step.id] = sanitizeResult(step, existing);
    } else {
      out[step.id] = { stepId: step.id, status: "pending" };
    }
  }
  return out;
}

/**
 * Strips unknown keys, defaults missing severity for fail/blocker, and clears
 * artifact noise on pass/pending. Pure.
 */
export function sanitizeResult(step: ChecklistStep, result: StepResult): StepResult {
  const status = result.status;
  const out: StepResult = {
    stepId: step.id,
    status,
  };
  if (result.actual !== undefined) out.actual = result.actual;
  if (result.expectedOverride !== undefined) out.expectedOverride = result.expectedOverride;
  if (result.notes !== undefined) out.notes = result.notes;
  if (result.taskId !== undefined) out.taskId = result.taskId;
  if (result.url !== undefined) out.url = result.url;
  if (result.screenshotPath !== undefined) out.screenshotPath = result.screenshotPath;
  if (result.consoleError !== undefined) out.consoleError = result.consoleError;
  if (result.networkLog !== undefined) out.networkLog = result.networkLog;
  if (result.serverLog !== undefined) out.serverLog = result.serverLog;
  if (result.updatedAt !== undefined) out.updatedAt = result.updatedAt;
  if (result.account !== undefined) out.account = result.account;
  if (result.browser !== undefined) out.browser = result.browser;
  if (result.reproducibility !== undefined) out.reproducibility = result.reproducibility;

  // Severity is only meaningful for failing rows; default to step's policy.
  if (status === "fail" || status === "blocker") {
    out.severity =
      result.severity ??
      (status === "blocker" ? step.severityOnBlocker ?? "P0" : step.severityOnFail);
  }
  return out;
}

export function summarizeResults(
  pathDef: ChecklistPath,
  results: Record<string, StepResult>,
): QaRunSummary {
  let pass = 0;
  let fail = 0;
  let blocker = 0;
  let skipped = 0;
  let pending = 0;
  for (const step of listAllSteps(pathDef)) {
    const r = results[step.id];
    const status = r?.status ?? "pending";
    switch (status) {
      case "pass":
        pass += 1;
        break;
      case "fail":
        fail += 1;
        break;
      case "blocker":
        blocker += 1;
        break;
      case "skipped":
        skipped += 1;
        break;
      default:
        pending += 1;
    }
  }
  const total = pass + fail + blocker + skipped + pending;
  return { pass, fail, blocker, skipped, pending, total, failing: fail + blocker };
}

export function countFailuresBySeverity(
  pathDef: ChecklistPath,
  results: Record<string, StepResult>,
): Record<Severity, number> {
  const counts: Record<Severity, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const step of listAllSteps(pathDef)) {
    const r = results[step.id];
    if (!r) continue;
    if (!isFailingStatus(r.status)) continue;
    const sev: Severity =
      r.severity ??
      (r.status === "blocker" ? step.severityOnBlocker ?? "P0" : step.severityOnFail);
    counts[sev] += 1;
  }
  return counts;
}

/**
 * Decide exit verdict for a run. Pure — only depends on the path definition,
 * the current results, and the exit-criteria definitions.
 */
export function decideExit(
  pathDef: ChecklistPath,
  results: Record<string, StepResult>,
  defs: ReadonlyArray<ExitCriterionDefinition>,
  options: { minSatisfiedRatio?: number } = {},
): ExitVerdict {
  const sevCounts = countFailuresBySeverity(pathDef, results);
  const criteria: ExitCriterion[] = defs.map((def) => {
    const need = def.minPass ?? def.requiresStepIds.length;
    let passed = 0;
    let failedDetail: string | undefined;
    for (const id of def.requiresStepIds) {
      const r = results[id];
      if (r?.status === "pass") {
        passed += 1;
      } else if (r && isFailingStatus(r.status)) {
        const stepLabel = id.split(":").slice(-2).join(":");
        failedDetail = `step ${stepLabel} ${r.status}`;
      }
    }
    const satisfied = passed >= need;
    return {
      id: def.id,
      title: def.title,
      satisfied,
      detail: satisfied
        ? `${passed}/${def.requiresStepIds.length} pass`
        : failedDetail
          ? `${passed}/${def.requiresStepIds.length} pass · ${failedDetail}`
          : `${passed}/${def.requiresStepIds.length} pass`,
    };
  });

  const satisfiedCount = criteria.filter((c) => c.satisfied).length;
  const ratio = options.minSatisfiedRatio ?? 0.75;
  const requiredCount = Math.ceil(criteria.length * ratio);
  const reasonShortBy: string[] = [];
  if (satisfiedCount < requiredCount) {
    for (const c of criteria) {
      if (!c.satisfied) reasonShortBy.push(c.title);
    }
  }
  if (sevCounts.P0 > 0) {
    reasonShortBy.unshift(`${sevCounts.P0} P0 ship-blocker(s) outstanding`);
  }
  if (sevCounts.P1 > 3) {
    reasonShortBy.push(`${sevCounts.P1} P1 issues exceed Phase 1.5 budget (≤3)`);
  }
  return {
    meetsBar: sevCounts.P0 === 0 && satisfiedCount >= requiredCount && sevCounts.P1 <= 3,
    satisfiedCount,
    requiredCount,
    p0Count: sevCounts.P0,
    p1Count: sevCounts.P1,
    reasonShortBy,
    criteria,
  };
}

// -----------------------------------------------------------------------------
// Bug-report formatter — single failed step → markdown ticket body
// -----------------------------------------------------------------------------

export interface BugReportContext {
  branchSha?: string;
  pathLabel?: string;
  runId?: string;
}

/**
 * Format a single failed/blocker result as a markdown bug ticket. Matches the
 * § 8 template of PHASE_1_FOUNDER_E2E.md so codex / Claude can ingest without
 * reformatting.
 */
export function formatStepAsBugReport(
  step: ChecklistStep,
  result: StepResult,
  ctx: BugReportContext = {},
): string {
  const severity =
    result.severity ??
    (result.status === "blocker" ? step.severityOnBlocker ?? "P0" : step.severityOnFail);
  const severityLine = `${severityToBadge(severity)} ${SEVERITY_LABEL[severity]}`;
  const surfaces = step.surfaces?.length ? step.surfaces.join(", ") : "—";
  const expected = result.expectedOverride ?? step.expected;
  const lines: string[] = [];
  lines.push(`### [BUG] ${step.title} (${step.section})`);
  lines.push("");
  lines.push(`**Severity**: ${severityLine}`);
  lines.push(`**Surface**: ${surfaces}`);
  lines.push(`**Section**: ${step.section} — ${step.title}`);
  if (ctx.pathLabel) lines.push(`**Path**: ${ctx.pathLabel}`);
  if (ctx.runId) lines.push(`**Run**: \`${ctx.runId}\``);
  if (ctx.branchSha) lines.push(`**Branch SHA**: \`${ctx.branchSha}\``);
  lines.push("");
  lines.push("**Steps to reproduce**:");
  lines.push(indentBlock(step.whatToDo));
  lines.push("");
  lines.push("**Expected**:");
  lines.push(indentBlock(expected));
  if (step.warn) {
    lines.push("");
    lines.push("**Warning signals from runbook**:");
    lines.push(indentBlock(step.warn));
  }
  lines.push("");
  lines.push("**Actual**:");
  lines.push(indentBlock(result.actual ?? "(founder did not fill in actual)"));
  if (result.notes) {
    lines.push("");
    lines.push("**Notes**:");
    lines.push(indentBlock(result.notes));
  }
  if (
    result.taskId ||
    result.url ||
    result.screenshotPath ||
    result.consoleError ||
    result.networkLog ||
    result.serverLog ||
    result.account ||
    result.browser ||
    result.reproducibility
  ) {
    lines.push("");
    lines.push("**Artifacts**:");
    if (result.taskId) lines.push(`- taskId: \`${result.taskId}\``);
    if (result.url) lines.push(`- url: ${result.url}`);
    if (result.screenshotPath) lines.push(`- screenshot: \`${result.screenshotPath}\``);
    if (result.consoleError) lines.push(`- console error:\n${indentBlock(result.consoleError)}`);
    if (result.networkLog) lines.push(`- network:\n${indentBlock(result.networkLog)}`);
    if (result.serverLog) lines.push(`- server log:\n${indentBlock(result.serverLog)}`);
    if (result.account) lines.push(`- account: ${result.account}`);
    if (result.browser) lines.push(`- browser: ${result.browser}`);
    if (result.reproducibility) lines.push(`- reproducibility: ${result.reproducibility}`);
  }
  if (step.refs?.length) {
    lines.push("");
    lines.push("**References**:");
    for (const ref of step.refs) lines.push(`- ${ref}`);
  }
  return lines.join("\n");
}

/**
 * Build a full markdown bug report covering every fail/blocker step in a run.
 */
export function formatRunAsBugReport(
  pathDef: ChecklistPath,
  run: QaRun,
): string {
  const ctx: BugReportContext = {
    branchSha: run.branchSha,
    pathLabel: PATH_LABEL[run.pathId],
    runId: run.id,
  };
  const failingSteps: { step: ChecklistStep; result: StepResult }[] = [];
  for (const step of listAllSteps(pathDef)) {
    const r = run.results[step.id];
    if (r && isFailingStatus(r.status)) {
      failingSteps.push({ step, result: r });
    }
  }
  const header: string[] = [];
  header.push(`# Founder QA report — ${PATH_LABEL[run.pathId]}`);
  header.push("");
  header.push(`- Run id: \`${run.id}\``);
  header.push(`- Started: ${run.startedAt}`);
  header.push(`- Updated: ${run.updatedAt}`);
  if (run.branchSha) header.push(`- Branch SHA: \`${run.branchSha}\``);
  header.push("");
  header.push("## Summary");
  header.push("");
  const s = run.summary;
  header.push(`- Pass: ${s.pass} · Fail: ${s.fail} · Blocker: ${s.blocker} · Skipped: ${s.skipped} · Pending: ${s.pending}`);
  const sev = countFailuresBySeverity(pathDef, run.results);
  header.push(`- P0: ${sev.P0} · P1: ${sev.P1} · P2: ${sev.P2} · P3: ${sev.P3}`);
  header.push(`- Exit bar met: ${run.exit.meetsBar ? "✅" : "❌"} (${run.exit.satisfiedCount}/${run.exit.criteria.length} criteria)`);
  if (run.exit.reasonShortBy.length) {
    header.push("");
    header.push("**Outstanding gaps:**");
    for (const r of run.exit.reasonShortBy) header.push(`- ${r}`);
  }
  if (run.noteAtEnd) {
    header.push("");
    header.push("**Founder note:**");
    header.push(indentBlock(run.noteAtEnd));
  }
  if (!failingSteps.length) {
    header.push("");
    header.push("_No fail/blocker rows. Polish notes only — see /dev/founder-e2e for full result table._");
    return header.join("\n");
  }
  header.push("");
  header.push("## Failing steps");
  const body: string[] = failingSteps.map(({ step, result }) =>
    formatStepAsBugReport(step, result, ctx),
  );
  return [...header, "", ...body].join("\n\n");
}

// -----------------------------------------------------------------------------
// JSON parse + safe-write helpers (no fs here; consumers pass raw text)
// -----------------------------------------------------------------------------

export class FounderE2eParseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "FounderE2eParseError";
  }
}

const ALLOWED_STATUSES: ReadonlySet<StepStatus> = new Set<StepStatus>([
  "pending",
  "pass",
  "fail",
  "blocker",
  "skipped",
]);

const ALLOWED_SEVERITIES: ReadonlySet<Severity> = new Set<Severity>(["P0", "P1", "P2", "P3"]);

/**
 * Parse a JSON payload into a QaRun, validating shape but tolerant to extra
 * fields. Throws FounderE2eParseError on malformed input.
 */
export function parseQaRun(raw: unknown): QaRun {
  if (raw === null || typeof raw !== "object") {
    throw new FounderE2eParseError("payload must be an object", "not_object");
  }
  const obj = raw as Record<string, unknown>;
  const schemaVersion = obj.schemaVersion;
  if (schemaVersion !== FOUNDER_E2E_SCHEMA_VERSION) {
    throw new FounderE2eParseError(
      `unknown schemaVersion ${String(schemaVersion)}; expected ${FOUNDER_E2E_SCHEMA_VERSION}`,
      "schema_version_mismatch",
    );
  }
  if (obj.kind !== FOUNDER_E2E_KIND) {
    throw new FounderE2eParseError(
      `unknown kind ${String(obj.kind)}; expected ${FOUNDER_E2E_KIND}`,
      "kind_mismatch",
    );
  }
  const id = expectString(obj.id, "id");
  const pathId = expectString(obj.pathId, "pathId");
  if (pathId !== "quick" && pathId !== "full") {
    throw new FounderE2eParseError(`pathId must be "quick" or "full"`, "bad_path_id");
  }
  const startedAt = expectString(obj.startedAt, "startedAt");
  const updatedAt = expectString(obj.updatedAt, "updatedAt");
  const branchSha = optionalString(obj.branchSha);
  const noteAtStart = optionalString(obj.noteAtStart);
  const noteAtEnd = optionalString(obj.noteAtEnd);

  const resultsRaw = obj.results;
  if (resultsRaw !== undefined && (resultsRaw === null || typeof resultsRaw !== "object")) {
    throw new FounderE2eParseError("results must be an object", "bad_results");
  }
  const results: Record<string, StepResult> = {};
  if (resultsRaw && typeof resultsRaw === "object") {
    for (const [key, valueRaw] of Object.entries(resultsRaw as Record<string, unknown>)) {
      if (!valueRaw || typeof valueRaw !== "object") {
        throw new FounderE2eParseError(`results[${key}] must be an object`, "bad_result_entry");
      }
      const value = valueRaw as Record<string, unknown>;
      const statusRaw = expectString(value.status, `results[${key}].status`);
      if (!ALLOWED_STATUSES.has(statusRaw as StepStatus)) {
        throw new FounderE2eParseError(
          `results[${key}].status invalid (${statusRaw})`,
          "bad_status",
        );
      }
      const sevRaw = optionalString(value.severity);
      if (sevRaw && !ALLOWED_SEVERITIES.has(sevRaw as Severity)) {
        throw new FounderE2eParseError(
          `results[${key}].severity invalid (${sevRaw})`,
          "bad_severity",
        );
      }
      results[key] = {
        stepId: optionalString(value.stepId) ?? key,
        status: statusRaw as StepStatus,
        actual: optionalString(value.actual),
        expectedOverride: optionalString(value.expectedOverride),
        notes: optionalString(value.notes),
        taskId: optionalString(value.taskId),
        url: optionalString(value.url),
        screenshotPath: optionalString(value.screenshotPath),
        consoleError: optionalString(value.consoleError),
        networkLog: optionalString(value.networkLog),
        serverLog: optionalString(value.serverLog),
        severity: sevRaw as Severity | undefined,
        updatedAt: optionalString(value.updatedAt),
        account: optionalString(value.account),
        browser: optionalString(value.browser),
        reproducibility: optionalString(value.reproducibility),
      };
    }
  }

  const summaryRaw = obj.summary as Partial<QaRunSummary> | undefined;
  const summary: QaRunSummary = {
    pass: numberFrom(summaryRaw?.pass) ?? 0,
    fail: numberFrom(summaryRaw?.fail) ?? 0,
    blocker: numberFrom(summaryRaw?.blocker) ?? 0,
    skipped: numberFrom(summaryRaw?.skipped) ?? 0,
    pending: numberFrom(summaryRaw?.pending) ?? 0,
    total: numberFrom(summaryRaw?.total) ?? 0,
    failing: numberFrom(summaryRaw?.failing) ?? 0,
  };

  const exitRaw = obj.exit as Partial<ExitVerdict> | undefined;
  const exit: ExitVerdict = {
    meetsBar: Boolean(exitRaw?.meetsBar),
    satisfiedCount: numberFrom(exitRaw?.satisfiedCount) ?? 0,
    requiredCount: numberFrom(exitRaw?.requiredCount) ?? 0,
    p0Count: numberFrom(exitRaw?.p0Count) ?? 0,
    p1Count: numberFrom(exitRaw?.p1Count) ?? 0,
    reasonShortBy: Array.isArray(exitRaw?.reasonShortBy)
      ? (exitRaw!.reasonShortBy as string[]).filter((s) => typeof s === "string")
      : [],
    criteria: Array.isArray(exitRaw?.criteria)
      ? (exitRaw!.criteria as ExitCriterion[]).map((c) => ({
          id: typeof c.id === "string" ? c.id : "",
          title: typeof c.title === "string" ? c.title : "",
          satisfied: Boolean(c.satisfied),
          detail: typeof c.detail === "string" ? c.detail : undefined,
        }))
      : [],
  };

  return {
    schemaVersion: FOUNDER_E2E_SCHEMA_VERSION,
    kind: FOUNDER_E2E_KIND,
    id,
    pathId,
    startedAt,
    updatedAt,
    branchSha,
    noteAtStart,
    noteAtEnd,
    results,
    summary,
    exit,
  };
}

/**
 * Build a fresh empty run for the given path, with all results pre-seeded
 * to "pending". Pure.
 */
export function buildEmptyRun(
  pathDef: ChecklistPath,
  defs: ReadonlyArray<ExitCriterionDefinition>,
  options: {
    id?: string;
    branchSha?: string;
    noteAtStart?: string;
    now?: () => string;
  } = {},
): QaRun {
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const id = options.id ?? `founder-e2e-${slugifyTimestamp(startedAt)}`;
  const results = normalizeResults(pathDef, {});
  return {
    schemaVersion: FOUNDER_E2E_SCHEMA_VERSION,
    kind: FOUNDER_E2E_KIND,
    id,
    pathId: pathDef.id,
    startedAt,
    updatedAt: startedAt,
    branchSha: options.branchSha,
    noteAtStart: options.noteAtStart,
    results,
    summary: summarizeResults(pathDef, results),
    exit: decideExit(pathDef, results, defs),
  };
}

/**
 * Recompute summary and exit from current results. Pure: returns a new run.
 */
export function recomputeRun(
  pathDef: ChecklistPath,
  run: QaRun,
  defs: ReadonlyArray<ExitCriterionDefinition>,
  options: { now?: () => string } = {},
): QaRun {
  const now = options.now ?? (() => new Date().toISOString());
  const normalized = normalizeResults(pathDef, run.results);
  return {
    ...run,
    results: normalized,
    summary: summarizeResults(pathDef, normalized),
    exit: decideExit(pathDef, normalized, defs),
    updatedAt: now(),
  };
}

// -----------------------------------------------------------------------------
// Filename safety (mirrors lib/benchmark/phase0-report.ts policy)
// -----------------------------------------------------------------------------

const FILE_NAME_PATTERN = /^founder-e2e-[A-Za-z0-9._-]+\.json$/;

export function isSafeFounderRunFileName(fileName: string): boolean {
  return (
    FILE_NAME_PATTERN.test(fileName) &&
    !fileName.includes("..") &&
    !fileName.includes("/") &&
    !fileName.includes("\\")
  );
}

export function fileNameForRun(run: QaRun): string {
  const slug = slugifyTimestamp(run.startedAt);
  return `founder-e2e-${run.pathId}-${slug}.json`;
}

// -----------------------------------------------------------------------------
// Tiny utilities
// -----------------------------------------------------------------------------

function severityToBadge(sev: Severity): string {
  switch (sev) {
    case "P0":
      return "🔴";
    case "P1":
      return "🟠";
    case "P2":
      return "🟡";
    case "P3":
      return "🟢";
  }
}

function indentBlock(s: string): string {
  return s
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function expectString(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.length) {
    throw new FounderE2eParseError(`${name} must be a non-empty string`, "bad_string");
  }
  return v;
}

function optionalString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") return undefined;
  return v;
}

function numberFrom(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function slugifyTimestamp(iso: string): string {
  return iso.replace(/[:.]/g, "-").replace(/Z$/, "Z");
}
