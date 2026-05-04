/**
 * Resy Run Analysis — pure loader / parser for Phase 0A live debug.
 *
 * After codex's `49b5670 fix(resy): add form strategy ladder` shipped
 * `[resy][strategy ...]` lines on slot / mobile / OTP / confirmation
 * paths, every benchmark case's `terminalReason` carries a sequence of
 * strategy attempts. Reading those by hand from JSON is slow and
 * error-prone — this module parses the lines, classifies the failure
 * stage, and surfaces them in `/dev/resy-run-analysis` so codex/founder
 * can answer four questions at a glance:
 *
 *   1. Where is the live debug stuck (probe / slot / form / OTP / confirm)?
 *   2. Which strategies were tried, which succeeded, which failed?
 *   3. What's the next safe case to spend a token on (or do we need a probe first)?
 *   4. What does the founder need to provide manually (auth / OTP / payment)?
 *
 * Read-only, pure, and self-contained — schema mirrors codex's runner
 * output verbatim but is defined inline here so this branch compiles
 * standalone against `origin/codex/openai-chat-model-env` without
 * depending on any in-flight Track B branch.
 *
 * ──────────────────────────────────────────────────────────────────
 *
 * Strategy line grammar (codex's emitter):
 *
 *   [resy][strategy <id>] ok
 *   [resy][strategy <id>] ok step <step-name>
 *   [resy][strategy <id>] ok filled <field-name>
 *   [resy][strategy <id>] step <step-name>
 *   [resy][strategy <id>] filled <field-name>
 *   [resy][strategy <id>] fail <reason>
 *
 * IDs follow `rs-<family>-NN-<descriptor>` — e.g. `rs-slot-01-direct`,
 * `rs-phone-04-mouse-keyboard`, `rs-confirm-03-dom-frame`. We don't
 * lock the descriptor portion (codex may rename) — only the family
 * prefix matters for stage classification.
 *
 * ──────────────────────────────────────────────────────────────────
 *
 * Failure-stage classifier (priority order — first match wins):
 *
 *   probe_no_slot                — probe has 0 use_for_live_fill_test
 *                                  AND no benchmark, OR benchmark hit
 *                                  the case but recommendation was
 *                                  no_matching_slot (live token would
 *                                  only re-validate no_availability_correct).
 *   slot_api_available_dom_missing — probe says slot exists but benchmark
 *                                  outcome is `no_availability_correct`
 *                                  with rs-slot-* fail traces (DOM didn't
 *                                  expose the slot the API claimed).
 *   slot_selection_failed        — rs-slot-* attempts present + all fail.
 *   guest_form_reached           — at least one rs-phone-* ok recorded
 *                                  (form rendered + at least one field
 *                                  filled successfully).
 *   guest_form_incomplete        — rs-phone-* recorded with mix of
 *                                  ok + fail; not all fields filled.
 *   otp_or_login_required        — terminalCode === F-PROVIDER-OTP, or
 *                                  outcome bucket `safe_handoff` with
 *                                  OTP-shaped reason, or rs-confirm-*
 *                                  blocked by login wall.
 *   ready_for_confirmation       — outcome bucket `ready_for_confirmation`,
 *                                  or rs-confirm-* with terminal ok.
 *   unknown                      — fallback (no signal we recognize).
 *
 * Verdict (RUN / DO NOT RUN / NEED PROBE / NEED ARTIFACTS):
 *
 *   NEED_PROBE      — no benchmark AND no probe data
 *   NEED_ARTIFACTS  — benchmark exists but we have neither strategy lines
 *                     nor debug screenshots — can't analyze, gather more
 *                     before next live spend
 *   DO_NOT_RUN      — recent benchmark severe OR recent benchmark failed
 *                     at slot_selection_failed/guest_form_incomplete with
 *                     full strategy ladder exhaustion (rerunning won't
 *                     help; codex needs to fix provider first)
 *   RUN             — probe has live-OK case AND last benchmark on it
 *                     either didn't exist or wasn't a hard failure
 *
 * `nextSafeCommand` is only generated when verdict === "RUN".
 * `founderInputs` populated from failure stages that need human help
 * (OTP code, captcha solve, payment confirmation).
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/* ─── Inline schema mirrors (codex's runner output) ──────────────────── */

interface InlineProbeCase {
  caseId: string;
  restaurantName: string;
  url: string;
  targetTime: string;
  apiVenueSlug?: string;
  matchingSlots?: unknown[];
  recommendation:
    | "use_for_live_fill_test"
    | "no_matching_slot"
    | "blocked_or_unknown";
}
interface InlineProbeReport {
  runId: string;
  createdAt: string;
  results: InlineProbeCase[];
  recommendedCase?: InlineProbeCase;
  recommendedCases?: InlineProbeCase[];
}

