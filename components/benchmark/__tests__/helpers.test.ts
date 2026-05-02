/**
 * Unit tests for benchmark dashboard helpers.
 *
 * Locks the contract behavior in `components/benchmark/types.ts` against
 * the schema codex's runner emits (see `lib/benchmark/phase0-report.ts`).
 * If codex evolves the report shape and these break, that's the signal
 * to update the dashboard alongside.
 *
 * Pure functions only — no React, no fetch, no DOM.
 */

import { describe, it, expect } from "vitest";
import {
  BUCKET_LABEL,
  BUCKET_TONE,
  OUTCOME_BUCKET_ORDER,
  TAXONOMY_LABEL,
  UNCATEGORIZED_TAXONOMY,
  formatDuration,
  formatRate,
  formatTimestamp,
  groupByOutcome,
  groupByTaxonomy,
  isSevereTaxonomy,
  type Phase0BenchmarkCaseResult,
  type Phase0OutcomeBucket,
} from "../types";
import { applyFilters } from "../CaseTable";

/* ─── Builder ────────────────────────────────────────────────────────── */

function buildCase(
  overrides: Partial<Phase0BenchmarkCaseResult> = {},
): Phase0BenchmarkCaseResult {
  return {
    caseId: "R-001",
    prompt: "Book me Buvette next Thursday 8pm",
    taskId: "task_abc123",
    currentJobId: "job_xyz789",
    state: "ready_for_confirmation",
    terminalCode: "ready_for_confirmation",
    terminalReason: "Held the slot.",
    outcome: "ready_for_confirmation",
    expectedOutcomes: ["ready_for_confirmation"],
    acceptableFailureTaxonomy: ["F-AVAIL-NONE"],
    safe: true,
    bookingReady: true,
    severe: false,
    expectedOutcomeMatched: true,
    taxonomyAccepted: true,
    durationMs: 92400,
    timelineUrl: "/api/v1/travel-tasks/task_abc123/timeline-events",
    snapshotsUrl: "/api/v1/travel-tasks/task_abc123/snapshots",
    ...overrides,
  };
}

/* ─── BUCKET constants ───────────────────────────────────────────────── */

describe("OUTCOME_BUCKET_ORDER", () => {
  it("contains exactly the 8 canonical buckets in the documented order", () => {
    expect(OUTCOME_BUCKET_ORDER).toEqual([
      "booking_confirmed",
      "ready_for_confirmation",
      "safe_handoff",
      "no_availability_correct",
      "recovered_via_fallback",
      "failed_with_clear_reason",
      "failed_unknown",
      "severe_error",
    ]);
  });

  it("has a label and tone for every bucket", () => {
    for (const b of OUTCOME_BUCKET_ORDER) {
      expect(BUCKET_LABEL[b]).toBeTruthy();
      expect(BUCKET_TONE[b]).toBeTruthy();
    }
  });

  it("only marks severe_error with the severe tone", () => {
    for (const b of OUTCOME_BUCKET_ORDER) {
      if (b === "severe_error") {
        expect(BUCKET_TONE[b]).toBe("severe");
      } else {
        expect(BUCKET_TONE[b]).not.toBe("severe");
      }
    }
  });
});

/* ─── isSevereTaxonomy ───────────────────────────────────────────────── */

describe("isSevereTaxonomy", () => {
  it("returns true for all F-LOGIC-WRONG-* codes", () => {
    expect(isSevereTaxonomy("F-LOGIC-WRONG-VENUE")).toBe(true);
    expect(isSevereTaxonomy("F-LOGIC-WRONG-TIME")).toBe(true);
    expect(isSevereTaxonomy("F-LOGIC-WRONG-PARTY")).toBe(true);
    expect(isSevereTaxonomy("F-LOGIC-WRONG-CARD")).toBe(true);
    // Forward-compat: any future F-LOGIC-WRONG-* should also be severe.
    expect(isSevereTaxonomy("F-LOGIC-WRONG-ROOM")).toBe(true);
  });

  it("returns false for non-severe taxonomy codes", () => {
    expect(isSevereTaxonomy("F-AVAIL-NONE")).toBe(false);
    expect(isSevereTaxonomy("F-PROVIDER-CAPTCHA")).toBe(false);
    expect(isSevereTaxonomy("F-DATA-PROFILE")).toBe(false);
    expect(isSevereTaxonomy("F-NETWORK")).toBe(false);
    expect(isSevereTaxonomy("F-INTERNAL")).toBe(false);
    expect(isSevereTaxonomy("uncategorized")).toBe(false);
    expect(isSevereTaxonomy("")).toBe(false);
  });

  it("documents at least the 4 known severe codes via TAXONOMY_LABEL", () => {
    expect(TAXONOMY_LABEL["F-LOGIC-WRONG-VENUE"]).toBeTruthy();
    expect(TAXONOMY_LABEL["F-LOGIC-WRONG-TIME"]).toBeTruthy();
    expect(TAXONOMY_LABEL["F-LOGIC-WRONG-PARTY"]).toBeTruthy();
    expect(TAXONOMY_LABEL["F-LOGIC-WRONG-CARD"]).toBeTruthy();
    expect(TAXONOMY_LABEL[UNCATEGORIZED_TAXONOMY]).toBeTruthy();
  });
});

