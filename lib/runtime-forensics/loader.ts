/**
 * Filesystem loader for runtime-forensics. V1 sources:
 *
 *   - `benchmark/runs/*.json` — Phase 0 benchmark reports (one per
 *     case run) authored by codex's runner. Each report contains
 *     per-case sub-records that we re-shape into JobLikeInput.
 *   - `worker/.debug-screenshots/<provider>/<run>/summary.json` —
 *     screenshot metadata produced by the worker on terminal failure.
 *   - `./codex-worker.log` (overridable via `WORKER_LOG_PATH` env) —
 *     raw worker log; we extract a bounded tail per provider/jobId
 *     match to feed `rawWorkerLogExcerpt`.
 *
 * If any source is missing, the loader returns an empty list (or
 * empty `rawWorkerLogExcerpt`) gracefully — it never throws on
 * missing files. This is a HARD requirement: the dashboard must
 * render even with zero artifacts.
 *
 * Path safety: every input filename is validated against
 * isSafeForensicsArtifactName before touching the filesystem;
 * resolved paths are checked against the configured base dir
 * prefix to defeat path traversal.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  RuntimeForensicsLoaderError,
  type ForensicsListFilter,
  type ForensicsReport,
  type ForensicsSummary,
  type JobLikeInput,
} from "./types";
import { buildForensicsReport, buildForensicsSummary } from "./report";

/* ─── Config ──────────────────────────────────────────────────────── */

/** Lazy resolution so tests can swap process.cwd(). */
export function getBenchmarkRunsDir(): string {
  return path.resolve(process.cwd(), "benchmark", "runs");
}

/** Lazy resolution. */
export function getDebugScreenshotsDir(): string {
  return path.resolve(process.cwd(), "worker", ".debug-screenshots");
}

/** Resolution of the worker log path. Default `./codex-worker.log`. */
export function getWorkerLogPath(): string {
  const env = process.env.WORKER_LOG_PATH;
  if (typeof env === "string" && env.length > 0) {
    return path.resolve(env);
  }
  return path.resolve(process.cwd(), "codex-worker.log");
}

/* ─── Filename + path safety ──────────────────────────────────────── */

/** Whitelist for benchmark-runs filenames (json only). */
export const BENCHMARK_RUN_FILE_PATTERN = /^[A-Za-z0-9._-]{1,200}\.json$/;

/** Generic safe-name check (used for screenshots dir entries too). */
export function isSafeForensicsArtifactName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 200) return false;
  if (name.includes("..")) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  return /^[A-Za-z0-9._-]+$/.test(name);
}

/** Resolve a benchmark-run JSON file to an absolute path inside benchmark/runs. */
export function resolveSafeBenchmarkRunPath(name: string): string {
  if (!isSafeForensicsArtifactName(name) || !BENCHMARK_RUN_FILE_PATTERN.test(name)) {
    throw new RuntimeForensicsLoaderError(`Refusing unsafe artifact name: ${String(name)}`);
  }
  const dir = getBenchmarkRunsDir();
  const resolved = path.resolve(dir, name);
  if (!resolved.startsWith(dir + path.sep)) {
    throw new RuntimeForensicsLoaderError(
      `Path-traversal attempt blocked: ${String(name)}`,
    );
  }
  return resolved;
}

/** Resolve a screenshots provider/run directory to an absolute path. */
export function resolveSafeScreenshotsPath(provider: string, run: string): string {
  if (!isSafeForensicsArtifactName(provider) || !isSafeForensicsArtifactName(run)) {
    throw new RuntimeForensicsLoaderError(
      `Refusing unsafe screenshots path: ${String(provider)}/${String(run)}`,
    );
  }
  const base = getDebugScreenshotsDir();
  const resolved = path.resolve(base, provider, run);
  if (!resolved.startsWith(base + path.sep)) {
    throw new RuntimeForensicsLoaderError(
      `Path-traversal attempt blocked: ${String(provider)}/${String(run)}`,
    );
  }
  return resolved;
}

/* ─── Worker log excerpt ──────────────────────────────────────────── */

/**
 * Extract a bounded tail (default 16 KB) of the worker log,
 * optionally filtered by a substring (e.g. jobId or provider).
 * Returns null on missing file (graceful degrade).
 */