interface InlineBenchmarkCase {
  caseId: string;
  prompt?: string;
  taskId?: string;
  currentJobId?: string | null;
  state?: string;
  terminalCode?: string | null;
  terminalReason?: string | null;
  outcome: string;
  taxonomyCode?: string;
  safe?: boolean;
  bookingReady?: boolean;
  severe?: boolean;
  durationMs?: number;
  timelineUrl?: string | null;
  snapshotsUrl?: string | null;
  error?: string;
}
interface InlineBenchmarkReport {
  runId: string;
  createdAt: string;
  results?: InlineBenchmarkCase[];
}

/* ─── Public output types ────────────────────────────────────────────── */

export type ResyFailureStage =
  | "probe_no_slot"
  | "slot_api_available_dom_missing"
  | "slot_selection_failed"
  | "guest_form_reached"
  | "guest_form_incomplete"
  | "otp_or_login_required"
  | "ready_for_confirmation"
  | "unknown";

export type ResyAnalysisVerdict =
  | "RUN"
  | "DO_NOT_RUN"
  | "NEED_PROBE"
  | "NEED_ARTIFACTS";

/** A single parsed `[resy][strategy ...]` line. */
export interface ResyStrategyLine {
  strategyId: string;
  family: "slot" | "phone" | "confirm" | "other";
  /** "ok" | "fail" | "step" | "filled" | "other" */
  kind: "ok" | "fail" | "step" | "filled" | "other";
  /** Free-form payload after the kind (step name, field, fail reason). */
  detail: string;
}

/** Aggregate row in the strategy ladder matrix — one per unique strategyId. */
export interface ResyStrategyAttempt {
  strategyId: string;
  family: "slot" | "phone" | "confirm" | "other";
  okCount: number;
  failCount: number;
  stepCount: number;
  filledCount: number;
  totalLines: number;
  /** Distinct step labels seen for this strategy. */
  steps: string[];
  /** Distinct filled-field labels seen for this strategy. */
  filledFields: string[];
  /** Latest fail detail, useful for triage. */
  latestError: string | null;
  /** Latest ok detail (or empty if just `ok` with no payload). */
  latestSuccess: string | null;
  /** Cases where this strategy was attempted. */
  caseIds: string[];
}

export interface ResyArtifactLink {
  /** "benchmark" | "probe" | "debug" | "task" */
  kind: "benchmark" | "probe" | "debug" | "task";
  label: string;
  /** Page-level link the founder can click in the dashboard. */
  href: string | null;
}

export interface ResyRunCaseAnalysis {
  caseId: string;
  source: "benchmark" | "probe-only";
  sourceFile: string;
  /** Outcome bucket from benchmark — null if no benchmark for this case. */
  outcome: string | null;
  taxonomyCode: string | null;
  terminalCode: string | null;
  terminalReasonExcerpt: string | null;
  severe: boolean;
  safe: boolean;
  bookingReady: boolean;
  /** Failure stage classification. */
  failureStage: ResyFailureStage;
  failureStageReason: string;
  /** Strategy attempts seen for THIS case (may be a subset of the global ladder). */
  strategyAttempts: ResyStrategyAttempt[];
  /** Probe verdict for this caseId in the most recent probe (if any). */
  matchingProbeRecommendation: InlineProbeCase["recommendation"] | null;
  artifactLinks: ResyArtifactLink[];
}

export interface ResyRunAnalysisSummary {
  generatedAt: string;
  /** Latest benchmark file basename, or null if none. */
  latestBenchmarkFile: string | null;
  latestBenchmarkRunId: string | null;
  /** Latest probe file basename, or null if none. */
  latestProbeFile: string | null;
  latestProbeRunId: string | null;
  /** Per-case analyses ordered as the report listed them. */
  caseAnalyses: ResyRunCaseAnalysis[];
  /** Strategy ladder matrix aggregated across all benchmark cases. */
  strategyLadder: ResyStrategyAttempt[];
  /** Distribution of failure stages across `caseAnalyses`. */
  failureStageDistribution: Record<ResyFailureStage, number>;
  verdict: ResyAnalysisVerdict;
  verdictReason: string;
  /** Pre-baked single-case live command — only populated when verdict === "RUN". */
  nextSafeCommand: string | null;
  /** What founder must manually provide for the latest case to make progress. */
  founderInputs: string[];
}

/* ─── Constants ──────────────────────────────────────────────────────── */

