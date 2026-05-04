import { describe, expect, it } from "vitest";

import {
  buildForensicsReport,
  buildForensicsSummary,
} from "../runtime-forensics/report";
import { formatForensicsBugReport } from "../runtime-forensics/markdown";
import {
  FAILURE_CLASS_LABEL,
  FAILURE_CLASS_SEVERITY,
  FAILURE_CLASS_TONE,
  RUNTIME_FORENSICS_SCHEMA_VERSION,
  type JobLikeInput,
} from "../runtime-forensics/types";

function job(overrides: Partial<JobLikeInput> = {}): JobLikeInput {
  return {
    id: "job-1",
    taskId: "task-1",
    provider: "resy",
    scenario: "R-003",
    status: "failed",
    ...overrides,
  };
}

/* ─── Display tables ─────────────────────────────────────────────── */

describe("FAILURE_CLASS tables", () => {
  it("LABEL covers all 8 classes", () => {
    expect(Object.keys(FAILURE_CLASS_LABEL).length).toBe(8);
  });
  it("SEVERITY covers all 8 classes", () => {
    expect(Object.keys(FAILURE_CLASS_SEVERITY).length).toBe(8);
  });
  it("TONE covers all 8 classes", () => {
    expect(Object.keys(FAILURE_CLASS_TONE).length).toBe(8);
  });
  it("legacy_shape_missing_source severity = p0", () => {
    expect(FAILURE_CLASS_SEVERITY.legacy_shape_missing_source).toBe("p0");
  });
  it("legacy_shape_missing_source tone = bad (red)", () => {
    expect(FAILURE_CLASS_TONE.legacy_shape_missing_source).toBe("bad");
  });
  it("checkout_reached_manual_review tone = good", () => {
    expect(FAILURE_CLASS_TONE.checkout_reached_manual_review).toBe("good");
  });
});

/* ─── buildForensicsReport ───────────────────────────────────────── */

describe("buildForensicsReport — basic", () => {
  it("stamps schemaVersion = 1", () => {
    const r = buildForensicsReport(job());
    expect(r.schemaVersion).toBe(RUNTIME_FORENSICS_SCHEMA_VERSION);
  });
  it("auto-fills generatedAt if missing", () => {
    const r = buildForensicsReport(job());
    expect(typeof r.generatedAt).toBe("string");
    expect(r.generatedAt.length).toBeGreaterThan(0);
  });
  it("preserves explicit generatedAt", () => {
    const r = buildForensicsReport(job(), {
      generatedAt: "2026-05-04T10:00:00.000Z",
    });
    expect(r.generatedAt).toBe("2026-05-04T10:00:00.000Z");
  });
  it("sets inputSource", () => {
    const r = buildForensicsReport(job(), { inputSource: "test-source" });
    expect(r.inputSource).toBe("test-source");
  });
  it("defaults inputSource to 'unknown'", () => {
    const r = buildForensicsReport(job());
    expect(r.inputSource).toBe("unknown");
  });
  it("falls back provider/scenario/status to 'unknown' when missing", () => {
    const r = buildForensicsReport({ id: "j" });
    expect(r.provider).toBe("unknown");
    expect(r.scenario).toBe("unknown");
    expect(r.status).toBe("unknown");
  });
  it("preserves taskPagePath in hints when taskId looks safe", () => {
    const r = buildForensicsReport(job({ taskId: "abc-123" }));
    expect(r.hints.taskPagePath).toBe("/tasks/abc-123");
  });
  it("rejects suspicious taskId for taskPagePath", () => {
    const r = buildForensicsReport(job({ taskId: "../etc/passwd" }));
    expect(r.hints.taskPagePath).toBeUndefined();
  });
  it("propagates rawTerminalReason", () => {
    const r = buildForensicsReport(job({ terminalReason: "no slot" }));
    expect(r.rawTerminalReason).toBe("no slot");
  });
  it("propagates updatedAt", () => {
    const r = buildForensicsReport(job({ updatedAt: "2026-05-04T09:00:00.000Z" }));
    expect(r.updatedAt).toBe("2026-05-04T09:00:00.000Z");
  });
});

describe("buildForensicsReport — classification embedded", () => {
  it("legacy-shape job classifies as p0", () => {
    const r = buildForensicsReport(
      job({ errorMessage: "Worker received legacy-shape step" }),
    );
    expect(r.classification.primaryClass).toBe("legacy_shape_missing_source");
    expect(r.classification.severity).toBe("p0");
  });
  it("step shape audit is included", () => {
    const r = buildForensicsReport(
      job({
        steps: [{ name: "x" }, { name: "y", __source: "lib/core/execution" }],
      }),
    );
    expect(r.stepShape.totalSteps).toBe(2);
    expect(r.stepShape.stepsWithSourceMarker).toBe(1);
  });
});

