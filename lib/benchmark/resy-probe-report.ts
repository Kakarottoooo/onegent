/**
 * Resy availability probe report — TYPES + LOADER (Track B helper).
 *
 * Why this file exists
 * ────────────────────
 * Codex (Track A) ships `scripts/probe-resy-availability.ts` (added in
 * commit `024dd05`) which hits Resy's public availability JSON endpoint
 * for each Phase 0 fixture case and writes its result to:
 *
 *     benchmark/runs/resy-availability-probe-<ISO-timestamp>.json
 *
 * The probe is intentionally cheap (no Computer Use, no live OpenAI, no
 * Stagehand prompt loop) so the founder can quickly find which Phase 0
 * cases have *real* availability for the requested date/time. R-003
 * burned a live token chasing a Resy case with zero slots — probe-first
 * prevents that.
 *
 * This module is the **Track B contract** that the dev dashboard at
 * `/dev/resy-probe-runs` reads. The shape is dictated BY codex's runner
 * output (see `scripts/probe-resy-availability.ts` types `ProbeReport`,
 * `CaseProbeResult`, `SlotCandidate`). If codex's schema changes, this
 * file is the one place to mirror that change.
 *
 * Hold-rule note
 * ──────────────
 * `lib/benchmark/phase0-report.ts` is codex's source-of-truth for the
 * live benchmark report. This file is the parallel for the no-token probe
 * report — DIFFERENT file, Track B owned reflection. Do not mix.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/* ─── Schema (mirrors scripts/probe-resy-availability.ts) ────────────── */

/** One slot Resy returned. Verbatim shape from probe runner's `SlotCandidate`. */
export interface ResyProbeSlot {
  /** Display label, e.g. "8:00 PM Bar Seats". */
  text: string;
  /** 24h minutes-since-midnight. e.g. 1200 = 20:00. */
  minutes: number;
  /** |slot.minutes - target.minutes| — used to rank within window. */
  diffMinutes: number;
  /** YYYY-MM-DD or null/undefined if probe couldn't tag a date. */
  dateIso?: string | null;
  href?: string | null;
  tagName?: string;
  /** Where the slot came from. "api" = Resy public JSON; "dom" = page scrape. */
  source: "api" | "dom";
  /** Resy `config.token` — opaque slot identifier for downstream reservation. */
  token?: string | null;
  venueSlug?: string | null;
  venueName?: string | null;
}

/**
 * One probe attempt for a single Phase 0 fixture case.
 *
 * `recommendation` is the runner's verdict:
 * - `use_for_live_fill_test` — has matching slots; safe to spend tokens here
 * - `no_matching_slot` — slot list empty/no match. Maps to `no_availability_correct`
 *   in the Phase 0 taxonomy. Useful for the no-availability classification path
 *   but CANNOT validate fill/OTP closure.
 * - `blocked_or_unknown` — captcha / rate limit / other blocker. Untrusted result.
 */
export interface ResyProbeCase {
  caseId: string;
  restaurantName: string;
  /**
   * Resy start URL with date/seats/time query params, e.g.
   * `https://resy.com/cities/new-york-ny/venues/charlie-bird?date=2026-05-08&seats=2&time=20%3A00`.
   */
  url: string;
  /** "HH:mm" 24h. */
  targetTime: string;
  /** Minutes since midnight of `targetTime`. */
  targetMinutes: number;
  /** Match window the runner used, e.g. 60. */
  allowedWindowMinutes: number;
  /** "api" | "api+browser" | "browser" — which sources the runner sampled. */
  probeSource: "api" | "api+browser" | "browser";
  apiStatus?: number;
  apiVenueName?: string;
  apiVenueSlug?: string;
  /** When the API call exact-slug-matched and returned, this is unset.
   *  When the runner couldn't find the expected slug or a slot, this carries
   *  a short reason like `Exact venue slug not returned. Top hits: X:slug-x, …`. */
  apiError?: string;
  pageUrl: string;
  title: string;
  slots: ResyProbeSlot[];
  matchingSlots: ResyProbeSlot[];
  noAvailabilitySignals: string[];
  blockerSignals: string[];
  bodySnippet: string;
  screenshotPath?: string;
  recommendation: "use_for_live_fill_test" | "no_matching_slot" | "blocked_or_unknown";
}