const RUNS_DIR = path.join(process.cwd(), "benchmark", "runs");
const DEBUG_ROOT = path.join(process.cwd(), "worker", ".debug-screenshots");
const PROBE_FILE_PATTERN = /^resy-availability-probe-.*\.json$/i;
const BENCHMARK_FILE_PATTERN = /^phase0-.*\.json$/i;
const RUN_DIR_PATTERN = /^[A-Za-z0-9._-]+$/;

const PROVIDERS_ALLOWED = ["resy", "opentable", "booking", "expedia", "hotels"] as const;

const NEXT_LIVE_COMMAND = (caseId: string) =>
  `npx tsx scripts\\run-phase0-resy-benchmark.ts --case ${caseId} --live-openai --allow-failures`;

/**
 * Strategy line grammar:
 *   [resy][strategy <id>] <rest>
 *
 * Capture groups: 1=strategyId, 2=rest (may be empty).
 * Used as a /g matcher across multi-line `terminalReason` blobs.
 */
const STRATEGY_LINE_RE = /\[resy\]\[strategy ([^\]]+)\][^\S\r\n]*([^\r\n]*)/g;

/** Recognized OTP / login signals in benchmark `terminalReason` / `outcome`. */
const OTP_SIGNALS = [
  /F-PROVIDER-OTP/i,
  /verification code/i,
  /otp/i,
  /sign in to continue/i,
  /please log in/i,
  /please sign in/i,
  /login required/i,
];

/** Known Resy availability-empty taxonomy/text patterns. */
const NO_AVAILABILITY_SIGNALS = [
  /F-AVAIL-NONE/i,
  /no_availability_correct/i,
  /not returning availability slots/i,
  /availability for the requested/i,
];

/* ─── Public API ─────────────────────────────────────────────────────── */

/** Build the full analysis summary. Always succeeds (defensively) so the API never 500s. */
export async function buildResyRunAnalysis(): Promise<ResyRunAnalysisSummary> {
  const generatedAt = new Date().toISOString();

  const [benchmarkLoaded, probeLoaded, debugIndex] = await Promise.all([
    loadLatestBenchmark(),
    loadLatestProbe(),
    loadDebugArtifactIndex(),
  ]);

  const benchmark = benchmarkLoaded?.report ?? null;
  const benchmarkFile = benchmarkLoaded?.file ?? null;
  const probe = probeLoaded?.report ?? null;
  const probeFile = probeLoaded?.file ?? null;

  // Per-case analysis is driven by benchmark results when present,
  // else fall back to probe-only case rows so the funnel still has data.
  const caseAnalyses: ResyRunCaseAnalysis[] = [];
  if (benchmark && Array.isArray(benchmark.results)) {
    for (const c of benchmark.results) {
      caseAnalyses.push(
        analyzeBenchmarkCase({
          benchmarkCase: c,
          benchmarkFile: benchmarkFile ?? "",
          benchmarkRunId: benchmark.runId,
          probe,
          debugIndex,
        }),
      );
    }
  } else if (probe && Array.isArray(probe.results)) {
    for (const p of probe.results) {
      caseAnalyses.push(probeOnlyAnalysis(p, probeFile ?? "", debugIndex));
    }
  }

  const strategyLadder = buildStrategyLadder(caseAnalyses);
  const failureStageDistribution = buildStageDistribution(caseAnalyses);

  const { verdict, verdictReason, founderInputs } = decideVerdict({
    benchmark,
    probe,
    caseAnalyses,
    debugIndex,
  });

  const nextSafeCommand =
    verdict === "RUN" && probe?.recommendedCase?.caseId
      ? NEXT_LIVE_COMMAND(probe.recommendedCase.caseId)
      : null;

  return {
    generatedAt,
    latestBenchmarkFile: benchmarkFile,
    latestBenchmarkRunId: benchmark?.runId ?? null,
    latestProbeFile: probeFile,
    latestProbeRunId: probe?.runId ?? null,
    caseAnalyses,
    strategyLadder,
    failureStageDistribution,
    verdict,
    verdictReason,
    nextSafeCommand,
    founderInputs,
  };
}

/* ─── Strategy line parser ───────────────────────────────────────────── */

/**
 * Parse all `[resy][strategy ...]` lines from a multi-line blob. Pure;
 * exported for unit tests. Lines that don't match the resy strategy
 * shape (e.g. opentable strategies, plain log lines) are silently
 * ignored.
 */
export function parseResyStrategyLines(source: string | null | undefined): ResyStrategyLine[] {
  if (!source) return [];
  const out: ResyStrategyLine[] = [];
  // Reset the lastIndex on the global regex to keep this function pure.
  STRATEGY_LINE_RE.lastIndex = 0;
  for (const m of source.matchAll(STRATEGY_LINE_RE)) {
    const strategyId = (m[1] ?? "").trim();
    if (!strategyId) continue;
    const rest = (m[2] ?? "").trim();
    out.push({
      strategyId,
      family: classifyFamily(strategyId),
      ...classifyKind(rest),
    });
  }
  return out;
}

