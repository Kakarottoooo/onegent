import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  buildQualityGateRun,
  classifyFailure,
  computeQualityGateVerdict,
  fileNameForQualityGateRun,
  fileNameFromRunId,
  formatDurationForMarkdown,
  formatQualityGateMarkdown,
  GATE_SEVERITY_LABEL,
  GATE_STATUS_LABEL,
  GATE_STATUS_TONE,
  GATE_TAIL_BYTES,
  GATE_VERDICT_LABEL,
  GATE_VERDICT_TONE,
  isSafeQualityGateFileName,
  parseQualityGateRun,
  QUALITY_GATE_FILE_PATTERN,
  QUALITY_GATE_SCHEMA_VERSION,
  QualityGateParseError,
  sanitizeCheck,
  SHIPPING_CRITICAL_IDS,
  summarizeQualityGateRun,
  tailString,
  type GateCheck,
  type GateRunnerMeta,
  type QualityGateRun,
} from "../quality-gate/report";

import {
  getQualityGateRunsDir,
  listQualityGateRunSummaries,
  QualityGateLoaderError,
  readQualityGateRunByFile,
  resolveSafeRunPath,
  saveQualityGateRun,
} from "../quality-gate/loader";

/* ─── Helpers ─────────────────────────────────────────────────────── */

function makeCheck(overrides: Partial<GateCheck> = {}): GateCheck {
  return {
    id: "tsc",
    label: "Typecheck",
    command: "npx tsc --noEmit",
    requirement: "required",
    status: "pass",
    severity: "skipped",
    durationMs: 1000,
    startedAt: "2026-05-04T08:00:00.000Z",
    stdoutTail: "",
    stderrTail: "",
    ...overrides,
  };
}

function makeRunnerMeta(overrides: Partial<GateRunnerMeta> = {}): GateRunnerMeta {
  return {
    command: "npm run gate:phase1",
    baseUrl: "http://localhost:3000",
    nodeVersion: "v20.18.0",
    durationMs: 12345,
    label: undefined,
    startedAt: "2026-05-04T08:00:00.000Z",
    ...overrides,
  };
}

/* ─── tailString ──────────────────────────────────────────────────── */

describe("tailString", () => {
  it("returns input unchanged when length ≤ max", () => {
    expect(tailString("hi", 10)).toBe("hi");
  });
  it("truncates with leading marker when length > max", () => {
    const input = "x".repeat(100);
    const out = tailString(input, 20);
    expect(out.length).toBeLessThan(input.length + 50);
    expect(out).toContain("[truncated, last 20 chars]");
    expect(out.endsWith("x".repeat(20))).toBe(true);
  });
  it("uses GATE_TAIL_BYTES default", () => {
    const input = "y".repeat(GATE_TAIL_BYTES + 100);
    const out = tailString(input);
    expect(out).toContain(`[truncated, last ${GATE_TAIL_BYTES} chars]`);
  });
  it("returns empty string for empty input", () => {
    expect(tailString("")).toBe("");
  });
  it("returns empty string for non-string input", () => {
    expect(tailString(undefined as unknown as string)).toBe("");
    expect(tailString(123 as unknown as string)).toBe("");
    expect(tailString(null as unknown as string)).toBe("");
  });
  it("preserves entire string when length === max", () => {
    const input = "z".repeat(50);
    expect(tailString(input, 50)).toBe(input);
  });
});

/* ─── classifyFailure ─────────────────────────────────────────────── */