export async function readWorkerLogExcerpt(options: {
  filterSubstring?: string;
  maxBytes?: number;
} = {}): Promise<string | null> {
  const max = Math.max(1024, options.maxBytes ?? 16 * 1024);
  const filter =
    typeof options.filterSubstring === "string" && options.filterSubstring.length > 0
      ? options.filterSubstring
      : null;
  const filePath = getWorkerLogPath();
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (isEnoent(err)) return null;
    return null; // graceful degrade on permission errors etc.
  }
  if (!filter) {
    return raw.length <= max ? raw : raw.slice(-max);
  }
  // Filter mode: walk lines, keep matching lines + 2 lines of context after.
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  let context = 0;
  for (const ln of lines) {
    if (ln.includes(filter)) {
      kept.push(ln);
      context = 2;
    } else if (context > 0) {
      kept.push(ln);
      context -= 1;
    }
  }
  let out = kept.join("\n");
  if (out.length > max) out = out.slice(-max);
  return out;
}

/* ─── Benchmark-run ingestion ─────────────────────────────────────── */

/**
 * List all `*.json` filenames in `benchmark/runs/`, filtered to
 * those that look like benchmark reports (NOT founder-e2e or
 * quality-gate runs). Sorted newest-first by mtime.
 *
 * Returns an empty list if the dir doesn't exist.
 */
export async function listBenchmarkRunFilenames(): Promise<string[]> {
  const dir = getBenchmarkRunsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if (isEnoent(err)) return [];
    return [];
  }
  const safe = entries.filter(
    (n) =>
      isSafeForensicsArtifactName(n) &&
      n.endsWith(".json") &&
      !n.startsWith("phase1-quality-gate-") &&
      !n.startsWith("founder-e2e-"),
  );
  // Sort by mtime desc; fall back to filename if mtime unavailable.
  const withMtime: Array<{ name: string; mtime: number }> = [];
  for (const n of safe) {
    try {
      const st = await fs.stat(path.resolve(dir, n));
      withMtime.push({ name: n, mtime: st.mtimeMs });
    } catch {
      withMtime.push({ name: n, mtime: 0 });
    }
  }
  withMtime.sort((a, b) => {
    if (b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.name.localeCompare(b.name);
  });
  return withMtime.map((x) => x.name);
}

/** Read a benchmark-run JSON file. Throws on shape violations. */
export async function readBenchmarkRunFile(name: string): Promise<unknown> {
  const resolved = resolveSafeBenchmarkRunPath(name);
  let raw: string;
  try {
    raw = await fs.readFile(resolved, "utf8");
  } catch (err) {
    if (isEnoent(err)) {
      throw new RuntimeForensicsLoaderError(`File not found: ${name}`);
    }
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new RuntimeForensicsLoaderError(
      `Invalid JSON in ${name}: ${(err as Error).message}`,
    );
  }
}

/**
 * Extract zero or more JobLikeInput records from a parsed
 * benchmark-run JSON. The format codex's runner produces has
 * variation across phases; we accept several common shapes:
 *
 *   - `{ cases: [{ id, provider, scenario, status, terminalReason,
 *      steps, decisionLog }] }`
 *   - `{ runs: [...] }` (older shape)
 *   - `{ id, scenario, ... }` (single-case run)
 *
 * Unknown shapes return an empty list with a loader note.
 */
export function extractJobsFromBenchmarkPayload(
  payload: unknown,
  sourceName: string,
): JobLikeInput[] {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }
  const obj = payload as Record<string, unknown>;
  const records = pickArray(obj.cases) ?? pickArray(obj.runs) ?? [obj];
  const out: JobLikeInput[] = [];
  for (const r of records) {
    if (r === null || typeof r !== "object" || Array.isArray(r)) continue;
    const job = duckCastToJob(r as Record<string, unknown>);
    job.loaderNotes = [...(job.loaderNotes ?? []), `from:${sourceName}`];
    out.push(job);
  }
  return out;
}

function duckCastToJob(r: Record<string, unknown>): JobLikeInput {
  return {
    id: pickString(r.id) ?? pickString(r.jobId),
    taskId: pickString(r.taskId) ?? pickString(r.task_id),
    sessionId: pickString(r.sessionId) ?? pickString(r.session_id),
    provider: pickString(r.provider) ?? pickString(r.providerName),
    scenario: pickString(r.scenario) ?? pickString(r.caseId) ?? pickString(r.case),
    status: pickString(r.status),
    errorMessage: pickString(r.errorMessage) ?? pickString(r.error),
    terminalReason:
      pickString(r.terminalReason) ?? pickString(r.terminalReasonText),
    terminalCode: pickString(r.terminalCode),
    createdAt: pickString(r.createdAt) ?? pickString(r.created_at),
    updatedAt:
      pickString(r.updatedAt) ?? pickString(r.completedAt) ?? pickString(r.finishedAt),
    steps: pickArray(r.steps),
    decisionLog: pickArray(r.decisionLog) ?? pickArray(r.decision_log),
    params:
      r.params !== undefined && r.params !== null && typeof r.params === "object"
        ? (r.params as Record<string, unknown>)
        : null,
  };
}