/** Derive the family bucket from a strategy id like `rs-slot-01-direct`. */
export function classifyFamily(strategyId: string): ResyStrategyLine["family"] {
  const lower = strategyId.toLowerCase();
  if (lower.startsWith("rs-slot")) return "slot";
  if (lower.startsWith("rs-phone")) return "phone";
  if (lower.startsWith("rs-confirm")) return "confirm";
  return "other";
}

/** Decide whether a `rest` string after `[strategy <id>]` is ok/fail/step/filled/other. */
function classifyKind(rest: string): {
  kind: ResyStrategyLine["kind"];
  detail: string;
} {
  if (!rest) return { kind: "other", detail: "" };
  // Strip leading punctuation like ":" or "-".
  const cleaned = rest.replace(/^[:\-\s]+/, "");
  // "ok" might be alone, or followed by "step <x>" or "filled <field>".
  const okMatch = /^ok\b\s*(.*)$/i.exec(cleaned);
  if (okMatch) {
    const trailing = okMatch[1].trim();
    if (/^step\b/i.test(trailing)) {
      return { kind: "ok", detail: trailing.replace(/^step\b\s*/i, "") };
    }
    if (/^filled\b/i.test(trailing)) {
      return { kind: "ok", detail: trailing.replace(/^filled\b\s*/i, "") };
    }
    return { kind: "ok", detail: trailing };
  }
  if (/^fail\b/i.test(cleaned)) {
    return { kind: "fail", detail: cleaned.replace(/^fail\b\s*/i, "").trim() };
  }
  if (/^step\b/i.test(cleaned)) {
    return { kind: "step", detail: cleaned.replace(/^step\b\s*/i, "").trim() };
  }
  if (/^filled\b/i.test(cleaned)) {
    return { kind: "filled", detail: cleaned.replace(/^filled\b\s*/i, "").trim() };
  }
  return { kind: "other", detail: cleaned };
}

/** Group parsed lines into per-strategy attempt aggregates. */
export function aggregateStrategyAttempts(
  lines: ResyStrategyLine[],
  caseIdHint: string | null,
): ResyStrategyAttempt[] {
  const map = new Map<string, ResyStrategyAttempt>();
  for (const ln of lines) {
    let attempt = map.get(ln.strategyId);
    if (!attempt) {
      attempt = {
        strategyId: ln.strategyId,
        family: ln.family,
        okCount: 0,
        failCount: 0,
        stepCount: 0,
        filledCount: 0,
        totalLines: 0,
        steps: [],
        filledFields: [],
        latestError: null,
        latestSuccess: null,
        caseIds: caseIdHint ? [caseIdHint] : [],
      };
      map.set(ln.strategyId, attempt);
    }
    attempt.totalLines += 1;
    if (ln.kind === "ok") {
      attempt.okCount += 1;
      attempt.latestSuccess = ln.detail || "ok";
    } else if (ln.kind === "fail") {
      attempt.failCount += 1;
      attempt.latestError = ln.detail || "fail";
    } else if (ln.kind === "step") {
      attempt.stepCount += 1;
      if (ln.detail && !attempt.steps.includes(ln.detail)) {
        attempt.steps.push(ln.detail);
      }
    } else if (ln.kind === "filled") {
      attempt.filledCount += 1;
      if (ln.detail && !attempt.filledFields.includes(ln.detail)) {
        attempt.filledFields.push(ln.detail);
      }
    }
  }
  return Array.from(map.values());
}

/* ─── Failure-stage classifier ───────────────────────────────────────── */

interface ClassifyInput {
  benchmarkCase: InlineBenchmarkCase | null;
  attempts: ResyStrategyAttempt[];
  probeRecommendation: InlineProbeCase["recommendation"] | null;
}

/**
 * Pure failure-stage classifier. Exported for unit testing.
 * Priority order matches the docstring at the top of the file.
 */
