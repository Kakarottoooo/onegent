// lib/__tests__/founder-e2e.test.ts
//
// Phase 1.5 Founder QA Suite — pure logic + fs integration tests.
// Target: 40+ vitest cases covering checklist schema, severity logic,
// exit criteria, parse + format helpers, fs loader.
//
// All tests are pure (no real network, no provider, no live token).
// fs integration uses a temporary cwd so we never write into the real
// benchmark/runs/ directory.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FOUNDER_E2E_KIND,
  FOUNDER_E2E_SCHEMA_VERSION,
  FOUNDER_E2E_PATHS,
  FOUNDER_E2E_EXIT_CRITERIA_FULL,
  FOUNDER_E2E_EXIT_CRITERIA_QUICK,
  FounderE2eParseError,
  PATH_LABEL,
  SEVERITY_GUIDANCE,
  SEVERITY_LABEL,
  STEP_STATUS_LABEL,
  buildEmptyRun,
  countFailuresBySeverity,
  decideExit,
  fileNameForRun,
  findStep,
  formatRunAsBugReport,
  formatStepAsBugReport,
  getExitCriteriaForPath,
  getPathDef,
  isFailingStatus,
  isSafeFounderRunFileName,
  listAllSteps,
  listFounderE2eRunSummaries,
  maxSeverity,
  normalizeResults,
  parseQaRun,
  readFounderE2eRunByFile,
  recomputeRun,
  resolveSafePath,
  sanitizeResult,
  saveFounderE2eRun,
  summarizeResults,
  type ChecklistPath,
  type QaRun,
  type Severity,
  type StepResult,
} from "@/lib/founder-e2e";

const QUICK = FOUNDER_E2E_PATHS.quick;
const FULL = FOUNDER_E2E_PATHS.full;

// -----------------------------------------------------------------------------
// Severity helpers
// -----------------------------------------------------------------------------

describe("maxSeverity", () => {
  it("returns undefined on empty input", () => {
    expect(maxSeverity([])).toBeUndefined();
  });

  it("returns the only entry when single", () => {
    expect(maxSeverity(["P2"])).toBe("P2");
  });

  it("returns the worst severity from a mixed list", () => {
    expect(maxSeverity(["P2", "P0", "P3"])).toBe("P0");
    expect(maxSeverity(["P3", "P1", "P2"])).toBe("P1");
  });
});

describe("isFailingStatus", () => {
  it("treats fail and blocker as failing", () => {
    expect(isFailingStatus("fail")).toBe(true);
    expect(isFailingStatus("blocker")).toBe(true);
  });

  it("treats pass / pending / skipped as not failing", () => {
    expect(isFailingStatus("pass")).toBe(false);
    expect(isFailingStatus("pending")).toBe(false);
    expect(isFailingStatus("skipped")).toBe(false);
  });
});

describe("display constants", () => {
  it("provides labels for every severity", () => {
    for (const sev of ["P0", "P1", "P2", "P3"] as Severity[]) {
      expect(SEVERITY_LABEL[sev]).toBeTruthy();
      expect(SEVERITY_GUIDANCE[sev]).toBeTruthy();
    }
  });

  it("provides labels for every step status", () => {
    expect(STEP_STATUS_LABEL.pending).toBe("Pending");
    expect(STEP_STATUS_LABEL.pass).toBe("Pass");
    expect(STEP_STATUS_LABEL.fail).toBe("Fail");
    expect(STEP_STATUS_LABEL.blocker).toBe("Blocker");
    expect(STEP_STATUS_LABEL.skipped).toBe("Skipped");
  });

  it("provides path labels", () => {
    expect(PATH_LABEL.quick).toMatch(/Quick/);
    expect(PATH_LABEL.full).toMatch(/Full/);
  });
});

// -----------------------------------------------------------------------------
// Path traversal
// -----------------------------------------------------------------------------

describe("listAllSteps", () => {
  it("walks every section of the quick path", () => {
    const steps = listAllSteps(QUICK);
    expect(steps.length).toBe(6); // A.1..A.6
  });

  it("walks every section of the full path", () => {
    const steps = listAllSteps(FULL);
    // 4 (preflight) + 1 (landing) + 6 (demo) + 5 (real) + 4 (PATCH) + 2 (benchmark) + 2 (gap-flow) + 3 (DR) = 27
    expect(steps.length).toBe(27);
  });
});