describe("classifyFailure", () => {
  it("returns 'skipped' for status=pass", () => {
    expect(
      classifyFailure({ id: "tsc", requirement: "required", status: "pass" }),
    ).toBe("skipped");
  });
  it("returns 'p2' for known_existing_failure", () => {
    expect(
      classifyFailure({
        id: "check-drift",
        requirement: "required",
        status: "known_existing_failure",
      }),
    ).toBe("p2");
  });
  it("returns 'env' for skipped + dev_server_unreachable", () => {
    expect(
      classifyFailure({
        id: "smoke:phase1",
        requirement: "optional",
        status: "skipped",
        skipReason: "dev_server_unreachable",
      }),
    ).toBe("env");
  });
  it("returns 'skipped' for skipped without env reason", () => {
    expect(
      classifyFailure({
        id: "vitest:founder-e2e",
        requirement: "required",
        status: "skipped",
        skipReason: "no_matching_test_files",
      }),
    ).toBe("skipped");
  });
  it("returns 'p0' for fail + required + tsc (shipping critical)", () => {
    expect(
      classifyFailure({ id: "tsc", requirement: "required", status: "fail" }),
    ).toBe("p0");
  });
  it("returns 'p0' for fail + required + flight-time-filter", () => {
    expect(
      classifyFailure({
        id: "vitest:flight-time-filter",
        requirement: "required",
        status: "fail",
      }),
    ).toBe("p0");
  });
  it("returns 'p1' for fail + required + check-drift (not critical)", () => {
    expect(
      classifyFailure({
        id: "check-drift",
        requirement: "required",
        status: "fail",
      }),
    ).toBe("p1");
  });
  it("returns 'p2' for fail + optional", () => {
    expect(
      classifyFailure({
        id: "smoke:phase1",
        requirement: "optional",
        status: "fail",
      }),
    ).toBe("p2");
  });
  it("treats pending+required+critical like fail (returns p0)", () => {
    expect(
      classifyFailure({ id: "tsc", requirement: "required", status: "pending" }),
    ).toBe("p0");
  });
  it("treats pending+optional like fail (returns p2)", () => {
    expect(
      classifyFailure({
        id: "e2e:founder",
        requirement: "optional",
        status: "pending",
      }),
    ).toBe("p2");
  });
});

describe("SHIPPING_CRITICAL_IDS", () => {
  it("includes tsc", () => {
    expect(SHIPPING_CRITICAL_IDS.has("tsc")).toBe(true);
  });
  it("includes vitest:flight-time-filter", () => {
    expect(SHIPPING_CRITICAL_IDS.has("vitest:flight-time-filter")).toBe(true);
  });
  it("includes vitest:founder-e2e", () => {
    expect(SHIPPING_CRITICAL_IDS.has("vitest:founder-e2e")).toBe(true);
  });
  it("does NOT include check-drift", () => {
    expect(SHIPPING_CRITICAL_IDS.has("check-drift")).toBe(false);
  });
  it("does NOT include optional smoke:phase1", () => {
    expect(SHIPPING_CRITICAL_IDS.has("smoke:phase1")).toBe(false);
  });
  it("includes vitest:profile-gap-decision", () => {
    expect(SHIPPING_CRITICAL_IDS.has("vitest:profile-gap-decision")).toBe(true);
  });
});

/* ─── computeQualityGateVerdict ───────────────────────────────────── */

