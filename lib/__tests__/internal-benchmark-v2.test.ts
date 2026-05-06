import { describe, expect, it } from "vitest";
import {
  INTERNAL_BENCHMARK_CASES,
  evaluateInternalBenchmarkGate,
  renderInternalBenchmarkMarkdown,
  runInternalNoLiveBenchmark,
  selectInternalBenchmarkCases,
} from "@/lib/internal-benchmark";

describe("internal benchmark v2", () => {
  it("ships a 200-case no-live corpus with required vertical distribution", () => {
    expect(INTERNAL_BENCHMARK_CASES.length).toBeGreaterThanOrEqual(200);

    const report = runInternalNoLiveBenchmark({ vertical: "all", count: 200 });
    expect(report.summary.total).toBe(200);
    expect(report.summary.byVertical.restaurant).toBeGreaterThanOrEqual(40);
    expect(report.summary.byVertical.hotel).toBeGreaterThanOrEqual(40);
    expect(report.summary.byVertical.flight).toBeGreaterThanOrEqual(40);
    expect(report.summary.byVertical.activity).toBeGreaterThanOrEqual(40);
    expect(report.summary.byVertical.trip).toBeGreaterThanOrEqual(40);
  });

  it("selects no-live cases by vertical and count", () => {
    const cases = selectInternalBenchmarkCases({ vertical: "activity", count: 40 });
    expect(cases).toHaveLength(40);
    expect(cases.every((testCase) => testCase.vertical === "activity")).toBe(true);
  });

  it("requires owner, expected outcome, and artifact expectations on every case", () => {
    for (const testCase of INTERNAL_BENCHMARK_CASES) {
      expect(testCase.id).toMatch(/^[a-z0-9-]+$/);
      expect(testCase.expectedOutcome).toMatch(/pass|expected_/);
      expect(testCase.suggestedOwner).not.toBe("unassigned");
      expect(testCase.artifactExpectations.syntheticMarker).toBe(true);
      expect(typeof testCase.artifactExpectations.logs).toBe("boolean");
      expect(typeof testCase.artifactExpectations.screenshots).toBe("boolean");
    }
  });

  it("runs a deterministic 200-case all-vertical no-live report", () => {
    const report = runInternalNoLiveBenchmark({ vertical: "all", count: 200 });
    expect(report.summary.mode).toBe("no-live");
    expect(report.summary.routingMismatchCount).toBe(0);
    expect(report.summary.ownerUnassignedCount).toBe(0);
    expect(report.summary.artifactCompletenessRate).toBeGreaterThanOrEqual(0.9);
    expect(report.summary.byFailureClass.provider_simulated_block).toBeGreaterThan(0);
    expect(report.summary.byFailureClass.task_workspace_artifact_incomplete).toBeGreaterThan(0);
    expect(report.summary.byFailureClass.manual_boundary_expected).toBeGreaterThan(0);
    expect(report.summary.byFailureClass.performance_budget_exceeded).toBeGreaterThan(0);
    expect(report.summary.bySuggestedOwner.nlu).toBeGreaterThan(0);
    expect(report.dogfoodMapping.find((item) => item.dogfoodId === "DOG-005")).toBeDefined();
    expect(report.nextRecommendedOwners[0]).toMatchObject({
      owner: expect.any(String),
      failedCases: expect.any(Number),
    });
  });

  it("renders stable JSON-shaped report fields and founder-readable markdown", () => {
    const report = runInternalNoLiveBenchmark({ vertical: "all", count: 200 });
    const json = JSON.parse(JSON.stringify(report));
    expect(json.summary.total).toBe(200);
    expect(json.topFailedCases.length).toBeGreaterThan(0);
    expect(json.dogfoodMapping.length).toBeGreaterThan(0);
    expect(json.nextRecommendedOwners.length).toBeGreaterThan(0);

    const markdown = renderInternalBenchmarkMarkdown(report);
    expect(markdown).toContain("# Internal Benchmark v2");
    expect(markdown).toContain("Failure Taxonomy");
    expect(markdown).toContain("Next Recommended Owners");
    expect(markdown).toContain("Dogfood Mapping");
    expect(markdown).toContain("task_workspace_artifact_incomplete");
  });

  it("can pass and fail configured gates", () => {
    const report = runInternalNoLiveBenchmark({ vertical: "all", count: 200 });

    expect(
      evaluateInternalBenchmarkGate(report, {
        minArtifactCompletenessRate: 0.9,
        maxRoutingMismatch: 0,
        maxOwnerUnassigned: 0,
      }),
    ).toMatchObject({ pass: true, errors: [] });

    const failed = evaluateInternalBenchmarkGate(report, {
      minSuccessRate: 0.95,
      maxFailureCounts: {
        provider_simulated_block: 0,
        task_workspace_artifact_incomplete: 0,
      },
    });
    expect(failed.pass).toBe(false);
    expect(failed.errors.join(" ")).toContain("successRate");
    expect(failed.errors.join(" ")).toContain("provider_simulated_block");
    expect(failed.errors.join(" ")).toContain("task_workspace_artifact_incomplete");
  });
});
