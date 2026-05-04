/**
 * Restaurant Readiness — go/no-go control center loader.
 *
 * Aggregates three independent dev-only data sources into a single
 * "should we burn an OpenAI token right now?" decision:
 *
 *   1. Resy availability probe runs (`benchmark/runs/resy-availability-probe-*.json`)
 *      — codex's `scripts/probe-resy-availability.ts` writes these
 *   2. Phase 0 benchmark reports (`benchmark/runs/phase0-*.json`)
 *      — codex's `scripts/run-phase0-resy-benchmark.ts` writes these
 *   3. Debug screenshot artifacts (`worker/.debug-screenshots/<provider>/<run>/summary.json`)
 *      — providers write these on terminal failures
 *
 * Output is a single `RestaurantReadinessSummary` consumed by the
 * `/dev/restaurant-readiness` page (and only that page). The point of
 * this loader: give the founder a one-screen verdict — `READY TO BURN
 * ONE CASE`, `NEEDS PROBE`, `DO NOT BURN` — with the exact safe
 * single-case live command pre-baked.
 *
 * Design rules (per task scope)
 * ─────────────────────────────
 * - **Read-only**. Never writes any file. Never spawns processes.
 * - **No imports from codex-owned files**. Schema is defined inline
 *   here and matches codex's runner output verbatim. If codex changes
 *   the schema, this file (only) updates in lockstep.
 * - **Empty / missing files = empty state**, never a 500. The page
 *   renders a "no probe yet, run npm run probe:resy" empty state.
 * - **Path-traversal proof**: only reads from a fixed list of dirs
 *   (`benchmark/runs/`, `worker/.debug-screenshots/<allow-listed-providers>/`).
 *   No user input ever joins paths.
 *
 * goNoGo verdict semantics
 * ────────────────────────
 * - `needs_probe`            — no probe file exists yet. Run `npm run probe:resy`.
 * - `blocked_no_artifacts`   — probe file exists but `results[]` is empty
 *                              (probe ran but matched nothing — broken fixture or
 *                              suite filter mistake).
 * - `blocked_no_slots`       — probe ran with cases, but ZERO of them are
 *                              `use_for_live_fill_test`. Every case is
 *                              `no_matching_slot`. A live token would only
 *                              re-validate `no_availability_correct` — not
 *                              fill/OTP closure. Don't burn.
 * - `unknown`                — probe ran but at least one case is
 *                              `blocked_or_unknown` AND no case is
 *                              `use_for_live_fill_test`. The probe itself was
 *                              partially blocked (captcha / rate limit) — rerun.
 * - `ready_for_single_live`  — probe has ≥1 `use_for_live_fill_test` case.
 *                              `nextCommand` is populated.
 *
 * Warnings (informational; don't change goNoGo)
 * ─────────────────────────────────────────────
 * - latest benchmark report has `severeErrorRate > 0` — burn-token gate is
 *   green probabilistically, but a severe is in the recent live record. Read
 *   `/dev/benchmark-runs` first.
 * - probe is older than 24h — slots may have been booked by other users
 *   since. Recommend re-running probe.
 * - debug artifact `summary.json` shows the prior live failed at a known
 *   provider step (e.g. phone-gate, payment) — surface the failure label.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/* ─── Schema (inline mirror of codex's probe runner output) ──────────── */

/** Mirror of `SlotCandidate` in `scripts/probe-resy-availability.ts`. */
interface InlineSlot {
  text: string;
  minutes: number;
  diffMinutes: number;
  dateIso?: string | null;
  source?: "api" | "dom";
  token?: string | null;
  venueSlug?: string | null;
}

/** Mirror of `CaseProbeResult`. Only the fields the readiness loader uses. */
interface InlineProbeCase {
  caseId: string;
  restaurantName: string;
  url: string;
  targetTime: string;
  targetMinutes?: number;
  allowedWindowMinutes?: number;
  apiVenueSlug?: string;
  apiError?: string;
  slots?: InlineSlot[];
  matchingSlots?: InlineSlot[];
  noAvailabilitySignals?: string[];
  blockerSignals?: string[];
  recommendation:
    | "use_for_live_fill_test"
    | "no_matching_slot"
    | "blocked_or_unknown";
}

