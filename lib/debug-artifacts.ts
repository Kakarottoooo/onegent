/**
 * Debug artifact loader — `worker/.debug-screenshots/<provider>/<run>/`.
 *
 * Why this file exists
 * ────────────────────
 * Codex's per-provider debug capture writes a directory tree like:
 *
 *     worker/.debug-screenshots/
 *       opentable/
 *         2026-05-04T00-03-31-072Z-phone-gate-manual-review/
 *           summary.json   ({ label, url, viewport, summary: { ... } })
 *           page.png       (~80-100 KB)
 *           page.html      (sometimes; depends on what the page API exposes)
 *         <next run dir>/
 *           ...
 *       resy/
 *         <run dir>/...
 *
 * Until 2026-05-04, founder/codex inspected these via file explorer +
 * terminal. Codex's coordination file flagged the gap three times:
 *
 *   "useful parallel task: artifact viewer UX/spec for
 *    `.debug-screenshots/opentable/*` so founder/codex can inspect
 *    screenshot + summary from the dashboard instead of terminal/file
 *    explorer."
 *
 * This module is the Track-B node-only contract for that viewer.
 * `app/api/dev/debug-artifacts/*` and `app/dev/debug-artifacts/page.tsx`
 * consume it.
 *
 * Hold-rule note
 * ──────────────
 * Reads only. No mutation of anything under `worker/`. Provider code
 * (`lib/booking-autopilot/**`, `worker/src/**`) is untouched.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/* ─── Constants ──────────────────────────────────────────────────────── */

const ROOT_DIR = path.join(process.cwd(), "worker", ".debug-screenshots");

/**
 * Whitelisted provider names. Anything else under `.debug-screenshots/`
 * is ignored (defense against arbitrary subdirs / symlinks landing
 * unexpectedly).
 */
const PROVIDER_WHITELIST = new Set<string>([
  "opentable",
  "resy",
  "booking",
  "expedia",
  "hotels",
]);

/**
 * Run-directory naming convention from codex's writer:
 *   `<ISO-timestamp-with-dashes-and-Z>-<label>`
 * Tolerated: any single-segment dir name made of ASCII alphanum, `-`, `_`, `.`.
 * Path-traversal guards reject anything with `/`, `\\`, or `..`.
 */
const RUN_DIR_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Files we expose via the asset endpoint. Keep tight — anything not on
 * this list is invisible to the dashboard, which avoids leaking dotfiles
 * or accidentally serving large unrelated blobs that codex's writer
 * might dump into a run dir later.
 */
export const ALLOWED_ARTIFACT_FILES = new Set<string>([
  "summary.json",
  "page.png",
  "page.html",
  "page.jpg",
  "page.jpeg",
]);

/* ─── Schema ─────────────────────────────────────────────────────────── */

/**
 * Shape of `summary.json`. Observed shape from codex's 2026-05-04
 * OpenTable runs — strict on the four known top-level keys, opaque on
 * the nested `summary` payload (different failure modes write different
 * fields).
 */
export interface DebugArtifactSummary {
  label: string;
  url: string;
  viewport: { width: number; height: number } | null;
  summary: Record<string, unknown>;
}

/** One run inside a provider directory. */
export interface DebugArtifactRun {
  /** The directory basename, e.g. `2026-05-04T00-03-31-072Z-phone-gate-manual-review`. */
  runId: string;
  /** Best-effort ISO timestamp parsed from the dir prefix; null if dir name doesn't lead with one. */
  capturedAt: string | null;
  /** Trailing label after the timestamp prefix, or empty string. */
  label: string;
  /** Files we'd serve from this run via the asset endpoint. */
  files: string[];
  /** Parsed summary.json if present + parseable, else null. */
  summary: DebugArtifactSummary | null;
}

export interface DebugArtifactProvider {
  provider: string;
  runs: DebugArtifactRun[];
}

export interface DebugArtifactIndex {
  providers: DebugArtifactProvider[];
  /** Aggregate counters for the dashboard summary strip. */
  totals: { providers: number; runs: number };
}

/* ─── Index loader (list everything) ─────────────────────────────────── */

/**
 * Walk `worker/.debug-screenshots/` and return one entry per provider
 * with its runs sorted newest-first. Missing root dir → empty index.
 *
 * Each run's `summary.json` is read up front so the dashboard can render
 * meaningful titles ("phone-gate-manual-review @ 2026-05-04 00:03 UTC")
 * without N+1 fetches.
 */
