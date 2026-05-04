// Tests for `lib/benchmark/resy-probe-report.ts`.
//
// Covers:
//   - listResyProbeRunSummaries: filename pattern, sort newest-first, summary
//     fields populated, graceful empty when dir missing, recommendation counts
//   - loadResyProbeRun: filename guard, shape guard, JSON-parse guard
//   - parseResyProbeUrl: extracts date / covers / time / slug from probe URL
//   - countByRecommendation: bucketizes results
//   - buildNextLiveCommand: matches codex's runner stdout format
//   - isExactVenueMatch: API venue slug vs URL venue slug
//   - explainRecommendation: human-readable rationale
//
// Uses node:fs in benchmark/runs (cwd-relative — same as the loader). Test files
// have a TEST_FILES_PREFIX that no real probe run will collide with.
//
// Note: vitest's oxc-based transformer is fussy about TS postfix-bang non-null
// assertions and about backticks in JSDoc-style /** */ block comments. This
// file uses early-return guards and // line comments for the header to avoid
// both pitfalls (hit the same bugs in lib/__tests__/debug-artifacts.test.ts).

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildNextLiveCommand,
  countByRecommendation,
  explainRecommendation,
  isExactVenueMatch,
  listResyProbeRunSummaries,
  loadResyProbeRun,
  parseResyProbeUrl,
  type ResyProbeCase,
  type ResyProbeRun,
} from "../benchmark/resy-probe-report";

const RUNS_DIR = path.join(process.cwd(), "benchmark", "runs");

const SAMPLE_LIVE_OK: ResyProbeCase = {
  caseId: "R-030",
  restaurantName: "Charlie Bird",
  url: "https://resy.com/cities/new-york-ny/venues/charlie-bird?date=2026-05-08&seats=2&time=20%3A00",
  targetTime: "20:00",
  targetMinutes: 1200,
  allowedWindowMinutes: 60,
  probeSource: "api",
  apiStatus: 200,
  apiVenueName: "Charlie Bird",
  apiVenueSlug: "charlie-bird",
  pageUrl: "https://resy.com/cities/new-york-ny/venues/charlie-bird?date=2026-05-08&seats=2&time=20%3A00",
  title: "",
  slots: [
    {
      text: "8:00 PM Bar Seats",
      minutes: 1200,
      diffMinutes: 0,
      dateIso: "2026-05-08",
      source: "api",
      token: "rgs://resy/5/2785316/2/2026-05-08/2026-05-08/20:00:00/2/Bar Seats",
      venueSlug: "charlie-bird",
      venueName: "Charlie Bird",
    },
  ],
  matchingSlots: [
    {
      text: "8:00 PM Bar Seats",
      minutes: 1200,
      diffMinutes: 0,
      dateIso: "2026-05-08",
      source: "api",
      token: "rgs://resy/5/2785316/2/2026-05-08/2026-05-08/20:00:00/2/Bar Seats",
      venueSlug: "charlie-bird",
      venueName: "Charlie Bird",
    },
  ],
  noAvailabilitySignals: [],
  blockerSignals: [],
  bodySnippet: "",
  recommendation: "use_for_live_fill_test",
};

const SAMPLE_NO_MATCH: ResyProbeCase = {
  caseId: "R-003",
  restaurantName: "Buvette",
  url: "https://resy.com/cities/new-york-ny/venues/buvette-nyc?date=2026-05-14&seats=1&time=20%3A00",
  targetTime: "20:00",
  targetMinutes: 1200,
  allowedWindowMinutes: 60,
  probeSource: "api",
  apiStatus: 200,
  apiVenueName: "Buvette",
  apiVenueSlug: "buvette-nyc",
  pageUrl: "https://resy.com/cities/new-york-ny/venues/buvette-nyc?date=2026-05-14&seats=1&time=20%3A00",
  title: "",
  slots: [],
  matchingSlots: [],
  noAvailabilitySignals: ["notify"],
  blockerSignals: [],
  bodySnippet: "",
  recommendation: "no_matching_slot",
};

const SAMPLE_BLOCKED: ResyProbeCase = {
  caseId: "R-099",
  restaurantName: "Test Captcha",
  url: "https://resy.com/cities/new-york-ny/venues/test-captcha?date=2026-05-14&seats=2&time=19%3A00",
  targetTime: "19:00",
  targetMinutes: 1140,
  allowedWindowMinutes: 60,
  probeSource: "api+browser",
  apiStatus: 0,
  pageUrl: "https://resy.com/cities/new-york-ny/venues/test-captcha?date=2026-05-14&seats=2&time=19%3A00",
  title: "",
  slots: [],
  matchingSlots: [],
  noAvailabilitySignals: [],
  blockerSignals: ["captcha"],
  bodySnippet: "",
  recommendation: "blocked_or_unknown",
};

