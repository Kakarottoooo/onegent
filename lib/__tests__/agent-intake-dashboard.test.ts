import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyAgentIntakeQueue,
  classifyAgentReturnReport,
  parseAgentIntakeInput,
  parseAgentIntakeMarkdown,
  renderAgentIntakeMarkdown,
  type AgentReturnReport,
} from "@/lib/internal-benchmark/agent-intake";

const REQUIRED_BASE = "origin/codex/goal-core-reliability-long-run";
const REQUIRED_COMMIT = "232fabd";

function passingValidations() {
  return [
    { name: "targeted_vitest", status: "pass" as const },
    { name: "tsc", status: "pass" as const },
    { name: "check_drift", status: "pass" as const },
    { name: "gate_phase1", status: "pass" as const },
    { name: "git_diff_check", status: "pass" as const },
  ];
}

function baseReport(overrides: Partial<AgentReturnReport> = {}): AgentReturnReport {
  return {
    branch: "codex/example-agent-return",
    commit: "abc1234",
    base: {
      branch: REQUIRED_BASE,
      commit: REQUIRED_COMMIT,
      containsRequiredCommit: true,
    },
    taskKind: "benchmark_fixture",
    mergeState: "unmerged",
    summary: "No-live intake test branch",
    changedFiles: ["docs/40-dogfood/EXAMPLE.md", "lib/internal-benchmark/example.ts"],
    artifacts: [],
    validations: passingValidations(),
    dependencyEdges: [{ type: "independent" }],
    ...overrides,
  };
}

