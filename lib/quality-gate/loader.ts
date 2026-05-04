/**
 * Quality Gate file IO. Lives separate from `report.ts` (pure
 * logic) so consumers that don't need fs (e.g., bundled into a
 * Next.js client component) can import only the pure module.
 *
 * Two operations:
 *  - listQualityGateRunSummaries() — scan benchmark/runs/, parse
 *    each JSON, return summaries (newest-first).
 *  - readQualityGateRunByFile(file) — read one file by name with
 *    defense-in-depth path-traversal guards.
 *
 * The directory is resolved lazily via getQualityGateRunsDir() so
 * tests can swap process.cwd() inside beforeEach without freezing
 * a stale absolute path at module load time. (We learned this the
 * hard way on lib/founder-e2e/loader.ts — see commit history.)
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  parseQualityGateRun,
  summarizeQualityGateRun,
  isSafeQualityGateFileName,
  fileNameFromRunId as fileNameFromRunIdReport,
  type QualityGateRunSummary,
  type QualityGateRun,
  QualityGateParseError,
} from "./report";

/**
 * Lazy resolution: tests do `process.chdir(tmpRoot)` and expect
 * the loader to follow. Don't cache this at module scope.
 */
export function getQualityGateRunsDir(): string {
  return path.resolve(process.cwd(), "benchmark", "runs");
}

/**
 * Resolve a candidate file name into an absolute path inside the
 * runs directory. Throws on traversal attempts or invalid names.
 *
 * Defense-in-depth:
 *  1. isSafeQualityGateFileName regex (no slashes, no "..", strict
 *     suffix).
 *  2. path.resolve gets us an absolute path.
 *  3. Verify the resolved path's prefix matches the runs dir.
 */
export function resolveSafeRunPath(fileName: string): string {
  if (!isSafeQualityGateFileName(fileName)) {
    throw new QualityGateLoaderError(
      `Refusing unsafe quality-gate file name: ${String(fileName)}`,
    );
  }
  const dir = getQualityGateRunsDir();
  const resolved = path.resolve(dir, fileName);
  // path.resolve normalizes ".." segments. After normalization, the
  // resolved path MUST start with the runs dir + path separator.
  if (!resolved.startsWith(dir + path.sep)) {
    throw new QualityGateLoaderError(
      `Path-traversal attempt blocked: ${fileName}`,
    );
  }
  return resolved;
}

/** Thrown by loader functions on IO + safety issues. */
export class QualityGateLoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QualityGateLoaderError";
  }
}

/**
 * List all phase1-quality-gate-*.json files in benchmark/runs/,
 * parse them, return summaries sorted newest-first by
 * generatedAt. Garbage files (parse errors, wrong shape) are
 * silently skipped — the dashboard renders whatever is valid.
 *
 * If the runs directory doesn't exist, returns []. Don't throw.
 */
export async function listQualityGateRunSummaries(): Promise<QualityGateRunSummary[]> {
  const dir = getQualityGateRunsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err: unknown) {
    if (isEnoent(err)) return [];
    throw err;
  }

  const summaries: QualityGateRunSummary[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    if (!isSafeQualityGateFileName(name)) continue;
    try {
      const summary = await readQualityGateSummary(name);
      summaries.push(summary);
    } catch {
      // Garbage in, garbage skipped. Don't fail the listing.
    }
  }
  summaries.sort((a, b) => {
    // Newest-first by generatedAt. Falls back to fileName if
    // timestamps tie.
    if (a.generatedAt > b.generatedAt) return -1;
    if (a.generatedAt < b.generatedAt) return 1;
    return a.fileName.localeCompare(b.fileName);
  });
  return summaries;
}

/** Read + parse one summary by file name. Throws on bad files. */
export async function readQualityGateSummary(
  fileName: string,
): Promise<QualityGateRunSummary> {
  const run = await readQualityGateRunByFile(fileName);
  return summarizeQualityGateRun(run, fileName);
}

/** Read + parse one full run by file name. Throws on bad files. */
export async function readQualityGateRunByFile(
  fileName: string,
): Promise<QualityGateRun> {
  const resolved = resolveSafeRunPath(fileName);
  const raw = await fs.readFile(resolved, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new QualityGateLoaderError(
      `Invalid JSON in ${fileName}: ${(err as Error).message}`,
    );
  }
  return parseQualityGateRun(parsed);
}

/**
 * Persist a run to disk as `<runId>.json`. Returns the absolute
 * file path written. Creates the runs dir if needed. Caller is
 * responsible for also writing the .md sibling if desired (the
 * runner does this).
 */
export async function saveQualityGateRun(
  run: QualityGateRun,
  options: { fileName?: string } = {},
): Promise<string> {
  const dir = getQualityGateRunsDir();
  await fs.mkdir(dir, { recursive: true });
  const fileName =
    options.fileName ??
    fileNameFromRunId(run.runId);
  const resolved = resolveSafeRunPath(fileName);
  await fs.writeFile(resolved, JSON.stringify(run, null, 2) + "\n", "utf8");
  return resolved;
}

/**
 * Persist the markdown sibling next to a JSON run. Pure helper
 * around fs.writeFile; same path-safety rules apply.
 */
export async function saveQualityGateMarkdown(
  fileName: string,
  markdown: string,
): Promise<string> {
  const resolved = resolveSafeRunPath(fileName);
  await fs.writeFile(resolved, markdown, "utf8");
  return resolved;
}

/**
 * Convenience: run id → canonical json filename. Re-exported from
 * report (pure) to keep the loader API ergonomic without forcing
 * callers to import from two places.
 */
export const fileNameFromRunId = fileNameFromRunIdReport;

function isEnoent(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}