/**
 * One probe RUN (potentially multiple cases).
 *
 * Lives at `benchmark/runs/resy-availability-probe-<ts>.json`.
 * Verbatim shape from codex's runner `ProbeReport` type.
 */
export interface ResyProbeRun {
  /** e.g. "resy-availability-probe-2026-05-04T02-48-49-759Z" — basename minus extension. */
  runId: string;
  /** ISO-8601, may have ms. */
  createdAt: string;
  /** Absolute path to suite JSON the runner read (informational only). */
  suitePath: string;
  /** True if the runner ran with a visible Chromium window. */
  visible: boolean;
  results: ResyProbeCase[];
  /** Top recommendation — first entry of `recommendedCases` if non-empty. */
  recommendedCase?: ResyProbeCase;
  /** All cases with `recommendation === "use_for_live_fill_test"`. */
  recommendedCases: ResyProbeCase[];
}

/** Aggregate counters derived client-side (NOT in codex's JSON). */
export interface ResyProbeRunSummary {
  /** Filename (basename, without dir). */
  file: string;
  /** Parsed createdAt from the JSON; null if unreadable. */
  createdAt: string | null;
  total: number | null;
  /** Count of `use_for_live_fill_test` results. */
  liveOk: number | null;
  noMatchingSlot: number | null;
  blockedOrUnknown: number | null;
  recommendedCaseId: string | null;
}

/** Parsed query params from a Resy probe `url`. */
export interface ResyProbeUrlParts {
  /** YYYY-MM-DD or null if param missing. */
  date: string | null;
  /** integer or null. */
  covers: number | null;
  /** "HH:mm" 24h or null. */
  time: string | null;
  /** Resy slug from path (e.g. "charlie-bird"). */
  resySlug: string | null;
  /** City slug, e.g. "new-york-ny". */
  citySlug: string | null;
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
  const empty: ResyProbeRunSummary = {
    file,
    createdAt: null,
    total: null,
    liveOk: null,
    noMatchingSlot: null,
    blockedOrUnknown: null,
    recommendedCaseId: null,
  };
  try {
    const raw = await fs.readFile(path.join(RUNS_DIR, file), "utf-8");
    const parsed = JSON.parse(raw) as Partial<ResyProbeRun>;
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    const counts = countByRecommendation(results);
    return {
      file,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : null,
      total: results.length,
      liveOk: counts.use_for_live_fill_test,
      noMatchingSlot: counts.no_matching_slot,
      blockedOrUnknown: counts.blocked_or_unknown,
      recommendedCaseId: parsed.recommendedCase?.caseId ?? null,
    };
  } catch {
    return empty;
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
    if (!parsed || typeof parsed.runId !== "string" || !Array.isArray(parsed.results)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/* ─── Pure helpers (used by dashboard + tests, no fs) ────────────────── */

/** Count results by recommendation bucket. */
export function countByRecommendation(
  results: Pick<ResyProbeCase, "recommendation">[],
): {
  use_for_live_fill_test: number;
  no_matching_slot: number;
  blocked_or_unknown: number;
} {
  const out = {
    use_for_live_fill_test: 0,
    no_matching_slot: 0,
    blocked_or_unknown: 0,
  };
  for (const r of results) {
    if (r.recommendation === "use_for_live_fill_test") out.use_for_live_fill_test++;
    else if (r.recommendation === "no_matching_slot") out.no_matching_slot++;
    else if (r.recommendation === "blocked_or_unknown") out.blocked_or_unknown++;
  }
  return out;
}

/**
 * Extract date / covers / time / slug from the probe `url`.
 * The probe runner produces URLs like:
 *   https://resy.com/cities/new-york-ny/venues/charlie-bird?date=2026-05-08&seats=2&time=20%3A00
 *
 * Returns nulls for any part it can't parse — never throws.
 */
export function parseResyProbeUrl(rawUrl: string): ResyProbeUrlParts {
  const empty: ResyProbeUrlParts = {
    date: null,
    covers: null,
    time: null,
    resySlug: null,
    citySlug: null,
  };
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return empty;
  }
  // Path: /cities/<citySlug>/venues/<venueSlug>
  const segments = parsed.pathname.split("/").filter(Boolean);
  let citySlug: string | null = null;
  let resySlug: string | null = null;
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === "cities") citySlug = segments[i + 1] ?? null;
    if (segments[i] === "venues") resySlug = segments[i + 1] ?? null;
  }
  const dateRaw = parsed.searchParams.get("date");
  const seatsRaw = parsed.searchParams.get("seats");
  const timeRaw = parsed.searchParams.get("time");
  const seats = seatsRaw ? Number(seatsRaw) : NaN;
  return {
    date: dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null,
    covers: Number.isFinite(seats) ? seats : null,
    time: timeRaw && /^\d{1,2}:\d{2}$/.test(timeRaw) ? timeRaw : null,
    resySlug,
    citySlug,
  };
}