/* ─── formatRate ─────────────────────────────────────────────────────── */

describe("formatRate", () => {
  it("formats 0..1 fractions as percent strings", () => {
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(0.5)).toBe("50%");
    expect(formatRate(0.8)).toBe("80%");
    expect(formatRate(0.95)).toBe("95%");
    expect(formatRate(1)).toBe("100%");
  });

  it("uses one decimal under 10%", () => {
    expect(formatRate(0.05)).toBe("5.0%");
    expect(formatRate(0.012)).toBe("1.2%");
    expect(formatRate(0.099)).toBe("9.9%");
  });

  it("renders an em dash for non-finite or null inputs", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatRate(undefined)).toBe("—");
    expect(formatRate(Number.NaN)).toBe("—");
    expect(formatRate(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

/* ─── formatDuration ─────────────────────────────────────────────────── */

describe("formatDuration", () => {
  it("formats sub-second as ms", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(150)).toBe("150ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats < 60s as float seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(38100)).toBe("38.1s");
    expect(formatDuration(59999)).toBe("60.0s");
  });

  it("formats >= 60s as minutes + seconds", () => {
    expect(formatDuration(60000)).toBe("1m 00s");
    expect(formatDuration(92400)).toBe("1m 32s");
    expect(formatDuration(118900)).toBe("1m 58s");
    expect(formatDuration(3599000)).toBe("59m 59s");
  });

  it("renders em dash for non-finite or null inputs", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});

/* ─── formatTimestamp ────────────────────────────────────────────────── */

describe("formatTimestamp", () => {
  it("renders em dash for null / undefined / empty", () => {
    expect(formatTimestamp(null)).toBe("—");
    expect(formatTimestamp(undefined)).toBe("—");
    expect(formatTimestamp("")).toBe("—");
  });

  it("returns the original string when un-parseable", () => {
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
  });

  it("formats a real ISO timestamp into a non-empty locale string", () => {
    const out = formatTimestamp("2026-05-02T18:00:00.000Z");
    expect(out).toBeTruthy();
    expect(out).not.toBe("—");
    expect(out).not.toBe("2026-05-02T18:00:00.000Z");
  });
});

/* ─── groupByOutcome ─────────────────────────────────────────────────── */

describe("groupByOutcome", () => {
  it("returns all 8 keys even when most are empty", () => {
    const grouped = groupByOutcome([]);
    expect(Object.keys(grouped).sort()).toEqual([...OUTCOME_BUCKET_ORDER].sort());
    for (const b of OUTCOME_BUCKET_ORDER) {
      expect(grouped[b]).toEqual([]);
    }
  });

  it("partitions cases into the right buckets", () => {
    const cases: Phase0BenchmarkCaseResult[] = [
      buildCase({ caseId: "R-001", outcome: "ready_for_confirmation" }),
      buildCase({ caseId: "R-002", outcome: "ready_for_confirmation" }),
      buildCase({ caseId: "R-003", outcome: "safe_handoff" }),
      buildCase({
        caseId: "R-004",
        outcome: "severe_error",
        taxonomyCode: "F-LOGIC-WRONG-TIME",
        severe: true,
      }),
    ];
    const grouped = groupByOutcome(cases);
    expect(grouped.ready_for_confirmation.map((c) => c.caseId)).toEqual([
      "R-001",
      "R-002",
    ]);
    expect(grouped.safe_handoff.map((c) => c.caseId)).toEqual(["R-003"]);
    expect(grouped.severe_error.map((c) => c.caseId)).toEqual(["R-004"]);
    expect(grouped.booking_confirmed).toEqual([]);
  });
});

/* ─── groupByTaxonomy ────────────────────────────────────────────────── */

describe("groupByTaxonomy", () => {
  it("uses the canonical 'uncategorized' key when taxonomyCode is missing", () => {
    const grouped = groupByTaxonomy([
      buildCase({ caseId: "R-001", taxonomyCode: undefined }),
      buildCase({ caseId: "R-002", taxonomyCode: undefined }),
    ]);
    expect(grouped[UNCATEGORIZED_TAXONOMY]?.map((c) => c.caseId)).toEqual([
      "R-001",
      "R-002",
    ]);
  });

  it("groups by the actual taxonomyCode when present", () => {
    const grouped = groupByTaxonomy([
      buildCase({ caseId: "R-001", taxonomyCode: "F-AVAIL-NONE" }),
      buildCase({ caseId: "R-002", taxonomyCode: "F-AVAIL-NONE" }),
      buildCase({ caseId: "R-003", taxonomyCode: "F-PROVIDER-OTP" }),
    ]);
    expect(grouped["F-AVAIL-NONE"]?.map((c) => c.caseId)).toEqual([
      "R-001",
      "R-002",
    ]);
    expect(grouped["F-PROVIDER-OTP"]?.map((c) => c.caseId)).toEqual(["R-003"]);
  });

  it("only includes keys that have at least one case (no zero-buckets)", () => {
    const grouped = groupByTaxonomy([
      buildCase({ taxonomyCode: "F-AVAIL-NONE" }),
    ]);
    expect(Object.keys(grouped)).toEqual(["F-AVAIL-NONE"]);
  });

  it("returns an empty object for empty input", () => {
    expect(groupByTaxonomy([])).toEqual({});
  });
});

/* ─── applyFilters (CaseTable) ───────────────────────────────────────── */

describe("applyFilters", () => {
  const cases: Phase0BenchmarkCaseResult[] = [
    buildCase({
      caseId: "R-001",
      prompt: "Book Buvette",
      outcome: "ready_for_confirmation",
      taxonomyCode: undefined,
    }),
    buildCase({
      caseId: "R-018",
      prompt: "Tonight Carbone for 2",
      outcome: "no_availability_correct",
      taxonomyCode: "F-AVAIL-NONE",
    }),
    buildCase({
      caseId: "R-025",
      prompt: "Misi 8pm Saturday",
      outcome: "failed_with_clear_reason",
      taxonomyCode: "F-PROVIDER-OTP",
    }),
    buildCase({
      caseId: "R-099",
      prompt: "Wrong-time severe",
      outcome: "severe_error",
      taxonomyCode: "F-LOGIC-WRONG-TIME",
      severe: true,
    }),
  ];

  it("returns everything when no filter active", () => {
    const out = applyFilters(cases, { bucket: null, taxonomy: null, search: "" });
    expect(out.map((c) => c.caseId)).toEqual(["R-001", "R-018", "R-025", "R-099"]);
  });

  it("filters by bucket", () => {
    const out = applyFilters(cases, {
      bucket: "no_availability_correct",
      taxonomy: null,
      search: "",
    });
    expect(out.map((c) => c.caseId)).toEqual(["R-018"]);
  });

  it("filters by taxonomy code", () => {
    const out = applyFilters(cases, {
      bucket: null,
      taxonomy: "F-PROVIDER-OTP",
      search: "",
    });
    expect(out.map((c) => c.caseId)).toEqual(["R-025"]);
  });

  it("filters by 'uncategorized' for cases with no taxonomyCode", () => {
    const out = applyFilters(cases, {
      bucket: null,
      taxonomy: UNCATEGORIZED_TAXONOMY,
      search: "",
    });
    expect(out.map((c) => c.caseId)).toEqual(["R-001"]);
  });

  it("filters by case-insensitive prompt search", () => {
    const out = applyFilters(cases, {
      bucket: null,
      taxonomy: null,
      search: "carbone",
    });
    expect(out.map((c) => c.caseId)).toEqual(["R-018"]);
  });

  it("filters by case ID search", () => {
    const out = applyFilters(cases, { bucket: null, taxonomy: null, search: "R-099" });
    expect(out.map((c) => c.caseId)).toEqual(["R-099"]);
  });

  it("combines bucket + taxonomy + search filters (AND)", () => {
    const out = applyFilters(cases, {
      bucket: "severe_error",
      taxonomy: "F-LOGIC-WRONG-TIME",
      search: "wrong",
    });
    expect(out.map((c) => c.caseId)).toEqual(["R-099"]);
  });

  it("returns empty when bucket + search don't both match", () => {
    const out = applyFilters(cases, {
      bucket: "ready_for_confirmation",
      taxonomy: null,
      search: "carbone",
    });
    expect(out).toEqual([]);
  });
});

/* ─── Cross-cutting invariant: severity pairing ─────────────────────── */

describe("severity pairing invariant (per PHASE0_REPORT_CONTRACT.md)", () => {
  // The contract documents (but doesn't enforce) that severe_error rows
  // pair with F-LOGIC-WRONG-* tags. The dashboard helpers we ship should
  // at minimum agree on what counts as severe — both for tone and for
  // taxonomy classification.
  it("severe_error bucket and severe taxonomy use the same 'severe' tone family", () => {
    expect(BUCKET_TONE.severe_error).toBe("severe");
    // Sanity: a severe taxonomy code matches isSevereTaxonomy.
    expect(isSevereTaxonomy("F-LOGIC-WRONG-VENUE")).toBe(true);
  });

  it("non-severe outcome buckets never claim severe taxonomy", () => {
    const nonSevereBuckets = OUTCOME_BUCKET_ORDER.filter(
      (b): b is Phase0OutcomeBucket => b !== "severe_error",
    );
    for (const b of nonSevereBuckets) {
      expect(BUCKET_TONE[b]).not.toBe("severe");
    }
  });
});
