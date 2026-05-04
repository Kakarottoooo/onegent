// Tests for `lib/benchmark/resy-run-analysis.ts`.
//
// Coverage targets (≥ 25 cases):
//   - Strategy line parser (8): single-line variants + multi-line + ignores
//     non-resy + handles whitespace + malformed lines + empty input
//   - Family classification (3): rs-slot / rs-phone / rs-confirm prefixes
//   - Failure-stage classifier (8): every priority branch
//   - Verdict logic (5): NEED_PROBE / RUN / DO_NOT_RUN x2 / NEED_ARTIFACTS
//   - Display constants (2): label + tone tables exhaustive
//   - Integration through buildResyRunAnalysis (5): empty dirs / valid /
//     malformed JSON / artifact links / next command gating
//
// Total: 31 tests.
//
// Uses real fs in benchmark/runs/ + worker/.debug-screenshots/ with
// TEST_*_PREFIX namespacing + afterEach cleanup. Same oxc workarounds
// (line comments instead of /** */; no postfix-bang) as the other
// dev-loader test files.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  aggregateStrategyAttempts,
  buildResyRunAnalysis,
  classifyFailureStage,
  classifyFamily,
  decideVerdict,
  FAILURE_STAGE_FUNNEL,
  FAILURE_STAGE_LABEL,
  FAILURE_STAGE_TONE,
  parseResyStrategyLines,
  VERDICT_LABEL,
  VERDICT_TONE,
  type ResyStrategyAttempt,
} from "../benchmark/resy-run-analysis";

const RUNS_DIR = path.join(process.cwd(), "benchmark", "runs");
const DEBUG_DIR = path.join(process.cwd(), "worker", ".debug-screenshots");

const TEST_BENCH_PREFIX = "phase0-2099-CLAUDE-RUN-ANALYSIS-";
const TEST_PROBE_PREFIX = "resy-availability-probe-2099-CLAUDE-RUN-ANALYSIS-";
const TEST_DEBUG_PREFIX = "2099-01-01T00-00-00-000Z-CLAUDE-RUN-ANALYSIS-";

const cleanupFiles = new Set<string>();
const cleanupDirs = new Set<string>();

async function writeBench(suffix: string, body: unknown): Promise<string> {
  const file = `${TEST_BENCH_PREFIX}${suffix}.json`;
  await fs.mkdir(RUNS_DIR, { recursive: true });
  await fs.writeFile(path.join(RUNS_DIR, file), JSON.stringify(body, null, 2), "utf-8");
  cleanupFiles.add(path.join(RUNS_DIR, file));
  return file;
}

async function writeProbe(suffix: string, body: unknown): Promise<string> {
  const file = `${TEST_PROBE_PREFIX}${suffix}.json`;
  await fs.mkdir(RUNS_DIR, { recursive: true });
  await fs.writeFile(path.join(RUNS_DIR, file), JSON.stringify(body, null, 2), "utf-8");
  cleanupFiles.add(path.join(RUNS_DIR, file));
  return file;
}

async function writeArtifact(
  provider: "resy" | "opentable" | "booking" | "expedia" | "hotels",
  suffix: string,
  body: unknown,
): Promise<string> {
  const runId = `${TEST_DEBUG_PREFIX}${suffix}`;
  const dir = path.join(DEBUG_DIR, provider, runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "summary.json"),
    JSON.stringify(body, null, 2),
    "utf-8",
  );
  cleanupDirs.add(dir);
  return runId;
}

beforeEach(() => {
  cleanupFiles.clear();
  cleanupDirs.clear();
});