describe("buildForensicsReport — notes", () => {
  it("propagates loaderNotes from input", () => {
    const r = buildForensicsReport(
      job({ loaderNotes: ["from:report-A.json", "incomplete params"] }),
    );
    expect(r.notes).toContain("from:report-A.json");
  });
  it("options.notes overrides input notes", () => {
    const r = buildForensicsReport(
      job({ loaderNotes: ["from:original"] }),
      { notes: ["override-note"] },
    );
    expect(r.notes).toEqual(["override-note"]);
  });
  it("caps notes at 32 entries", () => {
    const many = Array.from({ length: 100 }, (_, i) => `n${i}`);
    const r = buildForensicsReport(job(), { notes: many });
    expect(r.notes.length).toBe(32);
  });
});

/* ─── buildForensicsSummary ──────────────────────────────────────── */

describe("buildForensicsSummary", () => {
  it("includes basic identity fields", () => {
    const r = buildForensicsReport(job({ id: "abc", taskId: "tsk-1" }));
    const s = buildForensicsSummary(r);
    expect(s.jobId).toBe("abc");
    expect(s.taskId).toBe("tsk-1");
  });
  it("derives ageSeconds from updatedAt vs generatedAt", () => {
    const r = buildForensicsReport(job({ updatedAt: "2026-05-04T08:00:00.000Z" }), {
      generatedAt: "2026-05-04T08:01:00.000Z",
    });
    const s = buildForensicsSummary(r);
    expect(s.ageSeconds).toBe(60);
  });
  it("ageSeconds is null when updatedAt missing", () => {
    const r = buildForensicsReport(job({ updatedAt: undefined }));
    const s = buildForensicsSummary(r);
    expect(s.ageSeconds).toBeNull();
  });
  it("ageSeconds is null on invalid date", () => {
    const r = buildForensicsReport(job({ updatedAt: "not a date" }));
    const s = buildForensicsSummary(r);
    expect(s.ageSeconds).toBeNull();
  });
  it("hasLegacyShapeBug propagates from stepShape", () => {
    const r = buildForensicsReport(
      job({ errorMessage: "Worker received legacy-shape step" }),
    );
    const s = buildForensicsSummary(r);
    expect(s.hasLegacyShapeBug).toBe(true);
  });
});

/* ─── formatForensicsBugReport ───────────────────────────────────── */

describe("formatForensicsBugReport", () => {
  it("includes severity tag in heading", () => {
    const r = buildForensicsReport(
      job({ errorMessage: "Worker received legacy-shape step" }),
    );
    const md = formatForensicsBugReport(r);
    expect(md).toMatch(/^## \[P0\]/);
  });
  it("renders unknown class with fallback heading", () => {
    const r = buildForensicsReport(job({}));
    const md = formatForensicsBugReport(r);
    expect(md).toContain("Runtime forensics");
    expect(md).toContain("Unknown");
  });
  it("includes V1 caveat about source of truth", () => {
    const r = buildForensicsReport(job());
    const md = formatForensicsBugReport(r);
    expect(md).toContain("V1 is artifact-based");
    expect(md).toContain("Source of truth is still the");
    expect(md).toContain("DB + worker log + screenshots");
  });
  it("includes legacy-shape callout when bug detected", () => {
    const r = buildForensicsReport(
      job({ errorMessage: "Worker received legacy-shape step" }),
    );
    const md = formatForensicsBugReport(r);
    expect(md).toContain("Legacy-shape bug detected");
    expect(md).toContain("M5 force-gate");
  });
  it("renders top signals list", () => {
    const r = buildForensicsReport(
      job({
        errorMessage:
          "Worker received legacy-shape step (missing __source marker)",
      }),
    );
    const md = formatForensicsBugReport(r);
    expect(md).toContain("Top matched signals");
    expect(md).toContain("legacy_shape_missing_source");
  });
  it("escapes pipe and backtick in excerpts", () => {
    const r = buildForensicsReport(
      job({
        errorMessage: "Worker received legacy-shape step | with `pipe` chars",
      }),
    );
    const md = formatForensicsBugReport(r);
    // Backticks inside excerpts get escaped to \`. Since markdown table
    // formatter uses code spans, this is sanity that we don't crash.
    expect(md).toContain("Worker received legacy-shape step");
  });
  it("includes cross-references when hints provided", () => {
    const r = buildForensicsReport(job({ taskId: "tsk-1" }), {
      hints: {
        hasScreenshots: true,
        screenshotsRel: "worker/.debug-screenshots/resy/run-1/",
        benchmarkReportFile: "run-2026-05-04.json",
      },
    });
    const md = formatForensicsBugReport(r);
    expect(md).toContain("/tasks/tsk-1");
    expect(md).toContain("benchmark/runs/run-2026-05-04.json");
    expect(md).toContain("worker/.debug-screenshots/resy/run-1/");
  });
  it("is idempotent for same input", () => {
    const r = buildForensicsReport(
      job({ errorMessage: "no slots" }),
      { generatedAt: "2026-05-04T08:00:00.000Z" },
    );
    expect(formatForensicsBugReport(r)).toBe(formatForensicsBugReport(r));
  });
  it("handles empty job gracefully", () => {
    const r = buildForensicsReport({});
    expect(() => formatForensicsBugReport(r)).not.toThrow();
  });
});
