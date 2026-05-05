/**
 * Stuck-job audit (no-live, artifact-only).
 *
 * Scans `benchmark/runs/phase0-resy-*.json` reports for the
 * "DB transient ate the terminal write" pattern. The pattern is:
 *
 *   - outcome === "failed_unknown" OR errorClass starts with "F-INFRA-DB"
 *   - safe === false (terminal classification missing) OR taxonomyAccepted === false
 *   - dbTerminalAvailable === false (when present)
 *   - error matches a transient infra signature (ConnectTimeoutError /
 *     NeonDbError / "fetch failed" / "error connecting to database")
 *   - timelineUrl / snapshotsUrl null OR taskId/currentJobId still
 *     populated (so the operator has a target for cleanup)
 *
 * The audit produces a paste-ready Markdown summary the operator can
 * use to:
 *
 *   - identify the DB row that needs manual UPDATE
 *   - cross-link the live screenshot directory
 *   - decide whether the run was truly inconclusive vs. a real
 *     provider regression dressed up as DB blip
 *
 * Pure module - no fs writes, no DB queries, no live calls. Reads
 * benchmark report JSON only. The DB UPDATE itself is NOT performed
 * here; the operator must run it manually after founder approval.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export const STUCK_JOB_AUDIT_SCHEMA_VERSION = 1 as const;

/** Filename prefix the audit cares about. */
const RESY_REPORT_PREFIX = "phase0-resy-";

/** Common transient infra signatures in error strings. */
const TRANSIENT_INFRA_PATTERNS: ReadonlyArray<RegExp> = [
  /connect\s*timeout\s*error|connecttimeouterror/i,
  /neon\s*db\s*error|neondberror/i,
  /error\s+connecting\s+to\s+database/i,
  /\bfetch\s+failed\b/i,
];

/** Bare-5xx pattern with no provider / OpenAI context. */
const BARE_5XX_INTERNAL_SERVER_PATTERN =
  /^\s*5\d{2}\s+internal\s+server\s+error\s*:\s*internal\s+server\s+error\s*$/i;

/**
 * Per-case shape we read from a Phase 0 benchmark report. Optional
 * fields cover both the legacy report shape (pre-2026-05-05) and
 * the enriched shape after the runner gained safetyStatus /
 * screenshotDir / lastKnownStage / dbTerminalAvailable /
 * errorClass / pollRetriesAbsorbed.
 */
export interface ReportCase {
  caseId?: string;
  taskId?: string | null;
  currentJobId?: string | null;
  state?: string | null;
  terminalCode?: string | null;
  terminalReason?: string | null;
  outcome?: string;
  taxonomyCode?: string | null;
  errorClass?: string | null;
  safetyStatus?: string;
  safe?: boolean;
  taxonomyAccepted?: boolean;
  dbTerminalAvailable?: boolean;
  pollRetriesAbsorbed?: number;
  timelineUrl?: string | null;
  snapshotsUrl?: string | null;
  screenshotDir?: string | null;
  lastKnownStage?: string | null;
  durationMs?: number;
  error?: string | null;
}

export interface ReportEnvelope {
  schemaVersion?: number;
  reportKind?: string;
  runId?: string;
  baseUrl?: string;
  createdAt?: string;
  metrics?: Record<string, unknown>;
  results?: ReportCase[];
}

export interface StuckJobAuditEntry {
  reportFile: string;
  runId: string | null;
  createdAt: string | null;
  caseId: string | null;
  taskId: string | null;
  jobId: string | null;
  outcome: string | null;
  errorClass: string | null;
  safetyStatus: string | null;
  lastKnownStage: string | null;
  screenshotDir: string | null;
  pollRetriesAbsorbed: number | null;
  errorExcerpt: string | null;
  /** Reason this report was flagged. Always non-empty. */
  reasons: string[];
}

export interface StuckJobAuditResult {
  schemaVersion: typeof STUCK_JOB_AUDIT_SCHEMA_VERSION;
  generatedAt: string;
  scannedReports: number;
  matchedReports: number;
  entries: StuckJobAuditEntry[];
  notes: string[];
}

/* ------ Pure pattern check ----------------------------------------------------- */

/**
 * Decide whether a single ReportCase looks like the "DB transient
 * ate the terminal write" pattern. Returns the reasons it matches,
 * or empty array when it does not match.
 */