export async function listDebugArtifacts(): Promise<DebugArtifactIndex> {
  let providerDirents: import("node:fs").Dirent[];
  try {
    providerDirents = await fs.readdir(ROOT_DIR, { withFileTypes: true });
  } catch {
    return { providers: [], totals: { providers: 0, runs: 0 } };
  }

  const providers: DebugArtifactProvider[] = [];
  let totalRuns = 0;

  for (const ent of providerDirents) {
    if (!ent.isDirectory()) continue;
    if (!PROVIDER_WHITELIST.has(ent.name)) continue;
    const runs = await listProviderRuns(ent.name);
    providers.push({ provider: ent.name, runs });
    totalRuns += runs.length;
  }

  // Stable order: alphabetical by provider name.
  providers.sort((a, b) => a.provider.localeCompare(b.provider));

  return {
    providers,
    totals: { providers: providers.length, runs: totalRuns },
  };
}

async function listProviderRuns(provider: string): Promise<DebugArtifactRun[]> {
  const dir = path.join(ROOT_DIR, provider);
  let dirents: import("node:fs").Dirent[];
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const runs: DebugArtifactRun[] = [];
  for (const ent of dirents) {
    if (!ent.isDirectory()) continue;
    if (!RUN_DIR_PATTERN.test(ent.name)) continue;
    runs.push(await loadRunMetadata(provider, ent.name));
  }

  // Newest first by dir name (the leading ISO ts sorts naturally).
  runs.sort((a, b) => b.runId.localeCompare(a.runId));
  return runs;
}

async function loadRunMetadata(
  provider: string,
  runId: string,
): Promise<DebugArtifactRun> {
  const runDir = path.join(ROOT_DIR, provider, runId);
  let entries: string[];
  try {
    entries = await fs.readdir(runDir);
  } catch {
    entries = [];
  }
  const files = entries.filter((f) => ALLOWED_ARTIFACT_FILES.has(f)).sort();
  const summary = files.includes("summary.json")
    ? await readSummaryJson(path.join(runDir, "summary.json"))
    : null;
  const { capturedAt, label } = parseRunId(runId);
  return { runId, capturedAt, label, files, summary };
}

async function readSummaryJson(p: string): Promise<DebugArtifactSummary | null> {
  try {
    const raw = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(raw) as DebugArtifactSummary;
    // Loose shape check — must at least have a `label` string.
    if (typeof parsed?.label !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Run-id format: `<YYYY>-<MM>-<DD>T<HH>-<MM>-<SS>-<ms>Z-<label>`.
 * The `:` in standard ISO is replaced with `-` because it's unsafe in
 * filenames. We translate back to `:` for `Date` parsing.
 *
 * Returns capturedAt = null if dir name doesn't lead with a parseable ts.
 */
export function parseRunId(runId: string): { capturedAt: string | null; label: string } {
  // Match leading ts of form `YYYY-MM-DDTHH-MM-SS-mmmZ` (ms optional).
  const match = runId.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{1,3}))?Z(?:-(.+))?$/,
  );
  if (!match) return { capturedAt: null, label: runId };
  const [, y, mo, d, h, mi, s, ms, label] = match;
  const isoMs = ms ? `.${ms.padStart(3, "0")}` : "";
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${isoMs}Z`;
  // Validate by round-tripping through Date.
  const t = Date.parse(iso);
  return {
    capturedAt: Number.isFinite(t) ? new Date(t).toISOString() : null,
    label: label ?? "",
  };
}

/* ─── Single-asset loader (raw bytes for the asset endpoint) ─────────── */

/**
 * Resolve and read one allowed artifact file.
 *
 * Returns `null` on any of:
 *   - provider not whitelisted
 *   - runId fails RUN_DIR_PATTERN
 *   - file not in ALLOWED_ARTIFACT_FILES
 *   - resolved absolute path escapes `worker/.debug-screenshots/<provider>/<runId>/`
 *   - file missing / unreadable
 *
 * Defense in depth: the API route also rejects on these paths before
 * calling here.
 */
export async function readDebugArtifactAsset(
  provider: string,
  runId: string,
  file: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!PROVIDER_WHITELIST.has(provider)) return null;
  if (!RUN_DIR_PATTERN.test(runId)) return null;
  if (!ALLOWED_ARTIFACT_FILES.has(file)) return null;

  const runDir = path.resolve(ROOT_DIR, provider, runId);
  const target = path.resolve(runDir, file);
  // Make sure target is still inside the run dir (no traversal via symlinks).
  if (!target.startsWith(runDir + path.sep) && target !== runDir) return null;

  try {
    const bytes = await fs.readFile(target);
    return { bytes, contentType: contentTypeFor(file) };
  } catch {
    return null;
  }
}

function contentTypeFor(file: string): string {
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

/* ─── Helpers exposed for tests + fallback rendering ─────────────────── */

export const DEBUG_ARTIFACTS_ROOT = ROOT_DIR;
export { PROVIDER_WHITELIST, RUN_DIR_PATTERN };
