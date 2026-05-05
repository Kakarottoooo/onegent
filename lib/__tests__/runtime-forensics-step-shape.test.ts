import { describe, expect, it } from "vitest";

import {
  auditStepShape,
  errorMentionsLegacyShape,
  extractLegacyShapeQuote,
  truncate,
} from "../runtime-forensics/step-shape";
import type { JobLikeInput, StepLikeInput } from "../runtime-forensics/types";

function step(overrides: Partial<StepLikeInput> = {}): StepLikeInput {
  return { name: "step", ...overrides };
}

/* ─── errorMentionsLegacyShape ───────────────────────────────────── */

describe("errorMentionsLegacyShape", () => {
  it("matches canonical Worker received legacy-shape step", () => {
    expect(
      errorMentionsLegacyShape("Worker received legacy-shape step"),
    ).toBe(true);
  });
  it("matches with parenthetical (missing __source marker)", () => {
    expect(
      errorMentionsLegacyShape(
        "Worker received legacy-shape step (missing __source marker)",
      ),
    ).toBe(true);
  });
  it("matches case-insensitively", () => {
    expect(
      errorMentionsLegacyShape("WORKER RECEIVED LEGACY-SHAPE STEP"),
    ).toBe(true);
  });
  it("matches 'missing __source marker' alone", () => {
    expect(errorMentionsLegacyShape("missing __source marker")).toBe(true);
  });
  it("matches 'step lacks __source'", () => {
    expect(errorMentionsLegacyShape("step lacks __source field")).toBe(true);
  });
  it("matches 'unstamped step'", () => {
    expect(errorMentionsLegacyShape("unstamped step rejected")).toBe(true);
  });
  it("does NOT match unrelated text", () => {
    expect(errorMentionsLegacyShape("provider returned 503")).toBe(false);
  });
  it("returns false on null/undefined/non-string", () => {
    expect(errorMentionsLegacyShape(null)).toBe(false);
    expect(errorMentionsLegacyShape(undefined)).toBe(false);
    expect(errorMentionsLegacyShape(42 as unknown as string)).toBe(false);
  });
  it("returns false on empty string", () => {
    expect(errorMentionsLegacyShape("")).toBe(false);
  });
});

/* ─── extractLegacyShapeQuote ────────────────────────────────────── */

describe("extractLegacyShapeQuote", () => {
  it("returns excerpt with surrounding context", () => {
    const out = extractLegacyShapeQuote(
      "[worker] 2026-05-04 12:00:00 Worker received legacy-shape step (missing __source marker) — drop",
    );
    expect(out).not.toBeNull();
    expect(out!).toContain("legacy-shape step");
  });
  it("returns null for null input", () => {
    expect(extractLegacyShapeQuote(null)).toBeNull();
  });
  it("returns null when no match", () => {
    expect(extractLegacyShapeQuote("just a normal log line")).toBeNull();
  });
  it("truncates very long matches to ≤200 chars", () => {
    const long = "x".repeat(500) + "Worker received legacy-shape step" + "y".repeat(500);
    const out = extractLegacyShapeQuote(long);
    expect(out!.length).toBeLessThanOrEqual(200);
  });
});

/* ─── truncate (helper) ──────────────────────────────────────────── */

describe("truncate", () => {
  it("returns input unchanged when ≤ max", () => {
    expect(truncate("hi", 10)).toBe("hi");
  });
  it("truncates with ellipsis", () => {
    expect(truncate("abcdefghij", 7)).toBe("abcd...");
  });
  it("default max=200", () => {
    expect(truncate("a".repeat(300)).length).toBe(200);
  });
});

/* ─── auditStepShape ─────────────────────────────────────────────── */

describe("auditStepShape — empty / garbage", () => {
  it("returns zero rows for missing steps array", () => {
    const r = auditStepShape({});
    expect(r.totalSteps).toBe(0);
    expect(r.stepsWithSourceMarker).toBe(0);
    expect(r.stepsMissingSourceMarker).toBe(0);
    expect(r.hasLegacyShapeBug).toBe(false);
    expect(r.rows).toEqual([]);
  });
  it("returns zero rows for steps not being an array", () => {
    const r = auditStepShape({ steps: "nope" as unknown as null });
    expect(r.totalSteps).toBe(0);
  });
  it("survives invalid step entries", () => {
    const r = auditStepShape({
      steps: [42 as unknown as never, null as unknown as never],
    });
    expect(r.totalSteps).toBe(2);
    expect(r.rows[0].name).toBe("(invalid step)");
  });
});

describe("auditStepShape — counts", () => {
  it("counts steps with __source", () => {
    const r = auditStepShape({
      steps: [
        step({ __source: "lib/core/execution" }),
        step({ __source: "lib/execution-v2" }),
        step({}),
      ],
    });
    expect(r.totalSteps).toBe(3);
    expect(r.stepsWithSourceMarker).toBe(2);
    expect(r.stepsMissingSourceMarker).toBe(1);
  });
  it("rejects empty-string __source as missing", () => {
    const r = auditStepShape({
      steps: [step({ __source: "" })],
    });
    expect(r.stepsWithSourceMarker).toBe(0);
    expect(r.stepsMissingSourceMarker).toBe(1);
  });
  it("treats __source as non-string as missing", () => {
    const r = auditStepShape({
      steps: [step({ __source: 42 as unknown as string })],
    });
    expect(r.stepsWithSourceMarker).toBe(0);
  });
});

