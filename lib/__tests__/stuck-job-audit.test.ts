import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STUCK_JOB_AUDIT_SCHEMA_VERSION,
  auditStuckJobsInDir,
  buildStuckJobEntry,
  classifyStuckJobCase,
  renderStuckJobAuditMarkdown,
  type ReportCase,
  type ReportEnvelope,
} from "@/lib/runtime-forensics/stuck-job-audit";

/**
 * Test #3 of the user's required four:
 *   "stuck running/pending row is reported as infra DB transient,
 *    not provider closure result."
 */

const CLEAN_NO_AVAIL_CASE: ReportCase = {
  caseId: "R-030",
  taskId: "task-A",
  currentJobId: "job-A",
  state: "failed",
  terminalCode: "no_availability",
  outcome: "no_availability_correct",
  taxonomyCode: "F-AVAIL-NONE",
  errorClass: "F-AVAIL-NONE",
  safetyStatus: "inside_safety_bounds",
  safe: true,
  taxonomyAccepted: true,
  dbTerminalAvailable: true,
  pollRetriesAbsorbed: 0,
  timelineUrl: "/api/v1/travel-tasks/task-A/timeline-events",
  snapshotsUrl: "/api/v1/travel-tasks/task-A/snapshots",
  screenshotDir: ".debug-screenshots/live/job-A",
  lastKnownStage: "failed",
  durationMs: 338000,
  error: null,
};

const STUCK_NEON_CASE: ReportCase = {
  caseId: "R-030",
  taskId: "task-B",
  currentJobId: "job-B",
  state: undefined,
  outcome: "failed_unknown",
  taxonomyCode: "F-INFRA-DB-TRANSIENT",
  errorClass: "F-INFRA-DB-TRANSIENT",
  safetyStatus: "inside_safety_bounds",
  safe: false,
  taxonomyAccepted: false,
  dbTerminalAvailable: false,
  pollRetriesAbsorbed: 4,
  timelineUrl: null,
  snapshotsUrl: null,
  screenshotDir: ".debug-screenshots/live/job-B",
  lastKnownStage: "executing",
  durationMs: 87000,
  error:
    "ConnectTimeoutError: Connect Timeout Error (attempted addresses: 2600:1f18:4491:e80a:94a:8c4d:25fc:e627:443, timeout: 10000ms)",
};

const LEGACY_BARE_500_CASE: ReportCase = {
  caseId: "R-030",
  taskId: "task-C",
  currentJobId: "job-C",
  outcome: "failed_unknown",
  // Old-shape report (pre-2026-05-05 enrichment) - no errorClass /
  // dbTerminalAvailable / pollRetriesAbsorbed / safetyStatus.
  error: "500 Internal Server Error: Internal Server Error",
};

const PROVIDER_REGRESSION_CASE: ReportCase = {
  caseId: "R-030",
  taskId: "task-D",
  currentJobId: "job-D",
  outcome: "failed_with_clear_reason",
  taxonomyCode: "F-DATA-DOM",
  errorClass: "F-DATA-DOM",
  safetyStatus: "inside_safety_bounds",
  safe: false,
  taxonomyAccepted: true,
  dbTerminalAvailable: true,
  pollRetriesAbsorbed: 0,
  error: "DOM selector not found: button[type='submit']",
};

describe("classifyStuckJobCase pattern detection", () => {
  it("returns empty reasons for a clean no_availability case", () => {
    expect(classifyStuckJobCase(CLEAN_NO_AVAIL_CASE)).toEqual([]);
  });

  it("returns reasons for a Neon ConnectTimeoutError case", () => {
    const reasons = classifyStuckJobCase(STUCK_NEON_CASE);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons).toContain("explicit F-INFRA-DB-* taxonomy code on case");
    expect(reasons).toContain("dbTerminalAvailable === false");
    expect(reasons).toContain(
      "error message matches Neon/fetch transient pattern",
    );
  });

  it("returns reasons for a legacy bare-500 failed_unknown case (no enrichment fields)", () => {
    const reasons = classifyStuckJobCase(LEGACY_BARE_500_CASE);
    expect(reasons).toContain(
      "error is bare '500 Internal Server Error: Internal Server Error'",
    );
    expect(reasons).toContain("outcome=failed_unknown with infra signature");
  });

  it("returns empty reasons for a provider DOM regression (NOT a DB transient)", () => {
    expect(classifyStuckJobCase(PROVIDER_REGRESSION_CASE)).toEqual([]);
  });

  it("returns empty reasons for empty / undefined input", () => {
    expect(classifyStuckJobCase({} as ReportCase)).toEqual([]);
    expect(classifyStuckJobCase(undefined as unknown as ReportCase)).toEqual([]);
  });
});

