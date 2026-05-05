// lib/__tests__/founder-e2e-runner.test.ts
//
// Phase 1.5 Autonomous Founder E2E runner — pure logic tests.
//
// These pin the contracts that scripts/run-founder-e2e.ts depends on:
//   - probe → QaRun conversion (buildAutoRunFromProbes)
//   - verdict semantics (deriveRunnerVerdict / exitCodeForVerdict)
//   - markdown / banner rendering
//   - screenshot path safety (buildScreenshotRelPath / isSafeRunnerAssetPath)
//   - baseUrl normalization
//   - schema extensions (source / runnerMeta / runnerVerdict / auto path)
//   - legacy v1 payload tolerance
//
// All pure — no fs, no network, no playwright.

import { describe, expect, it } from "vitest";

import {
  FOUNDER_E2E_EXIT_CRITERIA_AUTO,
  FOUNDER_E2E_KIND,
  FOUNDER_E2E_LEGACY_SCHEMA_VERSION,
  FOUNDER_E2E_PATHS,
  FOUNDER_E2E_SCHEMA_VERSION,
  RUNNER_VERDICT_LABEL,
  RUN_SOURCE_LABEL,
  buildAutoRunFromProbes,
  buildEmptyRun,
  buildScreenshotRelPath,
  deriveRunnerVerdict,
  exitCodeForVerdict,
  formatAutoRunMarkdown,
  formatRunnerBanner,
  getExitCriteriaForPath,
  getPathDef,
  isSafeRunnerAssetPath,
  listAllSteps,
  normalizeBaseUrl,
  parseQaRun,
  recomputeRun,
  summarizeRunForRunner,
  type ProbeResult,
  type QaRun,
  type RunnerMeta,
  type Severity,
} from "@/lib/founder-e2e";

const AUTO_PATH = FOUNDER_E2E_PATHS.auto;
const NOW = "2026-05-04T12:00:00.000Z";

function makeRunnerMeta(overrides: Partial<RunnerMeta> = {}): RunnerMeta {
  return {
    command: "npx tsx scripts/run-founder-e2e.ts --json",
    baseUrl: "http://localhost:3000",
    browser: "chromium 1.58.2",
    durationMs: 12345,
    nodeVersion: "v22.19.0",
    ...overrides,
  };
}

function passEverything(): ProbeResult[] {
  return listAllSteps(AUTO_PATH).map((s) => ({
    stepId: s.id,
    status: "pass",
    actual: "ok",
    url: "http://localhost:3000/",
  }));
}

// -----------------------------------------------------------------------------
// Auto path content sanity
// -----------------------------------------------------------------------------