/** Mirror of `ProbeReport`. */
interface InlineProbeReport {
  runId: string;
  createdAt: string;
  results: InlineProbeCase[];
  recommendedCase?: InlineProbeCase;
  recommendedCases?: InlineProbeCase[];
}

/* ─── Public output schema ────────────────────────────────────────────── */

export type ReadinessGoNoGo =
  | "ready_for_single_live"
  | "needs_probe"
  | "blocked_no_slots"
  | "blocked_no_artifacts"
  | "unknown";

export interface ReadinessProbeSummary {
  /** Filename basename (no path). */
  file: string;
  /** Probe `runId` from JSON. */
  runId: string;
  /** ISO timestamp from JSON. */
  createdAt: string;
  totalCases: number;
  countByRecommendation: {
    use_for_live_fill_test: number;
    no_matching_slot: number;
    blocked_or_unknown: number;
  };
  recommendedCaseId: string | null;
}

export interface ReadinessRecommendedCase {
  caseId: string;
  restaurantName: string;
  /** YYYY-MM-DD parsed from URL, or null if URL missing the param. */
  date: string | null;
  /** "HH:mm" 24h. */
  time: string;
  /** Party size parsed from URL `seats=`, or null. */
  covers: number | null;
  /** Number of `matchingSlots` the probe returned. */
  matchingSlotsCount: number;
  /** True iff `apiVenueSlug` matches the slug in the probe URL. */
  exactVenueMatch: boolean;
  recommendation: InlineProbeCase["recommendation"];
  /** Pre-baked single-case live command. Same shape codex's runner prints. */
  liveCommand: string;
}

export interface ReadinessBenchmarkSummary {
  /** Filename basename. */
  file: string;
  runId: string;
  createdAt: string;
  total: number;
  passed: boolean;
  bookingReadyRate: number;
  safeOutcomeRate: number;
  severeErrorRate: number;
  taxonomyCoverageRate: number;
  /** Counts derived from `results[]`. */
  severeCount: number;
  safeFailureCount: number;
  noAvailabilityCorrectCount: number;
  /** First severe outcome's caseId, if any — for quick triage. */
  firstSevereCaseId: string | null;
}

export interface ReadinessDebugArtifact {
  provider: "resy" | "opentable" | "booking" | "expedia" | "hotels";
  /** Run dir basename. */
  runId: string;
  /** Parsed from runId timestamp prefix (ISO). null if dir name doesn't conform. */
  capturedAt: string | null;
  /** Label segment of the run dir (everything after the `Z-`). */
  label: string;
  /** Top-level `summary.summary.error` field if present, for at-a-glance triage. */
  summaryError: string | null;
}

export interface RestaurantReadinessSummary {
  /** ISO when this summary was computed (server clock). */
  generatedAt: string;
  latestProbe: ReadinessProbeSummary | null;
  recommendedCases: ReadinessRecommendedCase[];
  latestBenchmark: ReadinessBenchmarkSummary | null;
  latestDebugArtifacts: ReadinessDebugArtifact[];
  goNoGo: ReadinessGoNoGo;
  /** Human-readable one-line rationale for `goNoGo`. */
  goNoGoReason: string;
  /** Pre-baked live command, only populated when `goNoGo === "ready_for_single_live"`. */
  nextCommand: string | null;
  /** Non-blocking observations the founder should be aware of. */
  warnings: string[];
}

/* ─── Constants ──────────────────────────────────────────────────────── */

