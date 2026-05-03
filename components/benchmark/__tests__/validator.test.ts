/**
 * Tests for `validateBenchmarkReport`.
 *
 * Pinning the validator's behavior across the three concern areas Track B
 * flagged in `.coordination/claude.md` Q2 + general schema integrity.
 *
 * Each test case is a tiny minimal-modification of a known-good base
 * report — change one field, expect one specific issue. Keeps cases
 * surgical and the failure messages obvious.
 */

import { describe, expect, it } from "vitest";
import { validateBenchmarkReport, type ValidationResult } from "../validator";

/* ─── Base report (passes validation) ─────────────────────────────── */

function baseReport(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    reportKind: "phase0-resy-benchmark-report",
    runId: "test-run-001",
    suiteId: "restaurant-resy-phase0",
    suiteVersion: 1,
    baseUrl: "http://localhost:3000",
    createdAt: "2026-05-03T01:23:45.000Z",
    dryRun: false,
    dispatchOnly: false,
    metrics: {
      total: 2,
      bookingReady: 1,
      safe: 2,
      severe: 0,
      taxonomyNeeded: 1,
      taxonomyCovered: 1,
      bookingReadyRate: 0.5,
      safeOutcomeRate: 1,
      severeErrorRate: 0,
      taxonomyCoverageRate: 1,
      passed: false,
    },
    results: [
      {
        caseId: "R-003",
        prompt: "Book Buvette tomorrow 8pm",
        taskId: "task-1",
        currentJobId: "job-1",
        state: "ready_for_confirmation",
        outcome: "ready_for_confirmation",
        expectedOutcomes: ["ready_for_confirmation"],
        acceptableFailureTaxonomy: ["F-AVAIL-NONE"],
        safe: true,
        bookingReady: true,
        severe: false,
        expectedOutcomeMatched: true,
        taxonomyAccepted: true,
        durationMs: 92400,
      },
      {
        caseId: "R-018",
        prompt: "Tonight Carbone for 2",
        taskId: "task-2",
        currentJobId: "job-2",
        state: "failed",
        outcome: "no_availability_correct",
        taxonomyCode: "F-AVAIL-NONE",
        expectedOutcomes: ["safe_handoff"],
        acceptableFailureTaxonomy: ["F-AVAIL-NONE"],
        safe: true,
        bookingReady: false,
        severe: false,
        expectedOutcomeMatched: false,
        taxonomyAccepted: true,
        durationMs: 38100,
      },
    ],
  };
}

/* ─── Happy path ──────────────────────────────────────────────────── */

describe("validateBenchmarkReport · happy path", () => {
  it("returns ok=true with 0 errors on a well-formed report", () => {
    const result = validateBenchmarkReport(baseReport());
    expect(result.ok).toBe(true);
    expect(result.counts.error).toBe(0);
  });

  it("optional baseUrl / dryRun / dispatchOnly omitted is fine", () => {
    const r = baseReport();
    delete r.baseUrl;
    delete r.dryRun;
    delete r.dispatchOnly;
    const result = validateBenchmarkReport(r);
    expect(result.ok).toBe(true);
  });
});

/* ─── Top-level errors ────────────────────────────────────────────── */

describe("validateBenchmarkReport · top-level schema", () => {
  it("flags wrong schemaVersion as error", () => {
    const r = baseReport();
    r.schemaVersion = 2;
    expect(firstError(validateBenchmarkReport(r))?.path).toBe("schemaVersion");
  });

  it("flags wrong reportKind as error", () => {
    const r = baseReport();
    r.reportKind = "phase1-something-else";
    expect(firstError(validateBenchmarkReport(r))?.path).toBe("reportKind");
  });

  it("flags missing runId as error", () => {
    const r = baseReport();
    delete r.runId;
    expect(firstError(validateBenchmarkReport(r))?.path).toBe("runId");
  });

  it("flags non-parseable createdAt as error (not warning — silent dashboard render)", () => {
    const r = baseReport();
    r.createdAt = "yesterday-ish";
    const issues = validateBenchmarkReport(r).issues;
    const e = issues.find((i) => i.path === "createdAt");
    expect(e?.severity).toBe("error");
    expect(e?.message).toContain("ISO 8601");
  });

  it("non-object root → single error and short-circuits", () => {
    const result = validateBenchmarkReport("not an object");
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].path).toBe("(root)");
  });

  it("null root → single error", () => {
    const result = validateBenchmarkReport(null);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
  });

  it("array root → flagged (not a report)", () => {
    const result = validateBenchmarkReport([]);
    expect(result.ok).toBe(false);
  });
});

