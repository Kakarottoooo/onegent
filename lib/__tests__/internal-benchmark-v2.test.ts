import { describe, expect, it } from "vitest";
import {
  evaluateInternalBenchmarkGate,
  renderInternalBenchmarkMarkdown,
  runInternalNoLiveBenchmark,
  selectInternalBenchmarkCases,
} from "@/lib/internal-benchmark";

describe("internal benchmark v2", () => {
  it("selects no-live cases by vertical and count", () => {
    const cases = selectInternalBenchmarkCases({ vertical: "activity", count: 5 });
    expect(cases).toHaveLength(5);
    expect(cases.every((testCase) => testCase.vertical === "activity")).toBe(true);
  });

  it("supports trip as a first-class benchmark vertical", () => {
    const cases = selectInternalBenchmarkCases({ vertical: "trip", count: 4 });
    expect(cases).toHaveLength(4);
    expect(cases.every((testCase) => testCase.vertical === "trip")).toBe(true);
  });

  it("runs a deterministic all-vertical no-live report", () => {
    const report = runInternalNoLiveBenchmark({ vertical: "all", count: 50 });
    expect(report.summary.mode).toBe("no-live");
    expect(report.summary.total).toBe(50);
    expect(report.summary.byVertical.restaurant).toBeGreaterThan(0);
    expect(report.summary.byVertical.hotel).toBeGreaterThan(0);
    expect(report.summary.byVertical.flight).toBeGreaterThan(0);
    expect(report.summary.byVertical.activity).toBeGreaterThan(0);
    expect(report.summary.byVertical.trip).toBeGreaterThan(0);
    expect(report.summary.byFailureClass.simulated_provider_block).toBeGreaterThan(0);
    expect(report.summary.byFailureClass.manual_boundary_expected).toBeGreaterThan(0);
    expect(report.summary.bySuggestedOwner.nlu).toBeGreaterThan(0);
    expect(report.topFailedCases[0]).toMatchObject({
      failureClass: expect.any(String),
      suggestedOwner: expect.any(String),
    });
    expect(report.results.find((result) => result.id === "activity-lion-king-zh-routing")?.pass).toBe(true);
  });

  it("tracks artifact completeness separately from route classification", () => {
    const report = runInternalNoLiveBenchmark({ vertical: "restaurant", count: 4 });
    expect(report.summary.artifactCompletenessRate).toBe(0.75);
    expect(report.results.find((result) => result.failureClass === "artifact_incomplete")).toBeDefined();
  });

  it("renders markdown useful for local review", () => {
    const report = runInternalNoLiveBenchmark({ vertical: "all", count: 5 });
    const markdown = renderInternalBenchmarkMarkdown(report);
    expect(markdown).toContain("# Internal Benchmark v2");
    expect(markdown).toContain("no-live mode runs deterministic routing fixtures");
    expect(markdown).toContain("Failure Taxonomy");
    expect(markdown).toContain("Suggested Owners");
    expect(markdown).toContain("Top Failed Cases");
    expect(markdown).toContain("Cases");
  });

  it("can fail as a regression gate when configured thresholds are missed", () => {
    const report = runInternalNoLiveBenchmark({ vertical: "all", count: 10 });

    expect(
      evaluateInternalBenchmarkGate(report, {
        minSuccessRate: 0.6,
        minArtifactCompletenessRate: 0.9,
        maxFailureCounts: {
          routing_mismatch: 0,
          simulated_provider_block: 2,
        },
      }),
    ).toMatchObject({ pass: true, errors: [] });

    const failed = evaluateInternalBenchmarkGate(report, {
      minSuccessRate: 0.8,
      maxFailureCounts: {
        simulated_provider_block: 0,
      },
    });
    expect(failed.pass).toBe(false);
    expect(failed.errors.join(" ")).toContain("successRate");
    expect(failed.errors.join(" ")).toContain("simulated_provider_block");
  });
});