describe("agent intake dashboard coordination", () => {
  it("marks clean independent metadata as ready to merge", () => {
    const result = classifyAgentReturnReport(baseReport(), {
      requiredBaseBranch: REQUIRED_BASE,
      requiredBaseCommit: REQUIRED_COMMIT,
    });
    expect(result.decision).toBe("ready_to_merge");
    expect(result.issues).toHaveLength(0);
  });

  it("catches wrong base", () => {
    const result = classifyAgentReturnReport(
      baseReport({
        base: {
          branch: "origin/codex/integrated-preview-20260504",
          commit: "1978cc7",
          containsRequiredCommit: false,
        },
      }),
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );
    expect(result.decision).toBe("reject");
    expect(result.issues.map((issue) => issue.code)).toContain("wrong_base");
  });

  it("catches forbidden artifacts", () => {
    const result = classifyAgentReturnReport(
      baseReport({
        changedFiles: ["docs/40-dogfood/EXAMPLE.md", ".env.local", "benchmark/runs/local.md"],
        artifacts: [".tmp/run.log", "screenshots/provider.png"],
      }),
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );
    expect(result.decision).toBe("reject");
    expect(result.issues.find((issue) => issue.code === "forbidden_artifact")?.evidence).toEqual(
      expect.arrayContaining([".env.local", ".tmp/run.log", "screenshots/provider.png"]),
    );
  });

  it("catches missing validation", () => {
    const result = classifyAgentReturnReport(
      baseReport({
        validations: passingValidations().filter((validation) => validation.name !== "gate_phase1"),
      }),
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );
    expect(result.decision).toBe("needs_followup");
    expect(result.issues.find((issue) => issue.code === "missing_validation")?.evidence).toContain("gate_phase1");
  });

  it("catches runtime mirror changes without drift check", () => {
    const result = classifyAgentReturnReport(
      baseReport({
        taskKind: "runtime_fix",
        changedFiles: ["lib/booking-autopilot/providers/booking-com.ts"],
        validations: passingValidations().filter((validation) => validation.name !== "check_drift"),
      }),
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );
    expect(result.decision).toBe("needs_followup");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["missing_validation", "runtime_mirror_without_drift_check"]),
    );
  });

  it("rejects docs-only branches that claim runtime closure", () => {
    const result = classifyAgentReturnReport(
      baseReport({
        taskKind: "docs_contract",
        docsOnly: true,
        summary: "Provider runtime closure verified from documentation package.",
        changedFiles: ["docs/30-provider-debug/HOTEL_CLOSURE.md"],
        claims: {
          runtimeClosure: true,
          docsOnly: true,
        },
      }),
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );
    expect(result.decision).toBe("reject");
    expect(result.issues.map((issue) => issue.code)).toContain("docs_only_runtime_closure_claim");
  });

  it("supports dependency edges, supersession, and rebase follow-up", () => {
    const queue = classifyAgentIntakeQueue(
      [
        baseReport({
          branch: "codex/shared-schema",
          mergeState: "unmerged",
          dependencyEdges: [{ type: "independent" }],
        }),
        baseReport({
          branch: "codex/vertical-dependent",
          dependencyEdges: [
            {
              type: "depends_on_shared_schema",
              targetBranch: "codex/shared-schema",
              requiredState: "merged",
            },
          ],
        }),
        baseReport({
          branch: "codex/newer-branch",
          dependencyEdges: [{ type: "supersedes", targetBranch: "codex/old-branch" }],
        }),
        baseReport({
          branch: "codex/old-branch",
          dependencyEdges: [{ type: "independent" }],
        }),
        baseReport({
          branch: "codex/rebase-needed",
          dependencyEdges: [{ type: "requires_rebase_before_merge", reason: "base advanced" }],
        }),
      ],
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );

    expect(queue.results.find((result) => result.report.branch === "codex/vertical-dependent")?.decision).toBe(
      "needs_followup",
    );
    expect(queue.results.find((result) => result.report.branch === "codex/old-branch")?.decision).toBe("reject");
    expect(queue.results.find((result) => result.report.branch === "codex/rebase-needed")?.decision).toBe(
      "needs_followup",
    );
    expect(queue.summary.supersededBranches).toContain("codex/old-branch");
    expect(queue.nextTaskRecommendation).toMatchObject({
      can_start_next_task: false,
      conflict_risk: "high",
    });
  });

  it("turns the current four-agent sample into a dependency-aware recommendation", () => {
    const fixturePath = path.join(
      process.cwd(),
      "lib/internal-benchmark/__fixtures__/agent-intake/four-agent-queue.json",
    );
    const reports = parseAgentIntakeInput(readFileSync(fixturePath, "utf8"), fixturePath);
    const queue = classifyAgentIntakeQueue(reports, {
      requiredBaseBranch: REQUIRED_BASE,
      requiredBaseCommit: REQUIRED_COMMIT,
    });

    expect(queue.summary.total).toBe(4);
    expect(queue.summary.byTaskKind.benchmark_fixture).toBe(4);
    expect(queue.results.find((result) => result.report.branch === "codex/layered-benchmark-v2")?.decision).toBe(
      "ready_to_merge",
    );
    expect(queue.summary.byIssue.unresolved_shared_schema_dependency).toBe(3);
    expect(queue.nextTaskRecommendation.can_start_next_task).toBe(false);
    expect(queue.nextTaskRecommendation.reason).toContain("shared schema");
  });

  it("allows independent next work when only validation or rebase follow-up remains", () => {
    const queue = classifyAgentIntakeQueue(
      [
        baseReport({
          branch: "codex/rebase-needed",
          dependencyEdges: [{ type: "requires_rebase_before_merge", reason: "base advanced" }],
        }),
        baseReport({
          branch: "codex/missing-test",
          validations: passingValidations().filter((validation) => validation.name !== "targeted_vitest"),
        }),
      ],
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );

    expect(queue.summary.needsFollowup).toBe(2);
    expect(queue.nextTaskRecommendation).toMatchObject({
      can_start_next_task: true,
      conflict_risk: "medium",
      recommended_base: REQUIRED_BASE,
    });
  });

  it("renders JSON and markdown with next task recommendation fields", () => {
    const queue = classifyAgentIntakeQueue([baseReport()], {
      requiredBaseBranch: REQUIRED_BASE,
      requiredBaseCommit: REQUIRED_COMMIT,
    });
    const json = JSON.parse(JSON.stringify(queue));
    expect(json.nextTaskRecommendation.can_start_next_task).toBe(true);
    expect(json.nextTaskRecommendation.recommended_base).toBe(REQUIRED_BASE);

    const markdown = renderAgentIntakeMarkdown(queue);
    expect(markdown).toContain("# Agent Intake Queue");
    expect(markdown).toContain("## Next Task Recommendation");
    expect(markdown).toContain("can_start_next_task: true");
    expect(markdown).toContain("## Dependency Edges");
  });

  it("parses static markdown intake reports", () => {
    const parsed = parseAgentIntakeMarkdown(`
# Returned Agents

## codex/markdown-ready
- branch: codex/markdown-ready
- commit: def5678
- baseBranch: origin/codex/goal-core-reliability-long-run
- baseCommit: 232fabd
- baseContainsRequiredCommit: true
- taskKind: docs_contract
- mergeState: unmerged
- changedFiles: docs/40-dogfood/EXAMPLE.md, scripts/example.ts
- artifacts: none
- validations: targeted_vitest=pass, tsc=pass, check-drift=pass, gate:phase1=pass, git diff --check=pass
- dependencyEdges: independent
- docsOnly: false
- runtimeClosure: false
`);
    const queue = classifyAgentIntakeQueue(parsed, {
      requiredBaseBranch: REQUIRED_BASE,
      requiredBaseCommit: REQUIRED_COMMIT,
    });
    expect(queue.results).toHaveLength(1);
    expect(queue.results[0].decision).toBe("ready_to_merge");
  });
});