/**
 * Derive the next single-case live command for `caseId`. Mirrors the line
 * codex's probe runner prints to stdout, but kept here so the dashboard can
 * render it for any case (not just `recommendedCase`).
 *
 * Uses Windows-style backslash because the founder/codex run on Windows
 * (consistent with the runner's own output format).
 */
export function buildNextLiveCommand(caseId: string): string {
  return `npx tsx scripts\\run-phase0-resy-benchmark.ts --case ${caseId} --live-openai --allow-failures`;
}

/** True if `apiVenueSlug` matches what the URL says we asked for (or both blank). */
export function isExactVenueMatch(c: ResyProbeCase): boolean {
  const { resySlug } = parseResyProbeUrl(c.url);
  if (!resySlug) return false;
  if (!c.apiVenueSlug) return false;
  return c.apiVenueSlug.toLowerCase() === resySlug.toLowerCase();
}

/**
 * Short human-readable reason explaining why this case is or isn't a safe
 * next live target.
 */
export function explainRecommendation(c: ResyProbeCase): string {
  switch (c.recommendation) {
    case "use_for_live_fill_test":
      return `${c.matchingSlots.length} matching slot(s) within ±${c.allowedWindowMinutes}min of ${c.targetTime}. Exact venue slug confirmed${isExactVenueMatch(c) ? "" : " (slug mismatch — verify)"}.`;
    case "no_matching_slot":
      if (c.apiError) return `No exact venue match: ${c.apiError}`;
      if (c.slots.length === 0) return "Resy returned zero slots for this date/time. Maps to no_availability_correct — cannot validate fill/OTP.";
      return `${c.slots.length} slot(s) returned but none within ±${c.allowedWindowMinutes}min window.`;
    case "blocked_or_unknown":
      if (c.blockerSignals.length > 0) return `Blocker signals: ${c.blockerSignals.join(", ")}.`;
      return "Probe could not classify (no blocker signals captured).";
  }
}

/* ─── Display constants ──────────────────────────────────────────────── */

export const RECOMMENDATION_LABEL: Record<ResyProbeCase["recommendation"], string> = {
  use_for_live_fill_test: "Live OK",
  no_matching_slot: "No matching slot",
  blocked_or_unknown: "Blocked / unknown",
};

export const RECOMMENDATION_TONE: Record<
  ResyProbeCase["recommendation"],
  "good" | "ok" | "warn"
> = {
  use_for_live_fill_test: "good",
  no_matching_slot: "ok",
  blocked_or_unknown: "warn",
};
