import { describe, expect, it } from "vitest";
import {
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

  it("runs a deterministic all-vertical no-live report", () => {
    const report = runInternalNoLiveBenchmark({ vertical: "all", count: 10 });
    expect(report.summary.mode).toBe("no-live");
    expect(report.summary.total).toBe(10);
    expect(report.summary.byVertical.restaurant).toBeGreaterThan(0);
    expect(report.summary.byVertical.hotel).toBeGreaterThan(0);
    expect(report.summary.byVertical.flight).toBeGreaterThan(0);
    expect(report.summary.byVertical.activity).toBeGreaterThan(0);
    expect(report.summary.byFailureClass.provider_simulated_block).toBeGreaterThan(0);
    expect(report.results.find((result) => result.id === "activity-lion-king-zh-routing")?.pass).toBe(true);
  });

  it("tracks artifact completeness separately from route classification", () => {
    const report = runInternalNoLiveBenchmark({ vertical: "restaurant", count: 2 });
    expect(report.summary.artifactCompletenessRate).toBe(0.5);
    expect(report.results.find((result) => result.failureClass === "artifact_incomplete")).toBeDefined();
  });

  it("renders markdown useful for local review", () => {
    const report = runInternalNoLiveBenchmark({ vertical: "all", count: 5 });
    const markdown = renderInternalBenchmarkMarkdown(report);
    expect(markdown).toContain("# Internal Benchmark v2");
    expect(markdown).toContain("Failure Taxonomy");
    expect(markdown).toContain("Cases");
  });
});