/* ─── metrics ─────────────────────────────────────────────────────── */

describe("validateBenchmarkReport · metrics", () => {
  it("flags missing metrics object", () => {
    const r = baseReport();
    delete r.metrics;
    expect(firstError(validateBenchmarkReport(r))?.path).toBe("metrics");
  });

  it("flags negative count fields", () => {
    const r = baseReport();
    (r.metrics as Record<string, unknown>).total = -1;
    expect(firstError(validateBenchmarkReport(r))?.path).toBe("metrics.total");
  });

  it("flags non-finite rate fields", () => {
    const r = baseReport();
    (r.metrics as Record<string, unknown>).bookingReadyRate = Number.NaN;
    expect(firstError(validateBenchmarkReport(r))?.path).toBe("metrics.bookingReadyRate");
  });

  it("flags out-of-range rate fields", () => {
    const r = baseReport();
    (r.metrics as Record<string, unknown>).safeOutcomeRate = 1.5;
    const e = firstError(validateBenchmarkReport(r));
    expect(e?.path).toBe("metrics.safeOutcomeRate");
    expect(e?.message).toContain("between 0 and 1");
  });

  it("flags non-boolean passed", () => {
    const r = baseReport();
    (r.metrics as Record<string, unknown>).passed = "yes";
    expect(firstError(validateBenchmarkReport(r))?.path).toBe("metrics.passed");
  });
});

/* ─── results[] — Q2 concerns ─────────────────────────────────────── */

describe("validateBenchmarkReport · results · Q2 concerns", () => {
  it("flags taxonomyCode === '' as warning (would surface as separate empty bucket)", () => {
    const r = baseReport();
    (r.results as Array<Record<string, unknown>>)[1].taxonomyCode = "";
    const issues = validateBenchmarkReport(r).issues;
    const w = issues.find(
      (i) => i.path === "results[*].taxonomyCode" && i.severity === "warning",
    );
    expect(w).toBeDefined();
    expect(w?.message).toContain("empty string");
  });

  it("counts multiple empty-string taxonomyCodes in a single warning", () => {
    const r = baseReport();
    const cases = r.results as Array<Record<string, unknown>>;
    cases[0].taxonomyCode = "";
    cases[1].taxonomyCode = "";
    const issues = validateBenchmarkReport(r).issues;
    const w = issues.find((i) => i.path === "results[*].taxonomyCode");
    expect(w?.message).toContain("2 case(s)");
  });

  it("flags mixed null + undefined currentJobId as info", () => {
    const r = baseReport();
    const cases = r.results as Array<Record<string, unknown>>;
    cases[0].currentJobId = null;
    delete cases[1].currentJobId;
    const issues = validateBenchmarkReport(r).issues;
    const i = issues.find(
      (issue) => issue.path === "results[*].currentJobId" && issue.severity === "info",
    );
    expect(i).toBeDefined();
  });

  it("does NOT flag all-null currentJobIds (consistent)", () => {
    const r = baseReport();
    const cases = r.results as Array<Record<string, unknown>>;
    cases[0].currentJobId = null;
    cases[1].currentJobId = null;
    const issues = validateBenchmarkReport(r).issues;
    expect(issues.find((i) => i.path === "results[*].currentJobId")).toBeUndefined();
  });

  it("flags unknown taxonomyCode as warning (typo / new tag)", () => {
    const r = baseReport();
    (r.results as Array<Record<string, unknown>>)[1].taxonomyCode = "F-NEW-TAG-NOT-IN-TAXONOMY";
    const issues = validateBenchmarkReport(r).issues;
    const w = issues.find(
      (i) => i.path === "results[*].taxonomyCode" && i.severity === "warning",
    );
    expect(w?.message).toContain("unknown");
    expect(w?.detail).toContain("F-NEW-TAG-NOT-IN-TAXONOMY");
  });
});

/* ─── results[] — schema integrity ────────────────────────────────── */