const SAMPLE_RUN: ResyProbeRun = {
  runId: "resy-availability-probe-2026-05-04T02-00-00-000Z",
  createdAt: "2026-05-04T02:00:00.000Z",
  suitePath: "/tmp/benchmark/restaurant-resy-phase0.json",
  visible: false,
  results: [SAMPLE_LIVE_OK, SAMPLE_NO_MATCH, SAMPLE_BLOCKED],
  recommendedCase: SAMPLE_LIVE_OK,
  recommendedCases: [SAMPLE_LIVE_OK],
};

const TEST_FILES_PREFIX = "resy-availability-probe-2099-CLAUDE-TEST-";
const cleanupFiles = new Set<string>();

const writeTestProbe = async (suffix: string, run: unknown): Promise<string> => {
  const file = `${TEST_FILES_PREFIX}${suffix}.json`;
  await fs.mkdir(RUNS_DIR, { recursive: true });
  await fs.writeFile(path.join(RUNS_DIR, file), JSON.stringify(run, null, 2), "utf-8");
  cleanupFiles.add(file);
  return file;
};

beforeEach(() => {
  cleanupFiles.clear();
});

afterEach(async () => {
  for (const file of cleanupFiles) {
    await fs.unlink(path.join(RUNS_DIR, file)).catch(() => {});
  }
});

describe("parseResyProbeUrl", () => {
  it("extracts date / covers / time / slug from a real probe URL", () => {
    const out = parseResyProbeUrl(
      "https://resy.com/cities/new-york-ny/venues/charlie-bird?date=2026-05-08&seats=2&time=20%3A00",
    );
    expect(out.date).toBe("2026-05-08");
    expect(out.covers).toBe(2);
    expect(out.time).toBe("20:00");
    expect(out.resySlug).toBe("charlie-bird");
    expect(out.citySlug).toBe("new-york-ny");
  });

  it("returns nulls for malformed URLs", () => {
    const out = parseResyProbeUrl("not-a-url");
    expect(out.date).toBeNull();
    expect(out.covers).toBeNull();
    expect(out.time).toBeNull();
    expect(out.resySlug).toBeNull();
  });

  it("returns null fields for missing query params", () => {
    const out = parseResyProbeUrl("https://resy.com/cities/new-york-ny/venues/charlie-bird");
    expect(out.date).toBeNull();
    expect(out.covers).toBeNull();
    expect(out.time).toBeNull();
    expect(out.resySlug).toBe("charlie-bird");
  });
});

describe("countByRecommendation", () => {
  it("counts each bucket independently", () => {
    const out = countByRecommendation([SAMPLE_LIVE_OK, SAMPLE_NO_MATCH, SAMPLE_BLOCKED, SAMPLE_LIVE_OK]);
    expect(out.use_for_live_fill_test).toBe(2);
    expect(out.no_matching_slot).toBe(1);
    expect(out.blocked_or_unknown).toBe(1);
  });

  it("returns all-zero on empty input", () => {
    const out = countByRecommendation([]);
    expect(out.use_for_live_fill_test).toBe(0);
    expect(out.no_matching_slot).toBe(0);
    expect(out.blocked_or_unknown).toBe(0);
  });
});

describe("buildNextLiveCommand", () => {
  it("uses Windows-style backslash to match codex's runner stdout", () => {
    expect(buildNextLiveCommand("R-030")).toBe(
      "npx tsx scripts\\run-phase0-resy-benchmark.ts --case R-030 --live-openai --allow-failures",
    );
  });
});

describe("isExactVenueMatch", () => {
  it("matches when apiVenueSlug equals the URL slug case-insensitively", () => {
    expect(isExactVenueMatch(SAMPLE_LIVE_OK)).toBe(true);
  });

  it("returns false when apiVenueSlug is missing", () => {
    expect(isExactVenueMatch({ ...SAMPLE_LIVE_OK, apiVenueSlug: undefined })).toBe(false);
  });

  it("returns false when slugs differ", () => {
    expect(
      isExactVenueMatch({ ...SAMPLE_LIVE_OK, apiVenueSlug: "don-don" }),
    ).toBe(false);
  });
});

describe("explainRecommendation", () => {
  it("describes use_for_live_fill_test with slot count and window", () => {
    const out = explainRecommendation(SAMPLE_LIVE_OK);
    expect(out).toContain("matching slot");
    expect(out).toContain("60min");
    expect(out).toContain("20:00");
  });

  it("describes no_matching_slot pointing at no_availability_correct", () => {
    const out = explainRecommendation(SAMPLE_NO_MATCH);
    expect(out).toMatch(/no_availability_correct|zero slots/);
  });

  it("describes blocked_or_unknown using blockerSignals", () => {
    const out = explainRecommendation(SAMPLE_BLOCKED);
    expect(out).toContain("captcha");
  });
});

