import { describe, expect, it } from "vitest";
import {
  classifyAgentIntakeQueue,
  classifyAgentReturnReport,
  parseAgentIntakeMarkdown,
  renderAgentIntakeMarkdown,
  type AgentReturnReport,
} from "@/lib/internal-benchmark/agent-intake";

const REQUIRED_BASE = "origin/codex/goal-core-reliability-long-run";
const REQUIRED_COMMIT = "0e85721";

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
    summary: "No-live intake test branch",
    changedFiles: ["docs/40-dogfood/EXAMPLE.md", "lib/internal-benchmark/example.ts"],
    artifacts: [],
    validations: passingValidations(),
    ...overrides,
  };
}

describe("agent intake classifier", () => {
  it("marks clean metadata as ready to merge", () => {
    const result = classifyAgentReturnReport(baseReport(), {
      requiredBaseBranch: REQUIRED_BASE,
      requiredBaseCommit: REQUIRED_COMMIT,
    });
    expect(result.decision).toBe("ready_to_merge");
    expect(result.issues).toHaveLength(0);
  });

  it("rejects a returned branch from the wrong base", () => {
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

  it("rejects forbidden artifacts and local evidence paths", () => {
    const result = classifyAgentReturnReport(
      baseReport({
        changedFiles: ["docs/40-dogfood/EXAMPLE.md", ".env.local", "benchmark/runs/local-output.md"],
        artifacts: [".tmp/run.log", "screenshots/live-provider.png"],
      }),
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );

    expect(result.decision).toBe("reject");
    const forbidden = result.issues.find((issue) => issue.code === "forbidden_artifact");
    expect(forbidden?.evidence).toEqual(
      expect.arrayContaining([".env.local", "benchmark/runs/local-output.md", ".tmp/run.log"]),
    );
  });

  it("marks missing validation as needs followup", () => {
    const result = classifyAgentReturnReport(
      baseReport({
        validations: passingValidations().filter((validation) => validation.name !== "gate_phase1"),
      }),
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );

    expect(result.decision).toBe("needs_followup");
    const missing = result.issues.find((issue) => issue.code === "missing_validation");
    expect(missing?.evidence).toContain("gate_phase1");
  });

  it("catches runtime mirror changes without a passing drift check", () => {
    const result = classifyAgentReturnReport(
      baseReport({
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
        summary: "Provider runtime closure verified for hotel from docs only.",
        changedFiles: ["docs/30-provider-debug/HOTEL_CLOSURE.md"],
        docsOnly: true,
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

  it("summarizes a mixed intake queue and renders markdown", () => {
    const queue = classifyAgentIntakeQueue(
      [
        baseReport({ branch: "codex/ready" }),
        baseReport({
          branch: "codex/followup",
          validations: passingValidations().filter((validation) => validation.name !== "targeted_vitest"),
        }),
        baseReport({
          branch: "codex/reject",
          changedFiles: [".env.local"],
        }),
      ],
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );

    expect(queue.summary).toMatchObject({
      total: 3,
      readyToMerge: 1,
      needsFollowup: 1,
      reject: 1,
    });

    const markdown = renderAgentIntakeMarkdown(queue);
    expect(markdown).toContain("# Agent Intake Queue");
    expect(markdown).toContain("codex/ready");
    expect(markdown).toContain("forbidden_artifact");
  });

  it("parses a static markdown intake list", () => {
    const parsed = parseAgentIntakeMarkdown(`
# Returned Agents

## codex/markdown-ready
- branch: codex/markdown-ready
- commit: def5678
- baseBranch: origin/codex/goal-core-reliability-long-run
- baseCommit: 0e85721
- baseContainsRequiredCommit: true
- changedFiles: docs/40-dogfood/EXAMPLE.md, scripts/example.ts
- artifacts: none
- validations: targeted_vitest=pass, tsc=pass, check-drift=pass, gate:phase1=pass, git diff --check=pass
- docsOnly: false
- runtimeClosure: false
`);

    expect(parsed).toHaveLength(1);
    const result = classifyAgentReturnReport(parsed[0], {
      requiredBaseBranch: REQUIRED_BASE,
      requiredBaseCommit: REQUIRED_COMMIT,
    });
    expect(result.decision).toBe("ready_to_merge");
  });
});