describe("computeQualityGateVerdict", () => {
  it("empty list → pass / exit 0", () => {
    expect(computeQualityGateVerdict([])).toEqual({ verdict: "pass", exitCode: 0 });
  });
  it("all required pass → pass / exit 0", () => {
    const checks = [makeCheck({ id: "tsc", status: "pass" })];
    expect(computeQualityGateVerdict(checks)).toEqual({ verdict: "pass", exitCode: 0 });
  });
  it("any required fail → fail / exit 1", () => {
    const checks = [
      makeCheck({ id: "tsc", status: "pass" }),
      makeCheck({ id: "check-drift", status: "fail", severity: "p1" }),
    ];
    expect(computeQualityGateVerdict(checks)).toEqual({ verdict: "fail", exitCode: 1 });
  });
  it("required skipped+env → env_blocked / exit 2", () => {
    const checks = [
      makeCheck({
        id: "smoke:phase1",
        requirement: "required",
        status: "skipped",
        severity: "env",
      }),
    ];
    expect(computeQualityGateVerdict(checks)).toEqual({
      verdict: "env_blocked",
      exitCode: 2,
    });
  });
  it("fail has priority over env_blocked", () => {
    const checks = [
      makeCheck({ id: "tsc", status: "fail", severity: "p0" }),
      makeCheck({
        id: "smoke:phase1",
        requirement: "required",
        status: "skipped",
        severity: "env",
      }),
    ];
    expect(computeQualityGateVerdict(checks)).toEqual({ verdict: "fail", exitCode: 1 });
  });
  it("env_blocked has priority over needs_polish", () => {
    const checks = [
      makeCheck({
        id: "smoke:phase1",
        requirement: "required",
        status: "skipped",
        severity: "env",
      }),
      makeCheck({
        id: "e2e:founder",
        requirement: "optional",
        status: "fail",
        severity: "p2",
      }),
    ];
    expect(computeQualityGateVerdict(checks)).toEqual({
      verdict: "env_blocked",
      exitCode: 2,
    });
  });
  it("optional fail → needs_polish / exit 0", () => {
    const checks = [
      makeCheck({ id: "tsc", status: "pass" }),
      makeCheck({
        id: "smoke:phase1",
        requirement: "optional",
        status: "fail",
        severity: "p2",
      }),
    ];
    expect(computeQualityGateVerdict(checks)).toEqual({
      verdict: "needs_polish",
      exitCode: 0,
    });
  });
  it("optional skipped → needs_polish / exit 0", () => {
    const checks = [
      makeCheck({ id: "tsc", status: "pass" }),
      makeCheck({
        id: "smoke:phase1",
        requirement: "optional",
        status: "skipped",
        severity: "skipped",
      }),
    ];
    expect(computeQualityGateVerdict(checks)).toEqual({
      verdict: "needs_polish",
      exitCode: 0,
    });
  });
  it("known_existing_failure → needs_polish / exit 0 (does NOT block)", () => {
    const checks = [
      makeCheck({ id: "tsc", status: "pass" }),
      makeCheck({
        id: "check-drift",
        requirement: "required",
        status: "known_existing_failure",
        severity: "p2",
      }),
    ];
    expect(computeQualityGateVerdict(checks)).toEqual({
      verdict: "needs_polish",
      exitCode: 0,
    });
  });
  it("required skipped non-env → needs_polish (e.g. missing test file)", () => {
    const checks = [
      makeCheck({ id: "tsc", status: "pass" }),
      makeCheck({
        id: "vitest:founder-e2e",
        requirement: "required",
        status: "skipped",
        severity: "skipped",
      }),
    ];
    expect(computeQualityGateVerdict(checks)).toEqual({
      verdict: "needs_polish",
      exitCode: 0,
    });
  });
  it("multiple known_existing_failure aggregate to needs_polish", () => {
    const checks = [
      makeCheck({
        id: "check-drift",
        status: "known_existing_failure",
        severity: "p2",
      }),
      makeCheck({
        id: "vitest:foo",
        status: "known_existing_failure",
        severity: "p2",
      }),
    ];
    expect(computeQualityGateVerdict(checks)).toEqual({
      verdict: "needs_polish",
      exitCode: 0,
    });
  });
  it("fail + skipped(env) + known + optional fail → fail wins (priority)", () => {
    const checks = [
      makeCheck({ id: "tsc", status: "fail", severity: "p0" }),
      makeCheck({ id: "vitest:x", status: "skipped", severity: "env" }),
      makeCheck({ id: "check-drift", status: "known_existing_failure", severity: "p2" }),
      makeCheck({ id: "e2e:founder", requirement: "optional", status: "fail", severity: "p2" }),
    ];
    expect(computeQualityGateVerdict(checks)).toEqual({ verdict: "fail", exitCode: 1 });
  });
  it("all optional skipped + required pass → needs_polish", () => {
    const checks = [
      makeCheck({ id: "tsc", status: "pass" }),
      makeCheck({ id: "smoke:phase1", requirement: "optional", status: "skipped", severity: "env" }),
      makeCheck({ id: "e2e:founder", requirement: "optional", status: "skipped", severity: "env" }),
    ];
    expect(computeQualityGateVerdict(checks)).toEqual({
      verdict: "needs_polish",
      exitCode: 0,
    });
  });
});

/* ─── sanitizeCheck ───────────────────────────────────────────────── */

