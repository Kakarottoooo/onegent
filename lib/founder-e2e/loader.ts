// lib/founder-e2e/loader.ts
//
// Filesystem helpers for persisting Founder QA runs. Strict allow-listed
// directory + path-traversal proof. Read-only callers (the API GET) never
// throw on missing dir; write callers create the dir on demand.
//
// Persistence layout (relative to repo root):
//   benchmark/runs/founder-e2e-<pathId>-<slug>.json
//
// Files in benchmark/runs/ are gitignored except for ones explicitly committed
// by codex (phase0-resy-*.json). Founder runs share the same gitignore rule.

import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  FOUNDER_E2E_KIND,
  FOUNDER_E2E_SCHEMA_VERSION,
  fileNameForRun,
  isSafeFounderRunFileName,
  parseQaRun,
  recomputeRun,
  type ChecklistPath,
  type ExitCriterionDefinition,
  type QaRun,
} from "./checklist";
import { FOUNDER_E2E_PATHS, getExitCriteriaForPath } from "./fixtures";

// Resolved lazily so tests can swap cwd safely; constant snapshots break
// the moment a test does `process.chdir(...)`.
export function getFounderE2eRunsDir(): string {
  return path.resolve(process.cwd(), "benchmark", "runs");
}

const FILE_PREFIX = "founder-e2e-";

export interface FounderRunSummary {
  file: string;
  runId: string;
  pathId: "quick" | "full";
  startedAt: string;
  updatedAt: string;
  branchSha?: string;
  meetsBar: boolean;
  pass: number;
  fail: number;
  blocker: number;
  skipped: number;
  pending: number;
  total: number;
  p0Count: number;
  p1Count: number;
}

export async function listFounderE2eRunSummaries(): Promise<FounderRunSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(getFounderE2eRunsDir());
  } catch (err) {
    if (isFsNotFound(err)) return [];
    throw err;
  }
  const candidates = entries.filter(
    (name) => name.startsWith(FILE_PREFIX) && name.endsWith(".json") && isSafeFounderRunFileName(name),
  );
  const out: FounderRunSummary[] = [];
  for (const file of candidates) {
    const summary = await tryReadSummary(file);
    if (summary) out.push(summary);
  }
  out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return out;
}

async function tryReadSummary(file: string): Promise<FounderRunSummary | undefined> {
  const fullPath = resolveSafePath(file);
  if (!fullPath) return undefined;
  try {
    const raw = await fs.readFile(fullPath, "utf8");
    const parsed = JSON.parse(raw);
    const run = parseQaRun(parsed);
    return {
      file,
      runId: run.id,
      pathId: run.pathId,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      branchSha: run.branchSha,
      meetsBar: run.exit.meetsBar,
      pass: run.summary.pass,
      fail: run.summary.fail,
      blocker: run.summary.blocker,
      skipped: run.summary.skipped,
      pending: run.summary.pending,
      total: run.summary.total,
      p0Count: run.exit.p0Count,
      p1Count: run.exit.p1Count,
    };
  } catch {
    return undefined;
  }
}

export async function readFounderE2eRunByFile(file: string): Promise<QaRun | undefined> {
  if (!isSafeFounderRunFileName(file)) return undefined;
  const fullPath = resolveSafePath(file);
  if (!fullPath) return undefined;
  let raw: string;
  try {
    raw = await fs.readFile(fullPath, "utf8");
  } catch (err) {
    if (isFsNotFound(err)) return undefined;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    return parseQaRun(parsed);
  } catch {
    return undefined;
  }
}

export interface SaveFounderRunResult {
  file: string;
  run: QaRun;
}

/**
 * Persist a (recomputed) QaRun. The path id of the run determines which
 * exit-criteria definitions are applied. Always recomputes summary + exit
 * before writing, so saved files are internally consistent.
 */
export async function saveFounderE2eRun(run: QaRun): Promise<SaveFounderRunResult> {
  if (run.kind !== FOUNDER_E2E_KIND || run.schemaVersion !== FOUNDER_E2E_SCHEMA_VERSION) {
    throw new Error("invalid founder QA run payload");
  }
  const pathDef = FOUNDER_E2E_PATHS[run.pathId];
  if (!pathDef) {
    throw new Error(`unknown founder QA pathId ${run.pathId}`);
  }
  const exitDefs: ReadonlyArray<ExitCriterionDefinition> = getExitCriteriaForPath(run.pathId);
  const recomputed = recomputeRun(pathDef, run, exitDefs);
  const file = fileNameForRun(recomputed);
  if (!isSafeFounderRunFileName(file)) {
    throw new Error(`refusing to write unsafe filename ${file}`);
  }
  const fullPath = resolveSafePath(file);
  if (!fullPath) {
    throw new Error(`refusing to write outside ${getFounderE2eRunsDir()}`);
  }
  await fs.mkdir(getFounderE2eRunsDir(), { recursive: true });
  await fs.writeFile(fullPath, JSON.stringify(recomputed, null, 2), "utf8");
  return { file, run: recomputed };
}

/**
 * Resolve a file name into an absolute path inside getFounderE2eRunsDir().
 * Returns undefined if the resolved path escapes the dir (defense in depth
 * even though isSafeFounderRunFileName already rules out path separators).
 */
export function resolveSafePath(file: string): string | undefined {
  if (!isSafeFounderRunFileName(file)) return undefined;
  const candidate = path.resolve(getFounderE2eRunsDir(), file);
  if (!candidate.startsWith(getFounderE2eRunsDir() + path.sep) && candidate !== getFounderE2eRunsDir()) {
    return undefined;
  }
  return candidate;
}

export function isFsNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "ENOENT";
}

export function getPathDef(pathId: "quick" | "full"): ChecklistPath {
  return FOUNDER_E2E_PATHS[pathId];
}