export function classifyStuckJobCase(c: ReportCase): string[] {
  if (!c || typeof c !== "object") return [];
  const reasons: string[] = [];
  const errorText = typeof c.error === "string" ? c.error : "";
  const matchesTransientInfra = TRANSIENT_INFRA_PATTERNS.some((rx) =>
    rx.test(errorText),
  );
  const matchesBare5xx = BARE_5XX_INTERNAL_SERVER_PATTERN.test(errorText.trim());
  const dbUnavailable = c.dbTerminalAvailable === false;
  const errorClassIsDb =
    typeof c.errorClass === "string" &&
    /^F-INFRA-DB/i.test(c.errorClass);
  const taxonomyIsDb =
    typeof c.taxonomyCode === "string" &&
    /^F-INFRA-DB/i.test(c.taxonomyCode);
  const failedUnknown = c.outcome === "failed_unknown";

  if (errorClassIsDb || taxonomyIsDb) {
    reasons.push("explicit F-INFRA-DB-* taxonomy code on case");
  }
  if (dbUnavailable) {
    reasons.push("dbTerminalAvailable === false");
  }
  if (matchesTransientInfra) {
    reasons.push("error message matches Neon/fetch transient pattern");
  }
  if (matchesBare5xx) {
    reasons.push("error is bare '500 Internal Server Error: Internal Server Error'");
  }
  if (failedUnknown && (matchesTransientInfra || matchesBare5xx || dbUnavailable)) {
    if (!reasons.includes("outcome=failed_unknown with infra signature")) {
      reasons.push("outcome=failed_unknown with infra signature");
    }
  }
  // De-dupe while preserving order.
  return Array.from(new Set(reasons));
}

/**
 * Build a StuckJobAuditEntry from a matched (caseId, reasons,
 * report metadata) tuple. Pure - no fs, no time.
 */
export function buildStuckJobEntry(
  c: ReportCase,
  reportFile: string,
  runId: string | null,
  createdAt: string | null,
  reasons: string[],
): StuckJobAuditEntry {
  const errorExcerpt = typeof c.error === "string"
    ? c.error.slice(0, 240)
    : null;
  return {
    reportFile,
    runId,
    createdAt,
    caseId: c.caseId ?? null,
    taskId: c.taskId ?? null,
    jobId: c.currentJobId ?? null,
    outcome: c.outcome ?? null,
    errorClass: c.errorClass ?? c.taxonomyCode ?? null,
    safetyStatus: c.safetyStatus ?? null,
    lastKnownStage: c.lastKnownStage ?? c.state ?? null,
    screenshotDir: c.screenshotDir ?? null,
    pollRetriesAbsorbed: typeof c.pollRetriesAbsorbed === "number" ? c.pollRetriesAbsorbed : null,
    errorExcerpt,
    reasons,
  };
}

/* ------ Markdown summary ------------------------------------------------------- */

/**
 * Render a no-live operator-friendly Markdown summary of the audit
 * result. Safe to commit / paste into a handoff. Never includes the
 * full error string verbatim - excerpts are truncated to 240 chars
 * by `buildStuckJobEntry`.
 */