describe("sanitizeCheck", () => {
  it("clamps negative duration to 0", () => {
    const c = sanitizeCheck(makeCheck({ durationMs: -100 }));
    expect(c.durationMs).toBe(0);
  });
  it("clamps NaN duration to 0", () => {
    const c = sanitizeCheck(makeCheck({ durationMs: NaN }));
    expect(c.durationMs).toBe(0);
  });
  it("strips invalid status to pending", () => {
    const c = sanitizeCheck(makeCheck({ status: "unknown" as unknown as GateCheck["status"] }));
    expect(c.status).toBe("pending");
  });
  it("strips invalid severity to skipped", () => {
    const c = sanitizeCheck(
      makeCheck({ severity: "p9" as unknown as GateCheck["severity"] }),
    );
    expect(c.severity).toBe("skipped");
  });
  it("truncates oversize stdoutTail", () => {
    const big = "x".repeat(GATE_TAIL_BYTES * 4);
    const c = sanitizeCheck(makeCheck({ stdoutTail: big }));
    expect(c.stdoutTail.length).toBeLessThan(big.length);
    expect(c.stdoutTail).toContain("[truncated");
  });
  it("truncates oversize stderrTail", () => {
    const big = "y".repeat(GATE_TAIL_BYTES * 4);
    const c = sanitizeCheck(makeCheck({ stderrTail: big }));
    expect(c.stderrTail).toContain("[truncated");
  });
  it("drops empty notes to undefined", () => {
    const c = sanitizeCheck(makeCheck({ notes: "" }));
    expect(c.notes).toBeUndefined();
  });
  it("preserves non-empty notes", () => {
    const c = sanitizeCheck(makeCheck({ notes: "skip reason" }));
    expect(c.notes).toBe("skip reason");
  });
  it("defaults missing label to id", () => {
    const c = sanitizeCheck(
      makeCheck({ id: "tsc", label: "" as unknown as string }),
    );
    expect(c.label).toBe("tsc");
  });
  it("defaults missing startedAt to epoch ISO", () => {
    const c = sanitizeCheck(makeCheck({ startedAt: "" as unknown as string }));
    expect(c.startedAt).toBe(new Date(0).toISOString());
  });
});

/* ─── buildQualityGateRun ─────────────────────────────────────────── */

describe("buildQualityGateRun", () => {
  it("stamps schemaVersion = 1", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      checks: [],
      runnerMeta: makeRunnerMeta(),
    });
    expect(run.schemaVersion).toBe(QUALITY_GATE_SCHEMA_VERSION);
  });
  it("computes verdict from checks (pass)", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      checks: [makeCheck({ id: "tsc", status: "pass" })],
      runnerMeta: makeRunnerMeta(),
    });
    expect(run.verdict).toBe("pass");
    expect(run.exitCode).toBe(0);
  });
  it("computes verdict from checks (fail)", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      checks: [makeCheck({ id: "tsc", status: "fail", severity: "p0" })],
      runnerMeta: makeRunnerMeta(),
    });
    expect(run.verdict).toBe("fail");
    expect(run.exitCode).toBe(1);
  });
  it("auto-fills generatedAt if omitted", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      checks: [],
      runnerMeta: makeRunnerMeta(),
    });
    expect(typeof run.generatedAt).toBe("string");
    expect(run.generatedAt.length).toBeGreaterThan(0);
  });
  it("preserves explicit generatedAt", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      generatedAt: "2026-05-04T09:00:00.000Z",
      checks: [],
      runnerMeta: makeRunnerMeta(),
    });
    expect(run.generatedAt).toBe("2026-05-04T09:00:00.000Z");
  });
});

/* ─── summarizeQualityGateRun ─────────────────────────────────────── */

describe("summarizeQualityGateRun", () => {
  it("counts each status accurately", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      checks: [
        makeCheck({ id: "a", status: "pass" }),
        makeCheck({ id: "b", status: "pass" }),
        makeCheck({ id: "c", status: "fail", severity: "p0" }),
        makeCheck({ id: "d", status: "skipped", severity: "skipped" }),
        makeCheck({ id: "e", status: "known_existing_failure", severity: "p2" }),
      ],
      runnerMeta: makeRunnerMeta(),
    });
    const s = summarizeQualityGateRun(run, "phase1-quality-gate-x.json");
    expect(s.totalChecks).toBe(5);
    expect(s.passCount).toBe(2);
    expect(s.failCount).toBe(1);
    expect(s.skippedCount).toBe(1);
    expect(s.knownExistingFailureCount).toBe(1);
  });
  it("carries fileName + command + label", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      checks: [],
      runnerMeta: makeRunnerMeta({ command: "npm run gate:phase1 -- --label=ci-pr-42", label: "ci-pr-42" }),
    });
    const s = summarizeQualityGateRun(run, "phase1-quality-gate-abc.json");
    expect(s.fileName).toBe("phase1-quality-gate-abc.json");
    expect(s.command).toBe("npm run gate:phase1 -- --label=ci-pr-42");
    expect(s.label).toBe("ci-pr-42");
  });
  it("carries undefined label when none set", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      checks: [],
      runnerMeta: makeRunnerMeta({ label: undefined }),
    });
    const s = summarizeQualityGateRun(run, "x.json");
    expect(s.label).toBeUndefined();
  });
});