describe("auto path fixtures", () => {
  it("auto path is exactly 15 steps", () => {
    expect(listAllSteps(AUTO_PATH).length).toBe(15);
  });

  it("auto path covers 5 sections", () => {
    expect(AUTO_PATH.sections.map((s) => s.id)).toEqual([
      "auto.health",
      "auto.self",
      "auto.render",
      "auto.api",
      "auto.security",
    ]);
  });

  it("getPathDef('auto') returns the registry entry", () => {
    expect(getPathDef("auto")).toBe(AUTO_PATH);
  });

  it("getExitCriteriaForPath('auto') returns 5 criteria", () => {
    const defs = getExitCriteriaForPath("auto");
    expect(defs.length).toBe(5);
  });

  it("auto exit criteria reference only real step ids", () => {
    const ids = new Set(listAllSteps(AUTO_PATH).map((s) => s.id));
    for (const def of FOUNDER_E2E_EXIT_CRITERIA_AUTO) {
      for (const id of def.requiresStepIds) {
        expect(ids.has(id)).toBe(true);
      }
    }
  });

  it("every auto step id starts with 'auto:'", () => {
    for (const step of listAllSteps(AUTO_PATH)) {
      expect(step.id.startsWith("auto:")).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// buildAutoRunFromProbes — pure conversion
// -----------------------------------------------------------------------------

describe("buildAutoRunFromProbes", () => {
  it("empty probes yields all-pending automated run", () => {
    const run = buildAutoRunFromProbes({
      probes: [],
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    expect(run.source).toBe("automated");
    expect(run.pathId).toBe("auto");
    expect(run.summary.pending).toBe(15);
    expect(run.summary.pass).toBe(0);
    expect(run.runnerVerdict).toBeUndefined();
  });

  it("all-pass probes yield verdict pass + exit 0", () => {
    const run = buildAutoRunFromProbes({
      probes: passEverything(),
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    expect(run.summary.pass).toBe(15);
    expect(run.runnerVerdict).toBe("pass");
    expect(exitCodeForVerdict(run.runnerVerdict)).toBe(0);
  });

  it("any P0 fail yields verdict fail + exit 1", () => {
    const probes: ProbeResult[] = passEverything();
    const target = probes.find((p) => p.stepId === "auto:health:1");
    expect(target).toBeDefined();
    if (target) {
      target.status = "fail";
      target.actual = "server unreachable";
    }
    const run = buildAutoRunFromProbes({
      probes,
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    expect(run.runnerVerdict).toBe("fail");
    expect(exitCodeForVerdict(run.runnerVerdict)).toBe(1);
    expect(run.exit.p0Count).toBeGreaterThanOrEqual(1);
  });

  it("only P1 fails yields verdict needs_polish + exit 0", () => {
    const probes: ProbeResult[] = passEverything();
    const target = probes.find((p) => p.stepId === "auto:render:path-b-demo");
    expect(target).toBeDefined();
    if (target) {
      target.status = "fail";
      target.actual = "missing copy";
    }
    const run = buildAutoRunFromProbes({
      probes,
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    expect(run.runnerVerdict).toBe("needs_polish");
    expect(exitCodeForVerdict(run.runnerVerdict)).toBe(0);
    expect(run.exit.p0Count).toBe(0);
  });

  it("unknown probe step ids are dropped silently", () => {
    const probes: ProbeResult[] = [
      { stepId: "ghost:1", status: "fail", actual: "should be ignored" },
      { stepId: "auto:health:1", status: "pass", actual: "ok" },
    ];
    const run = buildAutoRunFromProbes({
      probes,
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    expect(run.results["ghost:1"]).toBeUndefined();
    expect(run.results["auto:health:1"].status).toBe("pass");
  });

  it("preserves screenshot, url, notes, severity override on probes", () => {
    const probes: ProbeResult[] = [
      {
        stepId: "auto:render:tasks-executing",
        status: "fail",
        actual: "missing copy",
        url: "http://localhost:3000/tasks/demo-executing",
        screenshotPath: "founder-e2e-assets/founder-e2e-XYZ/auto-render-tasks-executing.png",
        notes: "console errors: blah",
        severity: "P0",
      },
    ];
    const run = buildAutoRunFromProbes({
      probes,
      runnerMeta: makeRunnerMeta(),
      runId: "founder-e2e-XYZ",
      now: () => NOW,
    });
    const r = run.results["auto:render:tasks-executing"];
    expect(r.url).toContain("/tasks/demo-executing");
    expect(r.screenshotPath).toContain("founder-e2e-XYZ");
    expect(r.severity).toBe("P0");
    expect(r.notes).toContain("console errors");
  });

  it("attaches runnerMeta to the resulting run", () => {
    const meta = makeRunnerMeta({ label: "ci-pr-42" });
    const run = buildAutoRunFromProbes({
      probes: passEverything(),
      runnerMeta: meta,
      now: () => NOW,
    });
    expect(run.runnerMeta?.label).toBe("ci-pr-42");
    expect(run.runnerMeta?.command).toBe(meta.command);
    expect(run.runnerMeta?.baseUrl).toBe(meta.baseUrl);
  });

  it("uses the passed runId verbatim when provided", () => {
    const run = buildAutoRunFromProbes({
      probes: [],
      runnerMeta: makeRunnerMeta(),
      runId: "founder-e2e-FIXED",
      now: () => NOW,
    });
    expect(run.id).toBe("founder-e2e-FIXED");
  });

  it("autogenerates a runId when none provided", () => {
    const run = buildAutoRunFromProbes({
      probes: [],
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    expect(run.id.startsWith("founder-e2e-")).toBe(true);
  });

  it("startedAt and updatedAt mirror the now() supplier", () => {
    const run = buildAutoRunFromProbes({
      probes: [],
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    expect(run.startedAt).toBe(NOW);
    expect(run.updatedAt).toBe(NOW);
  });
});

// -----------------------------------------------------------------------------
// deriveRunnerVerdict — pure
// -----------------------------------------------------------------------------

describe("deriveRunnerVerdict", () => {
  it("returns undefined for manual runs", () => {
    const run = buildEmptyRun(AUTO_PATH, getExitCriteriaForPath("auto"));
    // buildEmptyRun defaults source to "manual" unless overridden.
    expect(run.source).toBe("manual");
    expect(
      deriveRunnerVerdict({
        summary: run.summary,
        exit: run.exit,
        run,
        pathDef: AUTO_PATH,
      }),
    ).toBeUndefined();
  });

  it("returns undefined for fresh automated run with all pending (indeterminate)", () => {
    const run = buildEmptyRun(AUTO_PATH, getExitCriteriaForPath("auto"), {
      source: "automated",
      runnerMeta: makeRunnerMeta(),
    });
    const verdict = deriveRunnerVerdict({
      summary: run.summary,
      exit: run.exit,
      run,
      pathDef: AUTO_PATH,
    });
    expect(verdict).toBeUndefined();
  });

  it("returns needs_polish when at least one step has been touched but pendings remain", () => {
    const probes: ProbeResult[] = [
      { stepId: "auto:health:1", status: "pass", actual: "ok" },
    ];
    const run = buildAutoRunFromProbes({
      probes,
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    expect(run.runnerVerdict).toBe("needs_polish");
  });

  it("returns pass when zero failing/pending/skipped", () => {
    const run = buildAutoRunFromProbes({
      probes: passEverything(),
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    expect(run.runnerVerdict).toBe("pass");
  });

  it("returns fail when any P0 outstanding", () => {
    const probes: ProbeResult[] = passEverything();
    const target = probes.find((p) => p.stepId === "auto:security:payment-guard");
    if (target) target.status = "fail";
    const run = buildAutoRunFromProbes({
      probes,
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    expect(run.runnerVerdict).toBe("fail");
  });

  it("returns needs_polish when only P1 fails", () => {
    const probes: ProbeResult[] = passEverything();
    const target = probes.find((p) => p.stepId === "auto:render:path-b-demo");
    if (target) target.status = "fail";
    const run = buildAutoRunFromProbes({
      probes,
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    expect(run.runnerVerdict).toBe("needs_polish");
  });

  it("returns needs_polish when skipped rows exist with no P0", () => {
    const probes: ProbeResult[] = passEverything();
    const target = probes.find((p) => p.stepId === "auto:render:tasks-failed");
    if (target) target.status = "skipped";
    const run = buildAutoRunFromProbes({
      probes,
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    expect(run.runnerVerdict).toBe("needs_polish");
  });
});

// -----------------------------------------------------------------------------
// exitCodeForVerdict
// -----------------------------------------------------------------------------

describe("exitCodeForVerdict", () => {
  it("pass → 0", () => {
    expect(exitCodeForVerdict("pass")).toBe(0);
  });
  it("needs_polish → 0", () => {
    expect(exitCodeForVerdict("needs_polish")).toBe(0);
  });
  it("fail → 1", () => {
    expect(exitCodeForVerdict("fail")).toBe(1);
  });
  it("undefined → 0 (manual / not yet computed)", () => {
    expect(exitCodeForVerdict(undefined)).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// summarizeRunForRunner
// -----------------------------------------------------------------------------

describe("summarizeRunForRunner", () => {
  it("collects failingStepIds and propagates duration", () => {
    const probes: ProbeResult[] = passEverything();
    const target = probes.find((p) => p.stepId === "auto:api:traversal");
    if (target) {
      target.status = "fail";
      target.actual = "200 returned — bad";
    }
    const run = buildAutoRunFromProbes({
      probes,
      runnerMeta: makeRunnerMeta({ durationMs: 9999 }),
      now: () => NOW,
    });
    const view = summarizeRunForRunner(run);
    expect(view.failingStepIds).toContain("auto:api:traversal");
    expect(view.durationMs).toBe(9999);
    expect(view.exitCode).toBe(1); // P0 default for traversal
  });

  it("zero failures → empty failing array", () => {
    const run = buildAutoRunFromProbes({
      probes: passEverything(),
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    const view = summarizeRunForRunner(run);
    expect(view.failingStepIds).toEqual([]);
    expect(view.exitCode).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// formatRunnerBanner / formatAutoRunMarkdown
// -----------------------------------------------------------------------------

describe("formatRunnerBanner", () => {
  it("renders pass tone when verdict pass", () => {
    const run = buildAutoRunFromProbes({
      probes: passEverything(),
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    const banner = formatRunnerBanner(summarizeRunForRunner(run));
    expect(banner).toContain("PASS");
    expect(banner).toContain("pass=15");
  });

  it("includes failingStepIds list when failures exist", () => {
    const probes: ProbeResult[] = passEverything();
    const target = probes.find((p) => p.stepId === "auto:health:1");
    if (target) target.status = "fail";
    const run = buildAutoRunFromProbes({
      probes,
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    const banner = formatRunnerBanner(summarizeRunForRunner(run));
    expect(banner).toContain("FAIL");
    expect(banner).toContain("auto:health:1");
  });

  it("falls back to INDETERMINATE when verdict undefined", () => {
    const view = {
      verdict: undefined,
      exitCode: 0,
      pass: 0,
      fail: 0,
      blocker: 0,
      skipped: 0,
      pending: 0,
      total: 0,
      p0: 0,
      p1: 0,
      failingStepIds: [],
    };
    expect(formatRunnerBanner(view)).toContain("INDETERMINATE");
  });
});

describe("formatAutoRunMarkdown", () => {
  it("emits Founder QA report header and auto path label", () => {
    const run = buildAutoRunFromProbes({
      probes: passEverything(),
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    const md = formatAutoRunMarkdown(run);
    expect(md).toContain("Founder QA report");
    expect(md).toContain("Automated runner");
  });

  it("includes failing step bug-report blocks when fails exist", () => {
    const probes: ProbeResult[] = passEverything();
    const target = probes.find((p) => p.stepId === "auto:security:payment-guard");
    if (target) {
      target.status = "fail";
      target.actual = "200 returned by /profile PATCH";
    }
    const run = buildAutoRunFromProbes({
      probes,
      runnerMeta: makeRunnerMeta(),
      now: () => NOW,
    });
    const md = formatAutoRunMarkdown(run);
    expect(md).toContain("Failing steps");
    expect(md).toContain("payment");
  });
});

// -----------------------------------------------------------------------------
// buildScreenshotRelPath / isSafeRunnerAssetPath
// -----------------------------------------------------------------------------

describe("buildScreenshotRelPath", () => {
  it("accepts well-formed runId + filename", () => {
    const out = buildScreenshotRelPath("founder-e2e-2026-05-04T01-02-03-000Z", "auto-self-1.png");
    expect(out).toBe("founder-e2e-assets/founder-e2e-2026-05-04T01-02-03-000Z/auto-self-1.png");
  });

  it("rejects invalid runId", () => {
    expect(buildScreenshotRelPath("../escape", "ok.png")).toBeUndefined();
    expect(buildScreenshotRelPath("badprefix-2026", "ok.png")).toBeUndefined();
  });

  it("rejects invalid filename extension", () => {
    expect(buildScreenshotRelPath("founder-e2e-x", "config.toml")).toBeUndefined();
    expect(buildScreenshotRelPath("founder-e2e-x", "ok.exe")).toBeUndefined();
  });

  it("rejects traversal in filename", () => {
    expect(buildScreenshotRelPath("founder-e2e-x", "../etc.png")).toBeUndefined();
  });

  it("accepts jpeg / jpg variants", () => {
    expect(buildScreenshotRelPath("founder-e2e-x", "shot.jpeg")).toBeDefined();
    expect(buildScreenshotRelPath("founder-e2e-x", "shot.jpg")).toBeDefined();
  });
});

describe("isSafeRunnerAssetPath", () => {
  it("accepts canonical 3-segment path", () => {
    expect(isSafeRunnerAssetPath("founder-e2e-assets/founder-e2e-X/file.png")).toBe(true);
  });

  it("rejects wrong prefix", () => {
    expect(isSafeRunnerAssetPath("benchmark/runs/file.png")).toBe(false);
  });

  it("rejects backslash separators (Windows path leakage)", () => {
    expect(isSafeRunnerAssetPath("founder-e2e-assets\\runId\\file.png")).toBe(false);
  });

  it("rejects more or fewer segments", () => {
    expect(isSafeRunnerAssetPath("founder-e2e-assets/runId/sub/file.png")).toBe(false);
    expect(isSafeRunnerAssetPath("founder-e2e-assets/file.png")).toBe(false);
  });

  it("rejects non-string", () => {
    expect(isSafeRunnerAssetPath(undefined)).toBe(false);
    expect(isSafeRunnerAssetPath(42)).toBe(false);
    expect(isSafeRunnerAssetPath(null)).toBe(false);
  });

  it("rejects traversal in middle segment", () => {
    expect(isSafeRunnerAssetPath("founder-e2e-assets/../escape.png")).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// normalizeBaseUrl
// -----------------------------------------------------------------------------

describe("normalizeBaseUrl", () => {
  it("accepts http://", () => {
    expect(normalizeBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("accepts https://", () => {
    expect(normalizeBaseUrl("https://example.com")).toBe("https://example.com");
  });

  it("strips trailing slashes", () => {
    expect(normalizeBaseUrl("http://localhost:3000///")).toBe("http://localhost:3000");
  });

  it("rejects file:// → fallback", () => {
    expect(normalizeBaseUrl("file:///etc/passwd")).toBe("http://localhost:3000");
  });

  it("rejects bare hostname → fallback", () => {
    expect(normalizeBaseUrl("localhost:3000")).toBe("http://localhost:3000");
  });

  it("undefined → fallback", () => {
    expect(normalizeBaseUrl(undefined)).toBe("http://localhost:3000");
  });

  it("empty string → fallback", () => {
    expect(normalizeBaseUrl("")).toBe("http://localhost:3000");
  });
});

// -----------------------------------------------------------------------------
// Schema extensions: source / runnerMeta / runnerVerdict / auto pathId
// -----------------------------------------------------------------------------

describe("parseQaRun — schema v2 fields", () => {
  function basePayload(): Record<string, unknown> {
    return {
      schemaVersion: FOUNDER_E2E_SCHEMA_VERSION,
      kind: FOUNDER_E2E_KIND,
      id: "founder-e2e-test",
      pathId: "auto",
      startedAt: "2026-05-04T00:00:00.000Z",
      updatedAt: "2026-05-04T00:00:00.000Z",
      results: {},
      summary: { pass: 0, fail: 0, blocker: 0, skipped: 0, pending: 15, total: 15, failing: 0 },
      exit: {
        meetsBar: false,
        satisfiedCount: 0,
        requiredCount: 4,
        p0Count: 0,
        p1Count: 0,
        reasonShortBy: [],
        criteria: [],
      },
    };
  }

  it("accepts source = automated", () => {
    const parsed = parseQaRun({ ...basePayload(), source: "automated" });
    expect(parsed.source).toBe("automated");
  });

  it("accepts source = manual", () => {
    const parsed = parseQaRun({ ...basePayload(), source: "manual" });
    expect(parsed.source).toBe("manual");
  });

  it("defaults source to manual when absent", () => {
    const parsed = parseQaRun(basePayload());
    expect(parsed.source).toBe("manual");
  });

  it("ignores invalid source value (defaults to manual)", () => {
    const parsed = parseQaRun({ ...basePayload(), source: "robot-overlord" });
    expect(parsed.source).toBe("manual");
  });

  it("preserves runnerMeta when valid", () => {
    const parsed = parseQaRun({
      ...basePayload(),
      source: "automated",
      runnerMeta: {
        command: "tsx run.ts",
        baseUrl: "http://localhost:3000",
        browser: "chromium 1.58.2",
        durationMs: 1234,
        nodeVersion: "v22.19.0",
      },
    });
    expect(parsed.runnerMeta?.browser).toBe("chromium 1.58.2");
    expect(parsed.runnerMeta?.durationMs).toBe(1234);
  });

  it("drops runnerMeta when required fields missing", () => {
    const parsed = parseQaRun({
      ...basePayload(),
      source: "automated",
      runnerMeta: { browser: "chromium" }, // missing command + baseUrl
    });
    expect(parsed.runnerMeta).toBeUndefined();
  });

  it("preserves valid runnerVerdict", () => {
    const parsed = parseQaRun({ ...basePayload(), runnerVerdict: "needs_polish" });
    expect(parsed.runnerVerdict).toBe("needs_polish");
  });

  it("drops invalid runnerVerdict", () => {
    const parsed = parseQaRun({ ...basePayload(), runnerVerdict: "rejected" });
    expect(parsed.runnerVerdict).toBeUndefined();
  });

  it("accepts pathId = auto", () => {
    const parsed = parseQaRun({ ...basePayload(), pathId: "auto" });
    expect(parsed.pathId).toBe("auto");
  });

  it("rejects unknown pathId", () => {
    expect(() => parseQaRun({ ...basePayload(), pathId: "weekly" })).toThrow(/pathId/);
  });

  it("accepts legacy schemaVersion = 1 payloads", () => {
    const parsed = parseQaRun({
      ...basePayload(),
      schemaVersion: FOUNDER_E2E_LEGACY_SCHEMA_VERSION,
      pathId: "quick",
    });
    expect(parsed.pathId).toBe("quick");
    expect(parsed.source).toBe("manual");
  });

  it("rejects unknown schemaVersion", () => {
    expect(() =>
      parseQaRun({ ...basePayload(), schemaVersion: 99 }),
    ).toThrow(/schemaVersion/);
  });
});

// -----------------------------------------------------------------------------
// Recompute / build options interplay
// -----------------------------------------------------------------------------

describe("recomputeRun + automated", () => {
  it("stamps schemaVersion to current on legacy v1 input", () => {
    const legacy: QaRun = {
      schemaVersion: FOUNDER_E2E_LEGACY_SCHEMA_VERSION as 1 as typeof FOUNDER_E2E_SCHEMA_VERSION,
      kind: FOUNDER_E2E_KIND,
      id: "founder-e2e-legacy",
      pathId: "quick",
      startedAt: NOW,
      updatedAt: NOW,
      source: "manual",
      results: {},
      summary: {
        pass: 0,
        fail: 0,
        blocker: 0,
        skipped: 0,
        pending: 0,
        total: 0,
        failing: 0,
      },
      exit: {
        meetsBar: false,
        satisfiedCount: 0,
        requiredCount: 0,
        p0Count: 0,
        p1Count: 0,
        reasonShortBy: [],
        criteria: [],
      },
    };
    const recomputed = recomputeRun(
      FOUNDER_E2E_PATHS.quick,
      legacy,
      getExitCriteriaForPath("quick"),
    );
    expect(recomputed.schemaVersion).toBe(FOUNDER_E2E_SCHEMA_VERSION);
    expect(recomputed.source).toBe("manual");
  });
});

describe("buildEmptyRun source / runnerMeta", () => {
  it("defaults source to manual when not specified", () => {
    const run = buildEmptyRun(AUTO_PATH, getExitCriteriaForPath("auto"));
    expect(run.source).toBe("manual");
  });

  it("accepts source = automated + propagates runnerMeta", () => {
    const meta = makeRunnerMeta();
    const run = buildEmptyRun(AUTO_PATH, getExitCriteriaForPath("auto"), {
      source: "automated",
      runnerMeta: meta,
    });
    expect(run.source).toBe("automated");
    expect(run.runnerMeta?.command).toBe(meta.command);
  });
});

// -----------------------------------------------------------------------------
// Display constants
// -----------------------------------------------------------------------------

describe("RUN_SOURCE_LABEL / RUNNER_VERDICT_LABEL", () => {
  it("source labels exist for both", () => {
    expect(RUN_SOURCE_LABEL.manual).toBe("Manual");
    expect(RUN_SOURCE_LABEL.automated).toBe("Automated");
  });

  it("verdict labels exist for all three", () => {
    expect(RUNNER_VERDICT_LABEL.pass).toBe("PASS");
    expect(RUNNER_VERDICT_LABEL.needs_polish).toBe("NEEDS_POLISH");
    expect(RUNNER_VERDICT_LABEL.fail).toBe("FAIL");
  });
});

describe("Severity sanity in auto fixtures", () => {
  it("payment-guard, traversal, unauthorized-task, self, awaiting-profile default P0", () => {
    const ids: ReadonlyArray<string> = [
      "auto:security:payment-guard",
      "auto:api:traversal",
      "auto:security:unauthorized-task",
      "auto:self:1",
      "auto:render:tasks-awaiting-profile",
      "auto:health:1",
    ];
    for (const id of ids) {
      const step = listAllSteps(AUTO_PATH).find((s) => s.id === id);
      expect(step?.severityOnFail).toBe<Severity>("P0");
    }
  });

  it("render task pages default P1 except awaiting-profile (P0) and failed (P2)", () => {
    const p1Ids = [
      "auto:render:path-b-demo",
      "auto:render:tasks-executing",
      "auto:render:tasks-ready",
      "auto:render:benchmark-runs",
      "auto:render:profile-gap-flow",
    ];
    for (const id of p1Ids) {
      const step = listAllSteps(AUTO_PATH).find((s) => s.id === id);
      expect(step?.severityOnFail).toBe<Severity>("P1");
    }
    const failed = listAllSteps(AUTO_PATH).find((s) => s.id === "auto:render:tasks-failed");
    expect(failed?.severityOnFail).toBe<Severity>("P2");
  });
});