export function classifyFailureStage(input: ClassifyInput): {
  stage: ResyFailureStage;
  reason: string;
} {
  const { benchmarkCase: bc, attempts, probeRecommendation } = input;

  // Aggregate signals.
  const slotAttempts = attempts.filter((a) => a.family === "slot");
  const phoneAttempts = attempts.filter((a) => a.family === "phone");
  const confirmAttempts = attempts.filter((a) => a.family === "confirm");
  const slotFails = slotAttempts.filter((a) => a.failCount > 0 && a.okCount === 0);
  const slotOk = slotAttempts.filter((a) => a.okCount > 0);
  const phoneOk = phoneAttempts.filter((a) => a.okCount > 0);
  const phoneFail = phoneAttempts.filter((a) => a.failCount > 0);
  const confirmOk = confirmAttempts.filter((a) => a.okCount > 0);

  const terminalReason = bc?.terminalReason ?? "";
  const terminalCode = bc?.terminalCode ?? "";
  const outcome = bc?.outcome ?? "";

  const otpHit =
    OTP_SIGNALS.some((re) => re.test(terminalReason) || re.test(terminalCode)) ||
    outcome === "safe_handoff" && /otp/i.test(terminalReason);

  const noAvailHit = NO_AVAILABILITY_SIGNALS.some(
    (re) => re.test(terminalReason) || re.test(terminalCode) || re.test(outcome),
  );

  // 1. ready_for_confirmation outcome wins immediately.
  if (outcome === "ready_for_confirmation" || confirmOk.length > 0) {
    return {
      stage: "ready_for_confirmation",
      reason:
        outcome === "ready_for_confirmation"
          ? "Benchmark outcome bucket is ready_for_confirmation."
          : `Strategy ${confirmOk[0]?.strategyId ?? "rs-confirm-*"} reported ok.`,
    };
  }

  // 2. OTP / login wall (per § 7.5 acceptable safe_handoff).
  if (otpHit) {
    return {
      stage: "otp_or_login_required",
      reason:
        terminalCode === "F-PROVIDER-OTP"
          ? "Terminal taxonomy F-PROVIDER-OTP — OTP wall reached."
          : "OTP / login signal detected in terminalReason.",
    };
  }

  // 3. Probe says no slot AND no benchmark available — purest no-slot case.
  if (probeRecommendation === "no_matching_slot" && !bc) {
    return {
      stage: "probe_no_slot",
      reason: "Probe recommendation is no_matching_slot for this case; no benchmark run yet.",
    };
  }

  // 4. Probe says use_for_live_fill_test BUT benchmark hit no-availability —
  //    DOM didn't expose the slot the API claimed.
  if (probeRecommendation === "use_for_live_fill_test" && noAvailHit) {
    return {
      stage: "slot_api_available_dom_missing",
      reason:
        "Probe API returned matching slots but benchmark hit no-availability — DOM scrape missed what the API exposed.",
    };
  }

  // 5. Phone form attempts present.
  if (phoneOk.length > 0) {
    if (phoneFail.length > 0) {
      return {
        stage: "guest_form_incomplete",
        reason: `Guest form rendered (${phoneOk.length} field(s) ok) but ${phoneFail.length} strategy/strategies failed.`,
      };
    }
    return {
      stage: "guest_form_reached",
      reason: `Guest form rendered; ${phoneOk.length} rs-phone-* attempt(s) ok.`,
    };
  }

  // 6. Slot attempts: all failed.
  if (slotAttempts.length > 0 && slotOk.length === 0) {
    return {
      stage: "slot_selection_failed",
      reason: `${slotAttempts.length} rs-slot-* strategy/strategies attempted; none succeeded.`,
    };
  }

  // 7. Benchmark says no_availability_correct without strategy traces.
  if (noAvailHit) {
    return {
      stage: "probe_no_slot",
      reason: "Benchmark outcome is no_availability_correct (no slots).",
    };
  }

  // 8. Probe also empty.
  if (probeRecommendation === "no_matching_slot") {
    return {
      stage: "probe_no_slot",
      reason: "Probe recommendation is no_matching_slot.",
    };
  }

  return {
    stage: "unknown",
    reason: "No recognizable strategy lines, no clear outcome bucket — open the benchmark report for raw context.",
  };
}

/* ─── Verdict ────────────────────────────────────────────────────────── */

interface VerdictInput {
  benchmark: InlineBenchmarkReport | null;
  probe: InlineProbeReport | null;
  caseAnalyses: ResyRunCaseAnalysis[];
  debugIndex: DebugArtifactIndexEntry[];
}

interface VerdictOutput {
  verdict: ResyAnalysisVerdict;
  verdictReason: string;
  founderInputs: string[];
}