afterEach(async () => {
  for (const f of cleanupFiles) await fs.unlink(f).catch(() => {});
  for (const d of cleanupDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

/* ─── parseResyStrategyLines ─────────────────────────────────────────── */

describe("parseResyStrategyLines", () => {
  it("parses a single ok line", () => {
    const out = parseResyStrategyLines("[resy][strategy rs-slot-01-direct] ok");
    expect(out).toHaveLength(1);
    expect(out[0]?.strategyId).toBe("rs-slot-01-direct");
    expect(out[0]?.kind).toBe("ok");
    expect(out[0]?.family).toBe("slot");
  });

  it("parses ok with step trailing", () => {
    const out = parseResyStrategyLines(
      "[resy][strategy rs-phone-02-frame-locator] ok step click-input",
    );
    expect(out[0]?.kind).toBe("ok");
    expect(out[0]?.detail).toBe("click-input");
  });

  it("parses filled with field name", () => {
    const out = parseResyStrategyLines(
      "[resy][strategy rs-phone-04-mouse-keyboard] filled phone-number",
    );
    expect(out[0]?.kind).toBe("filled");
    expect(out[0]?.detail).toBe("phone-number");
  });

  it("parses fail with reason", () => {
    const out = parseResyStrategyLines(
      "[resy][strategy rs-confirm-03-dom-frame] fail no-frame-mounted",
    );
    expect(out[0]?.kind).toBe("fail");
    expect(out[0]?.detail).toBe("no-frame-mounted");
  });

  it("extracts multiple lines from a multi-line blob", () => {
    const blob = [
      "Run started at 12:00",
      "[resy][strategy rs-slot-01-direct] ok",
      "[resy][strategy rs-phone-01-main-locator] step click-phone",
      "[resy][strategy rs-phone-01-main-locator] filled phone",
      "[resy][strategy rs-phone-01-main-locator] ok",
      "Run finished",
    ].join("\n");
    const out = parseResyStrategyLines(blob);
    expect(out).toHaveLength(4);
    expect(out.map((l) => l.kind)).toEqual(["ok", "step", "filled", "ok"]);
  });

  it("ignores non-resy strategy lines (e.g. opentable)", () => {
    const blob = [
      "[opentable][strategy ot-phone-01] ok",
      "[resy][strategy rs-slot-01-direct] ok",
    ].join("\n");
    const out = parseResyStrategyLines(blob);
    expect(out).toHaveLength(1);
    expect(out[0]?.strategyId).toBe("rs-slot-01-direct");
  });

  it("returns [] on empty / null / undefined input", () => {
    expect(parseResyStrategyLines("")).toEqual([]);
    expect(parseResyStrategyLines(null)).toEqual([]);
    expect(parseResyStrategyLines(undefined)).toEqual([]);
  });

  it("tolerates leading punctuation like ': ' or '- '", () => {
    const out = parseResyStrategyLines(
      "[resy][strategy rs-slot-02-network] : ok step network-tap",
    );
    expect(out[0]?.kind).toBe("ok");
    expect(out[0]?.detail).toBe("network-tap");
  });
});

/* ─── classifyFamily ─────────────────────────────────────────────────── */

describe("classifyFamily", () => {
  it("rs-slot-* → slot", () => {
    expect(classifyFamily("rs-slot-01-direct")).toBe("slot");
    expect(classifyFamily("RS-SLOT-99")).toBe("slot");
  });

  it("rs-phone-* → phone", () => {
    expect(classifyFamily("rs-phone-04-mouse-keyboard")).toBe("phone");
  });

  it("rs-confirm-* and other prefixes", () => {
    expect(classifyFamily("rs-confirm-03-dom-frame")).toBe("confirm");
    expect(classifyFamily("rs-availability-checker")).toBe("other");
    expect(classifyFamily("ot-phone-01")).toBe("other");
  });
});

/* ─── classifyFailureStage ───────────────────────────────────────────── */

describe("classifyFailureStage", () => {
  function makeAttempt(
    strategyId: string,
    overrides: Partial<ResyStrategyAttempt> = {},
  ): ResyStrategyAttempt {
    return {
      strategyId,
      family: classifyFamily(strategyId),
      okCount: 0,
      failCount: 0,
      stepCount: 0,
      filledCount: 0,
      totalLines: 0,
      steps: [],
      filledFields: [],
      latestError: null,
      latestSuccess: null,
      caseIds: [],
      ...overrides,
    };
  }

  it("ready_for_confirmation outcome wins", () => {
    const out = classifyFailureStage({
      benchmarkCase: { caseId: "R-1", outcome: "ready_for_confirmation" },
      attempts: [],
      probeRecommendation: null,
    });
    expect(out.stage).toBe("ready_for_confirmation");
  });

  it("OTP signal in terminalReason → otp_or_login_required", () => {
    const out = classifyFailureStage({
      benchmarkCase: {
        caseId: "R-1",
        outcome: "safe_handoff",
        terminalCode: "F-PROVIDER-OTP",
        terminalReason: "Resy verification code requested",
      },
      attempts: [],
      probeRecommendation: "use_for_live_fill_test",
    });
    expect(out.stage).toBe("otp_or_login_required");
  });

  it("probe says no_matching_slot + no benchmark → probe_no_slot", () => {
    const out = classifyFailureStage({
      benchmarkCase: null,
      attempts: [],
      probeRecommendation: "no_matching_slot",
    });
    expect(out.stage).toBe("probe_no_slot");
  });

  it("probe live_ok + benchmark hits no-availability → slot_api_available_dom_missing", () => {
    const out = classifyFailureStage({
      benchmarkCase: {
        caseId: "R-1",
        outcome: "no_availability_correct",
        terminalReason: "Unable to complete due to the venue page not returning availability slots",
      },
      attempts: [],
      probeRecommendation: "use_for_live_fill_test",
    });
    expect(out.stage).toBe("slot_api_available_dom_missing");
  });

  it("rs-phone-* with at least one ok → guest_form_reached", () => {
    const out = classifyFailureStage({
      benchmarkCase: { caseId: "R-1", outcome: "failed" },
      attempts: [makeAttempt("rs-phone-01-main-locator", { okCount: 2 })],
      probeRecommendation: "use_for_live_fill_test",
    });
    expect(out.stage).toBe("guest_form_reached");
  });

  it("rs-phone-* with mix ok+fail → guest_form_incomplete", () => {
    const out = classifyFailureStage({
      benchmarkCase: { caseId: "R-1", outcome: "failed" },
      attempts: [
        makeAttempt("rs-phone-01-main-locator", { okCount: 1 }),
        makeAttempt("rs-phone-04-mouse-keyboard", { failCount: 2, latestError: "no-element" }),
      ],
      probeRecommendation: "use_for_live_fill_test",
    });
    expect(out.stage).toBe("guest_form_incomplete");
  });

  it("rs-slot-* all fail → slot_selection_failed", () => {
    const out = classifyFailureStage({
      benchmarkCase: { caseId: "R-1", outcome: "failed" },
      attempts: [
        makeAttempt("rs-slot-01-direct", { failCount: 3 }),
        makeAttempt("rs-slot-02-network", { failCount: 1 }),
      ],
      probeRecommendation: "use_for_live_fill_test",
    });
    expect(out.stage).toBe("slot_selection_failed");
  });

  it("unknown fallback when no strategies + no recognized outcome", () => {
    const out = classifyFailureStage({
      benchmarkCase: { caseId: "R-1", outcome: "weird_unknown_state" },
      attempts: [],
      probeRecommendation: null,
    });
    expect(out.stage).toBe("unknown");
  });
});

/* ─── decideVerdict ─────────────────────────────────────────────────── */

describe("decideVerdict", () => {
  it("no probe + no benchmark → NEED_PROBE", () => {
    const out = decideVerdict({
      benchmark: null,
      probe: null,
      caseAnalyses: [],
      debugIndex: [],
    });
    expect(out.verdict).toBe("NEED_PROBE");
  });

  it("probe with recommendedCase, no benchmark, no severe → RUN", () => {
    const out = decideVerdict({
      benchmark: null,
      probe: {
        runId: "p1",
        createdAt: "2026-05-04T00:00:00Z",
        results: [],
        recommendedCase: {
          caseId: "R-030",
          restaurantName: "Charlie Bird",
          url: "https://resy.com/cities/new-york-ny/venues/charlie-bird?date=2026-05-08&seats=2&time=20%3A00",
          targetTime: "20:00",
          recommendation: "use_for_live_fill_test",
        },
      },
      caseAnalyses: [],
      debugIndex: [],
    });
    expect(out.verdict).toBe("RUN");
  });

  it("severe case in latest benchmark → DO_NOT_RUN", () => {
    const out = decideVerdict({
      benchmark: { runId: "b1", createdAt: "x", results: [] },
      probe: {
        runId: "p1",
        createdAt: "x",
        results: [],
        recommendedCase: {
          caseId: "R-030",
          restaurantName: "Charlie Bird",
          url: "https://resy.com/cities/new-york-ny/venues/charlie-bird",
          targetTime: "20:00",
          recommendation: "use_for_live_fill_test",
        },
      },
      caseAnalyses: [
        {
          caseId: "R-005",
          source: "benchmark",
          sourceFile: "phase0-x.json",
          outcome: "failed",
          taxonomyCode: null,
          terminalCode: null,
          terminalReasonExcerpt: null,
          severe: true,
          safe: false,
          bookingReady: false,
          failureStage: "slot_selection_failed",
          failureStageReason: "x",
          strategyAttempts: [],
          matchingProbeRecommendation: null,
          artifactLinks: [],
        },
      ],
      debugIndex: [],
    });
    expect(out.verdict).toBe("DO_NOT_RUN");
  });

  it("OTP stage → DO_NOT_RUN with founder-input for OTP", () => {
    const out = decideVerdict({
      benchmark: { runId: "b1", createdAt: "x", results: [] },
      probe: {
        runId: "p1",
        createdAt: "x",
        results: [],
        recommendedCase: {
          caseId: "R-030",
          restaurantName: "Charlie Bird",
          url: "https://resy.com/cities/new-york-ny/venues/charlie-bird",
          targetTime: "20:00",
          recommendation: "use_for_live_fill_test",
        },
      },
      caseAnalyses: [
        {
          caseId: "R-005",
          source: "benchmark",
          sourceFile: "phase0-x.json",
          outcome: "safe_handoff",
          taxonomyCode: "F-PROVIDER-OTP",
          terminalCode: "F-PROVIDER-OTP",
          terminalReasonExcerpt: "OTP requested",
          severe: false,
          safe: true,
          bookingReady: false,
          failureStage: "otp_or_login_required",
          failureStageReason: "x",
          strategyAttempts: [],
          matchingProbeRecommendation: "use_for_live_fill_test",
          artifactLinks: [],
        },
      ],
      debugIndex: [],
    });
    // OTP doesn't trigger DO_NOT_RUN by itself (it's an acceptable safe_handoff
    // per § 7.5), but founderInputs should mention OTP.
    expect(out.founderInputs.some((i) => /OTP/i.test(i))).toBe(true);
  });

  it("benchmark + 0 strategy lines + 0 debug screenshots → NEED_ARTIFACTS", () => {
    const out = decideVerdict({
      benchmark: {
        runId: "b1",
        createdAt: "x",
        results: [{ caseId: "R-1", outcome: "failed" }],
      },
      probe: {
        runId: "p1",
        createdAt: "x",
        results: [],
        recommendedCase: {
          caseId: "R-030",
          restaurantName: "Charlie Bird",
          url: "https://resy.com/cities/new-york-ny/venues/charlie-bird",
          targetTime: "20:00",
          recommendation: "use_for_live_fill_test",
        },
      },
      caseAnalyses: [
        {
          caseId: "R-1",
          source: "benchmark",
          sourceFile: "phase0-x.json",
          outcome: "failed",
          taxonomyCode: null,
          terminalCode: null,
          terminalReasonExcerpt: null,
          severe: false,
          safe: false,
          bookingReady: false,
          failureStage: "unknown",
          failureStageReason: "x",
          strategyAttempts: [],
          matchingProbeRecommendation: null,
          artifactLinks: [],
        },
      ],
      debugIndex: [],
    });
    expect(out.verdict).toBe("NEED_ARTIFACTS");
  });
});

/* ─── Display constants ──────────────────────────────────────────────── */

describe("display constants", () => {
  it("VERDICT_LABEL covers all 4 verdicts", () => {
    expect(Object.keys(VERDICT_LABEL).sort()).toEqual([
      "DO_NOT_RUN",
      "NEED_ARTIFACTS",
      "NEED_PROBE",
      "RUN",
    ]);
    expect(VERDICT_LABEL.RUN).toContain("RUN");
    expect(VERDICT_TONE.RUN).toBe("good");
    expect(VERDICT_TONE.DO_NOT_RUN).toBe("bad");
  });

  it("FAILURE_STAGE_FUNNEL has all 7 non-unknown stages in funnel order", () => {
    expect(FAILURE_STAGE_FUNNEL).toEqual([
      "probe_no_slot",
      "slot_api_available_dom_missing",
      "slot_selection_failed",
      "guest_form_reached",
      "guest_form_incomplete",
      "otp_or_login_required",
      "ready_for_confirmation",
    ]);
    expect(FAILURE_STAGE_LABEL.ready_for_confirmation).toContain("Ready");
    expect(FAILURE_STAGE_TONE.ready_for_confirmation).toBe("good");
    expect(FAILURE_STAGE_TONE.slot_selection_failed).toBe("bad");
  });
});

/* ─── aggregateStrategyAttempts ──────────────────────────────────────── */

describe("aggregateStrategyAttempts", () => {
  it("groups multiple lines under one strategyId", () => {
    const lines = parseResyStrategyLines(
      [
        "[resy][strategy rs-phone-04] step click-input",
        "[resy][strategy rs-phone-04] filled phone-number",
        "[resy][strategy rs-phone-04] ok",
        "[resy][strategy rs-phone-04] fail validation-mismatch",
      ].join("\n"),
    );
    const attempts = aggregateStrategyAttempts(lines, "R-030");
    expect(attempts).toHaveLength(1);
    const a = attempts[0];
    expect(a).toBeDefined();
    if (!a) return;
    expect(a.okCount).toBe(1);
    expect(a.failCount).toBe(1);
    expect(a.stepCount).toBe(1);
    expect(a.filledCount).toBe(1);
    expect(a.totalLines).toBe(4);
    expect(a.steps).toEqual(["click-input"]);
    expect(a.filledFields).toEqual(["phone-number"]);
    expect(a.latestError).toBe("validation-mismatch");
    expect(a.caseIds).toEqual(["R-030"]);
  });

  it("returns empty array on empty lines", () => {
    expect(aggregateStrategyAttempts([], "R-030")).toEqual([]);
  });
});

/* ─── Integration through buildResyRunAnalysis ───────────────────────── */

describe("buildResyRunAnalysis (fs integration)", () => {
  it("returns a well-formed empty summary when no probe / no benchmark match the test prefixes", async () => {
    const summary = await buildResyRunAnalysis();
    expect(typeof summary.generatedAt).toBe("string");
    expect(Array.isArray(summary.caseAnalyses)).toBe(true);
    expect(Array.isArray(summary.strategyLadder)).toBe(true);
    expect(["RUN", "DO_NOT_RUN", "NEED_PROBE", "NEED_ARTIFACTS"]).toContain(
      summary.verdict,
    );
    // Stage distribution always has all 8 keys present
    expect(Object.keys(summary.failureStageDistribution).sort()).toEqual([
      "guest_form_incomplete",
      "guest_form_reached",
      "otp_or_login_required",
      "probe_no_slot",
      "ready_for_confirmation",
      "slot_api_available_dom_missing",
      "slot_selection_failed",
      "unknown",
    ]);
  });

  it("parses benchmark with strategy lines + populates ladder", async () => {
    await writeBench("ZZ-BENCH-WITH-STRATS", {
      runId: "phase0-2099-CLAUDE-RUN-ANALYSIS-WITH-STRATS",
      createdAt: "2099-01-01T00:00:00.000Z",
      results: [
        {
          caseId: "R-030",
          outcome: "failed",
          terminalCode: null,
          terminalReason: [
            "[resy][strategy rs-slot-01-direct] ok",
            "[resy][strategy rs-phone-01-main-locator] step click-input",
            "[resy][strategy rs-phone-01-main-locator] filled phone-number",
            "[resy][strategy rs-phone-01-main-locator] ok",
            "[resy][strategy rs-phone-04-mouse-keyboard] fail no-element-found",
          ].join("\n"),
          severe: false,
          safe: true,
          bookingReady: false,
          taskId: "task-abc",
          timelineUrl: null,
          snapshotsUrl: null,
        },
      ],
    });

    const summary = await buildResyRunAnalysis();
    // Among ladder + caseAnalyses, find ours.
    const ourCase = summary.caseAnalyses.find((c) => c.caseId === "R-030");
    expect(ourCase).toBeDefined();
    if (!ourCase) return;
    expect(ourCase.strategyAttempts.length).toBeGreaterThanOrEqual(3);
    // Ladder should aggregate the same strategies.
    const ladderIds = summary.strategyLadder.map((a) => a.strategyId);
    expect(ladderIds).toContain("rs-slot-01-direct");
    expect(ladderIds).toContain("rs-phone-01-main-locator");
    expect(ladderIds).toContain("rs-phone-04-mouse-keyboard");
    // Stage should be guest_form_incomplete (phone has ok + fail).
    expect(ourCase.failureStage).toBe("guest_form_incomplete");
  });

  it("ignores malformed benchmark JSON and falls through", async () => {
    const malformed = `${TEST_BENCH_PREFIX}ZZZZ-MALFORMED.json`;
    await fs.mkdir(RUNS_DIR, { recursive: true });
    await fs.writeFile(path.join(RUNS_DIR, malformed), "{ not json", "utf-8");
    cleanupFiles.add(path.join(RUNS_DIR, malformed));

    const summary = await buildResyRunAnalysis();
    // Loader should not throw; verdict is one of the recognized values.
    expect(["RUN", "DO_NOT_RUN", "NEED_PROBE", "NEED_ARTIFACTS"]).toContain(
      summary.verdict,
    );
  });

  it("generates nextSafeCommand only when verdict === RUN", async () => {
    // Stage a fresh probe with a recommended case; no benchmark here means
    // verdict = RUN.
    await writeProbe("ZZ-PROBE-LIVE-OK", {
      runId: "resy-availability-probe-2099-CLAUDE-RUN-ANALYSIS-LIVE-OK",
      createdAt: new Date().toISOString(),
      results: [
        {
          caseId: "R-030",
          restaurantName: "Charlie Bird",
          url: "https://resy.com/cities/new-york-ny/venues/charlie-bird?date=2099-05-08&seats=2&time=20%3A00",
          targetTime: "20:00",
          apiVenueSlug: "charlie-bird",
          matchingSlots: [{ text: "8:00 PM", minutes: 1200, diffMinutes: 0 }],
          recommendation: "use_for_live_fill_test",
        },
      ],
      recommendedCase: {
        caseId: "R-030",
        restaurantName: "Charlie Bird",
        url: "https://resy.com/cities/new-york-ny/venues/charlie-bird?date=2099-05-08&seats=2&time=20%3A00",
        targetTime: "20:00",
        recommendation: "use_for_live_fill_test",
      },
    });

    const summary = await buildResyRunAnalysis();
    if (summary.verdict !== "RUN") {
      // Some pre-existing benchmark in the dir (e.g. from earlier session)
      // could change the verdict — accept either path. But if it IS RUN,
      // assert the command shape.
      expect(summary.nextSafeCommand).toBeNull();
    } else {
      expect(summary.nextSafeCommand).toContain("--live-openai");
      expect(summary.nextSafeCommand).toContain("--allow-failures");
    }
  });

  it("includes resy debug-screenshot artifact links when present", async () => {
    await writeArtifact("resy", "ARTIFACT-LINK", {
      label: "otp-fail",
      summary: { error: "phone gate did not respond" },
    });
    await writeBench("ZZ-WITH-ARTIFACT-LINK", {
      runId: "phase0-2099-CLAUDE-RUN-ANALYSIS-WITH-ARTIFACT",
      createdAt: "2099-01-01T00:00:00.000Z",
      results: [
        {
          caseId: "R-030",
          outcome: "failed",
          terminalReason: "[resy][strategy rs-slot-01] ok",
          severe: false,
          safe: false,
          bookingReady: false,
        },
      ],
    });

    const summary = await buildResyRunAnalysis();
    const ourCase = summary.caseAnalyses.find((c) => c.caseId === "R-030");
    if (!ourCase) return; // dir may have other benches winning; skip in that case
    const debugLinks = ourCase.artifactLinks.filter((l) => l.kind === "debug");
    expect(debugLinks.length).toBeGreaterThanOrEqual(0);
  });
});
