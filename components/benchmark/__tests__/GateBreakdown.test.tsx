/**
 * Tests for `<GateBreakdown>`.
 *
 * Coverage focus:
 *   1. Per-row threshold computation (current vs PHASE0_TARGETS)
 *   2. Recommendation surface ranks correctly (severe always first)
 *   3. Discrepancy banner fires when published-target check disagrees with
 *      runner's metrics.passed boolean
 *   4. Pure component — no fetch / no async
 *
 * jsdom + @testing-library/react. We render and grep the DOM rather than
 * snapshot — easier to maintain when copy changes.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import GateBreakdown from "../GateBreakdown";
import type {
  Phase0BenchmarkCaseResult,
  Phase0BenchmarkMetrics,
} from "../types";

/* ─── Fixtures ────────────────────────────────────────────────────── */

function passingMetrics(): Phase0BenchmarkMetrics {
  return {
    total: 25,
    bookingReady: 22,
    safe: 24,
    severe: 0,
    taxonomyNeeded: 3,
    taxonomyCovered: 3,
    bookingReadyRate: 22 / 25, // 88% — meets ≥80%
    safeOutcomeRate: 24 / 25, // 96% — meets ≥95%
    severeErrorRate: 0,
    taxonomyCoverageRate: 1,
    passed: true,
  };
}

function makeCase(
  overrides: Partial<Phase0BenchmarkCaseResult>,
): Phase0BenchmarkCaseResult {
  return {
    caseId: "R-000",
    prompt: "test",
    outcome: "ready_for_confirmation",
    expectedOutcomes: ["ready_for_confirmation"],
    acceptableFailureTaxonomy: [],
    safe: true,
    bookingReady: true,
    severe: false,
    expectedOutcomeMatched: true,
    taxonomyAccepted: true,
    durationMs: 1000,
    ...overrides,
  };
}

/* ─── Happy path ──────────────────────────────────────────────────── */

describe("GateBreakdown · all met", () => {
  it("renders 4 met rows when every threshold cleared", () => {
    const m = passingMetrics();
    const results: Phase0BenchmarkCaseResult[] = Array.from(
      { length: 25 },
      (_, i) =>
        makeCase({
          caseId: `R-${String(i + 1).padStart(3, "0")}`,
          bookingReady: i < 22,
          safe: i < 24,
        }),
    );

    render(<GateBreakdown metrics={m} results={results} />);

    // 4 met pills
    const metPills = screen.getAllByText("✓ met");
    expect(metPills).toHaveLength(4);

    // No "short" pills
    expect(screen.queryAllByText("✗ short")).toHaveLength(0);

    // No recommendations panel
    expect(screen.queryByText(/Top recommended fixes/i)).toBeNull();

    // Pass note shown
    expect(
      screen.getByText(/All published Phase 0 thresholds met/i),
    ).toBeInTheDocument();
  });
});

/* ─── Single-metric short ─────────────────────────────────────────── */

