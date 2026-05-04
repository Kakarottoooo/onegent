/**
 * Forensics report orchestrator. Pure module — composes the
 * step-shape audit, classifier, and decision-log summary into a
 * single `ForensicsReport`.
 */

import { auditStepShape } from "./step-shape";
import { classifyJob } from "./classifier";
import { summarizeDecisionLog } from "./decision-log";

import {
  RUNTIME_FORENSICS_SCHEMA_VERSION,
  type ForensicsHints,
  type ForensicsReport,
  type ForensicsSummary,
  type JobLikeInput,
} from "./types";

export interface BuildReportOptions {
  /** Source label for traceability. */
  inputSource?: string;
  /** ISO timestamp override (tests). */
  generatedAt?: string;
  /** Hints for cross-references — loader provides these. */
  hints?: Partial<ForensicsHints>;
  /** Notes to attach (loader-provided). */
  notes?: string[];
}

const FALLBACK_VALUE = "unknown";

/**
 * Build a complete ForensicsReport from a job-like input. Pure.
 */
export function buildForensicsReport(
  job: JobLikeInput,
  options: BuildReportOptions = {},
): ForensicsReport {
  const stepShape = auditStepShape(job);
  const classification = classifyJob(job);
  const decisionLogSummary = summarizeDecisionLog(job.decisionLog ?? null);

  const generatedAt =
    typeof options.generatedAt === "string" && options.generatedAt.length > 0
      ? options.generatedAt
      : new Date().toISOString();

  const hints: ForensicsHints = {
    hasScreenshots: Boolean(options.hints?.hasScreenshots ?? job.rawScreenshotsAvailable ?? false),
    screenshotsRel:
      typeof options.hints?.screenshotsRel === "string"
        ? options.hints.screenshotsRel
        : undefined,
    benchmarkReportFile:
      typeof options.hints?.benchmarkReportFile === "string"
        ? options.hints.benchmarkReportFile
        : undefined,
    taskPagePath:
      typeof options.hints?.taskPagePath === "string"
        ? options.hints.taskPagePath
        : taskPagePathFor(job),
  };

  const notes = Array.isArray(options.notes)
    ? options.notes
        .filter((n) => typeof n === "string")
        .slice(0, 32)
    : Array.isArray(job.loaderNotes)
    ? job.loaderNotes.filter((n) => typeof n === "string").slice(0, 32)
    : [];

  return {
    schemaVersion: RUNTIME_FORENSICS_SCHEMA_VERSION,
    inputSource: options.inputSource ?? "unknown",
    generatedAt,
    jobId: typeof job.id === "string" ? job.id : null,
    taskId: typeof job.taskId === "string" ? job.taskId : null,
    sessionId: typeof job.sessionId === "string" ? job.sessionId : null,
    provider:
      typeof job.provider === "string" && job.provider.length > 0
        ? job.provider
        : FALLBACK_VALUE,
    scenario:
      typeof job.scenario === "string" && job.scenario.length > 0
        ? job.scenario
        : FALLBACK_VALUE,
    status:
      typeof job.status === "string" && job.status.length > 0
        ? job.status
        : FALLBACK_VALUE,
    rawTerminalReason:
      typeof job.terminalReason === "string" ? job.terminalReason : null,
    rawTerminalCode:
      typeof job.terminalCode === "string" ? job.terminalCode : null,
    rawErrorMessage:
      typeof job.errorMessage === "string" ? job.errorMessage : null,
    updatedAt: typeof job.updatedAt === "string" ? job.updatedAt : null,
    classification,
    stepShape,
    decisionLogSummary,
    hints,
    notes,
  };
}

/**
 * Build the compact summary row for a list. Pure.
 */
export function buildForensicsSummary(report: ForensicsReport): ForensicsSummary {
  const ageSeconds = computeAgeSeconds(report.updatedAt, report.generatedAt);
  return {
    jobId: report.jobId,
    taskId: report.taskId,
    provider: report.provider,
    scenario: report.scenario,
    status: report.status,
    primaryClass: report.classification.primaryClass,
    severity: report.classification.severity,
    hasLegacyShapeBug: report.stepShape.hasLegacyShapeBug,
    ageSeconds,
    updatedAt: report.updatedAt,
    inputSource: report.inputSource,
  };
}

function computeAgeSeconds(updatedAt: string | null, generatedAt: string): number | null {
  if (!updatedAt) return null;
  const u = Date.parse(updatedAt);
  const g = Date.parse(generatedAt);
  if (!Number.isFinite(u) || !Number.isFinite(g)) return null;
  return Math.max(0, Math.floor((g - u) / 1000));
}

function taskPagePathFor(job: JobLikeInput): string | undefined {
  const t = typeof job.taskId === "string" && job.taskId.length > 0 ? job.taskId : null;
  if (!t) return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(t)) return undefined; // refuse weird ids
  return `/tasks/${t}`;
}