/* ─── parseQualityGateRun ─────────────────────────────────────────── */

describe("parseQualityGateRun", () => {
  function freshRunPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const base: Record<string, unknown> = {
      schemaVersion: QUALITY_GATE_SCHEMA_VERSION,
      runId: "abc",
      generatedAt: "2026-05-04T08:00:00.000Z",
      checks: [],
      verdict: "pass",
      exitCode: 0,
      runnerMeta: {
        command: "npm run gate:phase1",
        nodeVersion: "v20.18.0",
        durationMs: 100,
        startedAt: "2026-05-04T08:00:00.000Z",
      },
    };
    return { ...base, ...overrides };
  }

  it("throws on top-level non-object", () => {
    expect(() => parseQualityGateRun(null)).toThrow(QualityGateParseError);
    expect(() => parseQualityGateRun("hi")).toThrow(QualityGateParseError);
    expect(() => parseQualityGateRun([])).toThrow(QualityGateParseError);
  });
  it("throws on schemaVersion mismatch", () => {
    expect(() =>
      parseQualityGateRun(freshRunPayload({ schemaVersion: 99 })),
    ).toThrow(/schemaVersion/);
  });
  it("throws on missing runId", () => {
    const payload = freshRunPayload();
    delete payload.runId;
    expect(() => parseQualityGateRun(payload)).toThrow(/runId/);
  });
  it("throws on missing generatedAt", () => {
    const payload = freshRunPayload();
    delete payload.generatedAt;
    expect(() => parseQualityGateRun(payload)).toThrow(/generatedAt/);
  });
  it("throws on invalid verdict", () => {
    expect(() => parseQualityGateRun(freshRunPayload({ verdict: "wat" }))).toThrow(
      /verdict/,
    );
  });
  it("throws on invalid exitCode", () => {
    expect(() => parseQualityGateRun(freshRunPayload({ exitCode: 7 }))).toThrow(
      /exitCode/,
    );
  });
  it("throws on non-array checks", () => {
    expect(() => parseQualityGateRun(freshRunPayload({ checks: "not array" }))).toThrow(
      /checks/,
    );
  });
  it("throws when a check entry is not an object", () => {
    expect(() => parseQualityGateRun(freshRunPayload({ checks: [42] }))).toThrow(
      /checks\[0\]/,
    );
  });
  it("throws on missing runnerMeta", () => {
    const payload = freshRunPayload();
    delete payload.runnerMeta;
    expect(() => parseQualityGateRun(payload)).toThrow(/runnerMeta/);
  });
  it("round-trips a buildQualityGateRun result", () => {
    const original = buildQualityGateRun({
      runId: "abc",
      checks: [
        makeCheck({ id: "tsc", status: "pass" }),
        makeCheck({ id: "check-drift", status: "fail", severity: "p1" }),
      ],
      runnerMeta: makeRunnerMeta(),
    });
    const parsed = parseQualityGateRun(JSON.parse(JSON.stringify(original)));
    expect(parsed.runId).toBe(original.runId);
    expect(parsed.verdict).toBe(original.verdict);
    expect(parsed.exitCode).toBe(original.exitCode);
    expect(parsed.checks.length).toBe(original.checks.length);
  });
  it("defaults garbage status to pending in checks", () => {
    const payload = freshRunPayload({
      checks: [
        {
          id: "x",
          label: "x",
          command: "x",
          requirement: "required",
          status: "wrong",
          severity: "skipped",
          durationMs: 0,
          startedAt: "2026-05-04T08:00:00.000Z",
          stdoutTail: "",
          stderrTail: "",
        },
      ],
    });
    const parsed = parseQualityGateRun(payload);
    expect(parsed.checks[0].status).toBe("pending");
  });
  it("tolerates missing optional runnerMeta fields", () => {
    const payload = freshRunPayload({
      runnerMeta: {
        command: "npm run gate:phase1",
        nodeVersion: "v20",
        durationMs: 0,
        startedAt: "2026-05-04T08:00:00.000Z",
        // no baseUrl, no label
      },
    });
    const parsed = parseQualityGateRun(payload);
    expect(parsed.runnerMeta.baseUrl).toBeUndefined();
    expect(parsed.runnerMeta.label).toBeUndefined();
  });
});

/* ─── Filename safety ─────────────────────────────────────────────── */