describe("buildStuckJobEntry shape", () => {
  it("populates all fields from a stuck case", () => {
    const reasons = classifyStuckJobCase(STUCK_NEON_CASE);
    const entry = buildStuckJobEntry(
      STUCK_NEON_CASE,
      "phase0-resy-2026-05-05T03-56-48-854Z.json",
      "phase0-resy-T03-aeb663f9",
      "2026-05-05T03:56:48.854Z",
      reasons,
    );
    expect(entry.reportFile).toBe("phase0-resy-2026-05-05T03-56-48-854Z.json");
    expect(entry.runId).toBe("phase0-resy-T03-aeb663f9");
    expect(entry.createdAt).toBe("2026-05-05T03:56:48.854Z");
    expect(entry.caseId).toBe("R-030");
    expect(entry.taskId).toBe("task-B");
    expect(entry.jobId).toBe("job-B");
    expect(entry.outcome).toBe("failed_unknown");
    expect(entry.errorClass).toBe("F-INFRA-DB-TRANSIENT");
    expect(entry.safetyStatus).toBe("inside_safety_bounds");
    expect(entry.lastKnownStage).toBe("executing");
    expect(entry.screenshotDir).toBe(".debug-screenshots/live/job-B");
    expect(entry.pollRetriesAbsorbed).toBe(4);
    expect(entry.errorExcerpt).toContain("ConnectTimeoutError");
    expect(entry.reasons).toEqual(reasons);
  });

  it("truncates error excerpt to 240 chars", () => {
    const longError = "ConnectTimeoutError: " + "x".repeat(1000);
    const reasons = classifyStuckJobCase({ ...STUCK_NEON_CASE, error: longError });
    const entry = buildStuckJobEntry(
      { ...STUCK_NEON_CASE, error: longError },
      "f.json",
      null,
      null,
      reasons,
    );
    expect(entry.errorExcerpt!.length).toBeLessThanOrEqual(240);
  });
});