/** Pure verdict function exported for unit testing. */
export function decideVerdict(input: VerdictInput): VerdictOutput {
  const founderInputs: string[] = [];

  // Aggregate signals.
  const anySevere = input.caseAnalyses.some((c) => c.severe);
  const lastCase = input.caseAnalyses[0] ?? null;
  const otpStage = input.caseAnalyses.some(
    (c) => c.failureStage === "otp_or_login_required",
  );
  const slotFailStage = input.caseAnalyses.some(
    (c) => c.failureStage === "slot_selection_failed",
  );
  const formIncomplete = input.caseAnalyses.some(
    (c) => c.failureStage === "guest_form_incomplete",
  );

  // Founder-input collection.
  if (otpStage) {
    founderInputs.push(
      "OTP / login code: Resy hit the verification wall. Per § 7.5 OTP transitional rule, the founder must paste the code received via email/SMS.",
    );
  }
  if (input.caseAnalyses.some((c) => /captcha/i.test(c.terminalReasonExcerpt ?? ""))) {
    founderInputs.push(
      "CAPTCHA solve: a human must complete the challenge. We don't bypass CAPTCHAs.",
    );
  }
  if (input.caseAnalyses.some((c) => c.failureStage === "ready_for_confirmation")) {
    founderInputs.push(
      "Final confirmation click: dashboard ends at ready_for_confirmation; founder makes the actual booking decision.",
    );
  }

  // Verdict logic.
  if (!input.benchmark && !input.probe) {
    return {
      verdict: "NEED_PROBE",
      verdictReason:
        "No probe run AND no benchmark report in benchmark/runs/. Run `npm run probe:resy` first.",
      founderInputs,
    };
  }

  if (!input.probe) {
    return {
      verdict: "NEED_PROBE",
      verdictReason:
        "No probe data — even if benchmark exists, probe-first protocol requires a fresh probe before any live retry.",
      founderInputs,
    };
  }

  if (anySevere) {
    return {
      verdict: "DO_NOT_RUN",
      verdictReason:
        "Latest benchmark has at least one severe outcome — codex must fix the provider before another live spend.",
      founderInputs,
    };
  }

  if ((slotFailStage || formIncomplete) && lastCase) {
    return {
      verdict: "DO_NOT_RUN",
      verdictReason: `Latest case ${lastCase.caseId} stuck at ${lastCase.failureStage}. Strategy ladder needs a fix; rerunning the same case won't help.`,
      founderInputs,
    };
  }

  // Need-artifacts: benchmark exists but no strategy lines AND no debug screenshots.
  if (
    input.benchmark &&
    input.benchmark.results &&
    input.benchmark.results.length > 0 &&
    input.caseAnalyses.every((c) => c.strategyAttempts.length === 0) &&
    input.debugIndex.length === 0
  ) {
    return {
      verdict: "NEED_ARTIFACTS",
      verdictReason:
        "Benchmark report exists but neither strategy lines nor debug screenshots are present. Rerun with logging enabled before next live spend.",
      founderInputs,
    };
  }

  // RUN path — probe has live-OK and we don't have a hard failure record.
  if (input.probe.recommendedCase?.caseId) {
    return {
      verdict: "RUN",
      verdictReason: `Probe recommends ${input.probe.recommendedCase.caseId} (${input.probe.recommendedCase.restaurantName}). Single-case live retry is safe.`,
      founderInputs,
    };
  }

  // Probe ran but nothing qualifies.
  return {
    verdict: "DO_NOT_RUN",
    verdictReason:
      "Probe ran but produced no use_for_live_fill_test case — burning a token now would only re-validate no_availability_correct.",
    founderInputs,
  };
}

/* ─── Per-case analyzer ──────────────────────────────────────────────── */

function analyzeBenchmarkCase(args: {
  benchmarkCase: InlineBenchmarkCase;
  benchmarkFile: string;
  benchmarkRunId: string;
  probe: InlineProbeReport | null;
  debugIndex: DebugArtifactIndexEntry[];
}): ResyRunCaseAnalysis {
  const { benchmarkCase: bc, benchmarkFile, benchmarkRunId, probe, debugIndex } = args;
  const lines = parseResyStrategyLines(bc.terminalReason ?? "");
  const attempts = aggregateStrategyAttempts(lines, bc.caseId);
  const probeRecommendation =
    probe?.results.find((p) => p.caseId === bc.caseId)?.recommendation ?? null;
  const stage = classifyFailureStage({
    benchmarkCase: bc,
    attempts,
    probeRecommendation,
  });
  return {
    caseId: bc.caseId,
    source: "benchmark",
    sourceFile: benchmarkFile,
    outcome: bc.outcome ?? null,
    taxonomyCode: bc.taxonomyCode ?? null,
    terminalCode: bc.terminalCode ?? null,
    terminalReasonExcerpt: bc.terminalReason ? excerpt(bc.terminalReason, 280) : null,
    severe: !!bc.severe,
    safe: !!bc.safe,
    bookingReady: !!bc.bookingReady,
    failureStage: stage.stage,
    failureStageReason: stage.reason,
    strategyAttempts: attempts,
    matchingProbeRecommendation: probeRecommendation,
    artifactLinks: buildArtifactLinks(bc, benchmarkFile, benchmarkRunId, debugIndex),
  };
}