describe("isSafeQualityGateFileName + QUALITY_GATE_FILE_PATTERN", () => {
  it("matches a well-formed json filename", () => {
    expect(isSafeQualityGateFileName("phase1-quality-gate-abc.json")).toBe(true);
  });
  it("matches a well-formed md filename", () => {
    expect(isSafeQualityGateFileName("phase1-quality-gate-abc.md")).toBe(true);
  });
  it("matches timestamp-flavored runId", () => {
    expect(
      isSafeQualityGateFileName("phase1-quality-gate-2026-05-04T08-00-00-000Z.json"),
    ).toBe(true);
  });
  it("rejects path traversal", () => {
    expect(isSafeQualityGateFileName("phase1-quality-gate-../etc/passwd.json")).toBe(false);
  });
  it("rejects backslash", () => {
    expect(isSafeQualityGateFileName("phase1-quality-gate-x\\y.json")).toBe(false);
  });
  it("rejects forward slash", () => {
    expect(isSafeQualityGateFileName("phase1-quality-gate-x/y.json")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(isSafeQualityGateFileName("")).toBe(false);
  });
  it("rejects non-string", () => {
    expect(isSafeQualityGateFileName(123 as unknown as string)).toBe(false);
    expect(isSafeQualityGateFileName(null)).toBe(false);
  });
  it("rejects unsupported suffix (.txt)", () => {
    expect(isSafeQualityGateFileName("phase1-quality-gate-abc.txt")).toBe(false);
  });
  it("rejects wrong prefix", () => {
    expect(isSafeQualityGateFileName("foo-abc.json")).toBe(false);
  });
  it("rejects extremely long name (200 char cap)", () => {
    const long = "phase1-quality-gate-" + "a".repeat(300) + ".json";
    expect(isSafeQualityGateFileName(long)).toBe(false);
  });
  it("QUALITY_GATE_FILE_PATTERN is exported and matches", () => {
    expect(QUALITY_GATE_FILE_PATTERN.test("phase1-quality-gate-abc.json")).toBe(true);
  });
});

describe("fileNameForQualityGateRun + fileNameFromRunId", () => {
  it("builds canonical name with json suffix", () => {
    expect(fileNameForQualityGateRun("abc", "json")).toBe("phase1-quality-gate-abc.json");
  });
  it("builds canonical name with md suffix", () => {
    expect(fileNameForQualityGateRun("abc", "md")).toBe("phase1-quality-gate-abc.md");
  });
  it("sanitizes runId — strips slashes", () => {
    expect(fileNameForQualityGateRun("a/b\\c", "json")).toBe("phase1-quality-gate-a-b-c.json");
  });
  it("sanitizes runId — strips colons", () => {
    expect(fileNameForQualityGateRun("a:b", "json")).toBe("phase1-quality-gate-a-b.json");
  });
  it("throws on empty runId", () => {
    expect(() => fileNameForQualityGateRun("", "json")).toThrow();
  });
  it("throws on bad suffix", () => {
    expect(() => fileNameForQualityGateRun("abc", "txt" as unknown as "json")).toThrow();
  });
  it("fileNameFromRunId equals fileNameForQualityGateRun(.json)", () => {
    expect(fileNameFromRunId("abc")).toBe(fileNameForQualityGateRun("abc", "json"));
  });
});

/* ─── Display constants ───────────────────────────────────────────── */

describe("display constants", () => {
  it("GATE_VERDICT_LABEL has all 4 verdicts", () => {
    expect(GATE_VERDICT_LABEL.pass).toBeTruthy();
    expect(GATE_VERDICT_LABEL.needs_polish).toBeTruthy();
    expect(GATE_VERDICT_LABEL.fail).toBeTruthy();
    expect(GATE_VERDICT_LABEL.env_blocked).toBeTruthy();
  });
  it("GATE_VERDICT_TONE assigns a tone per verdict", () => {
    expect(GATE_VERDICT_TONE.pass).toBe("good");
    expect(GATE_VERDICT_TONE.needs_polish).toBe("warn");
    expect(GATE_VERDICT_TONE.fail).toBe("bad");
    expect(GATE_VERDICT_TONE.env_blocked).toBe("neutral");
  });
  it("GATE_STATUS_LABEL has all 5 statuses", () => {
    expect(GATE_STATUS_LABEL.pending).toBeTruthy();
    expect(GATE_STATUS_LABEL.pass).toBeTruthy();
    expect(GATE_STATUS_LABEL.fail).toBeTruthy();
    expect(GATE_STATUS_LABEL.skipped).toBeTruthy();
    expect(GATE_STATUS_LABEL.known_existing_failure).toBeTruthy();
  });
  it("GATE_STATUS_TONE assigns a tone per status", () => {
    expect(GATE_STATUS_TONE.pass).toBe("good");
    expect(GATE_STATUS_TONE.fail).toBe("bad");
    expect(GATE_STATUS_TONE.known_existing_failure).toBe("warn");
  });
  it("GATE_SEVERITY_LABEL has all 5 severities", () => {
    expect(GATE_SEVERITY_LABEL.p0).toBe("P0");
    expect(GATE_SEVERITY_LABEL.p1).toBe("P1");
    expect(GATE_SEVERITY_LABEL.p2).toBe("P2");
    expect(GATE_SEVERITY_LABEL.env).toBe("ENV");
    expect(GATE_SEVERITY_LABEL.skipped).toBe("—");
  });
});

/* ─── formatDurationForMarkdown ───────────────────────────────────── */

describe("formatDurationForMarkdown", () => {
  it("renders sub-second as ms", () => {
    expect(formatDurationForMarkdown(500)).toBe("500ms");
  });
  it("renders seconds with one decimal", () => {
    expect(formatDurationForMarkdown(1500)).toBe("1.5s");
  });
  it("renders 0 as 0ms", () => {
    expect(formatDurationForMarkdown(0)).toBe("0ms");
  });
  it("renders negative as em-dash", () => {
    expect(formatDurationForMarkdown(-100)).toBe("—");
  });
  it("renders NaN as em-dash", () => {
    expect(formatDurationForMarkdown(Number.NaN)).toBe("—");
  });
  it("rounds ms portion", () => {
    expect(formatDurationForMarkdown(123.7)).toBe("124ms");
  });
});

/* ─── formatQualityGateMarkdown ───────────────────────────────────── */

describe("formatQualityGateMarkdown", () => {
  it("includes verdict label in header", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      checks: [makeCheck({ id: "tsc", status: "pass" })],
      runnerMeta: makeRunnerMeta(),
    });
    const md = formatQualityGateMarkdown(run);
    expect(md).toContain("Phase 1 Quality Gate — Pass");
  });
  it("includes summary table", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      checks: [makeCheck({ id: "tsc", status: "pass" })],
      runnerMeta: makeRunnerMeta(),
    });
    const md = formatQualityGateMarkdown(run);
    expect(md).toContain("## Summary");
    expect(md).toContain("✅ Pass");
  });
  it("renders the checks table", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      checks: [makeCheck({ id: "tsc", status: "pass" })],
      runnerMeta: makeRunnerMeta(),
    });
    const md = formatQualityGateMarkdown(run);
    expect(md).toContain("## Checks");
    expect(md).toContain("`tsc`");
  });
  it("emits failing-checks section when something fails", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      checks: [makeCheck({ id: "check-drift", status: "fail", severity: "p1", stdoutTail: "boom", stderrTail: "diff!" })],
      runnerMeta: makeRunnerMeta(),
    });
    const md = formatQualityGateMarkdown(run);
    expect(md).toContain("## Failing checks");
    expect(md).toContain("[P1] `check-drift` — Fail");
    expect(md).toContain("boom");
    expect(md).toContain("diff!");
  });
  it("includes known_existing_failure rows in failing-checks section", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      checks: [
        makeCheck({
          id: "check-drift",
          status: "known_existing_failure",
          severity: "p2",
          notes: "pre-existing",
        }),
      ],
      runnerMeta: makeRunnerMeta(),
    });
    const md = formatQualityGateMarkdown(run);
    expect(md).toContain("[P2] `check-drift` — Known existing failure");
    expect(md).toContain("pre-existing");
  });
  it("escapes pipe characters in command/id", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      checks: [
        makeCheck({
          id: "x",
          command: "foo | bar",
          status: "pass",
        }),
      ],
      runnerMeta: makeRunnerMeta(),
    });
    const md = formatQualityGateMarkdown(run);
    expect(md).toContain("foo \\| bar");
  });
  it("is idempotent for the same input", () => {
    const run = buildQualityGateRun({
      runId: "abc",
      checks: [makeCheck({ id: "tsc", status: "pass" })],
      runnerMeta: makeRunnerMeta({ startedAt: "2026-05-04T08:00:00.000Z" }),
      generatedAt: "2026-05-04T08:00:00.000Z",
    });
    const a = formatQualityGateMarkdown(run);
    const b = formatQualityGateMarkdown(run);
    expect(a).toBe(b);
  });
});

