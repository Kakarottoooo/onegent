import * as fs from "node:fs/promises";
import * as path from "node:path";

export const PHASE0_REPORT_SCHEMA_VERSION = 1;
export const PHASE0_REPORT_KIND = "phase0-resy-benchmark-report";

export type Phase0OutcomeBucket =
  | "booking_confirmed"
  | "ready_for_confirmation"
  | "safe_handoff"
  | "no_availability_correct"
  | "recovered_via_fallback"
  | "failed_with_clear_reason"
  | "failed_unknown"
  | "severe_error";

export interface Phase0BenchmarkMetrics {
  total: number;
  bookingReady: number;
  safe: number;
  severe: number;
  taxonomyNeeded: number;
  taxonomyCovered: number;
  bookingReadyRate: number;
  safeOutcomeRate: number;
  severeErrorRate: number;
  taxonomyCoverageRate: number;
  passed: boolean;
}

export interface Phase0BenchmarkCaseResult {
  caseId: string;
  prompt: string;
  taskId?: string;
  currentJobId?: string | null;
  state?: string;
  terminalCode?: string | null;
  terminalReason?: string | null;
  outcome: Phase0OutcomeBucket;
  taxonomyCode?: string;
  expectedOutcomes: Phase0OutcomeBucket[];
  acceptableFailureTaxonomy: string[];
  safe: boolean;
  bookingReady: boolean;
  severe: boolean;
  expectedOutcomeMatched: boolean;
  taxonomyAccepted: boolean;
  durationMs: number;
  timelineUrl?: string | null;
  snapshotsUrl?: string | null;
  error?: string;
}

export interface Phase0BenchmarkReport {
  schemaVersion: typeof PHASE0_REPORT_SCHEMA_VERSION;
  reportKind: typeof PHASE0_REPORT_KIND;
  runId: string;
  suiteId: string;
  suiteVersion: number;
  baseUrl: string;
  createdAt: string;
  dryRun: boolean;
  dispatchOnly: boolean;
  metrics: Phase0BenchmarkMetrics;
  results: Phase0BenchmarkCaseResult[];
}

export interface Phase0BenchmarkRunSummary {
  file: string;
  source: "run" | "fixture";
  runId: string;
  suiteId: string;
  suiteVersion: number;
  createdAt: string;
  dryRun: boolean;
  dispatchOnly: boolean;
  metrics: Phase0BenchmarkMetrics;
  caseCount: number;
}

const FILE_NAME_PATTERN = /^[A-Za-z0-9._-]+\.json$/;

export const BENCHMARK_RUNS_DIR = path.resolve(process.cwd(), "benchmark", "runs");
export const BENCHMARK_FIXTURES_DIR = path.resolve(process.cwd(), "benchmark", "fixtures");

export function isSafeBenchmarkReportFileName(fileName: string): boolean {
  return FILE_NAME_PATTERN.test(fileName) && path.basename(fileName) === fileName;
}

export function phase0TaskTimelineUrl(taskId?: string): string | null {
  return taskId ? `/api/v1/travel-tasks/${taskId}/timeline-events` : null;
}

export function phase0TaskSnapshotsUrl(taskId?: string): string | null {
  return taskId ? `/api/v1/travel-tasks/${taskId}/snapshots` : null;
}

export async function listPhase0BenchmarkRunSummaries(): Promise<Phase0BenchmarkRunSummary[]> {
  const [runs, fixtures] = await Promise.all([
    listReportsInDirectory(BENCHMARK_RUNS_DIR, "run"),
    listReportsInDirectory(BENCHMARK_FIXTURES_DIR, "fixture"),
  ]);
  return [...runs, ...fixtures].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readPhase0BenchmarkReportByFile(
  fileName: string,
): Promise<{ source: "run" | "fixture"; file: string; report: Phase0BenchmarkReport } | null> {
  if (!isSafeBenchmarkReportFileName(fileName)) return null;
  for (const source of ["run", "fixture"] as const) {
    const directory = source === "run" ? BENCHMARK_RUNS_DIR : BENCHMARK_FIXTURES_DIR;
    const report = await readReportAtPath(path.join(directory, fileName));
    if (report) return { source, file: fileName, report };
  }
  return null;
}

async function listReportsInDirectory(
  directory: string,
  source: "run" | "fixture",
): Promise<Phase0BenchmarkRunSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const summaries = await Promise.all(
    entries
      .filter(isSafeBenchmarkReportFileName)
      .map(async (file) => {
        const report = await readReportAtPath(path.join(directory, file));
        return report ? summarizeReport(file, source, report) : null;
      }),
  );
  return summaries.filter((summary): summary is Phase0BenchmarkRunSummary => Boolean(summary));
}

async function readReportAtPath(filePath: string): Promise<Phase0BenchmarkReport | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!isPhase0BenchmarkReport(parsed)) return null;
  return withDerivedLinks(parsed);
}

function summarizeReport(
  file: string,
  source: "run" | "fixture",
  report: Phase0BenchmarkReport,
): Phase0BenchmarkRunSummary {
  return {
    file,
    source,
    runId: report.runId,
    suiteId: report.suiteId,
    suiteVersion: report.suiteVersion,
    createdAt: report.createdAt,
    dryRun: report.dryRun,
    dispatchOnly: report.dispatchOnly,
    metrics: report.metrics,
    caseCount: report.results.length,
  };
}

function withDerivedLinks(report: Phase0BenchmarkReport): Phase0BenchmarkReport {
  return {
    ...report,
    results: report.results.map((result) => ({
      ...result,
      timelineUrl: result.timelineUrl ?? phase0TaskTimelineUrl(result.taskId),
      snapshotsUrl: result.snapshotsUrl ?? phase0TaskSnapshotsUrl(result.taskId),
    })),
  };
}

function isPhase0BenchmarkReport(value: unknown): value is Phase0BenchmarkReport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Phase0BenchmarkReport>;
  return (
    candidate.schemaVersion === PHASE0_REPORT_SCHEMA_VERSION &&
    candidate.reportKind === PHASE0_REPORT_KIND &&
    typeof candidate.runId === "string" &&
    typeof candidate.suiteId === "string" &&
    typeof candidate.suiteVersion === "number" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.metrics === "object" &&
    Array.isArray(candidate.results)
  );
}