function probeOnlyAnalysis(
  pc: InlineProbeCase,
  probeFile: string,
  debugIndex: DebugArtifactIndexEntry[],
): ResyRunCaseAnalysis {
  const stage =
    pc.recommendation === "use_for_live_fill_test"
      ? { stage: "unknown" as ResyFailureStage, reason: "Probe says live-OK; no benchmark run yet." }
      : pc.recommendation === "no_matching_slot"
        ? { stage: "probe_no_slot" as ResyFailureStage, reason: "Probe recommendation is no_matching_slot." }
        : { stage: "unknown" as ResyFailureStage, reason: "Probe recommendation is blocked_or_unknown." };
  return {
    caseId: pc.caseId,
    source: "probe-only",
    sourceFile: probeFile,
    outcome: null,
    taxonomyCode: null,
    terminalCode: null,
    terminalReasonExcerpt: null,
    severe: false,
    safe: false,
    bookingReady: false,
    failureStage: stage.stage,
    failureStageReason: stage.reason,
    strategyAttempts: [],
    matchingProbeRecommendation: pc.recommendation,
    artifactLinks: buildProbeArtifactLinks(probeFile, debugIndex),
  };
}

function buildArtifactLinks(
  bc: InlineBenchmarkCase,
  benchmarkFile: string,
  benchmarkRunId: string,
  debugIndex: DebugArtifactIndexEntry[],
): ResyArtifactLink[] {
  const links: ResyArtifactLink[] = [
    {
      kind: "benchmark",
      label: `${benchmarkRunId} (${benchmarkFile})`,
      href: `/dev/benchmark-runs`,
    },
  ];
  if (bc.taskId) {
    links.push({
      kind: "task",
      label: bc.taskId,
      href: `/tasks/${encodeURIComponent(bc.taskId)}`,
    });
  }
  // Debug screenshots: filter to resy provider for this case.
  const resyArtifacts = debugIndex.filter((d) => d.provider === "resy");
  for (const a of resyArtifacts.slice(0, 3)) {
    links.push({
      kind: "debug",
      label: `${a.provider}/${a.label || a.runId}`,
      href: `/dev/debug-artifacts`,
    });
  }
  return links;
}

function buildProbeArtifactLinks(
  probeFile: string,
  debugIndex: DebugArtifactIndexEntry[],
): ResyArtifactLink[] {
  const links: ResyArtifactLink[] = [
    {
      kind: "probe",
      label: probeFile,
      href: `/dev/resy-probe-runs`,
    },
  ];
  for (const a of debugIndex.filter((d) => d.provider === "resy").slice(0, 2)) {
    links.push({
      kind: "debug",
      label: `${a.provider}/${a.label || a.runId}`,
      href: `/dev/debug-artifacts`,
    });
  }
  return links;
}

function excerpt(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

/* ─── Aggregators ────────────────────────────────────────────────────── */

function buildStrategyLadder(
  cases: ResyRunCaseAnalysis[],
): ResyStrategyAttempt[] {
  const map = new Map<string, ResyStrategyAttempt>();
  for (const c of cases) {
    for (const a of c.strategyAttempts) {
      const existing = map.get(a.strategyId);
      if (!existing) {
        map.set(a.strategyId, {
          ...a,
          caseIds: [...a.caseIds],
          steps: [...a.steps],
          filledFields: [...a.filledFields],
        });
        continue;
      }
      existing.okCount += a.okCount;
      existing.failCount += a.failCount;
      existing.stepCount += a.stepCount;
      existing.filledCount += a.filledCount;
      existing.totalLines += a.totalLines;
      for (const s of a.steps) {
        if (!existing.steps.includes(s)) existing.steps.push(s);
      }
      for (const f of a.filledFields) {
        if (!existing.filledFields.includes(f)) existing.filledFields.push(f);
      }
      if (a.latestError) existing.latestError = a.latestError;
      if (a.latestSuccess) existing.latestSuccess = a.latestSuccess;
      if (!existing.caseIds.includes(c.caseId)) existing.caseIds.push(c.caseId);
    }
  }
  // Order by family then strategyId so the matrix has a stable display.
  return Array.from(map.values()).sort((a, b) => {
    const familyOrder = { slot: 0, phone: 1, confirm: 2, other: 3 } as const;
    const fa = familyOrder[a.family];
    const fb = familyOrder[b.family];
    if (fa !== fb) return fa - fb;
    return a.strategyId.localeCompare(b.strategyId);
  });
}

function buildStageDistribution(
  cases: ResyRunCaseAnalysis[],
): Record<ResyFailureStage, number> {
  const init: Record<ResyFailureStage, number> = {
    probe_no_slot: 0,
    slot_api_available_dom_missing: 0,
    slot_selection_failed: 0,
    guest_form_reached: 0,
    guest_form_incomplete: 0,
    otp_or_login_required: 0,
    ready_for_confirmation: 0,
    unknown: 0,
  };
  for (const c of cases) {
    init[c.failureStage] += 1;
  }
  return init;
}

/* ─── Loaders (fs) ───────────────────────────────────────────────────── */

interface DebugArtifactIndexEntry {
  provider: (typeof PROVIDERS_ALLOWED)[number];
  runId: string;
  capturedAt: string | null;
  label: string;
}

async function loadLatestBenchmark(): Promise<{
  file: string;
  report: InlineBenchmarkReport;
} | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(RUNS_DIR);
  } catch {
    return null;
  }
  const candidates = entries
    .filter(
      (n) => BENCHMARK_FILE_PATTERN.test(n) && !PROBE_FILE_PATTERN.test(n),
    )
    .sort()
    .reverse();
  for (const file of candidates) {
    const report = await readJson<InlineBenchmarkReport>(
      path.join(RUNS_DIR, file),
    );
    if (report && typeof report.runId === "string") return { file, report };
  }
  return null;
}

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
    .filter((n) => PROBE_FILE_PATTERN.test(n))
    .sort()
    .reverse();
  for (const file of candidates) {
    const report = await readJson<InlineProbeReport>(
      path.join(RUNS_DIR, file),
    );
    if (
      report &&
      typeof report.runId === "string" &&
      Array.isArray(report.results)
    )
      return { file, report };
  }
  return null;
}