/* ─── Loader (filesystem) ─────────────────────────────────────────── */

describe("loader (filesystem)", () => {
  const originalCwd = process.cwd();
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qgate-"));
    await fs.mkdir(path.join(tmpRoot, "benchmark", "runs"), { recursive: true });
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

  it("getQualityGateRunsDir resolves under cwd", () => {
    const dir = getQualityGateRunsDir();
    expect(dir).toBe(path.resolve(tmpRoot, "benchmark", "runs"));
  });
  it("listQualityGateRunSummaries returns [] for empty dir", async () => {
    const list = await listQualityGateRunSummaries();
    expect(list).toEqual([]);
  });
  it("listQualityGateRunSummaries returns [] when dir does not exist", async () => {
    await fs.rm(path.join(tmpRoot, "benchmark"), { recursive: true, force: true });
    const list = await listQualityGateRunSummaries();
    expect(list).toEqual([]);
  });
  it("save then read round-trips", async () => {
    const run = buildQualityGateRun({
      runId: "rt",
      checks: [makeCheck({ id: "tsc", status: "pass" })],
      runnerMeta: makeRunnerMeta(),
    });
    await saveQualityGateRun(run);
    const list = await listQualityGateRunSummaries();
    expect(list).toHaveLength(1);
    expect(list[0].runId).toBe("rt");

    const loaded = await readQualityGateRunByFile(list[0].fileName);
    expect(loaded.runId).toBe(run.runId);
    expect(loaded.verdict).toBe(run.verdict);
  });
  it("listQualityGateRunSummaries skips non-matching files", async () => {
    await fs.writeFile(
      path.join(tmpRoot, "benchmark", "runs", "garbage.json"),
      "{}",
      "utf8",
    );
    await fs.writeFile(
      path.join(tmpRoot, "benchmark", "runs", "phase1-quality-gate-good.json"),
      JSON.stringify(
        buildQualityGateRun({
          runId: "good",
          checks: [],
          runnerMeta: makeRunnerMeta(),
        }),
      ),
      "utf8",
    );
    const list = await listQualityGateRunSummaries();
    expect(list.map((s) => s.runId)).toEqual(["good"]);
  });
  it("listQualityGateRunSummaries silently skips invalid JSON", async () => {
    await fs.writeFile(
      path.join(tmpRoot, "benchmark", "runs", "phase1-quality-gate-bad.json"),
      "{this is not json",
      "utf8",
    );
    const list = await listQualityGateRunSummaries();
    expect(list).toEqual([]);
  });
  it("listQualityGateRunSummaries sorts newest-first", async () => {
    const a = buildQualityGateRun({
      runId: "alpha",
      generatedAt: "2026-05-04T01:00:00.000Z",
      checks: [],
      runnerMeta: makeRunnerMeta(),
    });
    const b = buildQualityGateRun({
      runId: "bravo",
      generatedAt: "2026-05-04T02:00:00.000Z",
      checks: [],
      runnerMeta: makeRunnerMeta(),
    });
    await saveQualityGateRun(a);
    await saveQualityGateRun(b);
    const list = await listQualityGateRunSummaries();
    expect(list.map((s) => s.runId)).toEqual(["bravo", "alpha"]);
  });
  it("resolveSafeRunPath rejects traversal", () => {
    expect(() => resolveSafeRunPath("../etc/passwd")).toThrow(QualityGateLoaderError);
    expect(() => resolveSafeRunPath("phase1-quality-gate-../etc.json")).toThrow(
      QualityGateLoaderError,
    );
  });
  it("resolveSafeRunPath returns a path inside the runs dir", () => {
    const resolved = resolveSafeRunPath("phase1-quality-gate-abc.json");
    expect(resolved.startsWith(getQualityGateRunsDir() + path.sep)).toBe(true);
  });
  it("readQualityGateRunByFile throws on bad json", async () => {
    await fs.writeFile(
      path.join(tmpRoot, "benchmark", "runs", "phase1-quality-gate-bad.json"),
      "{",
      "utf8",
    );
    await expect(
      readQualityGateRunByFile("phase1-quality-gate-bad.json"),
    ).rejects.toThrow(QualityGateLoaderError);
  });
});