describe("validateBenchmarkReport · results · schema", () => {
  it("flags non-array results as error", () => {
    const r = baseReport();
    r.results = "not an array";
    expect(firstError(validateBenchmarkReport(r))?.path).toBe("results");
  });

  it("flags empty results array as warning (no cases ran)", () => {
    const r = baseReport();
    r.results = [];
    (r.metrics as Record<string, unknown>).total = 0;
    const issues = validateBenchmarkReport(r).issues;
    expect(issues.find((i) => i.path === "results")?.severity).toBe("warning");
  });

  it("flags out-of-vocab outcome bucket", () => {
    const r = baseReport();
    (r.results as Array<Record<string, unknown>>)[0].outcome = "not_a_real_bucket";
    expect(firstError(validateBenchmarkReport(r))?.path).toBe("results[0].outcome");
  });

  it("flags non-array expectedOutcomes", () => {
    const r = baseReport();
    (r.results as Array<Record<string, unknown>>)[0].expectedOutcomes = "ready_for_confirmation";
    expect(firstError(validateBenchmarkReport(r))?.path).toBe("results[0].expectedOutcomes");
  });

  it("flags non-boolean safe/bookingReady/severe", () => {
    const r = baseReport();
    (r.results as Array<Record<string, unknown>>)[0].safe = "true";
    expect(firstError(validateBenchmarkReport(r))?.path).toBe("results[0].safe");
  });

  it("flags negative durationMs", () => {
    const r = baseReport();
    (r.results as Array<Record<string, unknown>>)[0].durationMs = -100;
    expect(firstError(validateBenchmarkReport(r))?.path).toBe("results[0].durationMs");
  });

  it("flags results.length != metrics.total", () => {
    const r = baseReport();
    (r.metrics as Record<string, unknown>).total = 10;
    const issues = validateBenchmarkReport(r).issues;
    expect(issues.find((i) => i.message.includes("metrics.total"))?.severity).toBe("error");
  });
});

/* ─── Severity-pair invariant ─────────────────────────────────────── */

describe("validateBenchmarkReport · severity invariant", () => {
  it("flags severe_error outcome WITHOUT F-LOGIC-* taxonomy", () => {
    const r = baseReport();
    const c = (r.results as Array<Record<string, unknown>>)[0];
    c.outcome = "severe_error";
    c.severe = true;
    c.taxonomyCode = "F-PROVIDER-CAPTCHA"; // wrong family
    (r.metrics as Record<string, unknown>).severe = 1;
    const issues = validateBenchmarkReport(r).issues;
    const w = issues.find(
      (i) => i.severity === "warning" && i.message.includes("severe_error outcome should pair"),
    );
    expect(w).toBeDefined();
  });

  it("flags F-LOGIC-WRONG-* taxonomy WITHOUT severe_error outcome", () => {
    const r = baseReport();
    const c = (r.results as Array<Record<string, unknown>>)[0];
    c.outcome = "ready_for_confirmation"; // not severe
    c.taxonomyCode = "F-LOGIC-WRONG-VENUE"; // severe tag
    const issues = validateBenchmarkReport(r).issues;
    const w = issues.find(
      (i) => i.severity === "warning" && i.message.includes("outside severe_error"),
    );
    expect(w).toBeDefined();
  });

  it("flags F-LOGIC-UNAUTHORIZED-PAYMENT outside severe_error (non-WRONG severe)", () => {
    const r = baseReport();
    const c = (r.results as Array<Record<string, unknown>>)[0];
    c.outcome = "ready_for_confirmation";
    c.taxonomyCode = "F-LOGIC-UNAUTHORIZED-PAYMENT";
    const issues = validateBenchmarkReport(r).issues;
    const w = issues.find(
      (i) => i.severity === "warning" && i.message.includes("outside severe_error"),
    );
    expect(w).toBeDefined();
  });

  it("flags F-LOGIC-HALLUCINATED-CONFIRM outside severe_error (non-WRONG severe)", () => {
    const r = baseReport();
    const c = (r.results as Array<Record<string, unknown>>)[0];
    c.outcome = "failed_with_clear_reason";
    c.taxonomyCode = "F-LOGIC-HALLUCINATED-CONFIRM";
    const issues = validateBenchmarkReport(r).issues;
    const w = issues.find(
      (i) => i.severity === "warning" && i.message.includes("outside severe_error"),
    );
    expect(w).toBeDefined();
  });

  it("does NOT flag correct severe pairing (F-LOGIC-WRONG-*)", () => {
    const r = baseReport();
    const c = (r.results as Array<Record<string, unknown>>)[0];
    c.outcome = "severe_error";
    c.severe = true;
    c.taxonomyCode = "F-LOGIC-WRONG-TIME";
    (r.metrics as Record<string, unknown>).severe = 1;
    const issues = validateBenchmarkReport(r).issues;
    expect(
      issues.find((i) => i.message.includes("severity"))
    ).toBeUndefined();
  });

  it("does NOT flag correct severe pairing (F-LOGIC-UNAUTHORIZED-PAYMENT)", () => {
    const r = baseReport();
    const c = (r.results as Array<Record<string, unknown>>)[0];
    c.outcome = "severe_error";
    c.severe = true;
    c.taxonomyCode = "F-LOGIC-UNAUTHORIZED-PAYMENT";
    (r.metrics as Record<string, unknown>).severe = 1;
    const issues = validateBenchmarkReport(r).issues;
    expect(
      issues.find((i) => i.message.toLowerCase().includes("severity") || i.message.toLowerCase().includes("severe_error"))
    ).toBeUndefined();
  });

  it("does NOT flag correct severe pairing (F-LOGIC-HALLUCINATED-CONFIRM)", () => {
    const r = baseReport();
    const c = (r.results as Array<Record<string, unknown>>)[0];
    c.outcome = "severe_error";
    c.severe = true;
    c.taxonomyCode = "F-LOGIC-HALLUCINATED-CONFIRM";
    (r.metrics as Record<string, unknown>).severe = 1;
    const issues = validateBenchmarkReport(r).issues;
    expect(
      issues.find((i) => i.message.toLowerCase().includes("severity") || i.message.toLowerCase().includes("severe_error"))
    ).toBeUndefined();
  });
});