async function loadDebugArtifactIndex(): Promise<DebugArtifactIndexEntry[]> {
  const out: DebugArtifactIndexEntry[] = [];
  for (const provider of PROVIDERS_ALLOWED) {
    const dir = path.join(DEBUG_ROOT, provider);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const runId of entries) {
      if (!RUN_DIR_PATTERN.test(runId)) continue;
      // Defense in depth: resolve + prefix check.
      const baseDir = path.resolve(DEBUG_ROOT, provider);
      const runDir = path.resolve(baseDir, runId);
      if (!runDir.startsWith(baseDir + path.sep) && runDir !== baseDir) continue;

      let stat;
      try {
        stat = await fs.stat(runDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      const { capturedAt, label } = parseRunId(runId);
      out.push({ provider, runId, capturedAt, label });
    }
  }
  return out.sort((a, b) => (b.capturedAt ?? "").localeCompare(a.capturedAt ?? ""));
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

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

/* ─── Display constants ──────────────────────────────────────────────── */

export const VERDICT_LABEL: Record<ResyAnalysisVerdict, string> = {
  RUN: "RUN — single live retry safe",
  DO_NOT_RUN: "DO NOT RUN — fix provider first",
  NEED_PROBE: "NEED PROBE — run probe before any live spend",
  NEED_ARTIFACTS: "NEED ARTIFACTS — gather logs first",
};

export const VERDICT_TONE: Record<
  ResyAnalysisVerdict,
  "good" | "warn" | "bad" | "neutral"
> = {
  RUN: "good",
  DO_NOT_RUN: "bad",
  NEED_PROBE: "neutral",
  NEED_ARTIFACTS: "warn",
};

export const FAILURE_STAGE_LABEL: Record<ResyFailureStage, string> = {
  probe_no_slot: "Probe says no slot",
  slot_api_available_dom_missing: "API has slot, DOM missing",
  slot_selection_failed: "Slot selection failed",
  guest_form_reached: "Guest form reached",
  guest_form_incomplete: "Guest form incomplete",
  otp_or_login_required: "OTP / login required",
  ready_for_confirmation: "Ready for confirmation",
  unknown: "Unknown",
};

export const FAILURE_STAGE_TONE: Record<
  ResyFailureStage,
  "good" | "ok" | "warn" | "bad" | "neutral"
> = {
  probe_no_slot: "neutral",
  slot_api_available_dom_missing: "warn",
  slot_selection_failed: "bad",
  guest_form_reached: "ok",
  guest_form_incomplete: "warn",
  otp_or_login_required: "warn",
  ready_for_confirmation: "good",
  unknown: "neutral",
};

/** Funnel order — used by the dashboard to render left-to-right progression. */
export const FAILURE_STAGE_FUNNEL: ResyFailureStage[] = [
  "probe_no_slot",
  "slot_api_available_dom_missing",
  "slot_selection_failed",
  "guest_form_reached",
  "guest_form_incomplete",
  "otp_or_login_required",
  "ready_for_confirmation",
];