const RUNS_DIR = path.join(process.cwd(), "benchmark", "runs");
const DEBUG_ROOT = path.join(process.cwd(), "worker", ".debug-screenshots");
const PROBE_FILE_PATTERN = /^resy-availability-probe-.*\.json$/i;
/** Phase 0 benchmark reports are `phase0-*.json` BUT NOT the probe ones. */
const BENCHMARK_FILE_PATTERN = /^phase0-.*\.json$/i;
const RUN_DIR_PATTERN = /^[A-Za-z0-9._-]+$/;
const PROVIDERS_ALLOWED = [
  "resy",
  "opentable",
  "booking",
  "expedia",
  "hotels",
] as const;
type AllowedProvider = (typeof PROVIDERS_ALLOWED)[number];

const PROBE_STALE_HOURS = 24;
const NEXT_LIVE_TEMPLATE = (caseId: string) =>
  `npx tsx scripts\\run-phase0-resy-benchmark.ts --case ${caseId} --live-openai --allow-failures`;

/* ─── Public API ─────────────────────────────────────────────────────── */

/**
 * Build the full readiness summary. Always succeeds (returns an empty
 * shell on full I/O failure rather than throwing) so the API route can
 * always render an empty state.
 */
export async function buildReadinessSummary(): Promise<RestaurantReadinessSummary> {
  const generatedAt = new Date().toISOString();

  const [latestProbeFull, latestBenchmark, latestDebugArtifacts] =
    await Promise.all([
      loadLatestProbe(),
      loadLatestBenchmark(),
      loadLatestDebugArtifacts(),
    ]);

  const latestProbe = latestProbeFull
    ? summarizeProbe(latestProbeFull.file, latestProbeFull.report)
    : null;

  const recommendedCases = latestProbeFull
    ? extractRecommendedCases(latestProbeFull.report)
    : [];

  const { goNoGo, goNoGoReason, warnings } = decideGoNoGo({
    probeReport: latestProbeFull?.report ?? null,
    probeSummary: latestProbe,
    benchmark: latestBenchmark,
    artifacts: latestDebugArtifacts,
  });

  const nextCommand =
    goNoGo === "ready_for_single_live" && recommendedCases[0]
      ? NEXT_LIVE_TEMPLATE(recommendedCases[0].caseId)
      : null;

  return {
    generatedAt,
    latestProbe,
    recommendedCases,
    latestBenchmark,
    latestDebugArtifacts,
    goNoGo,
    goNoGoReason,
    nextCommand,
    warnings,
  };
}

/* ─── Probe loader ───────────────────────────────────────────────────── */

async function loadLatestProbe(): Promise<{
  file: string;
  report: InlineProbeReport;
} | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(RUNS_DIR);
  } catch {
    return null;
  }
  const candidates = entries
    .filter((name) => PROBE_FILE_PATTERN.test(name))
    .sort()
    .reverse();
  for (const file of candidates) {
    const report = await readProbeFile(file);
    if (report) return { file, report };
  }
  return null;
}