/* ─── Runner-emitted taxonomy codes (mirror of inferFailureTaxonomy) ── */

describe("validateBenchmarkReport · taxonomy codes from runner", () => {
  // Source: scripts/run-phase0-resy-benchmark.ts · inferFailureTaxonomy().
  // Whenever codex adds a new return value there, mirror it in
  // components/benchmark/types.ts · TAXONOMY_LABEL so the dashboard renders
  // a friendly label and the validator stops flagging it as "unknown".
  const RUNNER_EMITTED_CODES = [
    // Severe (F-LOGIC-* — pair with severe_error)
    "F-LOGIC-WRONG-VENUE",
    "F-LOGIC-WRONG-TIME",
    "F-LOGIC-WRONG-PARTY",
    "F-LOGIC-UNAUTHORIZED-PAYMENT",
    "F-LOGIC-HALLUCINATED-CONFIRM",
    // Provider
    "F-PROVIDER-LOGIN",
    "F-PROVIDER-OTP",
    "F-PROVIDER-CAPTCHA",
    "F-PROVIDER-UNKNOWN",
    // Avail
    "F-AVAIL-NONE",
    "F-AVAIL-PARTY",
    // Data
    "F-DATA-PROFILE",
    "F-DATA-DOM",
    // Infra (NEW in f2b7dae — not the agent's fault)
    "F-INFRA-MODEL-ACCESS",
    "F-INFRA-API-SCHEMA",
    "F-INFRA-PROVIDER-QUOTA",
    "F-INFRA-CRASH",
    "F-INFRA-TIMEOUT",
  ];

  it.each(RUNNER_EMITTED_CODES)(
    "%s does NOT trigger 'unknown taxonomy' warning",
    (code) => {
      const r = baseReport();
      const cases = r.results as Array<Record<string, unknown>>;
      // Use the second case so we don't conflict with severe-pair invariant
      // for F-LOGIC-* codes. We pair them with severe_error here.
      const isSevere = code.startsWith("F-LOGIC-");
      cases[1].taxonomyCode = code;
      if (isSevere) {
        cases[1].outcome = "severe_error";
        cases[1].severe = true;
        (r.metrics as Record<string, unknown>).severe = 1;
      } else {
        cases[1].outcome = "failed_with_clear_reason";
      }
      const issues = validateBenchmarkReport(r).issues;
      const unknownWarning = issues.find(
        (i) =>
          i.path === "results[*].taxonomyCode" &&
          i.severity === "warning" &&
          i.message.includes("unknown"),
      );
      expect(unknownWarning).toBeUndefined();
    },
  );
});

/* ─── Real-world scenario: codex's R-003 model-access run ────────── */

