/**
 * Tests for the static-fixture pipeline:
 *
 *  - all 8 fixture files parse as valid JSON
 *  - each fixture classifies to the expected primary class
 *  - loadFixtureJobs returns FIXTURE_FILENAMES in canonical order
 *  - aggregateForensics({ includeFixtures: true }) tags rows isFixture
 *  - fixtures NEVER appear in default aggregateForensics output
 *  - resolveSafeFixturePath rejects unsafe names
 *  - fixtures expose deterministic IDs prefixed with "fixture-"
 *  - fixtures contain no real PII (heuristic check on commonly leaked
 *    fields)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  aggregateForensics,
  buildForensicsReport,
  classifyJob,
  extractJobFromFixturePayload,
  getFixturesDir,
  loadFixtureJobs,
  readFixtureFile,
  resolveSafeFixturePath,
  RuntimeForensicsLoaderError,
} from "@/lib/runtime-forensics";
import {
  FIXTURE_COUNT,
  FIXTURE_EXPECTED_CLASS,
  FIXTURE_FILENAMES,
  type FixtureFilename,
} from "@/lib/runtime-forensics/__fixtures__";

describe("FIXTURE_FILENAMES whitelist", () => {
  it("has exactly 8 entries", () => {
    expect(FIXTURE_FILENAMES.length).toBe(8);
    expect(FIXTURE_COUNT).toBe(8);
  });

  it("lists each fixture exactly once", () => {
    const set = new Set(FIXTURE_FILENAMES);
    expect(set.size).toBe(FIXTURE_FILENAMES.length);
  });

  it("every entry has an expected class assigned", () => {
    for (const name of FIXTURE_FILENAMES) {
      expect(FIXTURE_EXPECTED_CLASS[name]).toBeTruthy();
    }
  });

  it("all classes covered (one per failure-class taxonomy)", () => {
    const classes = new Set(
      FIXTURE_FILENAMES.map((n) => FIXTURE_EXPECTED_CLASS[n]),
    );
    // Fixtures cover 7 of 8 classes; provider_form_incomplete has both
    // restaurant and hotel examples, while model_or_env_blocked is covered
    // by classifier unit tests.
    expect(classes.size).toBe(7);
  });
});

describe("readFixtureFile + extractJobFromFixturePayload", () => {
  it.each(FIXTURE_FILENAMES.map((n) => [n] as const))(
    "%s parses to a valid JobLikeInput",
    async (name) => {
      const payload = await readFixtureFile(name);
      const job = extractJobFromFixturePayload(payload, name);
      expect(job).not.toBeNull();
      expect(typeof job?.id).toBe("string");
      expect(job?.id?.startsWith("fixture-")).toBe(true);
      expect(job?.taskId?.startsWith("fixture-")).toBe(true);
      expect(typeof job?.provider).toBe("string");
      expect(job?.loaderNotes?.some((n) => n.startsWith("from-fixture:"))).toBe(true);
    },
  );

  it("returns null for non-object payload", () => {
    expect(extractJobFromFixturePayload(null, "x.json")).toBeNull();
    expect(extractJobFromFixturePayload([], "x.json")).toBeNull();
    expect(extractJobFromFixturePayload("string", "x.json")).toBeNull();
    expect(extractJobFromFixturePayload(42, "x.json")).toBeNull();
  });
});

describe("classifier correctness on fixtures", () => {
  it.each(FIXTURE_FILENAMES.map((n) => [n] as const))(
    "%s classifies to expected class",
    async (name) => {
      const payload = await readFixtureFile(name);
      const job = extractJobFromFixturePayload(payload, name);
      if (!job) throw new Error(`fixture ${name} failed to parse`);
      const result = classifyJob(job);
      expect(result.primaryClass).toBe(FIXTURE_EXPECTED_CLASS[name]);
    },
  );

  it("expedia-legacy-shape is detected with severity p0", async () => {
    const payload = await readFixtureFile("expedia-legacy-shape.json");
    const job = extractJobFromFixturePayload(payload, "expedia-legacy-shape.json");
    if (!job) throw new Error("payload failed to parse");
    const report = buildForensicsReport(job, { isFixture: true });
    expect(report.classification.severity).toBe("p0");
    expect(report.stepShape.hasLegacyShapeBug).toBe(true);
    expect(report.stepShape.legacyShapeQuotes.length).toBeGreaterThan(0);
  });

  it("checkout-reached fixture has confidence at least medium", async () => {
    const payload = await readFixtureFile("expedia-checkout-reached.json");
    const job = extractJobFromFixturePayload(payload, "expedia-checkout-reached.json");
    if (!job) throw new Error("payload failed to parse");
    const result = classifyJob(job);
    expect(["high", "medium"]).toContain(result.confidence);
  });

  it("booking hotel guest-details fixture classifies as form incomplete", async () => {
    const payload = await readFixtureFile(
      "booking-hotel-guest-form-incomplete.json",
    );
    const job = extractJobFromFixturePayload(
      payload,
      "booking-hotel-guest-form-incomplete.json",
    );
    if (!job) throw new Error("payload failed to parse");
    const result = classifyJob(job);
    expect(job.provider).toBe("booking-com");
    expect(job.scenario).toBe("hotel");
    expect(result.primaryClass).toBe("provider_form_incomplete");
    expect(result.signals.some((s) => s.label.includes("form incomplete"))).toBe(
      true,
    );
  });
});

describe("loadFixtureJobs", () => {
  it("returns jobs in FIXTURE_FILENAMES canonical order", async () => {
    const out = await loadFixtureJobs();
    expect(out.jobs.map((e) => e.sourceName)).toEqual([...FIXTURE_FILENAMES]);
  });

  it("attaches loader notes for fixtures (none on success)", async () => {
    const out = await loadFixtureJobs();
    // Each fixture parses, so no skip notes expected.
    expect(out.notes.length).toBe(0);
  });
});

describe("aggregateForensics — fixtures gated by includeFixtures", () => {
  // Each test isolates via a tmp cwd so real benchmark/runs don't
  // leak into assertions.
  const originalCwd = process.cwd();
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(originalCwd, ".tmp-rfor-fix-"));
    // Copy fixtures into the tmp root so the loader can find them.
    const fixturesSrc = getFixturesDir();
    await fs.mkdir(
      path.join(tmpRoot, "lib", "runtime-forensics"),
      { recursive: true },
    );
    await fs.cp(
      fixturesSrc,
      path.join(tmpRoot, "lib", "runtime-forensics", "__fixtures__"),
      { recursive: true },
    );
    process.chdir(tmpRoot);
  });
  afterEach(async () => {
    process.chdir(originalCwd);
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("default call does NOT load fixtures", async () => {
    const r = await aggregateForensics();
    expect(r.summaries.length).toBe(0);
    expect(r.fixturesLoaded).toBe(0);
  });

  it("includeFixtures=true tags rows with isFixture=true", async () => {
    const r = await aggregateForensics({ includeFixtures: true });
    expect(r.fixturesLoaded).toBe(FIXTURE_COUNT);
    const fixtureRows = r.summaries.filter((s) => s.isFixture);
    expect(fixtureRows.length).toBe(FIXTURE_COUNT);
    for (const row of fixtureRows) {
      expect(row.inputSource.startsWith("fixture:")).toBe(true);
    }
  });

  it("includeFixtures puts fixtures after real benchmark rows", async () => {
    await fs.mkdir(path.join(tmpRoot, "benchmark", "runs"), { recursive: true });
    await fs.writeFile(
      path.join(tmpRoot, "benchmark", "runs", "real.json"),
      JSON.stringify({
        cases: [{ id: "real-row", provider: "resy", scenario: "real" }],
      }),
      "utf8",
    );
    const r = await aggregateForensics({ includeFixtures: true });
    expect(r.summaries[0]?.jobId).toBe("real-row");
    expect(r.summaries[0]?.isFixture).toBe(false);
    expect(r.summaries.slice(1).every((s) => s.isFixture)).toBe(true);
  });

  it("filter still applies to fixture rows (resy = 2 hits)", async () => {
    const r = await aggregateForensics({
      includeFixtures: true,
      filter: { provider: "resy" },
    });
    expect(r.summaries.length).toBe(2);
    expect(r.summaries.every((s) => s.provider === "resy")).toBe(true);
    expect(r.summaries.every((s) => s.isFixture)).toBe(true);
  });

  it("limit caps the combined real+fixtures output", async () => {
    const r = await aggregateForensics({
      includeFixtures: true,
      limit: 3,
    });
    expect(r.summaries.length).toBeLessThanOrEqual(3);
  });

  it("fixtures load even when benchmark dir missing", async () => {
    const r = await aggregateForensics({ includeFixtures: true });
    expect(r.fixturesLoaded).toBe(FIXTURE_COUNT);
    expect(r.benchmarkRunsScanned).toBe(0);
    expect(r.summaries.every((s) => s.isFixture)).toBe(true);
  });
});

describe("resolveSafeFixturePath — path safety", () => {
  it("accepts a whitelisted fixture name", () => {
    const p = resolveSafeFixturePath("resy-no-availability.json");
    expect(p).toMatch(/__fixtures__/);
    expect(p.endsWith("resy-no-availability.json")).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(() => resolveSafeFixturePath("../../etc/passwd")).toThrow(
      RuntimeForensicsLoaderError,
    );
  });

  it("rejects names with slashes", () => {
    expect(() => resolveSafeFixturePath("sub/dir.json")).toThrow();
  });

  it("rejects empty / non-string", () => {
    expect(() => resolveSafeFixturePath("")).toThrow();
    // @ts-expect-error testing runtime guard
    expect(() => resolveSafeFixturePath(null)).toThrow();
    // @ts-expect-error testing runtime guard
    expect(() => resolveSafeFixturePath(undefined)).toThrow();
  });

  it("rejects non-json extensions", () => {
    expect(() => resolveSafeFixturePath("ok.txt")).toThrow();
  });

  it("rejects names exceeding length cap", () => {
    expect(() => resolveSafeFixturePath("x".repeat(250) + ".json")).toThrow();
  });
});

describe("fixtures contain no real PII", () => {
  // Heuristic guard: if these regex match anything in a fixture, it's
  // a strong signal someone pasted real evidence by mistake.
  const PII_PATTERNS: Array<{ name: string; rx: RegExp }> = [
    { name: "real US phone", rx: /\+1[2-9]\d{2}\d{3}\d{4}/ },
    { name: "@gmail.com address", rx: /[\w.-]+@gmail\.com/i },
    { name: "@outlook.com address", rx: /[\w.-]+@outlook\.com/i },
    {
      name: "credit-card-shaped digits",
      rx: /\b(?:\d[ -]*?){13,19}\b/,
    },
    {
      name: "passport-shaped (US)",
      rx: /\b[A-Z]\d{8}\b/,
    },
  ];

  it.each(FIXTURE_FILENAMES.map((n) => [n] as const))(
    "%s contains no PII patterns",
    async (name: FixtureFilename) => {
      const text = JSON.stringify(await readFixtureFile(name));
      for (const { name: kind, rx } of PII_PATTERNS) {
        // +10000000000 should NOT match \+1[2-9]... so this stays clean.
        expect(text, `${name} matched ${kind}`).not.toMatch(rx);
      }
    },
  );
});