describe("findStep", () => {
  it("finds a known step by id", () => {
    const step = findStep(QUICK, "quick:A.3:1");
    expect(step).toBeDefined();
    expect(step?.title).toMatch(/Real task/);
  });

  it("returns undefined for unknown ids", () => {
    expect(findStep(QUICK, "nope")).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// normalizeResults / sanitizeResult
// -----------------------------------------------------------------------------

describe("normalizeResults", () => {
  it("seeds every step with pending when given empty results", () => {
    const out = normalizeResults(QUICK, {});
    const ids = Object.keys(out);
    expect(ids).toHaveLength(6);
    for (const id of ids) {
      expect(out[id].status).toBe("pending");
    }
  });

  it("preserves provided statuses for known steps", () => {
    const out = normalizeResults(QUICK, {
      "quick:A.1:1": { stepId: "quick:A.1:1", status: "pass" },
    });
    expect(out["quick:A.1:1"].status).toBe("pass");
    expect(out["quick:A.2:1"].status).toBe("pending");
  });

  it("ignores unknown step ids in input", () => {
    const out = normalizeResults(QUICK, {
      "quick:A.1:1": { stepId: "quick:A.1:1", status: "pass" },
      "ghost:1": { stepId: "ghost:1", status: "fail" },
    });
    expect(Object.keys(out)).toHaveLength(6);
    expect(out["ghost:1"]).toBeUndefined();
  });
});

describe("sanitizeResult", () => {
  it("strips severity from passing rows", () => {
    const step = findStep(QUICK, "quick:A.1:1");
    expect(step).toBeDefined();
    if (!step) return;
    const out = sanitizeResult(step, {
      stepId: step.id,
      status: "pass",
      severity: "P0",
    });
    expect(out.severity).toBeUndefined();
  });

  it("defaults severity to step.severityOnFail for fail rows", () => {
    const step = findStep(QUICK, "quick:A.1:1");
    expect(step).toBeDefined();
    if (!step) return;
    const out = sanitizeResult(step, { stepId: step.id, status: "fail" });
    expect(out.severity).toBe(step.severityOnFail);
  });

  it("defaults severity to P0 for blocker rows when no override exists", () => {
    const step = findStep(QUICK, "quick:A.6:1");
    expect(step).toBeDefined();
    if (!step) return;
    const out = sanitizeResult(step, { stepId: step.id, status: "blocker" });
    expect(out.severity).toBe("P0");
  });

  it("preserves founder severity override on fail", () => {
    const step = findStep(FULL, "full:2.5:1"); // demo-failed, default P2
    expect(step).toBeDefined();
    if (!step) return;
    const out = sanitizeResult(step, {
      stepId: step.id,
      status: "fail",
      severity: "P0",
    });
    expect(out.severity).toBe("P0");
  });
});

// -----------------------------------------------------------------------------
// summarizeResults / severity counts
// -----------------------------------------------------------------------------

describe("summarizeResults", () => {
  it("counts all pending for empty results", () => {
    const summary = summarizeResults(QUICK, normalizeResults(QUICK, {}));
    expect(summary.pending).toBe(6);
    expect(summary.pass).toBe(0);
    expect(summary.failing).toBe(0);
  });

  it("counts mixed statuses correctly", () => {
    const results = normalizeResults(QUICK, {
      "quick:A.1:1": { stepId: "quick:A.1:1", status: "pass" },
      "quick:A.2:1": { stepId: "quick:A.2:1", status: "pass" },
      "quick:A.3:1": { stepId: "quick:A.3:1", status: "fail" },
      "quick:A.4:1": { stepId: "quick:A.4:1", status: "blocker" },
      "quick:A.5:1": { stepId: "quick:A.5:1", status: "skipped" },
    });
    const summary = summarizeResults(QUICK, results);
    expect(summary.pass).toBe(2);
    expect(summary.fail).toBe(1);
    expect(summary.blocker).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.total).toBe(6);
    expect(summary.failing).toBe(2);
  });

  it("handles unsanitized input gracefully", () => {
    const summary = summarizeResults(FULL, {});
    expect(summary.pending).toBe(listAllSteps(FULL).length);
  });
});

describe("countFailuresBySeverity", () => {
  it("returns zeros when no failures", () => {
    const counts = countFailuresBySeverity(QUICK, {});
    expect(counts).toEqual({ P0: 0, P1: 0, P2: 0, P3: 0 });
  });

  it("buckets failures by severity using step defaults", () => {
    const results = normalizeResults(QUICK, {
      "quick:A.1:1": { stepId: "quick:A.1:1", status: "fail" }, // P0
      "quick:A.2:1": { stepId: "quick:A.2:1", status: "fail" }, // P0
    });
    const counts = countFailuresBySeverity(QUICK, results);
    expect(counts.P0).toBe(2);
    expect(counts.P1).toBe(0);
  });

  it("respects severity override", () => {
    const results = normalizeResults(FULL, {
      "full:2.5:1": {
        stepId: "full:2.5:1",
        status: "fail",
        severity: "P0",
      }, // default would be P2
    });
    const counts = countFailuresBySeverity(FULL, results);
    expect(counts.P0).toBe(1);
    expect(counts.P2).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// decideExit
// -----------------------------------------------------------------------------

describe("decideExit", () => {
  it("does not meet bar when no steps are passing", () => {
    const verdict = decideExit(QUICK, {}, FOUNDER_E2E_EXIT_CRITERIA_QUICK);
    expect(verdict.meetsBar).toBe(false);
    expect(verdict.satisfiedCount).toBe(0);
  });

  it("meets bar when all required steps pass", () => {
    const allPass = normalizeResults(
      FULL,
      Object.fromEntries(
        listAllSteps(FULL).map((s) => [s.id, { stepId: s.id, status: "pass" }]),
      ),
    );
    const verdict = decideExit(FULL, allPass, FOUNDER_E2E_EXIT_CRITERIA_FULL);
    expect(verdict.meetsBar).toBe(true);
    expect(verdict.p0Count).toBe(0);
  });

  it("does not meet bar when any P0 outstanding", () => {
    const results = normalizeResults(
      FULL,
      Object.fromEntries([
        ...listAllSteps(FULL).map((s) => [s.id, { stepId: s.id, status: "pass" }]),
        ["full:2.4:1", { stepId: "full:2.4:1", status: "fail" }],
      ]),
    );
    const verdict = decideExit(FULL, results, FOUNDER_E2E_EXIT_CRITERIA_FULL);
    expect(verdict.meetsBar).toBe(false);
    expect(verdict.p0Count).toBeGreaterThanOrEqual(1);
  });

  it("flags too many P1 failures", () => {
    // mark four P1-default steps as fail
    const targets = ["full:5:1", "full:6:1", "full:6:2", "full:7.1:1"];
    const results = normalizeResults(
      FULL,
      Object.fromEntries(
        targets.map((id) => [id, { stepId: id, status: "fail" }]),
      ),
    );
    const verdict = decideExit(FULL, results, FOUNDER_E2E_EXIT_CRITERIA_FULL);
    expect(verdict.p1Count).toBeGreaterThan(3);
    expect(verdict.meetsBar).toBe(false);
    expect(
      verdict.reasonShortBy.some((r) => r.includes("P1")),
    ).toBe(true);
  });

  it("partial pass — reports gaps in reasonShortBy", () => {
    const results = normalizeResults(
      FULL,
      Object.fromEntries(
        listAllSteps(FULL).slice(0, 4).map((s) => [s.id, { stepId: s.id, status: "pass" }]),
      ),
    );
    const verdict = decideExit(FULL, results, FOUNDER_E2E_EXIT_CRITERIA_FULL);
    expect(verdict.meetsBar).toBe(false);
    expect(verdict.reasonShortBy.length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// buildEmptyRun / recomputeRun
// -----------------------------------------------------------------------------

describe("buildEmptyRun", () => {
  it("seeds with all pending and exit not met", () => {
    const run = buildEmptyRun(QUICK, FOUNDER_E2E_EXIT_CRITERIA_QUICK);
    expect(run.kind).toBe(FOUNDER_E2E_KIND);
    expect(run.schemaVersion).toBe(FOUNDER_E2E_SCHEMA_VERSION);
    expect(run.pathId).toBe("quick");
    expect(run.summary.pending).toBe(6);
    expect(run.exit.meetsBar).toBe(false);
  });

  it("uses custom now() and id", () => {
    const run = buildEmptyRun(QUICK, FOUNDER_E2E_EXIT_CRITERIA_QUICK, {
      id: "custom-run",
      now: () => "2026-05-04T12:34:56.000Z",
    });
    expect(run.id).toBe("custom-run");
    expect(run.startedAt).toBe("2026-05-04T12:34:56.000Z");
    expect(run.updatedAt).toBe("2026-05-04T12:34:56.000Z");
  });
});

describe("recomputeRun", () => {
  it("refreshes summary + exit + updatedAt after a result change", () => {
    const run = buildEmptyRun(QUICK, FOUNDER_E2E_EXIT_CRITERIA_QUICK, {
      now: () => "2026-05-04T12:00:00.000Z",
    });
    const updated: QaRun = {
      ...run,
      results: {
        ...run.results,
        "quick:A.1:1": { stepId: "quick:A.1:1", status: "pass" },
      },
    };
    const recomputed = recomputeRun(QUICK, updated, FOUNDER_E2E_EXIT_CRITERIA_QUICK, {
      now: () => "2026-05-04T13:00:00.000Z",
    });
    expect(recomputed.summary.pass).toBe(1);
    expect(recomputed.updatedAt).toBe("2026-05-04T13:00:00.000Z");
  });

  it("re-normalizes unknown ids out of results", () => {
    const run = buildEmptyRun(QUICK, FOUNDER_E2E_EXIT_CRITERIA_QUICK);
    const polluted: QaRun = {
      ...run,
      results: {
        ...run.results,
        "ghost:1": { stepId: "ghost:1", status: "fail" },
      },
    };
    const recomputed = recomputeRun(QUICK, polluted, FOUNDER_E2E_EXIT_CRITERIA_QUICK);
    expect(recomputed.results["ghost:1"]).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// parseQaRun
// -----------------------------------------------------------------------------

describe("parseQaRun", () => {
  function makeValid(): unknown {
    return {
      schemaVersion: FOUNDER_E2E_SCHEMA_VERSION,
      kind: FOUNDER_E2E_KIND,
      id: "founder-e2e-test",
      pathId: "quick",
      startedAt: "2026-05-04T00:00:00.000Z",
      updatedAt: "2026-05-04T00:00:00.000Z",
      results: {
        "quick:A.1:1": { stepId: "quick:A.1:1", status: "pass" },
      },
      summary: { pass: 1, fail: 0, blocker: 0, skipped: 0, pending: 5, total: 6, failing: 0 },
      exit: { meetsBar: false, satisfiedCount: 0, requiredCount: 4, p0Count: 0, p1Count: 0, reasonShortBy: [], criteria: [] },
    };
  }

  it("parses a valid payload", () => {
    const parsed = parseQaRun(makeValid());
    expect(parsed.id).toBe("founder-e2e-test");
    expect(parsed.pathId).toBe("quick");
    expect(parsed.results["quick:A.1:1"].status).toBe("pass");
  });

  it("rejects missing schemaVersion", () => {
    const bad = { ...(makeValid() as Record<string, unknown>) };
    delete bad.schemaVersion;
    expect(() => parseQaRun(bad)).toThrow(FounderE2eParseError);
  });

  it("rejects bad pathId", () => {
    const bad = { ...(makeValid() as Record<string, unknown>), pathId: "weekly" };
    expect(() => parseQaRun(bad)).toThrow(/pathId/);
  });

  it("rejects bad status", () => {
    const bad = makeValid() as Record<string, unknown>;
    bad.results = { "quick:A.1:1": { stepId: "quick:A.1:1", status: "exploded" } };
    expect(() => parseQaRun(bad)).toThrow(/status/);
  });

  it("rejects bad severity value", () => {
    const bad = makeValid() as Record<string, unknown>;
    bad.results = {
      "quick:A.1:1": { stepId: "quick:A.1:1", status: "fail", severity: "P9" },
    };
    expect(() => parseQaRun(bad)).toThrow(/severity/);
  });
});

// -----------------------------------------------------------------------------
// Filename safety
// -----------------------------------------------------------------------------

describe("filename safety", () => {
  it("accepts well-formed founder-e2e filenames", () => {
    expect(isSafeFounderRunFileName("founder-e2e-quick-2026-05-04.json")).toBe(true);
    expect(isSafeFounderRunFileName("founder-e2e-full-runZ.json")).toBe(true);
  });

  it("rejects path traversal attempts", () => {
    expect(isSafeFounderRunFileName("../etc/passwd")).toBe(false);
    expect(isSafeFounderRunFileName("founder-e2e-..json")).toBe(false);
  });

  it("rejects path separators", () => {
    expect(isSafeFounderRunFileName("founder-e2e-quick/run.json")).toBe(false);
    expect(isSafeFounderRunFileName("founder-e2e-quick\\run.json")).toBe(false);
  });

  it("rejects unprefixed names", () => {
    expect(isSafeFounderRunFileName("phase0-resy-x.json")).toBe(false);
    expect(isSafeFounderRunFileName("README.md")).toBe(false);
  });

  it("fileNameForRun produces a safe name", () => {
    const run = buildEmptyRun(QUICK, FOUNDER_E2E_EXIT_CRITERIA_QUICK, {
      now: () => "2026-05-04T12:34:56.789Z",
    });
    const name = fileNameForRun(run);
    expect(isSafeFounderRunFileName(name)).toBe(true);
    expect(name.startsWith("founder-e2e-quick-")).toBe(true);
    expect(name.endsWith(".json")).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// formatStepAsBugReport
// -----------------------------------------------------------------------------

describe("formatStepAsBugReport", () => {
  it("includes severity, surface, expected, and actual", () => {
    const step = findStep(QUICK, "quick:A.5:1");
    expect(step).toBeDefined();
    if (!step) return;
    const md = formatStepAsBugReport(step, {
      stepId: step.id,
      status: "fail",
      actual: "saw ziweiA's task contents",
      severity: "P0",
    });
    expect(md).toContain("P0 ship-blocker");
    expect(md).toContain("Ownership boundary");
    expect(md).toContain("saw ziweiA's task contents");
    expect(md).toContain("Expected");
  });

  it("includes refs section when step has refs", () => {
    const step = findStep(QUICK, "quick:A.6:1");
    expect(step).toBeDefined();
    if (!step) return;
    const md = formatStepAsBugReport(step, {
      stepId: step.id,
      status: "fail",
      actual: "200 OK",
    });
    expect(md).toContain("References");
    expect(md).toContain("PHASE_1_FOUNDER_E2E.md");
  });

  it("blocker without explicit severity is rendered as P0", () => {
    const step = findStep(FULL, "full:2.5:1");
    expect(step).toBeDefined();
    if (!step) return;
    const md = formatStepAsBugReport(step, {
      stepId: step.id,
      status: "blocker",
      actual: "page crashed",
    });
    expect(md).toContain("P0 ship-blocker");
  });
});

describe("formatRunAsBugReport", () => {
  it("renders summary header even when no failing steps exist", () => {
    const run = buildEmptyRun(QUICK, FOUNDER_E2E_EXIT_CRITERIA_QUICK);
    const md = formatRunAsBugReport(QUICK, run);
    expect(md).toContain("Founder QA report");
    expect(md).toContain("No fail/blocker rows");
  });

  it("renders failing-steps section when any row failed", () => {
    let run = buildEmptyRun(QUICK, FOUNDER_E2E_EXIT_CRITERIA_QUICK);
    run = recomputeRun(
      QUICK,
      {
        ...run,
        results: {
          ...run.results,
          "quick:A.5:1": {
            stepId: "quick:A.5:1",
            status: "fail",
            actual: "leak observed",
          },
        },
      },
      FOUNDER_E2E_EXIT_CRITERIA_QUICK,
    );
    const md = formatRunAsBugReport(QUICK, run);
    expect(md).toContain("Failing steps");
    expect(md).toContain("Ownership boundary");
    expect(md).toContain("leak observed");
  });

  it("includes founder note when present", () => {
    let run = buildEmptyRun(QUICK, FOUNDER_E2E_EXIT_CRITERIA_QUICK);
    run = { ...run, noteAtEnd: "Stop and ping codex" };
    const md = formatRunAsBugReport(QUICK, run);
    expect(md).toContain("Stop and ping codex");
  });
});

// -----------------------------------------------------------------------------
// Fixtures content
// -----------------------------------------------------------------------------

describe("fixtures content", () => {
  it("quick path has 6 sections and 6 steps", () => {
    expect(QUICK.sections.length).toBe(6);
    expect(listAllSteps(QUICK).length).toBe(6);
    for (const step of listAllSteps(QUICK)) {
      expect(step.id.startsWith("quick:")).toBe(true);
    }
  });

  it("full path covers section ids 0,1,2,3,4,5,6,7", () => {
    const sectionIds = FULL.sections.map((s) => s.id);
    expect(sectionIds).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
    for (const step of listAllSteps(FULL)) {
      expect(step.id.startsWith("full:")).toBe(true);
    }
  });

  it("exit criteria reference real step ids", () => {
    const allFullIds = new Set(listAllSteps(FULL).map((s) => s.id));
    for (const def of FOUNDER_E2E_EXIT_CRITERIA_FULL) {
      for (const id of def.requiresStepIds) {
        expect(allFullIds.has(id)).toBe(true);
      }
    }
    const allQuickIds = new Set(listAllSteps(QUICK).map((s) => s.id));
    for (const def of FOUNDER_E2E_EXIT_CRITERIA_QUICK) {
      for (const id of def.requiresStepIds) {
        expect(allQuickIds.has(id)).toBe(true);
      }
    }
  });

  it("getPathDef returns same object as registry", () => {
    expect(getPathDef("quick")).toBe(QUICK);
    expect(getPathDef("full")).toBe(FULL);
  });

  it("getExitCriteriaForPath returns expected definitions", () => {
    expect(getExitCriteriaForPath("quick")).toBe(FOUNDER_E2E_EXIT_CRITERIA_QUICK);
    expect(getExitCriteriaForPath("full")).toBe(FOUNDER_E2E_EXIT_CRITERIA_FULL);
  });
});

// -----------------------------------------------------------------------------
// fs integration — temp cwd to avoid touching real benchmark/runs/
// -----------------------------------------------------------------------------

describe("loader fs integration", () => {
  let tmpRoot = "";
  let originalCwd = "";

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "founder-e2e-test-"));
    process.chdir(tmpRoot);
    await fs.mkdir(path.join(tmpRoot, "benchmark", "runs"), { recursive: true });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("listFounderE2eRunSummaries returns [] when dir is empty", async () => {
    const summaries = await listFounderE2eRunSummaries();
    expect(summaries).toEqual([]);
  });

  it("save then read round-trips the run", async () => {
    const run = buildEmptyRun(QUICK, FOUNDER_E2E_EXIT_CRITERIA_QUICK, {
      now: () => "2026-05-04T01:02:03.000Z",
    });
    const updated: QaRun = {
      ...run,
      results: {
        ...run.results,
        "quick:A.1:1": { stepId: "quick:A.1:1", status: "pass" },
      },
    };
    const saved = await saveFounderE2eRun(updated);
    expect(isSafeFounderRunFileName(saved.file)).toBe(true);
    const list = await listFounderE2eRunSummaries();
    expect(list.length).toBe(1);
    expect(list[0].pass).toBe(1);
    const reloaded = await readFounderE2eRunByFile(saved.file);
    expect(reloaded).toBeDefined();
    expect(reloaded?.results["quick:A.1:1"].status).toBe("pass");
  });

  it("readFounderE2eRunByFile rejects unsafe filenames", async () => {
    const traversal = await readFounderE2eRunByFile("../README.md");
    expect(traversal).toBeUndefined();
    const slashed = await readFounderE2eRunByFile("founder-e2e-quick/run.json");
    expect(slashed).toBeUndefined();
  });

  it("resolveSafePath rejects names outside the runs dir", () => {
    expect(resolveSafePath("../escape.json")).toBeUndefined();
    expect(resolveSafePath("founder-e2e-quick/sub.json")).toBeUndefined();
  });

  it("save recomputes summary and exit before write", async () => {
    const run = buildEmptyRun(QUICK, FOUNDER_E2E_EXIT_CRITERIA_QUICK, {
      now: () => "2026-05-04T01:02:03.000Z",
    });
    const seeded: QaRun = {
      ...run,
      // Lie in summary; loader should overwrite it.
      summary: { pass: 99, fail: 0, blocker: 0, skipped: 0, pending: 0, total: 0, failing: 0 },
      results: {
        ...run.results,
        "quick:A.1:1": { stepId: "quick:A.1:1", status: "pass" },
      },
    };
    const saved = await saveFounderE2eRun(seeded);
    expect(saved.run.summary.pass).toBe(1);
    expect(saved.run.summary.pending).toBe(5);
  });

  it("listFounderE2eRunSummaries skips garbage files", async () => {
    const dir = path.join(tmpRoot, "benchmark", "runs");
    await fs.writeFile(path.join(dir, "founder-e2e-quick-bad.json"), "not json", "utf8");
    await fs.writeFile(path.join(dir, "founder-e2e-quick-empty.json"), "{}", "utf8");
    await fs.writeFile(
      path.join(dir, "phase0-resy-unrelated.json"),
      JSON.stringify({ runId: "x" }),
      "utf8",
    );
    const list = await listFounderE2eRunSummaries();
    expect(list).toEqual([]);
  });
});