async function readProbeFile(file: string): Promise<InlineProbeReport | null> {
  try {
    const raw = await fs.readFile(path.join(RUNS_DIR, file), "utf-8");
    const parsed = JSON.parse(raw) as InlineProbeReport;
    if (
      !parsed ||
      typeof parsed.runId !== "string" ||
      !Array.isArray(parsed.results)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function summarizeProbe(
  file: string,
  report: InlineProbeReport,
): ReadinessProbeSummary {
  const counts = {
    use_for_live_fill_test: 0,
    no_matching_slot: 0,
    blocked_or_unknown: 0,
  };
  for (const r of report.results) {
    if (r.recommendation === "use_for_live_fill_test")
      counts.use_for_live_fill_test++;
    else if (r.recommendation === "no_matching_slot") counts.no_matching_slot++;
    else if (r.recommendation === "blocked_or_unknown")
      counts.blocked_or_unknown++;
  }
  return {
    file,
    runId: report.runId,
    createdAt: report.createdAt,
    totalCases: report.results.length,
    countByRecommendation: counts,
    recommendedCaseId: report.recommendedCase?.caseId ?? null,
  };
}

function extractRecommendedCases(
  report: InlineProbeReport,
): ReadinessRecommendedCase[] {
  // Prefer `recommendedCases` array; fall back to filtering `results`. Keep
  // the order codex's runner produced (it pre-sorted by slot quality).
  const source =
    Array.isArray(report.recommendedCases) && report.recommendedCases.length > 0
      ? report.recommendedCases
      : report.results.filter(
          (r) => r.recommendation === "use_for_live_fill_test",
        );
  return source.map((c) => buildRecommendedCase(c));
}

function buildRecommendedCase(c: InlineProbeCase): ReadinessRecommendedCase {
  const url = parseProbeUrl(c.url);
  const exactVenueMatch =
    Boolean(c.apiVenueSlug) &&
    Boolean(url.resySlug) &&
    c.apiVenueSlug?.toLowerCase() === url.resySlug?.toLowerCase();
  return {
    caseId: c.caseId,
    restaurantName: c.restaurantName,
    date: url.date,
    time: c.targetTime,
    covers: url.covers,
    matchingSlotsCount: c.matchingSlots?.length ?? 0,
    exactVenueMatch: !!exactVenueMatch,
    recommendation: c.recommendation,
    liveCommand: NEXT_LIVE_TEMPLATE(c.caseId),
  };
}

/** Parse date/seats/time/slug from a Resy probe URL. Pure; never throws. */
function parseProbeUrl(rawUrl: string): {
  date: string | null;
  covers: number | null;
  time: string | null;
  resySlug: string | null;
} {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { date: null, covers: null, time: null, resySlug: null };
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  let resySlug: string | null = null;
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === "venues") resySlug = segments[i + 1] ?? null;
  }
  const date = parsed.searchParams.get("date");
  const seatsRaw = parsed.searchParams.get("seats");
  const time = parsed.searchParams.get("time");
  const seats = seatsRaw ? Number(seatsRaw) : NaN;
  return {
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    covers: Number.isFinite(seats) ? seats : null,
    time: time && /^\d{1,2}:\d{2}$/.test(time) ? time : null,
    resySlug,
  };
}

/* ─── Benchmark loader ───────────────────────────────────────────────── */

interface InlineBenchmarkResult {
  caseId: string;
  outcome: string;
  safe?: boolean;
  bookingReady?: boolean;
  severe?: boolean;
}

interface InlineBenchmarkReport {
  runId: string;
  createdAt: string;
  metrics?: {
    total: number;
    passed: boolean;
    bookingReadyRate: number;
    safeOutcomeRate: number;
    severeErrorRate: number;
    taxonomyCoverageRate: number;
  };
  results?: InlineBenchmarkResult[];
}

async function loadLatestBenchmark(): Promise<ReadinessBenchmarkSummary | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(RUNS_DIR);
  } catch {
    return null;
  }
  const candidates = entries
    .filter(
      (name) => BENCHMARK_FILE_PATTERN.test(name) && !PROBE_FILE_PATTERN.test(name),
    )
    .sort()
    .reverse();
  for (const file of candidates) {
    const summary = await readBenchmarkFile(file);
    if (summary) return summary;
  }
  return null;
}

async function readBenchmarkFile(
  file: string,
): Promise<ReadinessBenchmarkSummary | null> {
  try {
    const raw = await fs.readFile(path.join(RUNS_DIR, file), "utf-8");
    const parsed = JSON.parse(raw) as InlineBenchmarkReport;
    if (!parsed || typeof parsed.runId !== "string" || !parsed.metrics) {
      return null;
    }
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    let severeCount = 0;
    let safeFailureCount = 0;
    let noAvailabilityCorrectCount = 0;
    let firstSevereCaseId: string | null = null;
    for (const r of results) {
      if (r.severe) {
        severeCount++;
        if (!firstSevereCaseId) firstSevereCaseId = r.caseId;
      }
      if (r.safe && !r.bookingReady) safeFailureCount++;
      if (r.outcome === "no_availability_correct") noAvailabilityCorrectCount++;
    }
    return {
      file,
      runId: parsed.runId,
      createdAt: parsed.createdAt,
      total: parsed.metrics.total,
      passed: parsed.metrics.passed,
      bookingReadyRate: parsed.metrics.bookingReadyRate,
      safeOutcomeRate: parsed.metrics.safeOutcomeRate,
      severeErrorRate: parsed.metrics.severeErrorRate,
      taxonomyCoverageRate: parsed.metrics.taxonomyCoverageRate,
      severeCount,
      safeFailureCount,
      noAvailabilityCorrectCount,
      firstSevereCaseId,
    };
  } catch {
    return null;
  }
}

