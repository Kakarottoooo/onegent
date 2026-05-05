/**
 * Quality Gate report — schema, verdict logic, formatting helpers.
 *
 * Pure module. Zero IO. Zero subprocess. Zero global state. Easy to
 * unit test from `lib/__tests__/quality-gate-report.test.ts`.
 *
 * Hierarchy:
 *  - GateRequirement: required vs optional (decides whether failure
 *    blocks the gate or only downgrades it).
 *  - GateStatus: terminal status of a single check (pass, fail,
 *    skipped, known_existing_failure).
 *  - GateSeverity: how bad a failure is (p0/p1/p2/env/skipped). Used
 *    for triage routing in the markdown report.
 *  - GateVerdict: rolled-up verdict over the whole run (pass /
 *    needs_polish / fail / env_blocked).
 *  - exitCode: 0 / 1 / 2 / 3, derived from verdict + runner errors.
 *
 * known_existing_failure is a deliberate escape hatch. The user
 * locked this behavior so a pre-existing drift between lib/ and
 * worker/src/ (a codex-domain issue) doesn't make this gate
 * permanently red on Track B PRs. The flag is opt-in via runner
 * `--allow-known-drift` or env `QUALITY_GATE_KNOWN_DRIFT=1`.
 *
 * SAFETY RAILS (non-negotiable):
 *  - Never run live OpenAI / Computer Use / external booking
 *    provider / payment / OTP / CAPTCHA from any check. The runner
 *    enforces this at build time; the report layer assumes upstream
 *    has already filtered.
 */

export const QUALITY_GATE_SCHEMA_VERSION = 1 as const;

export type GateRequirement = "required" | "optional";

export type GateStatus =
  | "pending"
  | "pass"
  | "fail"
  | "skipped"
  | "known_existing_failure";

export type GateSeverity = "p0" | "p1" | "p2" | "env" | "skipped";

export type GateVerdict = "pass" | "needs_polish" | "fail" | "env_blocked";

export type GateExitCode = 0 | 1 | 2 | 3;

/** Display label for a status. UI-friendly. */
export const GATE_STATUS_LABEL: Record<GateStatus, string> = {
  pending: "Pending",
  pass: "Pass",
  fail: "Fail",
  skipped: "Skipped",
  known_existing_failure: "Known existing failure",
};

/** Display label for a severity. UI-friendly. */
export const GATE_SEVERITY_LABEL: Record<GateSeverity, string> = {
  p0: "P0",
  p1: "P1",
  p2: "P2",
  env: "ENV",
  skipped: "—",
};

/** Display label for a verdict. UI-friendly. */
export const GATE_VERDICT_LABEL: Record<GateVerdict, string> = {
  pass: "Pass",
  needs_polish: "Needs polish",
  fail: "Fail",
  env_blocked: "Environment blocked",
};

/** Tone hint for verdict — used by dashboard cards. */
export const GATE_VERDICT_TONE: Record<GateVerdict, "good" | "warn" | "bad" | "neutral"> = {
  pass: "good",
  needs_polish: "warn",
  fail: "bad",
  env_blocked: "neutral",
};

/** Tone hint for status — used by check rows. */
export const GATE_STATUS_TONE: Record<GateStatus, "good" | "warn" | "bad" | "neutral"> = {
  pending: "neutral",
  pass: "good",
  fail: "bad",
  skipped: "neutral",
  known_existing_failure: "warn",
};

/** Truncation limit for stdout/stderr tails (bytes). */
export const GATE_TAIL_BYTES = 4096;

/** A single check inside a quality gate run. */
export interface GateCheck {
  /** Stable id for cross-references (e.g., "tsc", "vitest:founder-e2e"). */
  id: string;
  /** Human-readable label shown in dashboards. */
  label: string;
  /** The exact shell command this check runs. Goes into report. */
  command: string;
  /** Required = blocks gate on fail; Optional = downgrades to needs_polish. */
  requirement: GateRequirement;
  /** Outcome after the runner finished (or skipped). */
  status: GateStatus;
  /** Severity used for triage/routing in the markdown report. */
  severity: GateSeverity;
  /** Wall-clock duration in ms. 0 if skipped. */
  durationMs: number;
  /** ISO timestamp when the check started. */
  startedAt: string;
  /** Process exit code, if it ran. Undefined for skipped. */
  exitCode?: number;
  /** Tail of stdout (most recent GATE_TAIL_BYTES). */
  stdoutTail: string;
  /** Tail of stderr (most recent GATE_TAIL_BYTES). */
  stderrTail: string;
  /** Free-form notes (skip reason, classifier hint, etc.). */
  notes?: string;
}