function pickString(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

function pickArray<T = unknown>(v: unknown): T[] | null {
  return Array.isArray(v) ? (v as T[]) : null;
}

/* ─── Aggregator: build summaries / reports for the dashboard ────── */

export interface AggregateOptions {
  filter?: ForensicsListFilter;
  /** Cap on number of jobs to process. Default 100. */
  limit?: number;
  /** Whether to attach a worker log excerpt per job. Default false. */
  attachWorkerLog?: boolean;
}

export interface AggregateResult {
  reports: ForensicsReport[];
  summaries: ForensicsSummary[];
  workerLogAvailable: boolean;
  workerLogPathHint: string;
  benchmarkRunsScanned: number;
  loaderNotes: string[];
}

/**
 * Scan filesystem sources, build forensics reports for each
 * matching job, return both reports + summaries + meta info for
 * the dashboard. Graceful empty-state on missing artifacts.
 */
export async function aggregateForensics(
  options: AggregateOptions = {},
): Promise<AggregateResult> {
  const limit = Math.max(1, options.limit ?? 100);
  const loaderNotes: string[] = [];
  const allJobs: { job: JobLikeInput; sourceName: string }[] = [];

  let filenames: string[] = [];
  try {
    filenames = await listBenchmarkRunFilenames();
  } catch (err) {
    loaderNotes.push(`benchmark-runs scan failed: ${(err as Error).message}`);
  }
  if (filenames.length === 0) {
    loaderNotes.push("no benchmark-runs/*.json found — empty source");
  }

  for (const name of filenames) {
    if (allJobs.length >= limit) break;
    let parsed: unknown;
    try {
      parsed = await readBenchmarkRunFile(name);
    } catch (err) {
      loaderNotes.push(
        `skipped ${name}: ${(err as Error).message}`.slice(0, 240),
      );
      continue;
    }
    const jobs = extractJobsFromBenchmarkPayload(parsed, name);
    for (const j of jobs) {
      if (allJobs.length >= limit) break;
      allJobs.push({ job: j, sourceName: name });
    }
  }

  // Worker log presence (no excerpt unless asked).
  let workerLogAvailable = false;
  try {
    const path = getWorkerLogPath();
    await fs.access(path);
    workerLogAvailable = true;
  } catch {
    workerLogAvailable = false;
  }

  // Optional excerpt attach per job.
  if (options.attachWorkerLog && workerLogAvailable) {
    for (const e of allJobs) {
      const filter = e.job.id ?? e.job.taskId ?? e.job.scenario ?? null;
      const excerpt = filter
        ? await readWorkerLogExcerpt({ filterSubstring: filter, maxBytes: 4096 })
        : null;
      if (excerpt && excerpt.length > 0) {
        e.job.rawWorkerLogExcerpt = excerpt;
      }
    }
  }

  // Filter step (post-extraction).
  const filtered = allJobs.filter((e) => matchesFilter(e.job, options.filter));

  const reports: ForensicsReport[] = filtered.map((e) =>
    buildForensicsReport(e.job, {
      inputSource: `benchmark-run:${e.sourceName}`,
      hints: { benchmarkReportFile: e.sourceName },
    }),
  );
  const summaries = reports.map(buildForensicsSummary);

  return {
    reports,
    summaries,
    workerLogAvailable,
    workerLogPathHint: getWorkerLogPath(),
    benchmarkRunsScanned: filenames.length,
    loaderNotes,
  };
}

/** Pure filter applied to a JobLikeInput. */
export function matchesFilter(
  job: JobLikeInput,
  filter: ForensicsListFilter | undefined,
): boolean {
  if (!filter) return true;
  if (filter.jobId && job.id !== filter.jobId) return false;
  if (filter.taskId && job.taskId !== filter.taskId) return false;
  if (filter.sessionId && job.sessionId !== filter.sessionId) return false;
  if (
    filter.provider &&
    typeof job.provider === "string" &&
    job.provider.toLowerCase() !== filter.provider.toLowerCase()
  ) {
    return false;
  }
  if (
    filter.status &&
    typeof job.status === "string" &&
    job.status.toLowerCase() !== filter.status.toLowerCase()
  ) {
    return false;
  }
  // primaryClass filter is post-classification — handled at aggregator if needed.
  return true;
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

function isEnoent(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}
