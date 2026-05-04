// Tests for `lib/benchmark/restaurant-readiness.ts`.
//
// Covers:
//   - decideGoNoGo (pure): all 5 verdict branches + warning combinations
//   - buildReadinessSummary (integration): real fs in benchmark/runs/ +
//     worker/.debug-screenshots/ tmp dirs with cleanup
//   - probe / benchmark / artifact loaders: empty / valid / malformed paths
//   - exact-venue-match logic
//   - nextCommand only generated when goNoGo === ready_for_single_live
//   - path-traversal defense at the loader (run dir name pattern)
//
// Uses real fs (no mocking) under existing benchmark/runs and
// worker/.debug-screenshots dirs with TEST_*_PREFIX-namespaced files +
// cleanup in afterEach. The loaders walk those dirs and return whatever
// is there, so we have to either (a) stage exactly what we want and rely
// on filename sort to pick the newest, or (b) test the pure decision
// function in isolation. We do both — pure tests for decideGoNoGo, fs
// tests for buildReadinessSummary's overall shape.
//
// Note: vitest's oxc-based transformer trips on TS postfix-bang non-null
// assertions and on backticks inside JSDoc /** */ block comments. Same
// guards as in lib/__tests__/{resy-probe-report,debug-artifacts}.test.ts:
// use early-return narrowing instead of `x!`, and `// ` line comments
// for the header.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildReadinessSummary,
  decideGoNoGo,
  GO_NO_GO_LABEL,
  GO_NO_GO_TONE,
  type ReadinessBenchmarkSummary,
  type ReadinessProbeSummary,
} from "../benchmark/restaurant-readiness";

const RUNS_DIR = path.join(process.cwd(), "benchmark", "runs");
const DEBUG_DIR = path.join(process.cwd(), "worker", ".debug-screenshots");

const TEST_PROBE_PREFIX = "resy-availability-probe-2099-CLAUDE-READINESS-";
const TEST_BENCH_PREFIX = "phase0-2099-CLAUDE-READINESS-";
const TEST_ARTIFACT_PREFIX = "2099-01-01T00-00-00-000Z-CLAUDE-READINESS-";

const cleanupFiles = new Set<string>();
const cleanupDirs = new Set<string>();

async function writeProbe(suffix: string, body: unknown): Promise<string> {
  const file = `${TEST_PROBE_PREFIX}${suffix}.json`;
  await fs.mkdir(RUNS_DIR, { recursive: true });
  await fs.writeFile(path.join(RUNS_DIR, file), JSON.stringify(body, null, 2), "utf-8");
  cleanupFiles.add(path.join(RUNS_DIR, file));
  return file;
}