/** Metadata about the runner invocation. */
export interface GateRunnerMeta {
  /** The exact command the operator typed. */
  command: string;
  /** dev server base URL the runner probed (if any). */
  baseUrl?: string;
  /** Node version (e.g. "v20.18.0"). */
  nodeVersion: string;
  /** Total runner wall-clock duration in ms. */
  durationMs: number;
  /** Optional label from --label flag. */
  label?: string;
  /** ISO timestamp when the runner started. */
  startedAt: string;
}

/** A whole quality-gate run. Persisted to JSON. */
export interface QualityGateRun {
  schemaVersion: typeof QUALITY_GATE_SCHEMA_VERSION;
  runId: string;
  generatedAt: string;
  checks: GateCheck[];
  verdict: GateVerdict;
  exitCode: GateExitCode;
  runnerMeta: GateRunnerMeta;
}

/** Lightweight summary for listings (homepage, dashboard table). */
export interface QualityGateRunSummary {
  runId: string;
  generatedAt: string;
  fileName: string;
  verdict: GateVerdict;
  exitCode: GateExitCode;
  totalChecks: number;
  passCount: number;
  failCount: number;
  skippedCount: number;
  knownExistingFailureCount: number;
  durationMs: number;
  command: string;
  label?: string;
}

/** Error thrown by parseQualityGateRun on malformed input. */
export class QualityGateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QualityGateParseError";
  }
}

/* ─── Verdict computation ─────────────────────────────────────────── */

/**
 * Compute the rolled-up verdict + exit code from a list of checks.
 *
 * Rules (in priority order):
 *  1. Any required check with status="fail" → fail (exit 1).
 *  2. Any required check with status="skipped" + severity="env" →
 *     env_blocked (exit 2). This means: dev server was needed but
 *     missing under --include-* flag.
 *  3. Any required check skipped for non-env reasons (missing
 *     files, --no-* flag) → needs_polish. The gate is incomplete
 *     but didn't fail outright; founder should be aware.
 *  4. Any optional check with status="fail" or "skipped" or any
 *     check with status="known_existing_failure" → needs_polish
 *     (exit 0).
 *  5. All checks pass → pass (exit 0).
 *  6. Empty checks → pass (exit 0). Caller should treat empty as
 *     suspicious and surface a runner error separately.
 */
export function computeQualityGateVerdict(
  checks: ReadonlyArray<GateCheck>,
): { verdict: GateVerdict; exitCode: GateExitCode } {
  const required = checks.filter((c) => c.requirement === "required");
  const optional = checks.filter((c) => c.requirement === "optional");

  const hasRequiredFail = required.some((c) => c.status === "fail");
  if (hasRequiredFail) {
    return { verdict: "fail", exitCode: 1 };
  }

  const hasRequiredEnvBlocked = required.some(
    (c) => c.status === "skipped" && c.severity === "env",
  );
  if (hasRequiredEnvBlocked) {
    return { verdict: "env_blocked", exitCode: 2 };
  }

  const hasRequiredSkippedNonEnv = required.some(
    (c) => c.status === "skipped" && c.severity !== "env",
  );
  const hasOptionalFail = optional.some((c) => c.status === "fail");
  const hasOptionalSkipped = optional.some((c) => c.status === "skipped");
  const hasKnownExistingFailure = checks.some(
    (c) => c.status === "known_existing_failure",
  );

  if (
    hasRequiredSkippedNonEnv ||
    hasOptionalFail ||
    hasOptionalSkipped ||
    hasKnownExistingFailure
  ) {
    return { verdict: "needs_polish", exitCode: 0 };
  }

  return { verdict: "pass", exitCode: 0 };
}

/* ─── Severity classification ─────────────────────────────────────── */

