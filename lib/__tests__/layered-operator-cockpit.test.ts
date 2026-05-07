import { describe, expect, it } from "vitest";
import {
  evaluateLayeredBenchmarkGate,
  runLayeredNoLiveBenchmark,
  type LayeredBenchmarkReport,
} from "@/lib/execution-layer/layered-benchmark";
import {
  buildLayeredOperatorCockpit,
  parseLayeredOperatorBenchmarkInput,
  renderLayeredOperatorCockpitMarkdown,
  type LayeredBenchmarkReportWithGate,
} from "@/lib/internal-benchmark/layered-operator-cockpit";
import type { AgentReturnReport } from "@/lib/internal-benchmark/agent-intake";

const REQUIRED_BASE = "origin/codex/goal-core-reliability-long-run";
const REQUIRED_COMMIT = "3b8e39d";

function passingValidations() {
  return [
    { name: "targeted_vitest", status: "pass" as const },
    { name: "tsc", status: "pass" as const },
    { name: "check_drift", status: "pass" as const },
    { name: "gate_phase1", status: "pass" as const },
    { name: "git_diff_check", status: "pass" as const },
  ];
}

function agentReport(overrides: Partial<AgentReturnReport> = {}): AgentReturnReport {
  return {
    branch: "codex/example",
    commit: "abc1234",
    agent: "Goal",
    base: {
      branch: REQUIRED_BASE,
      commit: REQUIRED_COMMIT,
      containsRequiredCommit: true,
    },
    taskKind: "benchmark_fixture",
    mergeState: "unmerged",
    summary: "No-live operator cockpit test branch",
    changedFiles: ["lib/internal-benchmark/example.ts"],
    artifacts: [],
    validations: passingValidations(),
    dependencyEdges: [{ type: "independent" }],
    claims: {
      runtimeClosure: false,
      liveVerified: false,
      docsOnly: false,
    },
    ...overrides,
  };
}

function benchmarkReport(): LayeredBenchmarkReport {
  return runLayeredNoLiveBenchmark({ vertical: "all", count: 50 });
}

