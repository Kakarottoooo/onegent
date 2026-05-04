/**
 * Resy availability probe report — TYPES + LOADER (Track B helper).
 *
 * Why this file exists
 * ────────────────────
 * Codex (Track A) is shipping a `scripts/probe-resy-availability.ts` runner
 * that hits Resy's public availability JSON endpoint for each Phase 0
 * fixture case and writes its result to:
 *
 *     benchmark/runs/resy-availability-probe-<ISO-timestamp>.json
 *
 * The probe is intentionally cheap (no Computer Use, no browser) so the
 * founder can quickly find which Phase 0 cases have *real* availability on
 * the requested date/time. R-003 burned a live token because the case had
 * no slots — the probe-first protocol prevents that.
 *
 * This module is the **Track B contract** for that report: types the dev
 * dashboard at `/dev/resy-probe-runs` reads + a node-only file loader.
 * Codex's probe writer must match this shape, or update this file in the
 * same commit so the dashboard stays in sync.
 *
 * Hold-rule note
 * ──────────────
 * `lib/benchmark/phase0-report.ts` is codex's source-of-truth for the live
 * benchmark report. This file is the parallel for the probe report — DIFFERENT
 * file, Track B owned. Don't mix. If the probe schema converges with the live
 * benchmark schema, that's a future merge codex can drive.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/* ─── Schema ─────────────────────────────────────────────────────────── */

/**
 * One probe attempt for a single Phase 0 fixture case.
 *
 * Field semantics
 * ───────────────
 * - `slots[]` — every slot Resy returned, regardless of whether it matches
 *   the requested time. Empty = no availability at any time.
 * - `matchingSlots[]` — subset of `slots` whose `time` matches what the
 *   fixture asked for (within a small tolerance the probe runner decides).
 * - `noAvailabilitySignals[]` — strings the probe extracted that explain
 *   *why* slots is empty. e.g. "venue_closed_on_date", "fully_booked",
 *   "outside_booking_window". Empty if slots > 0.
 * - `blockerSignals[]` — strings indicating the probe couldn't get a
 *   clean answer. e.g. "captcha", "rate_limited", "schema_drift".
 *   Non-empty means probe result is UNTRUSTED.
 *
 * `recommendation` is the runner's pre-computed verdict:
 * - `live_ok` — has matching slots, safe to spend tokens on this case
 * - `live_no_slots_correct` — no matching slots, would map to
 *   `no_availability_correct`. Useful for taxonomy testing but NOT for
 *   validating fill/OTP closure.
 * - `skip` — blocker signals or zero confidence; rerun probe later.
 */
export interface ResyProbeCase {
  caseId: string;
  restaurant: string;
  /** YYYY-MM-DD */
  date: string;
  /** 24h "HH:mm" or empty if any-time */
  time: string;
  covers: number;
  slots: ResyProbeSlot[];
  matchingSlots: ResyProbeSlot[];
  noAvailabilitySignals: string[];
  blockerSignals: string[];
  recommendation: "live_ok" | "live_no_slots_correct" | "skip";
  /** Optional pre-computed live runner command for this case. */
  recommendedCommand?: string;
  /** Free-form note from the probe (e.g. "matched on +/- 30 min window"). */
  note?: string;
}

export interface ResyProbeSlot {
  /** ISO-ish "HH:mm" 24h. */
  time: string;
  /** Resy's slot-type label, e.g. "Bar", "Standard". Optional. */
  type?: string;
  /** Resy's `config.token` or equivalent. Useful for downstream live runs. */
  configToken?: string;
}

/**
 * One probe RUN (multiple cases).
 *
 * Lives at `benchmark/runs/resy-availability-probe-<ts>.json`.
 */
export interface ResyProbeRun {
  /** ISO timestamp matching filename. */
  startedAt: string;
  finishedAt: string;
  /** Probe runner version — bump when schema changes. */
  schemaVersion: 1;
  /**
   * The runner's top recommendation across all cases.
   * Populated even when 0 cases qualify (then `caseId` is null).
   */
  recommendedCase: {
    caseId: string | null;
    rationale: string;
    /** The exact `npx tsx ...` command founder should paste. */
    nextLiveCommand: string;
  };
  cases: ResyProbeCase[];
  /** Aggregate counters. */
  summary: {
    total: number;
    live_ok: number;
    live_no_slots_correct: number;
    skip: number;
  };
  /** Optional notes from the runner — e.g. rate limit detected, retry advice. */
  runnerNotes: string[];
}

/**
 * List item for the run picker (one row per probe run file on disk).
 */
export interface ResyProbeRunSummary {
  /** Filename (basename, without dir). */
  file: string;
  /** Parsed startedAt from the JSON; null if unreadable. */
  startedAt: string | null;
  /** Quick-look counts from `summary`. */
  total: number | null;
  live_ok: number | null;
  recommendedCaseId: string | null;
}

/* ─── File I/O ───────────────────────────────────────────────────────── */

const RUNS_DIR = path.join(process.cwd(), "benchmark", "runs");
const FILE_PATTERN = /^resy-availability-probe-.*\.json$/i;

/**
 * List probe-run files (newest first by filename, which encodes ISO ts).
 * Returns at most `limit` entries; default 20.
 *
 * On any I/O error the list is returned empty rather than throwing — the
 * dashboard gracefully shows "no probe runs yet" + a runner pointer.
 */
export async function listResyProbeRunSummaries(
  limit = 20,
): Promise<ResyProbeRunSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(RUNS_DIR);
  } catch {
    return [];
  }
  const matching = entries
    .filter((name) => FILE_PATTERN.test(name))
    .sort()
    .reverse()
    .slice(0, limit);

  const summaries: ResyProbeRunSummary[] = [];
  for (const file of matching) {
    summaries.push(await loadProbeSummary(file));
  }
  return summaries;
}

async function loadProbeSummary(file: string): Promise<ResyProbeRunSummary> {
  try {
    const raw = await fs.readFile(path.join(RUNS_DIR, file), "utf-8");
    const parsed = JSON.parse(raw) as Partial<ResyProbeRun>;
    return {
      file,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
      total: parsed.summary?.total ?? null,
      live_ok: parsed.summary?.live_ok ?? null,
      recommendedCaseId: parsed.recommendedCase?.caseId ?? null,
    };
  } catch {
    return { file, startedAt: null, total: null, live_ok: null, recommendedCaseId: null };
  }
}

/**
 * Load one full probe-run JSON. Returns null if the file is missing or
 * unparseable. Caller is responsible for filename-shape validation
 * (defense-in-depth — the API route also validates).
 */
export async function loadResyProbeRun(file: string): Promise<ResyProbeRun | null> {
  if (!FILE_PATTERN.test(file)) return null;
  try {
    const raw = await fs.readFile(path.join(RUNS_DIR, file), "utf-8");
    const parsed = JSON.parse(raw) as ResyProbeRun;
    if (parsed.schemaVersion !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ─── Display helpers (used by dashboard) ─────────────────────────────── */

export const RECOMMENDATION_LABEL: Record<ResyProbeCase["recommendation"], string> = {
  live_ok: "Live OK",
  live_no_slots_correct: "No slots (correct)",
  skip: "Skip / blocker",
};

export const RECOMMENDATION_TONE: Record<ResyProbeCase["recommendation"], "good" | "ok" | "warn"> = {
  live_ok: "good",
  live_no_slots_correct: "ok",
  skip: "warn",
};