/** Hint structure for classifyFailure. */
export interface ClassifyHint {
  /** The check id (e.g., "tsc", "vitest:founder-e2e"). */
  id: string;
  /** Required vs optional. */
  requirement: GateRequirement;
  /** Did the process actually run? */
  status: GateStatus;
  /** Skip reason hint (e.g., "dev_server_unreachable"). */
  skipReason?: string;
}

/**
 * Pure classifier: given a check spec + outcome, return the
 * severity that the report should record.
 *
 * Heuristics:
 *  - status="pass" → "skipped" (severity not meaningful for
 *    passing checks; we still need a value for the type).
 *  - status="known_existing_failure" → "p2" (info only, doesn't
 *    block; dashboard will surface it as "warn" tone).
 *  - status="skipped" + skipReason="dev_server_unreachable" → "env".
 *  - status="skipped" otherwise → "skipped".
 *  - status="fail" + required + id ∈ shipping-critical set → "p0".
 *  - status="fail" + required + others → "p1".
 *  - status="fail" + optional → "p2".
 */
export function classifyFailure(hint: ClassifyHint): GateSeverity {
  if (hint.status === "pass") return "skipped";
  if (hint.status === "known_existing_failure") return "p2";
  if (hint.status === "skipped") {
    if (hint.skipReason === "dev_server_unreachable") return "env";
    return "skipped";
  }

  // status === "fail" || "pending" (treat pending as fail for severity)
  if (hint.requirement === "optional") return "p2";

  // Required + fail. P0 if it's a shipping-critical check; P1 otherwise.
  if (SHIPPING_CRITICAL_IDS.has(hint.id)) return "p0";
  return "p1";
}

/**
 * Set of check ids that are shipping-critical: a fail here means
 * the build cannot ship. Tightly scoped to the orchestrator's
 * required set.
 *
 * Keep this in sync with the runner's check definitions. Any
 * required check NOT in this set defaults to P1 (still blocks the
 * gate, but signals "fixable before ship without a hotfix").
 */
export const SHIPPING_CRITICAL_IDS: ReadonlySet<string> = new Set([
  "tsc",
  "vitest:founder-e2e",
  "vitest:founder-e2e-runner",
  "vitest:flight-time-filter",
  "vitest:profile-gap-decision",
  "vitest:profile-gap-on-save",
  "vitest:chat-plan-query",
]);

/* ─── Tail truncation ─────────────────────────────────────────────── */

/**
 * Truncate a long string to its last `max` chars (default
 * GATE_TAIL_BYTES). Adds a leading marker so the consumer knows
 * truncation happened. Idempotent: if input ≤ max, returns
 * unchanged.
 */
export function tailString(input: string, max: number = GATE_TAIL_BYTES): string {
  if (typeof input !== "string") return "";
  if (input.length <= max) return input;
  const marker = `...[truncated, last ${max} chars]...\n`;
  return marker + input.slice(-max);
}

/* ─── Run construction ────────────────────────────────────────────── */

/** Inputs for buildQualityGateRun. */
export interface BuildRunInput {
  runId: string;
  generatedAt?: string;
  checks: ReadonlyArray<GateCheck>;
  runnerMeta: GateRunnerMeta;
}

/**
 * Build a QualityGateRun from raw checks + runnerMeta. Computes
 * verdict + exitCode and stamps the schema version. Pure.
 */
export function buildQualityGateRun(input: BuildRunInput): QualityGateRun {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const { verdict, exitCode } = computeQualityGateVerdict(input.checks);
  return {
    schemaVersion: QUALITY_GATE_SCHEMA_VERSION,
    runId: input.runId,
    generatedAt,
    checks: input.checks.map((c) => sanitizeCheck(c)),
    verdict,
    exitCode,
    runnerMeta: { ...input.runnerMeta },
  };
}