describe("loadResyProbeRun", () => {
  it("loads a valid probe run", async () => {
    const file = await writeTestProbe("VALID-001", SAMPLE_RUN);
    const out = await loadResyProbeRun(file);
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.runId).toBe(SAMPLE_RUN.runId);
    expect(out.results).toHaveLength(3);
    expect(out.recommendedCase?.caseId).toBe("R-030");
  });

  it("rejects filenames that don't match the probe pattern", async () => {
    expect(await loadResyProbeRun("not-a-probe.json")).toBeNull();
    expect(await loadResyProbeRun("../etc/passwd")).toBeNull();
    expect(await loadResyProbeRun("phase0-resy-2026-05-04.json")).toBeNull();
  });

  it("rejects shape mismatch (missing runId)", async () => {
    const file = await writeTestProbe("BAD-SHAPE", { results: [], notARun: true });
    expect(await loadResyProbeRun(file)).toBeNull();
  });

  it("rejects shape mismatch (results not an array)", async () => {
    const file = await writeTestProbe("BAD-RESULTS", { ...SAMPLE_RUN, results: "nope" });
    expect(await loadResyProbeRun(file)).toBeNull();
  });

  it("returns null on unparseable JSON instead of throwing", async () => {
    const file = `${TEST_FILES_PREFIX}MALFORMED.json`;
    await fs.mkdir(RUNS_DIR, { recursive: true });
    await fs.writeFile(path.join(RUNS_DIR, file), "{ malformed json", "utf-8");
    cleanupFiles.add(file);
    expect(await loadResyProbeRun(file)).toBeNull();
  });

  it("returns null for missing files", async () => {
    expect(
      await loadResyProbeRun(`${TEST_FILES_PREFIX}DOES-NOT-EXIST.json`),
    ).toBeNull();
  });
});

describe("listResyProbeRunSummaries", () => {
  it("returns probe-pattern files sorted newest-first by filename", async () => {
    await writeTestProbe("ORDER-A-001", { ...SAMPLE_RUN, createdAt: "2026-05-01T00:00:00.000Z" });
    await writeTestProbe("ORDER-B-002", { ...SAMPLE_RUN, createdAt: "2026-05-03T00:00:00.000Z" });
    await writeTestProbe("ORDER-C-003", { ...SAMPLE_RUN, createdAt: "2026-05-02T00:00:00.000Z" });

    const summaries = await listResyProbeRunSummaries();
    const testEntries = summaries.filter((s) =>
      s.file.startsWith(`${TEST_FILES_PREFIX}ORDER-`),
    );
    // Sort is by filename (which encodes ISO timestamp), so suffix C-003 sorts
    // newest of the three test entries even though createdAt would say B-002.
    expect(testEntries.map((s) => s.file)).toEqual([
      `${TEST_FILES_PREFIX}ORDER-C-003.json`,
      `${TEST_FILES_PREFIX}ORDER-B-002.json`,
      `${TEST_FILES_PREFIX}ORDER-A-001.json`,
    ]);
  });

  it("populates summary fields from full run JSON", async () => {
    const file = await writeTestProbe("SUMMARY-FIELDS", SAMPLE_RUN);
    const summaries = await listResyProbeRunSummaries();
    const entry = summaries.find((s) => s.file === file);
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.createdAt).toBe(SAMPLE_RUN.createdAt);
    expect(entry.total).toBe(3);
    expect(entry.liveOk).toBe(1);
    expect(entry.noMatchingSlot).toBe(1);
    expect(entry.blockedOrUnknown).toBe(1);
    expect(entry.recommendedCaseId).toBe("R-030");
  });

  it("falls back to nulls when a single file is unparseable rather than failing the whole list", async () => {
    await writeTestProbe("FALLBACK-OK", SAMPLE_RUN);
    const malformed = `${TEST_FILES_PREFIX}FALLBACK-MALFORMED.json`;
    await fs.writeFile(path.join(RUNS_DIR, malformed), "{ broken", "utf-8");
    cleanupFiles.add(malformed);

    const summaries = await listResyProbeRunSummaries();
    const malformedEntry = summaries.find((s) => s.file === malformed);
    const okEntry = summaries.find(
      (s) => s.file === `${TEST_FILES_PREFIX}FALLBACK-OK.json`,
    );

    expect(malformedEntry?.createdAt).toBeNull();
    expect(malformedEntry?.total).toBeNull();
    expect(okEntry?.createdAt).toBe(SAMPLE_RUN.createdAt);
  });

  it("respects the limit parameter (no more than `limit` total entries)", async () => {
    await writeTestProbe("LIMIT-1", SAMPLE_RUN);
    await writeTestProbe("LIMIT-2", SAMPLE_RUN);
    await writeTestProbe("LIMIT-3", SAMPLE_RUN);

    const summaries = await listResyProbeRunSummaries(1);
    expect(summaries.length).toBeLessThanOrEqual(1);
  });
});