describe("GateBreakdown · booking-ready short only", () => {
  it("flags booking-ready short and recommends top failing taxonomy", () => {
    // 16/25 ready (64% < 80%) but other 3 metrics still pass
    const m: Phase0BenchmarkMetrics = {
      total: 25,
      bookingReady: 16,
      safe: 24,
      severe: 0,
      taxonomyNeeded: 9,
      taxonomyCovered: 9,
      bookingReadyRate: 16 / 25, // 64%
      safeOutcomeRate: 24 / 25, // 96%
      severeErrorRate: 0,
      taxonomyCoverageRate: 1,
      passed: false,
    };
    const results: Phase0BenchmarkCaseResult[] = [
      // 16 successful
      ...Array.from({ length: 16 }, (_, i) =>
        makeCase({
          caseId: `R-${String(i + 1).padStart(3, "0")}`,
          bookingReady: true,
          safe: true,
        }),
      ),
      // 9 failed — 6 cluster on F-PROVIDER-OTP (top), 3 on F-AVAIL-NONE
      ...Array.from({ length: 6 }, (_, i) =>
        makeCase({
          caseId: `R-${String(17 + i).padStart(3, "0")}`,
          outcome: "failed_with_clear_reason",
          taxonomyCode: "F-PROVIDER-OTP",
          bookingReady: false,
          safe: true,
        }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeCase({
          caseId: `R-${String(23 + i).padStart(3, "0")}`,
          outcome: "no_availability_correct",
          taxonomyCode: "F-AVAIL-NONE",
          bookingReady: false,
          safe: true,
        }),
      ),
    ];

    render(<GateBreakdown metrics={m} results={results} />);

    // 1 short, 3 met
    expect(screen.getAllByText("✓ met")).toHaveLength(3);
    expect(screen.getAllByText("✗ short")).toHaveLength(1);

    // Recommendation present
    expect(screen.getByText(/Top recommended fixes/i)).toBeInTheDocument();

    // Top failing taxonomy is F-PROVIDER-OTP (6 cases)
    expect(screen.getByText(/F-PROVIDER-OTP/)).toBeInTheDocument();
    expect(screen.getByText(/6 cases/)).toBeInTheDocument();

    // Booking-ready gap = ceil(0.8*25) - 16 = 20 - 16 = 4
    expect(screen.getByText(/Need 4 more booking-ready/i)).toBeInTheDocument();
  });
});

/* ─── Severe is always BLOCKER + first ────────────────────────────── */

describe("GateBreakdown · severe is BLOCKER", () => {
  it("severe row marked short and surfaced first with case IDs", () => {
    const m: Phase0BenchmarkMetrics = {
      total: 25,
      bookingReady: 22,
      safe: 22,
      severe: 2,
      taxonomyNeeded: 3,
      taxonomyCovered: 3,
      bookingReadyRate: 22 / 25,
      safeOutcomeRate: 22 / 25, // 88% < 95%
      severeErrorRate: 2 / 25,
      taxonomyCoverageRate: 1,
      passed: false,
    };
    const results: Phase0BenchmarkCaseResult[] = [
      ...Array.from({ length: 22 }, (_, i) =>
        makeCase({
          caseId: `R-${String(i + 1).padStart(3, "0")}`,
          bookingReady: true,
          safe: true,
        }),
      ),
      makeCase({
        caseId: "R-023",
        outcome: "severe_error",
        taxonomyCode: "F-LOGIC-WRONG-VENUE",
        bookingReady: false,
        safe: false,
        severe: true,
      }),
      makeCase({
        caseId: "R-024",
        outcome: "severe_error",
        taxonomyCode: "F-LOGIC-HALLUCINATED-CONFIRM",
        bookingReady: false,
        safe: false,
        severe: true,
      }),
      makeCase({
        caseId: "R-025",
        outcome: "failed_with_clear_reason",
        taxonomyCode: "F-AVAIL-NONE",
        bookingReady: false,
        safe: true,
      }),
    ];

    render(<GateBreakdown metrics={m} results={results} />);

    // First recommendation must be the severe BLOCKER
    const recList = screen.getByRole("list"); // <ol>
    const firstItem = within(recList).getAllByRole("listitem")[0];
    expect(within(firstItem).getByText(/BLOCKER/)).toBeInTheDocument();
    expect(within(firstItem).getByText(/2 severe error cases/i)).toBeInTheDocument();

    // Case IDs surfaced inside the BLOCKER recommendation specifically.
    // (R-023 + R-024 also appear under "safe-outcome short" because both
    // severe cases are also unsafe; we scope to the BLOCKER item to test
    // independence.)
    expect(within(firstItem).getByText("R-023")).toBeInTheDocument();
    expect(within(firstItem).getByText("R-024")).toBeInTheDocument();
  });
});

/* ─── Taxonomy coverage gap ───────────────────────────────────────── */

describe("GateBreakdown · taxonomy coverage short", () => {
  it("lists uncategorized case IDs", () => {
    const m: Phase0BenchmarkMetrics = {
      total: 25,
      bookingReady: 22,
      safe: 24,
      severe: 0,
      taxonomyNeeded: 3,
      taxonomyCovered: 1,
      bookingReadyRate: 22 / 25,
      safeOutcomeRate: 24 / 25,
      severeErrorRate: 0,
      taxonomyCoverageRate: 1 / 3,
      passed: false,
    };
    const results: Phase0BenchmarkCaseResult[] = [
      ...Array.from({ length: 22 }, (_, i) =>
        makeCase({
          caseId: `R-${String(i + 1).padStart(3, "0")}`,
          bookingReady: true,
        }),
      ),
      makeCase({
        caseId: "R-023",
        outcome: "failed_with_clear_reason",
        taxonomyCode: "F-AVAIL-NONE", // categorized
        bookingReady: false,
      }),
      makeCase({
        caseId: "R-024",
        outcome: "failed_with_clear_reason",
        // taxonomyCode missing (uncategorized)
        bookingReady: false,
      }),
      makeCase({
        caseId: "R-025",
        outcome: "failed_with_clear_reason",
        taxonomyCode: "", // empty == uncategorized per Q2
        bookingReady: false,
      }),
    ];

    render(<GateBreakdown metrics={m} results={results} />);

    // Surfaces uncategorized count + IDs
    expect(
      screen.getByText(/2 uncategorized failures need a taxonomy code/i),
    ).toBeInTheDocument();
    expect(screen.getByText("R-024")).toBeInTheDocument();
    expect(screen.getByText("R-025")).toBeInTheDocument();
    expect(screen.queryByText("R-023")).toBeNull(); // properly categorized
  });
});

/* ─── Discrepancy banner ──────────────────────────────────────────── */

describe("GateBreakdown · discrepancy", () => {
  it("flags when all rows met but runner says passed=false", () => {
    const m = passingMetrics();
    m.passed = false;
    render(<GateBreakdown metrics={m} results={[]} />);

    expect(
      screen.getByText(/Heads up/i).parentElement?.textContent,
    ).toMatch(/all four published thresholds appear met/i);
  });

  it("flags when at least one row short but runner says passed=true", () => {
    const m: Phase0BenchmarkMetrics = {
      total: 25,
      bookingReady: 10, // 40% — short
      safe: 24,
      severe: 0,
      taxonomyNeeded: 0,
      taxonomyCovered: 0,
      bookingReadyRate: 10 / 25,
      safeOutcomeRate: 24 / 25,
      severeErrorRate: 0,
      taxonomyCoverageRate: 1,
      passed: true, // runner says pass!
    };
    render(<GateBreakdown metrics={m} results={[]} />);

    expect(
      screen.getByText(/Heads up/i).parentElement?.textContent,
    ).toMatch(/runner reports.*metrics\.passed === true/i);
  });

  it("no discrepancy when published targets agree with runner", () => {
    const m = passingMetrics();
    render(<GateBreakdown metrics={m} results={[]} />);
    expect(screen.queryByText(/Heads up/i)).toBeNull();
  });
});

/* ─── Navigation drift detection ──────────────────────────────────── */

describe("GateBreakdown · navigation drift", () => {
  // Pattern observed first in R-003 live smoke 2026-05-03:
  // taxonomyCode === "F-PROVIDER-UNKNOWN" AND terminalReason mentions
  // /search / ?query= / search?. Codex's a0ce2ee shipped CU prompt
  // hardening + auto-pullback. GateBreakdown surfaces this as a
  // dedicated rec independent of threshold state.
  it("surfaces drift case with /search in terminalReason", () => {
    const m = passingMetrics();
    m.passed = false;
    m.bookingReady = 0;
    m.bookingReadyRate = 0;
    const results: Phase0BenchmarkCaseResult[] = [
      makeCase({
        caseId: "R-003",
        outcome: "failed_with_clear_reason",
        taxonomyCode: "F-PROVIDER-UNKNOWN",
        terminalReason:
          "Computer Use stopped at https://resy.com/cities/ny/search?query=Buvette&time=2100",
        bookingReady: false,
        safe: true,
      }),
    ];
    render(<GateBreakdown metrics={m} results={results} />);

    expect(
      screen.getByText(/likely drifted to Resy \/search/i),
    ).toBeInTheDocument();
    expect(screen.getByText("R-003")).toBeInTheDocument();
  });

  it("does NOT flag F-PROVIDER-UNKNOWN without drift hint in terminalReason", () => {
    const m = passingMetrics();
    m.passed = false;
    m.bookingReady = 0;
    m.bookingReadyRate = 0;
    const results: Phase0BenchmarkCaseResult[] = [
      makeCase({
        caseId: "R-007",
        outcome: "failed_with_clear_reason",
        taxonomyCode: "F-PROVIDER-UNKNOWN",
        terminalReason: "Provider returned an unexpected error",
        bookingReady: false,
        safe: true,
      }),
    ];
    render(<GateBreakdown metrics={m} results={results} />);

    expect(screen.queryByText(/drifted to Resy/i)).toBeNull();
  });

  it("flags multiple drift cases with combined headline", () => {
    const m = passingMetrics();
    m.passed = false;
    m.bookingReady = 0;
    m.bookingReadyRate = 0;
    const results: Phase0BenchmarkCaseResult[] = [
      makeCase({
        caseId: "R-003",
        outcome: "failed_with_clear_reason",
        taxonomyCode: "F-PROVIDER-UNKNOWN",
        terminalReason: "Final URL: https://resy.com/cities/ny/search?query=Buvette",
        bookingReady: false,
      }),
      makeCase({
        caseId: "R-007",
        outcome: "failed_with_clear_reason",
        taxonomyCode: "F-PROVIDER-UNKNOWN",
        terminalReason: "Drifted to /search?query=Carbone&time=1900",
        bookingReady: false,
      }),
    ];
    render(<GateBreakdown metrics={m} results={results} />);

    expect(screen.getByText(/2 cases likely drifted/i)).toBeInTheDocument();
    expect(screen.getByText("R-003")).toBeInTheDocument();
    expect(screen.getByText("R-007")).toBeInTheDocument();
  });

  it("drift rec fires even when all 4 thresholds met (informational on passing run)", () => {
    // Edge case: a 25-case run with 24 ready_for_confirmation + 1 drift.
    // Thresholds pass but drift is still useful signal.
    const m: Phase0BenchmarkMetrics = {
      total: 25,
      bookingReady: 24,
      safe: 24,
      severe: 0,
      taxonomyNeeded: 1,
      taxonomyCovered: 1,
      bookingReadyRate: 24 / 25, // 96% — meets ≥80%
      safeOutcomeRate: 24 / 25, // 96% — meets ≥95%
      severeErrorRate: 0,
      taxonomyCoverageRate: 1,
      passed: true,
    };
    const results: Phase0BenchmarkCaseResult[] = [
      ...Array.from({ length: 24 }, (_, i) =>
        makeCase({
          caseId: `R-${String(i + 1).padStart(3, "0")}`,
          outcome: "ready_for_confirmation",
          bookingReady: true,
          safe: true,
        }),
      ),
      makeCase({
        caseId: "R-025",
        outcome: "failed_with_clear_reason",
        taxonomyCode: "F-PROVIDER-UNKNOWN",
        terminalReason: "Final URL contains /search?query=...",
        bookingReady: false,
        safe: false,
      }),
    ];
    render(<GateBreakdown metrics={m} results={results} />);

    // All-met note should still show (passing run)
    expect(
      screen.getByText(/All published Phase 0 thresholds met/i),
    ).toBeInTheDocument();
    // But drift rec ALSO fires — informational
    expect(
      screen.getByText(/likely drifted to Resy \/search/i),
    ).toBeInTheDocument();
  });
});

/* ─── R-003 model-access scenario (mirrors codex's actual report) ─── */

describe("GateBreakdown · R-003 model-access scenario", () => {
  it("infra-blocked single case shows 0 severe + clear booking-ready gap", () => {
    // Codex's actual R-003 run: 1 case, F-INFRA-MODEL-ACCESS,
    // failed_with_clear_reason. Treated as a "safe" outcome (we know the
    // exact reason, no wrong action taken).
    const m: Phase0BenchmarkMetrics = {
      total: 1,
      bookingReady: 0,
      safe: 1,
      severe: 0,
      taxonomyNeeded: 1,
      taxonomyCovered: 1,
      bookingReadyRate: 0,
      safeOutcomeRate: 1,
      severeErrorRate: 0,
      taxonomyCoverageRate: 1,
      passed: false, // bookingReady = 0% < 80%
    };
    const results: Phase0BenchmarkCaseResult[] = [
      makeCase({
        caseId: "R-003",
        outcome: "failed_with_clear_reason",
        taxonomyCode: "F-INFRA-MODEL-ACCESS",
        bookingReady: false,
        safe: true,
        severe: false,
      }),
    ];

    render(<GateBreakdown metrics={m} results={results} />);

    // No severe BLOCKER recommendation
    expect(screen.queryByText(/BLOCKER/)).toBeNull();

    // Booking-ready short surfaced (need 1 more = ceil(0.8*1) - 0 = 1)
    expect(screen.getByText(/Need 1 more booking-ready/i)).toBeInTheDocument();

    // 3 of 4 thresholds met (safe, severe, taxonomy)
    expect(screen.getAllByText("✓ met")).toHaveLength(3);
    expect(screen.getAllByText("✗ short")).toHaveLength(1);
  });
});