/** Defensive copy + tail truncation + numeric clamps for a check. */
export function sanitizeCheck(c: GateCheck): GateCheck {
  const id = typeof c.id === "string" ? c.id : "";
  const labelInput = typeof c.label === "string" ? c.label : "";
  return {
    id,
    // Default missing/empty label to id so dashboards never show a
    // blank row.
    label: labelInput.length > 0 ? labelInput : id,
    command: typeof c.command === "string" ? c.command : "",
    requirement: c.requirement === "required" ? "required" : "optional",
    status: isGateStatus(c.status) ? c.status : "pending",
    severity: isGateSeverity(c.severity) ? c.severity : "skipped",
    durationMs: clampNonNegative(c.durationMs),
    startedAt:
      typeof c.startedAt === "string" && c.startedAt.length > 0
        ? c.startedAt
        : new Date(0).toISOString(),
    exitCode: typeof c.exitCode === "number" ? c.exitCode : undefined,
    stdoutTail: tailString(typeof c.stdoutTail === "string" ? c.stdoutTail : ""),
    stderrTail: tailString(typeof c.stderrTail === "string" ? c.stderrTail : ""),
    notes:
      typeof c.notes === "string" && c.notes.length > 0
        ? c.notes
        : undefined,
  };
}

function clampNonNegative(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function isGateStatus(s: unknown): s is GateStatus {
  return (
    s === "pending" ||
    s === "pass" ||
    s === "fail" ||
    s === "skipped" ||
    s === "known_existing_failure"
  );
}

function isGateSeverity(s: unknown): s is GateSeverity {
  return s === "p0" || s === "p1" || s === "p2" || s === "env" || s === "skipped";
}

/* ─── Summary ─────────────────────────────────────────────────────── */

/** Compact summary used in listings and dashboard tables. */
export function summarizeQualityGateRun(
  run: QualityGateRun,
  fileName: string,
): QualityGateRunSummary {
  return {
    runId: run.runId,
    generatedAt: run.generatedAt,
    fileName,
    verdict: run.verdict,
    exitCode: run.exitCode,
    totalChecks: run.checks.length,
    passCount: run.checks.filter((c) => c.status === "pass").length,
    failCount: run.checks.filter((c) => c.status === "fail").length,
    skippedCount: run.checks.filter((c) => c.status === "skipped").length,
    knownExistingFailureCount: run.checks.filter(
      (c) => c.status === "known_existing_failure",
    ).length,
    durationMs: run.runnerMeta.durationMs,
    command: run.runnerMeta.command,
    label: run.runnerMeta.label,
  };
}

/* ─── Markdown formatting ─────────────────────────────────────────── */

/**
 * Render a QualityGateRun as a paste-ready markdown report. Used
 * by:
 *  - the runner to write `<runId>.md` next to the JSON;
 *  - the dashboard to show a copyable view;
 *  - founder/codex/Claude to paste failing checks into chats.
 *
 * Stable order: runner banner → checks table → per-failure detail
 * blocks → footer.
 */
export function formatQualityGateMarkdown(run: QualityGateRun): string {
  const lines: string[] = [];
  const verdictLabel = GATE_VERDICT_LABEL[run.verdict] ?? run.verdict;
  lines.push(`# Phase 1 Quality Gate — ${verdictLabel}`);
  lines.push("");
  lines.push(`> **Run id**: \`${run.runId}\``);
  lines.push(`> **Generated**: ${run.generatedAt}`);
  lines.push(`> **Exit code**: \`${run.exitCode}\``);
  lines.push(`> **Command**: \`${run.runnerMeta.command}\``);
  if (run.runnerMeta.baseUrl) {
    lines.push(`> **Base URL**: ${run.runnerMeta.baseUrl}`);
  }
  if (run.runnerMeta.label) {
    lines.push(`> **Label**: ${run.runnerMeta.label}`);
  }
  lines.push(
    `> **Duration**: ${formatDurationForMarkdown(run.runnerMeta.durationMs)}`,
  );
  lines.push(`> **Node**: ${run.runnerMeta.nodeVersion}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("|---|---:|");
  const summary = summarizeQualityGateRun(run, "");
  lines.push(`| ✅ Pass | ${summary.passCount} |`);
  lines.push(`| ❌ Fail | ${summary.failCount} |`);
  lines.push(`| ⏭ Skipped | ${summary.skippedCount} |`);
  lines.push(`| ⚠️ Known existing failure | ${summary.knownExistingFailureCount} |`);
  lines.push(`| **Total** | **${summary.totalChecks}** |`);
  lines.push("");

  lines.push("## Checks");
  lines.push("");
  lines.push("| Id | Required | Status | Severity | Duration | Command |");
  lines.push("|---|---|---|---|---:|---|");
  for (const c of run.checks) {
    const reqLabel = c.requirement === "required" ? "required" : "optional";
    const statusLabel = GATE_STATUS_LABEL[c.status] ?? c.status;
    const sevLabel = GATE_SEVERITY_LABEL[c.severity] ?? c.severity;
    lines.push(
      `| \`${escapePipe(c.id)}\` | ${reqLabel} | ${statusLabel} | ${sevLabel} | ${formatDurationForMarkdown(c.durationMs)} | \`${escapePipe(c.command)}\` |`,
    );
  }
  lines.push("");

  const failingOrKnown = run.checks.filter(
    (c) => c.status === "fail" || c.status === "known_existing_failure",
  );
  if (failingOrKnown.length > 0) {
    lines.push("## Failing checks (paste these to triage)");
    lines.push("");
    for (const c of failingOrKnown) {
      lines.push(`### [${GATE_SEVERITY_LABEL[c.severity]}] \`${c.id}\` — ${GATE_STATUS_LABEL[c.status]}`);
      lines.push("");
      lines.push(`- **Label**: ${c.label}`);
      lines.push(`- **Command**: \`${c.command}\``);
      lines.push(`- **Requirement**: ${c.requirement}`);
      lines.push(`- **Started**: ${c.startedAt}`);
      lines.push(`- **Duration**: ${formatDurationForMarkdown(c.durationMs)}`);
      if (typeof c.exitCode === "number") {
        lines.push(`- **Exit code**: \`${c.exitCode}\``);
      }
      if (c.notes) {
        lines.push(`- **Notes**: ${c.notes}`);
      }
      lines.push("");
      if (c.stdoutTail.length > 0) {
        lines.push("<details><summary>stdout (tail)</summary>");
        lines.push("");
        lines.push("```");
        lines.push(c.stdoutTail);
        lines.push("```");
        lines.push("");
        lines.push("</details>");
        lines.push("");
      }
      if (c.stderrTail.length > 0) {
        lines.push("<details><summary>stderr (tail)</summary>");
        lines.push("");
        lines.push("```");
        lines.push(c.stderrTail);
        lines.push("```");
        lines.push("");
        lines.push("</details>");
        lines.push("");
      }
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "_Generated by `npm run gate:phase1`. See `PHASE_1_QUALITY_GATE.md` for triage routing + safety rails._",
  );
  return lines.join("\n");
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, "\\|");
}