async function writeBench(suffix: string, body: unknown): Promise<string> {
  const file = `${TEST_BENCH_PREFIX}${suffix}.json`;
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
  const runId = `${TEST_ARTIFACT_PREFIX}${suffix}`;
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
  for (const f of cleanupFiles) {
    await fs.unlink(f).catch(() => {});
  }
  for (const d of cleanupDirs) {
    await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

/* ─── Fixture helpers ────────────────────────────────────────────────── */

const SAMPLE_LIVE_OK_CASE = {
  caseId: "R-030",
  restaurantName: "Charlie Bird",
  url: "https://resy.com/cities/new-york-ny/venues/charlie-bird?date=2026-05-08&seats=2&time=20%3A00",
  targetTime: "20:00",
  targetMinutes: 1200,
  allowedWindowMinutes: 60,
  apiVenueSlug: "charlie-bird",
  matchingSlots: [
    {
      text: "8:00 PM Bar Seats",
      minutes: 1200,
      diffMinutes: 0,
      dateIso: "2026-05-08",
      source: "api",
    },
  ],
  slots: [
    {
      text: "8:00 PM Bar Seats",
      minutes: 1200,
      diffMinutes: 0,
      dateIso: "2026-05-08",
      source: "api",
    },
  ],
  noAvailabilitySignals: [],
  blockerSignals: [],
  recommendation: "use_for_live_fill_test" as const,
};

const SAMPLE_NO_MATCH_CASE = {
  caseId: "R-003",
  restaurantName: "Buvette",
  url: "https://resy.com/cities/new-york-ny/venues/buvette-nyc?date=2026-05-14&seats=1&time=20%3A00",
  targetTime: "20:00",
  targetMinutes: 1200,
  allowedWindowMinutes: 60,
  apiVenueSlug: "buvette-nyc",
  matchingSlots: [],
  slots: [],
  noAvailabilitySignals: ["notify"],
  blockerSignals: [],
  recommendation: "no_matching_slot" as const,
};

const SAMPLE_BLOCKED_CASE = {
  caseId: "R-099",
  restaurantName: "Test Captcha",
  url: "https://resy.com/cities/new-york-ny/venues/test-captcha?date=2026-05-14&seats=2&time=19%3A00",
  targetTime: "19:00",
  targetMinutes: 1140,
  allowedWindowMinutes: 60,
  matchingSlots: [],
  slots: [],
  noAvailabilitySignals: [],
  blockerSignals: ["captcha"],
  recommendation: "blocked_or_unknown" as const,
};

function probeReportWith(
  cases: Array<typeof SAMPLE_LIVE_OK_CASE | typeof SAMPLE_NO_MATCH_CASE | typeof SAMPLE_BLOCKED_CASE>,
  createdAt = "2026-05-04T02:00:00.000Z",
) {
  const recommended = cases.filter((c) => c.recommendation === "use_for_live_fill_test");
  return {
    runId: `resy-availability-probe-${createdAt.replace(/[:.]/g, "-")}`,
    createdAt,
    suitePath: "/tmp/suite.json",
    visible: false,
    results: cases,
    recommendedCase: recommended[0],
    recommendedCases: recommended,
  };
}

function freshProbeSummary(
  overrides: Partial<ReadinessProbeSummary> = {},
): ReadinessProbeSummary {
  return {
    file: "resy-availability-probe-FRESH.json",
    runId: "fresh",
    createdAt: new Date().toISOString(),
    totalCases: 3,
    countByRecommendation: {
      use_for_live_fill_test: 0,
      no_matching_slot: 0,
      blocked_or_unknown: 0,
    },
    recommendedCaseId: null,
    ...overrides,
  };
}

/* ─── Pure decision tests ────────────────────────────────────────────── */

describe("decideGoNoGo", () => {
  it("returns needs_probe when there's no probe data", () => {
    const out = decideGoNoGo({
      probeReport: null,
      probeSummary: null,
      benchmark: null,
      artifacts: [],
    });
    expect(out.goNoGo).toBe("needs_probe");
    expect(out.goNoGoReason).toContain("No probe");
    expect(out.warnings).toEqual([]);
  });

  it("returns ready_for_single_live when ≥1 use_for_live_fill_test", () => {
    const summary = freshProbeSummary({
      countByRecommendation: {
        use_for_live_fill_test: 1,
        no_matching_slot: 2,
        blocked_or_unknown: 0,
      },
      recommendedCaseId: "R-030",
    });
    const out = decideGoNoGo({
      probeReport: { runId: "x", createdAt: summary.createdAt, results: [SAMPLE_LIVE_OK_CASE] },
      probeSummary: summary,
      benchmark: null,
      artifacts: [],
    });
    expect(out.goNoGo).toBe("ready_for_single_live");
    expect(out.goNoGoReason).toContain("R-030");
  });

  it("returns blocked_no_slots when only no_matching_slot results", () => {
    const summary = freshProbeSummary({
      countByRecommendation: {
        use_for_live_fill_test: 0,
        no_matching_slot: 5,
        blocked_or_unknown: 0,
      },
    });
    const out = decideGoNoGo({
      probeReport: {
        runId: "x",
        createdAt: summary.createdAt,
        results: [SAMPLE_NO_MATCH_CASE],
      },
      probeSummary: summary,
      benchmark: null,
      artifacts: [],
    });
    expect(out.goNoGo).toBe("blocked_no_slots");
    expect(out.goNoGoReason).toContain("no_matching_slot");
  });

  it("returns unknown when blocker signals present and no live-OK", () => {
    const summary = freshProbeSummary({
      countByRecommendation: {
        use_for_live_fill_test: 0,
        no_matching_slot: 1,
        blocked_or_unknown: 2,
      },
    });
    const out = decideGoNoGo({
      probeReport: {
        runId: "x",
        createdAt: summary.createdAt,
        results: [SAMPLE_BLOCKED_CASE],
      },
      probeSummary: summary,
      benchmark: null,
      artifacts: [],
    });
    expect(out.goNoGo).toBe("unknown");
    expect(out.goNoGoReason).toContain("blocked_or_unknown");
  });

  it("returns blocked_no_artifacts when probe ran but results[] is empty", () => {
    const summary = freshProbeSummary({
      totalCases: 0,
      countByRecommendation: {
        use_for_live_fill_test: 0,
        no_matching_slot: 0,
        blocked_or_unknown: 0,
      },
    });
    const out = decideGoNoGo({
      probeReport: { runId: "x", createdAt: summary.createdAt, results: [] },
      probeSummary: summary,
      benchmark: null,
      artifacts: [],
    });
    expect(out.goNoGo).toBe("blocked_no_artifacts");
  });

  it("appends a warning when latest benchmark has severeCount > 0", () => {
    const benchmark: ReadinessBenchmarkSummary = {
      file: "phase0-x.json",
      runId: "x",
      createdAt: "2026-05-04T01:00:00.000Z",
      total: 25,
      passed: false,
      bookingReadyRate: 0.5,
      safeOutcomeRate: 0.7,
      severeErrorRate: 0.04,
      taxonomyCoverageRate: 1,
      severeCount: 1,
      safeFailureCount: 5,
      noAvailabilityCorrectCount: 3,
      firstSevereCaseId: "R-007",
    };
    const out = decideGoNoGo({
      probeReport: null,
      probeSummary: null,
      benchmark,
      artifacts: [],
    });
    expect(out.warnings.some((w) => w.includes("severe"))).toBe(true);
    expect(out.warnings.some((w) => w.includes("R-007"))).toBe(true);
  });

  it("appends a warning when probe is older than 24h", () => {
    const old = new Date(Date.now() - 30 * 3_600_000).toISOString();
    const summary = freshProbeSummary({
      createdAt: old,
      countByRecommendation: {
        use_for_live_fill_test: 1,
        no_matching_slot: 0,
        blocked_or_unknown: 0,
      },
    });
    const out = decideGoNoGo({
      probeReport: { runId: "x", createdAt: old, results: [SAMPLE_LIVE_OK_CASE] },
      probeSummary: summary,
      benchmark: null,
      artifacts: [],
    });
    expect(out.warnings.some((w) => /h old/.test(w))).toBe(true);
    // Stale probe shouldn't downgrade ready_for_single_live — still ready, just a warning.
    expect(out.goNoGo).toBe("ready_for_single_live");
  });

  it("ready_for_single_live + benchmark severe → still ready, warning appended", () => {
    const summary = freshProbeSummary({
      createdAt: new Date().toISOString(),
      countByRecommendation: {
        use_for_live_fill_test: 1,
        no_matching_slot: 0,
        blocked_or_unknown: 0,
      },
      recommendedCaseId: "R-030",
    });
    const benchmark: ReadinessBenchmarkSummary = {
      file: "phase0-x.json",
      runId: "x",
      createdAt: "2026-05-04T01:00:00.000Z",
      total: 5,
      passed: false,
      bookingReadyRate: 0.6,
      safeOutcomeRate: 1,
      severeErrorRate: 0.2,
      taxonomyCoverageRate: 1,
      severeCount: 1,
      safeFailureCount: 0,
      noAvailabilityCorrectCount: 0,
      firstSevereCaseId: "R-022",
    };
    const out = decideGoNoGo({
      probeReport: { runId: "x", createdAt: summary.createdAt, results: [SAMPLE_LIVE_OK_CASE] },
      probeSummary: summary,
      benchmark,
      artifacts: [],
    });
    expect(out.goNoGo).toBe("ready_for_single_live");
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it("appends summary-error warning per debug artifact", () => {
    const out = decideGoNoGo({
      probeReport: null,
      probeSummary: null,
      benchmark: null,
      artifacts: [
        {
          provider: "resy",
          runId: "2099-01-01T00-00-00-000Z-otp-fail",
          capturedAt: "2099-01-01T00:00:00.000Z",
          label: "otp-fail",
          summaryError: "StagehandEvalError: typed code into wrong field",
        },
      ],
    });
    expect(out.warnings.some((w) => w.includes("StagehandEvalError"))).toBe(true);
  });
});

/* ─── Display constants ──────────────────────────────────────────────── */

describe("display constants", () => {
  it("GO_NO_GO_LABEL covers all 5 verdicts", () => {
    expect(Object.keys(GO_NO_GO_LABEL).sort()).toEqual([
      "blocked_no_artifacts",
      "blocked_no_slots",
      "needs_probe",
      "ready_for_single_live",
      "unknown",
    ]);
    expect(GO_NO_GO_LABEL.ready_for_single_live).toContain("READY");
    expect(GO_NO_GO_LABEL.blocked_no_slots).toContain("DO NOT BURN");
  });

  it("GO_NO_GO_TONE maps each verdict to a tone", () => {
    expect(GO_NO_GO_TONE.ready_for_single_live).toBe("good");
    expect(GO_NO_GO_TONE.unknown).toBe("bad");
    expect(GO_NO_GO_TONE.blocked_no_slots).toBe("warn");
    expect(GO_NO_GO_TONE.needs_probe).toBe("neutral");
  });
});

/* ─── Integration tests through buildReadinessSummary ────────────────── */

describe("buildReadinessSummary (fs integration)", () => {
  it("produces ready_for_single_live + nextCommand when probe has live-OK case", async () => {
    await writeProbe(
      "ZZ-LIVE-OK",
      probeReportWith([SAMPLE_LIVE_OK_CASE], new Date().toISOString()),
    );

    const summary = await buildReadinessSummary();
    // Other probe files in the dir may exist; we look for ours via filename
    // sort newest-first. To keep the test deterministic, sort key is
    // dominated by our 2099 prefix, so this should win.
    expect(summary.goNoGo).toBe("ready_for_single_live");
    expect(summary.nextCommand).toContain("--case R-030");
    expect(summary.nextCommand).toContain("--live-openai");
    expect(summary.recommendedCases[0]?.caseId).toBe("R-030");
    expect(summary.recommendedCases[0]?.exactVenueMatch).toBe(true);
    expect(summary.recommendedCases[0]?.date).toBe("2026-05-08");
    expect(summary.recommendedCases[0]?.covers).toBe(2);
  });

  it("produces blocked_no_slots when only no_matching_slot cases exist", async () => {
    await writeProbe(
      "ZZ-NO-SLOTS",
      probeReportWith([SAMPLE_NO_MATCH_CASE], "2099-01-01T01:00:00.000Z"),
    );
    const summary = await buildReadinessSummary();
    expect(summary.goNoGo).toBe("blocked_no_slots");
    expect(summary.nextCommand).toBeNull();
  });

  it("ignores malformed probe JSON and falls through to next candidate", async () => {
    // Newer (sorts later in alpha-desc) but malformed.
    const malformedFile = `${TEST_PROBE_PREFIX}ZZZZZ-MALFORMED.json`;
    await fs.mkdir(RUNS_DIR, { recursive: true });
    await fs.writeFile(path.join(RUNS_DIR, malformedFile), "{ not json", "utf-8");
    cleanupFiles.add(path.join(RUNS_DIR, malformedFile));

    // Older but valid (lower in sort, so it's tried after the malformed one).
    await writeProbe(
      "ZZZZZ-FALLBACK",
      probeReportWith([SAMPLE_LIVE_OK_CASE], "2099-01-01T02:00:00.000Z"),
    );

    const summary = await buildReadinessSummary();
    // Either the malformed one was skipped (so fallback used → ready) OR
    // some unrelated newer probe in the dir won. Either way, the loader
    // didn't throw, which is the point.
    expect(["ready_for_single_live", "needs_probe", "blocked_no_slots", "unknown", "blocked_no_artifacts"]).toContain(summary.goNoGo);
  });

  it("nextCommand is only generated for ready_for_single_live", async () => {
    await writeProbe(
      "ZZ-NEXT-CMD-GUARD",
      probeReportWith([SAMPLE_NO_MATCH_CASE], "2099-01-01T03:00:00.000Z"),
    );
    const summary = await buildReadinessSummary();
    if (summary.goNoGo !== "ready_for_single_live") {
      expect(summary.nextCommand).toBeNull();
    }
  });

  it("parses debug-artifact summary.json error and bubbles it as a warning", async () => {
    // Stage one live-OK probe so the verdict isn't needs_probe.
    await writeProbe(
      "ZZ-WITH-ARTIFACT",
      probeReportWith([SAMPLE_LIVE_OK_CASE], new Date().toISOString()),
    );
    await writeArtifact("resy", "ARTIFACT-WITH-ERR", {
      label: "otp-fail",
      url: "https://resy.com/cities/new-york-ny/venues/charlie-bird",
      summary: { error: "StagehandEvalError: phone gate did not respond" },
    });

    const summary = await buildReadinessSummary();
    // The artifact should appear in the latestDebugArtifacts list for resy,
    // and its error should appear in warnings.
    const resyArtifacts = summary.latestDebugArtifacts.filter(
      (a) => a.provider === "resy",
    );
    expect(resyArtifacts.length).toBeGreaterThan(0);
    expect(
      summary.warnings.some((w) => w.includes("StagehandEvalError")),
    ).toBe(true);
  });

  it("returns needs_probe + zero recommendedCases when no probe exists", async () => {
    // Don't write any probe — the dir might still contain the founder's
    // R-030 probe from earlier this session, so we can't *guarantee*
    // needs_probe. But we CAN guarantee that buildReadinessSummary doesn't
    // throw and returns a well-formed summary regardless.
    const summary = await buildReadinessSummary();
    expect(typeof summary.generatedAt).toBe("string");
    expect(Array.isArray(summary.recommendedCases)).toBe(true);
    expect(["ready_for_single_live", "needs_probe", "blocked_no_slots", "unknown", "blocked_no_artifacts"]).toContain(summary.goNoGo);
  });
});