describe("layered operator cockpit", () => {
  it("orders ready shared branches before dependency-blocked vertical branches", () => {
    const cockpit = buildLayeredOperatorCockpit({
      benchmarkReport: benchmarkReport(),
      agentReports: [
        agentReport({
          branch: "codex/layered-benchmark-v2",
          commit: "aaa1111",
          agent: "Goal",
          dependencyEdges: [{ type: "independent" }],
        }),
        agentReport({
          branch: "codex/flight-layered-recovery",
          commit: "bbb2222",
          agent: "Agent2",
          dependencyEdges: [
            {
              type: "depends_on_shared_schema",
              targetBranch: "codex/layered-benchmark-v2",
              requiredState: "merged",
            },
          ],
        }),
      ],
      requiredBaseBranch: REQUIRED_BASE,
      requiredBaseCommit: REQUIRED_COMMIT,
    });

    expect(cockpit.mergeQueue[0]).toMatchObject({
      branch: "codex/layered-benchmark-v2",
      decision: "ready_to_merge",
    });
    expect(cockpit.mergeQueue[1]).toMatchObject({
      branch: "codex/flight-layered-recovery",
      decision: "needs_followup",
    });
    expect(cockpit.dependencyWarnings.join(" ")).toContain("codex/layered-benchmark-v2");
    expect(cockpit.exactNextStep).toContain("codex/layered-benchmark-v2");
  });

  it("uses recently merged commits to unblock dependent branch ordering", () => {
    const cockpit = buildLayeredOperatorCockpit({
      benchmarkReport: benchmarkReport(),
      agentReports: [
        agentReport({
          branch: "codex/layered-benchmark-v2",
          commit: "aaa1111",
          agent: "Goal",
        }),
        agentReport({
          branch: "codex/hotel-layered-recovery",
          commit: "ccc3333",
          agent: "Agent3",
          dependencyEdges: [
            {
              type: "depends_on_shared_schema",
              targetBranch: "codex/layered-benchmark-v2",
              requiredState: "merged",
            },
          ],
        }),
      ],
      recentMergedCommits: [{ commit: "aaa1111" }],
      requiredBaseBranch: REQUIRED_BASE,
      requiredBaseCommit: REQUIRED_COMMIT,
    });

    const hotel = cockpit.mergeQueue.find((item) => item.branch === "codex/hotel-layered-recovery");
    expect(hotel?.decision).toBe("ready_to_merge");
    expect(cockpit.dependencyWarnings).toHaveLength(0);
  });

  it("reports safe-to-start next work decisions for independent branches", () => {
    const cockpit = buildLayeredOperatorCockpit({
      benchmarkReport: benchmarkReport(),
      agentReports: [
        agentReport({
          branch: "codex/independent-read-model",
          taskKind: "read_model_perf",
          agent: "Agent4",
        }),
      ],
      requiredBaseBranch: REQUIRED_BASE,
      requiredBaseCommit: REQUIRED_COMMIT,
    });

    expect(cockpit.independentWork[0]).toMatchObject({
      branch: "codex/independent-read-model",
      canStart: true,
      conflictRisk: "low",
    });
    expect(cockpit.intake.nextTaskRecommendation.can_start_next_task).toBe(true);
  });

  it("maps top failed benchmark cases to owners with concrete next tasks", () => {
    const cockpit = buildLayeredOperatorCockpit({
      benchmarkReport: benchmarkReport(),
      agentReports: [agentReport()],
      requiredBaseBranch: REQUIRED_BASE,
      requiredBaseCommit: REQUIRED_COMMIT,
    });

    const providerRuntime = cockpit.ownerRecommendations.find((item) => item.owner === "provider-runtime");
    expect(providerRuntime?.failedCount).toBeGreaterThan(0);
    expect(providerRuntime?.nextTask).toContain("Patch");
    expect(providerRuntime?.cases[0]).toMatchObject({
      owner: "provider-runtime",
      patchProposal: true,
    });
  });

  it("does not treat docs-only runtime closure claims as credible closure", () => {
    const cockpit = buildLayeredOperatorCockpit({
      benchmarkReport: benchmarkReport(),
      agentReports: [
        agentReport({
          branch: "codex/docs-only-closure",
          taskKind: "docs_contract",
          docsOnly: true,
          changedFiles: ["docs/30-provider-debug/CLAIM.md"],
          summary: "Provider runtime closure verified from docs only.",
          claims: {
            runtimeClosure: true,
            liveVerified: false,
            docsOnly: true,
          },
        }),
      ],
      requiredBaseBranch: REQUIRED_BASE,
      requiredBaseCommit: REQUIRED_COMMIT,
    });

    expect(cockpit.mergeQueue[0]).toMatchObject({
      branch: "codex/docs-only-closure",
      decision: "reject",
      runtimeClosureCredible: false,
    });
    expect(cockpit.conflictWarnings.join(" ")).toContain("Docs-only branch claims runtime/provider closure");
  });

  it("summarizes benchmark gate pass and fail states", () => {
    const passingBenchmark: LayeredBenchmarkReportWithGate = {
      ...benchmarkReport(),
      gate: evaluateLayeredBenchmarkGate(benchmarkReport(), {
        minArtifactCompletenessRate: 0.9,
        maxUnknownFailureRate: 0.1,
        maxRoutingMismatch: 0,
        minL1DirectPassRate: 0.2,
        minL1PlusL2RecoveredPassRate: 0.4,
      }),
    };
    const failingBenchmark: LayeredBenchmarkReportWithGate = {
      ...benchmarkReport(),
      gate: evaluateLayeredBenchmarkGate(benchmarkReport(), {
        minL1DirectPassRate: 0.95,
      }),
    };

    expect(
      buildLayeredOperatorCockpit({
        benchmarkReport: passingBenchmark,
        agentReports: [agentReport()],
        requiredBaseBranch: REQUIRED_BASE,
        requiredBaseCommit: REQUIRED_COMMIT,
      }).benchmarkGate,
    ).toMatchObject({ pass: true, failedChecks: [] });

    const failing = buildLayeredOperatorCockpit({
      benchmarkReport: failingBenchmark,
      agentReports: [agentReport()],
      requiredBaseBranch: REQUIRED_BASE,
      requiredBaseCommit: REQUIRED_COMMIT,
    });
    expect(failing.benchmarkGate.pass).toBe(false);
    expect(failing.benchmarkGate.failedChecks).toContain("min_l1_direct_pass");
    expect(failing.conflictWarnings.join(" ")).toContain("Layered benchmark gate fails");
  });

  it("renders markdown and parses layered benchmark markdown inputs", () => {
    const cockpit = buildLayeredOperatorCockpit({
      benchmarkReport: benchmarkReport(),
      agentReports: [agentReport()],
      requiredBaseBranch: REQUIRED_BASE,
      requiredBaseCommit: REQUIRED_COMMIT,
    });
    const markdown = renderLayeredOperatorCockpitMarkdown(cockpit);
    expect(markdown).toContain("# Layered Operator Cockpit");
    expect(markdown).toContain("## Ordered Merge Queue");
    expect(markdown).toContain("## Benchmark Failures By Owner");

    const parsed = parseLayeredOperatorBenchmarkInput(
      [
        "# Layered Benchmark V2",
        "Cases: 2",
        "Pass: 1",
        "Fail: 1",
        "Artifact completeness: 100%",
        "Average artifact score: 100%",
        "Unknown failure rate: 0%",
        "Routing mismatches: 0",
        "L1 direct pass: 50%",
        "L1 + L2 recovered pass: 50%",
        "",
        "## Top Failed Cases",
        "| Case | Vertical | Failure | Verdict | Owner | Patch |",
        "| --- | --- | --- | --- | --- | --- |",
        "| `lbv2-test` | restaurant | `selector_drift` | `needs_runtime_patch` | provider-runtime | yes |",
      ].join("\n"),
      "report.md",
    );
    expect(parsed.summary.total).toBe(2);
    expect(parsed.topFailedCases[0]).toMatchObject({
      id: "lbv2-test",
      owner: "provider-runtime",
    });
  });
});