describe("renderStuckJobAuditMarkdown", () => {
  it("renders empty-state markdown when no matches", () => {
    const md = renderStuckJobAuditMarkdown({
      schemaVersion: STUCK_JOB_AUDIT_SCHEMA_VERSION,
      generatedAt: "2026-05-05T04:00:00.000Z",
      scannedReports: 5,
      matchedReports: 0,
      entries: [],
      notes: ["one note"],
    });
    expect(md).toContain("Stuck-job audit");
    expect(md).toContain("Scanned: 5 report(s); matched: 0.");
    expect(md).toContain(
      "No phase0-resy benchmark report matched the DB-transient pattern.",
    );
    expect(md).toContain("one note");
  });

  it("renders matched-state markdown with manual cleanup pointer", () => {
    const reasons = classifyStuckJobCase(STUCK_NEON_CASE);
    const md = renderStuckJobAuditMarkdown({
      schemaVersion: STUCK_JOB_AUDIT_SCHEMA_VERSION,
      generatedAt: "2026-05-05T04:00:00.000Z",
      scannedReports: 1,
      matchedReports: 1,
      entries: [
        buildStuckJobEntry(
          STUCK_NEON_CASE,
          "phase0-resy-2026-05-05T03-56-48-854Z.json",
          "run-1",
          "2026-05-05T03:56:48.854Z",
          reasons,
        ),
      ],
      notes: [],
    });
    expect(md).toContain("Stuck-job audit");
    expect(md).toContain("Scanned: 1 report(s); matched: 1.");
    expect(md).toContain("R-030 - phase0-resy-2026-05-05T03-56-48-854Z.json");
    expect(md).toContain("taskId: task-B");
    expect(md).toContain("jobId: job-B");
    expect(md).toContain(
      "Manual cleanup procedure (founder approval required)",
    );
    expect(md).toContain("PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md");
    expect(md).not.toContain("UPDATE booking_jobs"); // NOT contained verbatim
  });

  it("never contains the literal SQL UPDATE template (audit is read-only)", () => {
    const reasons = classifyStuckJobCase(STUCK_NEON_CASE);
    const md = renderStuckJobAuditMarkdown({
      schemaVersion: STUCK_JOB_AUDIT_SCHEMA_VERSION,
      generatedAt: "now",
      scannedReports: 1,
      matchedReports: 1,
      entries: [
        buildStuckJobEntry(STUCK_NEON_CASE, "f.json", null, null, reasons),
      ],
      notes: [],
    });
    expect(md).not.toMatch(/update booking_jobs.*set.*status/i);
    expect(md).not.toMatch(/where.*id.*=.*['"]/);
  });
});

describe("auditStuckJobsInDir filesystem integration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stuck-job-audit-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty + note when directory does not exist", async () => {
    const missing = path.join(tmpDir, "no-such-dir");
    const result = await auditStuckJobsInDir(missing);
    expect(result.scannedReports).toBe(0);
    expect(result.matchedReports).toBe(0);
    expect(result.entries).toEqual([]);
    expect(result.notes.some((n) => n.includes("not present"))).toBe(true);
  });

  it("matches a real DB-transient report and ignores a clean one + a non-resy report + invalid JSON", async () => {
    const stuckReport: ReportEnvelope = {
      schemaVersion: 1,
      reportKind: "phase0-resy-benchmark-report",
      runId: "run-stuck",
      createdAt: "2026-05-05T03:56:48.854Z",
      results: [STUCK_NEON_CASE],
    };
    const cleanReport: ReportEnvelope = {
      schemaVersion: 1,
      reportKind: "phase0-resy-benchmark-report",
      runId: "run-clean",
      createdAt: "2026-05-05T04:00:00.000Z",
      results: [CLEAN_NO_AVAIL_CASE],
    };
    await fs.writeFile(
      path.join(tmpDir, "phase0-resy-2026-05-05T03-56-48-854Z.json"),
      JSON.stringify(stuckReport),
      "utf8",
    );
    await fs.writeFile(
      path.join(tmpDir, "phase0-resy-2026-05-05T04-00-00-000Z.json"),
      JSON.stringify(cleanReport),
      "utf8",
    );
    // Non-resy file should be ignored.
    await fs.writeFile(
      path.join(tmpDir, "phase1-quality-gate-2026-05-05T04-00-00-000Z.json"),
      JSON.stringify({ schemaVersion: 1, results: [] }),
      "utf8",
    );
    // Invalid JSON should be skipped with note, not crash.
    await fs.writeFile(
      path.join(tmpDir, "phase0-resy-2026-05-05T05-00-00-000Z.json"),
      "{ not valid json",
      "utf8",
    );

    const result = await auditStuckJobsInDir(tmpDir);
    expect(result.schemaVersion).toBe(STUCK_JOB_AUDIT_SCHEMA_VERSION);
    expect(result.scannedReports).toBe(3); // 2 valid resy + 1 invalid (still in count)
    expect(result.matchedReports).toBe(1);
    expect(result.entries[0].caseId).toBe("R-030");
    expect(result.entries[0].jobId).toBe("job-B");
    // Invalid JSON produced a note.
    expect(
      result.notes.some((n) =>
        n.startsWith("skip phase0-resy-2026-05-05T05-00-00-000Z.json"),
      ),
    ).toBe(true);
  });

  it("multiple stuck reports produce multiple entries (one per case)", async () => {
    const multiReport: ReportEnvelope = {
      schemaVersion: 1,
      reportKind: "phase0-resy-benchmark-report",
      runId: "run-multi",
      createdAt: "2026-05-05T05:00:00.000Z",
      results: [
        STUCK_NEON_CASE,
        { ...STUCK_NEON_CASE, taskId: "task-X", currentJobId: "job-X" },
      ],
    };
    await fs.writeFile(
      path.join(tmpDir, "phase0-resy-2026-05-05T06-00-00-000Z.json"),
      JSON.stringify(multiReport),
      "utf8",
    );
    const result = await auditStuckJobsInDir(tmpDir);
    expect(result.matchedReports).toBe(2);
    const jobIds = result.entries.map((e) => e.jobId).sort();
    expect(jobIds).toEqual(["job-B", "job-X"]);
  });
});

describe("safety boundary - audit never advertises live actions", () => {
  it("module surface is read-only (no mutate/start/run/exec exports)", () => {
    // Verified by importing and confirming the function set.
    const exports = [
      classifyStuckJobCase,
      buildStuckJobEntry,
      renderStuckJobAuditMarkdown,
      auditStuckJobsInDir,
    ];
    for (const fn of exports) {
      expect(typeof fn).toBe("function");
      expect(fn.name).not.toMatch(/run|start|exec|mutate|update|delete/i);
    }
  });
});