describe("auditStepShape — legacy-shape bug detection", () => {
  it("step.error matches phrase → bug=true", () => {
    const r = auditStepShape({
      steps: [step({ error: "Worker received legacy-shape step" })],
    });
    expect(r.hasLegacyShapeBug).toBe(true);
    expect(r.rows[0].errorMentionsLegacyShape).toBe(true);
  });
  it("job.errorMessage matches phrase → bug=true", () => {
    const r = auditStepShape({
      errorMessage: "missing __source marker",
      steps: [step({})],
    });
    expect(r.hasLegacyShapeBug).toBe(true);
  });
  it("job.terminalReason matches phrase → bug=true", () => {
    const r = auditStepShape({
      terminalReason: "step lacks __source after legacy adapter",
    });
    expect(r.hasLegacyShapeBug).toBe(true);
  });
  it("rawWorkerLogExcerpt matches phrase → bug=true", () => {
    const r = auditStepShape({
      rawWorkerLogExcerpt:
        "[worker] Worker received legacy-shape step (missing __source marker)",
    });
    expect(r.hasLegacyShapeBug).toBe(true);
  });
  it("clean job → bug=false", () => {
    const r = auditStepShape({
      steps: [
        step({ __source: "lib/core/execution", error: "no slots" }),
      ],
    });
    expect(r.hasLegacyShapeBug).toBe(false);
  });
});

describe("auditStepShape — legacyShapeQuotes", () => {
  it("collects step quotes with prefix step[i]", () => {
    const r = auditStepShape({
      steps: [
        step({ name: "navigate" }),
        step({
          name: "form_fill",
          error: "Worker received legacy-shape step (missing __source marker)",
        }),
      ],
    });
    expect(r.legacyShapeQuotes.some((q) => q.startsWith("step[1]:"))).toBe(true);
  });
  it("collects job-level errorMessage quote", () => {
    const r = auditStepShape({
      errorMessage: "Worker received legacy-shape step",
    });
    expect(
      r.legacyShapeQuotes.some((q) => q.startsWith("job.errorMessage:")),
    ).toBe(true);
  });
  it("collects worker_log quote", () => {
    const r = auditStepShape({
      rawWorkerLogExcerpt: "Worker received legacy-shape step (missing __source marker)",
    });
    expect(r.legacyShapeQuotes.some((q) => q.startsWith("worker_log:"))).toBe(
      true,
    );
  });
  it("dedupes identical quotes", () => {
    const r = auditStepShape({
      errorMessage: "Worker received legacy-shape step",
      terminalReason: "Worker received legacy-shape step",
    });
    // Different prefixes (job.errorMessage / job.terminalReason), so 2.
    expect(r.legacyShapeQuotes.length).toBeGreaterThanOrEqual(2);
    const set = new Set(r.legacyShapeQuotes);
    expect(set.size).toBe(r.legacyShapeQuotes.length);
  });
});

describe("auditStepShape — row content", () => {
  it("name falls back to type if name missing", () => {
    const r = auditStepShape({
      steps: [step({ name: "", type: "navigate" })],
    });
    expect(r.rows[0].name).toBe("navigate");
  });
  it("name falls back to '(unnamed)' if both missing", () => {
    const r = auditStepShape({
      steps: [step({ name: "", type: "" })],
    });
    expect(r.rows[0].name).toBe("(unnamed)");
  });
  it("errorExcerpt is truncated to ≤200 chars", () => {
    const long = "x".repeat(400);
    const r = auditStepShape({
      steps: [step({ error: long })],
    });
    expect(r.rows[0].errorExcerpt!.length).toBeLessThanOrEqual(200);
  });
  it("sourceMarker is preserved when set", () => {
    const r = auditStepShape({
      steps: [step({ __source: "lib/execution-v2" })],
    });
    expect(r.rows[0].sourceMarker).toBe("lib/execution-v2");
  });
});

/* ─── Job-level integration ──────────────────────────────────────── */

describe("auditStepShape — Expedia regression fixture", () => {
  it("Expedia flight legacy-shape job is flagged", () => {
    const j: JobLikeInput = {
      id: "job-expedia-flight-1",
      provider: "expedia",
      scenario: "F-EXP-LAX-NRT-1",
      status: "failed",
      errorMessage:
        "Worker received legacy-shape step (missing __source marker)",
      steps: [
        step({ name: "search_flights" }),
        step({
          name: "select_fare",
          error: "Worker received legacy-shape step (missing __source marker)",
        }),
      ],
    };
    const r = auditStepShape(j);
    expect(r.hasLegacyShapeBug).toBe(true);
    expect(r.rows[1].errorMentionsLegacyShape).toBe(true);
    expect(r.legacyShapeQuotes.length).toBeGreaterThanOrEqual(2);
  });
});