/** Pretty-print a duration in ms as either `XXms` or `X.Ys`. */
export function formatDurationForMarkdown(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ─── Parsing (defensive) ─────────────────────────────────────────── */

/**
 * Parse a JSON-ish payload into a QualityGateRun. Tolerant of
 * older schema versions (none yet, but the structure is in place).
 *
 * Throws QualityGateParseError on shape violations (missing
 * required fields, unknown schemaVersion, malformed checks).
 */
export function parseQualityGateRun(raw: unknown): QualityGateRun {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new QualityGateParseError("Expected an object at the top level.");
  }
  const obj = raw as Record<string, unknown>;

  const schemaVersion = obj.schemaVersion;
  if (schemaVersion !== QUALITY_GATE_SCHEMA_VERSION) {
    throw new QualityGateParseError(
      `Unsupported schemaVersion: ${String(schemaVersion)}. Expected ${QUALITY_GATE_SCHEMA_VERSION}.`,
    );
  }

  const runId = obj.runId;
  if (typeof runId !== "string" || runId.length === 0) {
    throw new QualityGateParseError("runId must be a non-empty string.");
  }
  const generatedAt = obj.generatedAt;
  if (typeof generatedAt !== "string" || generatedAt.length === 0) {
    throw new QualityGateParseError("generatedAt must be an ISO timestamp string.");
  }
  const verdict = obj.verdict;
  if (
    verdict !== "pass" &&
    verdict !== "needs_polish" &&
    verdict !== "fail" &&
    verdict !== "env_blocked"
  ) {
    throw new QualityGateParseError(`Invalid verdict: ${String(verdict)}`);
  }
  const exitCode = obj.exitCode;
  if (exitCode !== 0 && exitCode !== 1 && exitCode !== 2 && exitCode !== 3) {
    throw new QualityGateParseError(`Invalid exitCode: ${String(exitCode)}`);
  }

  const checksRaw = obj.checks;
  if (!Array.isArray(checksRaw)) {
    throw new QualityGateParseError("checks must be an array.");
  }
  const checks = checksRaw.map((entry, idx) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new QualityGateParseError(`checks[${idx}] is not an object.`);
    }
    const e = entry as Record<string, unknown>;
    return sanitizeCheck({
      id: typeof e.id === "string" ? e.id : "",
      label: typeof e.label === "string" ? e.label : (typeof e.id === "string" ? e.id : ""),
      command: typeof e.command === "string" ? e.command : "",
      requirement:
        e.requirement === "required" ? "required" : "optional",
      status: isGateStatus(e.status) ? e.status : "pending",
      severity: isGateSeverity(e.severity) ? e.severity : "skipped",
      durationMs: typeof e.durationMs === "number" ? e.durationMs : 0,
      startedAt:
        typeof e.startedAt === "string" && e.startedAt.length > 0
          ? e.startedAt
          : new Date(0).toISOString(),
      exitCode: typeof e.exitCode === "number" ? e.exitCode : undefined,
      stdoutTail: typeof e.stdoutTail === "string" ? e.stdoutTail : "",
      stderrTail: typeof e.stderrTail === "string" ? e.stderrTail : "",
      notes: typeof e.notes === "string" ? e.notes : undefined,
    });
  });

  const runnerMetaRaw = obj.runnerMeta;
  if (runnerMetaRaw === null || typeof runnerMetaRaw !== "object" || Array.isArray(runnerMetaRaw)) {
    throw new QualityGateParseError("runnerMeta must be an object.");
  }
  const rm = runnerMetaRaw as Record<string, unknown>;
  const runnerMeta: GateRunnerMeta = {
    command: typeof rm.command === "string" ? rm.command : "",
    baseUrl: typeof rm.baseUrl === "string" ? rm.baseUrl : undefined,
    nodeVersion: typeof rm.nodeVersion === "string" ? rm.nodeVersion : "",
    durationMs:
      typeof rm.durationMs === "number" && Number.isFinite(rm.durationMs)
        ? Math.max(0, Math.floor(rm.durationMs))
        : 0,
    label: typeof rm.label === "string" ? rm.label : undefined,
    startedAt:
      typeof rm.startedAt === "string" && rm.startedAt.length > 0
        ? rm.startedAt
        : generatedAt,
  };

  return {
    schemaVersion: QUALITY_GATE_SCHEMA_VERSION,
    runId,
    generatedAt,
    checks,
    verdict,
    exitCode,
    runnerMeta,
  };
}