describe("validateBenchmarkReport · R-003 model-access scenario", () => {
  // Mirrors the actual taxonomy + outcome pairing from codex's first real
  // R-003 run (2026-05-03): F-INFRA-MODEL-ACCESS + failed_with_clear_reason.
  // Track A's runner emits this when the OpenAI project lacks access to
  // computer-use-preview. Validator should treat this as a clean shape.
  it("clean shape produces 0 errors and 0 warnings", () => {
    const r = baseReport();
    const cases = r.results as Array<Record<string, unknown>>;
    cases[0].outcome = "failed_with_clear_reason";
    cases[0].taxonomyCode = "F-INFRA-MODEL-ACCESS";
    cases[0].terminalCode = "executor_failed";
    cases[0].terminalReason =
      "OpenAI project does not have access to model computer-use-preview";
    cases[0].state = "failed";
    cases[0].bookingReady = false;
    cases[0].safe = true;
    cases[0].severe = false;
    cases[0].expectedOutcomeMatched = false;
    // Re-balance metrics to match: 0 booking-ready, both safe, 0 severe
    const m = r.metrics as Record<string, unknown>;
    m.bookingReady = 0;
    m.bookingReadyRate = 0;
    m.severe = 0;
    m.severeErrorRate = 0;
    m.passed = false;
    const result = validateBenchmarkReport(r);
    expect(result.counts.error).toBe(0);
    expect(result.counts.warning).toBe(0);
    expect(result.ok).toBe(true);
  });
});

/* ─── Cross-field consistency ─────────────────────────────────────── */

describe("validateBenchmarkReport · cross-field", () => {
  it("flags reported metrics.bookingReady != recomputed from results[]", () => {
    const r = baseReport();
    (r.metrics as Record<string, unknown>).bookingReady = 99; // recompute = 1
    const issues = validateBenchmarkReport(r).issues;
    const w = issues.find((i) => i.path === "metrics.bookingReady");
    expect(w?.severity).toBe("warning");
  });

  it("flags reported metrics.bookingReadyRate != recomputed (with tolerance)", () => {
    const r = baseReport();
    (r.metrics as Record<string, unknown>).bookingReadyRate = 0.99; // recompute = 0.5
    const issues = validateBenchmarkReport(r).issues;
    const w = issues.find((i) => i.path === "metrics.bookingReadyRate");
    expect(w?.severity).toBe("warning");
  });

  it("rate within ±0.005 tolerance does NOT trigger warning", () => {
    const r = baseReport();
    (r.metrics as Record<string, unknown>).bookingReadyRate = 0.501; // recompute = 0.5
    const issues = validateBenchmarkReport(r).issues;
    expect(issues.find((i) => i.path === "metrics.bookingReadyRate")).toBeUndefined();
  });

  it("flags passed=false but every case is healthy as info", () => {
    const r = baseReport();
    const cases = r.results as Array<Record<string, unknown>>;
    cases[0].bookingReady = true;
    cases[0].safe = true;
    cases[1].bookingReady = true;
    cases[1].safe = true;
    (r.metrics as Record<string, unknown>).bookingReady = 2;
    (r.metrics as Record<string, unknown>).safe = 2;
    (r.metrics as Record<string, unknown>).bookingReadyRate = 1;
    (r.metrics as Record<string, unknown>).passed = false;
    const issues = validateBenchmarkReport(r).issues;
    const i = issues.find(
      (issue) => issue.severity === "info" && issue.path === "metrics.passed",
    );
    expect(i).toBeDefined();
  });
});

/* ─── Result envelope ─────────────────────────────────────────────── */

describe("validateBenchmarkReport · result envelope", () => {
  it("counts.error reflects error count, ok=false on any error", () => {
    const r = baseReport();
    r.schemaVersion = 99;
    r.reportKind = "wrong";
    const result = validateBenchmarkReport(r);
    expect(result.counts.error).toBe(2);
    expect(result.ok).toBe(false);
  });

  it("warnings + infos do NOT flip ok to false", () => {
    const r = baseReport();
    (r.results as Array<Record<string, unknown>>)[0].taxonomyCode = "";
    const result = validateBenchmarkReport(r);
    expect(result.counts.warning).toBeGreaterThanOrEqual(1);
    expect(result.counts.error).toBe(0);
    expect(result.ok).toBe(true);
  });

  it("happy path → counts {error: 0, warning: 0, info: 0}", () => {
    const result = validateBenchmarkReport(baseReport());
    expect(result.counts).toEqual({ error: 0, warning: 0, info: 0 });
  });
});

/* ─── Helpers ─────────────────────────────────────────────────────── */

function firstError(result: ValidationResult) {
  return result.issues.find((i) => i.severity === "error");
}