export function renderStuckJobAuditMarkdown(
  result: StuckJobAuditResult,
): string {
  const lines: string[] = [];
  lines.push("# Stuck-job audit (no-live, artifact-only)");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(
    `Scanned: ${result.scannedReports} report(s); matched: ${result.matchedReports}.`,
  );
  lines.push("");
  if (result.matchedReports === 0) {
    lines.push("No phase0-resy benchmark report matched the DB-transient pattern.");
    if (result.notes.length > 0) {
      lines.push("");
      lines.push("## Notes");
      for (const note of result.notes) lines.push(`- ${note}`);
    }
    return lines.join("\n") + "\n";
  }
  lines.push("## Matches");
  lines.push("");
  for (const entry of result.entries) {
    lines.push(`### ${entry.caseId ?? "(unknown case)"} - ${entry.reportFile}`);
    lines.push("");
    lines.push(`- runId: ${entry.runId ?? "(none)"}`);
    lines.push(`- createdAt: ${entry.createdAt ?? "(none)"}`);
    lines.push(`- taskId: ${entry.taskId ?? "(none)"}`);
    lines.push(`- jobId: ${entry.jobId ?? "(none)"}`);
    lines.push(`- outcome: ${entry.outcome ?? "(none)"}`);
    lines.push(`- errorClass: ${entry.errorClass ?? "(none)"}`);
    lines.push(`- safetyStatus: ${entry.safetyStatus ?? "(none)"}`);
    lines.push(`- lastKnownStage: ${entry.lastKnownStage ?? "(none)"}`);
    lines.push(`- screenshotDir: ${entry.screenshotDir ?? "(none)"}`);
    lines.push(
      `- pollRetriesAbsorbed: ${entry.pollRetriesAbsorbed === null ? "(unknown)" : entry.pollRetriesAbsorbed}`,
    );
    lines.push(`- reasons:`);
    for (const r of entry.reasons) lines.push(`  - ${r}`);
    if (entry.errorExcerpt) {
      lines.push("- error excerpt:");
      lines.push("  ```");
      lines.push(`  ${entry.errorExcerpt}`);
      lines.push("  ```");
    }
    lines.push("");
  }
  if (result.notes.length > 0) {
    lines.push("## Notes");
    for (const note of result.notes) lines.push(`- ${note}`);
    lines.push("");
  }
  lines.push("## Manual cleanup procedure (founder approval required)");
  lines.push("");
  lines.push(
    "This audit does NOT mutate the database. To recover a stuck DB row, see "
      + "`docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` "
      + "section \"Stuck job recovery (manual)\". The operator runs the "
      + "documented SQL only after explicit founder approval and only "
      + "after confirming the live screenshot trail shows the run reached "
      + "a safe boundary or never reached the provider.",
  );
  return lines.join("\n") + "\n";
}

/* ------ Filesystem entrypoint -------------------------------------------------- */

/**
 * Scan a directory for phase0-resy-*.json reports and produce a
 * StuckJobAuditResult. Graceful: missing dir / non-JSON / non-resy
 * files are skipped with notes. Never throws on bad files.
 */
export async function auditStuckJobsInDir(
  benchmarkRunsDir: string,
  options: { generatedAt?: string } = {},
): Promise<StuckJobAuditResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const notes: string[] = [];
  let entries: string[] = [];
  try {
    entries = await fs.readdir(benchmarkRunsDir);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") {
      notes.push(`benchmark/runs/ not present at ${benchmarkRunsDir}`);
      return {
        schemaVersion: STUCK_JOB_AUDIT_SCHEMA_VERSION,
        generatedAt,
        scannedReports: 0,
        matchedReports: 0,
        entries: [],
        notes,
      };
    }
    notes.push(
      `failed to read ${benchmarkRunsDir}: ${(err as Error).message}`.slice(
        0,
        240,
      ),
    );
    return {
      schemaVersion: STUCK_JOB_AUDIT_SCHEMA_VERSION,
      generatedAt,
      scannedReports: 0,
      matchedReports: 0,
      entries: [],
      notes,
    };
  }
  const reports = entries
    .filter(
      (n) =>
        typeof n === "string" &&
        n.startsWith(RESY_REPORT_PREFIX) &&
        n.endsWith(".json"),
    )
    .sort();
  const auditEntries: StuckJobAuditEntry[] = [];
  for (const file of reports) {
    const full = path.join(benchmarkRunsDir, file);
    let parsed: ReportEnvelope | null = null;
    try {
      const raw = await fs.readFile(full, "utf8");
      parsed = JSON.parse(raw) as ReportEnvelope;
    } catch (err) {
      notes.push(`skip ${file}: ${(err as Error).message}`.slice(0, 240));
      continue;
    }
    if (!parsed || !Array.isArray(parsed.results)) continue;
    for (const c of parsed.results) {
      const reasons = classifyStuckJobCase(c);
      if (reasons.length === 0) continue;
      auditEntries.push(
        buildStuckJobEntry(
          c,
          file,
          typeof parsed.runId === "string" ? parsed.runId : null,
          typeof parsed.createdAt === "string" ? parsed.createdAt : null,
          reasons,
        ),
      );
    }
  }
  return {
    schemaVersion: STUCK_JOB_AUDIT_SCHEMA_VERSION,
    generatedAt,
    scannedReports: reports.length,
    matchedReports: auditEntries.length,
    entries: auditEntries,
    notes,
  };
}