/* ─── Filename safety ─────────────────────────────────────────────── */

/**
 * Whitelist regex for quality-gate run filenames. Used both by the
 * loader (when listing) and the dev API (when accepting ?file=).
 */
export const QUALITY_GATE_FILE_PATTERN =
  /^phase1-quality-gate-[A-Za-z0-9._-]+\.(json|md)$/;

/** Strict type guard for safe filename. */
export function isSafeQualityGateFileName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 200) return false;
  if (name.includes("..")) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  return QUALITY_GATE_FILE_PATTERN.test(name);
}

/**
 * Build the canonical filename for a run. Matches
 * QUALITY_GATE_FILE_PATTERN. Suffix is "json" or "md".
 */
export function fileNameForQualityGateRun(
  runId: string,
  suffix: "json" | "md",
): string {
  if (typeof runId !== "string" || runId.length === 0) {
    throw new Error("runId must be a non-empty string");
  }
  if (suffix !== "json" && suffix !== "md") {
    throw new Error(`unsupported suffix: ${suffix}`);
  }
  // Sanitize: replace anything not in [A-Za-z0-9._-] with -.
  const safeId = runId.replace(/[^A-Za-z0-9._-]/g, "-");
  return `phase1-quality-gate-${safeId}.${suffix}`;
}

/** Convenience: equivalent to fileNameForQualityGateRun(runId, "json"). */
export function fileNameFromRunId(runId: string): string {
  return fileNameForQualityGateRun(runId, "json");
}