/* ─── Debug-artifact loader ──────────────────────────────────────────── */

async function loadLatestDebugArtifacts(): Promise<ReadinessDebugArtifact[]> {
  const out: ReadinessDebugArtifact[] = [];
  for (const provider of PROVIDERS_ALLOWED) {
    const latest = await loadLatestProviderArtifact(provider);
    if (latest) out.push(latest);
  }
  // Sort newest-first across providers.
  out.sort((a, b) => {
    const ta = a.capturedAt ?? "";
    const tb = b.capturedAt ?? "";
    return tb.localeCompare(ta);
  });
  return out;
}

async function loadLatestProviderArtifact(
  provider: AllowedProvider,
): Promise<ReadinessDebugArtifact | null> {
  const dir = path.join(DEBUG_ROOT, provider);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  const candidates = entries
    .filter((name) => RUN_DIR_PATTERN.test(name))
    .sort()
    .reverse();
  for (const runId of candidates) {
    const summary = await readArtifactSummary(provider, runId);
    if (summary) return summary;
  }
  return null;
}

async function readArtifactSummary(
  provider: AllowedProvider,
  runId: string,
): Promise<ReadinessDebugArtifact | null> {
  // path.resolve + prefix check to defeat any malformed runId that escapes
  // RUN_DIR_PATTERN (defense in depth).
  const baseDir = path.resolve(DEBUG_ROOT, provider);
  const runDir = path.resolve(baseDir, runId);
  if (!runDir.startsWith(baseDir + path.sep) && runDir !== baseDir) return null;

  let stat;
  try {
    stat = await fs.stat(runDir);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;

  const { capturedAt, label } = parseRunId(runId);
  const summaryFile = path.join(runDir, "summary.json");
  let summaryError: string | null = null;
  try {
    const raw = await fs.readFile(summaryFile, "utf-8");
    const parsed = JSON.parse(raw) as { summary?: { error?: string } };
    if (parsed?.summary?.error && typeof parsed.summary.error === "string") {
      summaryError = parsed.summary.error;
    }
  } catch {
    summaryError = null; // missing/unparseable summary is OK
  }
  return { provider, runId, capturedAt, label, summaryError };
}

/** Decode a run dir name like `2026-05-04T01-03-31-072Z-resy-otp-fail`. */
function parseRunId(runId: string): { capturedAt: string | null; label: string } {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{1,3}))?Z-(.*)$/.exec(
      runId,
    );
  if (!m) return { capturedAt: null, label: runId };
  const [, y, mo, d, h, mi, s, ms, label] = m;
  const isoMs = ms ? ms.padStart(3, "0") : "000";
  return {
    capturedAt: `${y}-${mo}-${d}T${h}:${mi}:${s}.${isoMs}Z`,
    label,
  };
}

/* ─── Decision logic ─────────────────────────────────────────────────── */

interface DecideInput {
  probeReport: InlineProbeReport | null;
  probeSummary: ReadinessProbeSummary | null;
  benchmark: ReadinessBenchmarkSummary | null;
  artifacts: ReadinessDebugArtifact[];
}

interface DecideOutput {
  goNoGo: ReadinessGoNoGo;
  goNoGoReason: string;
  warnings: string[];
}

/**
 * Pure decision function exported for unit testing. `goNoGo` priority order:
 *
 *   1. No probe data → `needs_probe`
 *   2. Probe ran but `results.length === 0` → `blocked_no_artifacts`
 *   3. Probe has ≥1 use_for_live_fill_test → `ready_for_single_live`
 *   4. Probe has ≥1 blocked_or_unknown (and 0 use_for_live_fill_test) → `unknown`
 *   5. Otherwise (only no_matching_slot) → `blocked_no_slots`
 */
export function decideGoNoGo(input: DecideInput): DecideOutput {
  const warnings: string[] = [];

  // Warnings: severe in latest benchmark.
  if (input.benchmark && input.benchmark.severeCount > 0) {
    warnings.push(
      `Latest benchmark has ${input.benchmark.severeCount} severe outcome(s)` +
        (input.benchmark.firstSevereCaseId
          ? ` (first: ${input.benchmark.firstSevereCaseId})`
          : "") +
        " — read /dev/benchmark-runs before live spend.",
    );
  }

  // Warnings: probe stale.
  if (input.probeSummary) {
    const ageHours =
      (Date.now() - new Date(input.probeSummary.createdAt).getTime()) /
      3_600_000;
    if (Number.isFinite(ageHours) && ageHours > PROBE_STALE_HOURS) {
      warnings.push(
        `Probe is ${Math.round(ageHours)}h old (>${PROBE_STALE_HOURS}h). Slots may be gone — rerun probe.`,
      );
    }
  }

  // Warnings: any debug artifact has a known summary error label.
  for (const a of input.artifacts) {
    if (a.summaryError) {
      warnings.push(
        `Latest ${a.provider} debug capture (${a.label}) ended with: ${a.summaryError.slice(0, 120)}`,
      );
    }
  }

  // Verdict.
  if (!input.probeReport || !input.probeSummary) {
    return {
      goNoGo: "needs_probe",
      goNoGoReason:
        "No probe run found in benchmark/runs/. Run `npm run probe:resy` to find a safe live case.",
      warnings,
    };
  }
  if (input.probeReport.results.length === 0) {
    return {
      goNoGo: "blocked_no_artifacts",
      goNoGoReason:
        "Probe file exists but produced zero case results. Check the suite filter and rerun.",
      warnings,
    };
  }
  const counts = input.probeSummary.countByRecommendation;
  if (counts.use_for_live_fill_test > 0) {
    return {
      goNoGo: "ready_for_single_live",
      goNoGoReason: `${counts.use_for_live_fill_test} case(s) have matching slots. Top recommendation: ${input.probeSummary.recommendedCaseId ?? "?"}.`,
      warnings,
    };
  }
  if (counts.blocked_or_unknown > 0) {
    return {
      goNoGo: "unknown",
      goNoGoReason: `Probe was partially blocked (${counts.blocked_or_unknown} case(s) blocked_or_unknown). Rerun probe before any live spend.`,
      warnings,
    };
  }
  return {
    goNoGo: "blocked_no_slots",
    goNoGoReason: `All ${counts.no_matching_slot} probed case(s) are no_matching_slot — Resy has nothing within the requested window. A live spend would only re-validate no_availability_correct.`,
    warnings,
  };
}

/* ─── Display constants ──────────────────────────────────────────────── */

export const GO_NO_GO_LABEL: Record<ReadinessGoNoGo, string> = {
  ready_for_single_live: "READY TO BURN ONE CASE",
  needs_probe: "NEEDS PROBE",
  blocked_no_slots: "DO NOT BURN — NO SLOTS",
  blocked_no_artifacts: "DO NOT BURN — NO ARTIFACTS",
  unknown: "DO NOT BURN — PROBE BLOCKED",
};

export const GO_NO_GO_TONE: Record<
  ReadinessGoNoGo,
  "good" | "warn" | "bad" | "neutral"
> = {
  ready_for_single_live: "good",
  needs_probe: "neutral",
  blocked_no_slots: "warn",
  blocked_no_artifacts: "warn",
  unknown: "bad",
};
