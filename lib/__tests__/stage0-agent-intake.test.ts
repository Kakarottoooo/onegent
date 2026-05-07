import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyAgentIntakeQueue,
  classifyAgentReturnReport,
  parseAgentIntakeInput,
  renderAgentIntakeMarkdown,
  type AgentReturnReport,
} from "@/lib/internal-benchmark/agent-intake";

const REQUIRED_BASE = "origin/codex/stage0-capture-mvp";
const REQUIRED_COMMIT = "2a5088a";

function validations() {
  return [
    { name: "targeted_vitest", status: "pass" as const },
    { name: "tsc", status: "pass" as const },
    { name: "check_drift", status: "pass" as const },
    { name: "gate_phase1", status: "pass" as const },
    { name: "git_diff_check", status: "pass" as const },
  ];
}

function report(overrides: Partial<AgentReturnReport> = {}): AgentReturnReport {
  return {
    branch: "codex/example-stage0",
    commit: "abc1234",
    worktree: "C:\\Users\\Gzw19\\onegent-example-stage0",
    base: {
      branch: REQUIRED_BASE,
      commit: REQUIRED_COMMIT,
      containsRequiredCommit: true,
    },
    taskKind: "benchmark_fixture",
    mergeState: "unmerged",
    summary: "Stage 0 no-live benchmark branch.",
    changedFiles: ["lib/capture/benchmark.ts", "lib/__tests__/capture-benchmark.test.ts"],
    artifacts: [],
    validations: validations(),
    dependencyEdges: [{ type: "independent" }],
    claims: { runtimeClosure: false, liveVerified: false, docsOnly: false },
    safetyStatement:
      "No provider workflow, no browser booking agent, no live OpenAI call, no secrets, no payment, no login or verification, and no final confirmation was run.",
    ...overrides,
  };
}

describe("Stage 0 agent intake upgrade", () => {
  it("classifies the sample Goal/Claude/Agent2/Agent3 queue", () => {
    const fixturePath = path.join(
      process.cwd(),
      "lib/internal-benchmark/__fixtures__/agent-intake/stage0-returned-branches.json",
    );
    const reports = parseAgentIntakeInput(readFileSync(fixturePath, "utf8"), fixturePath);
    const queue = classifyAgentIntakeQueue(reports, {
      requiredBaseBranch: REQUIRED_BASE,
      requiredBaseCommit: REQUIRED_COMMIT,
      forbidProviderRuntimeChanges: true,
    });

    expect(queue.summary.total).toBe(5);
    expect(queue.results.find((item) => item.report.id === "goal-stage0-reliability-system")?.decision).toBe("ready_to_merge");
    expect(queue.results.find((item) => item.report.id === "claude-activity-runtime-followup")?.decision).toBe("needs_followup");
    expect(queue.results.find((item) => item.report.id === "agent2-flight-ready")?.decision).toBe("ready_to_merge");
    expect(queue.results.find((item) => item.report.id === "agent3-hotel-ready")?.decision).toBe("ready_to_merge");
    expect(queue.results.find((item) => item.report.id === "unsafe-missing-report")?.decision).toBe("reject");
    expect(queue.summary.byIssue.provider_runtime_without_permission).toBe(1);
    expect(queue.summary.byIssue.missing_safety_statement).toBe(1);
    expect(queue.results.find((item) => item.report.id === "goal-stage0-reliability-system")?.codexAction).toBe("merge_validate");

    const markdown = renderAgentIntakeMarkdown(queue);
    expect(markdown).toContain("codex/goal-stage0-reliability-system");
    expect(markdown).toContain("provider_runtime_without_permission");
    expect(markdown).toContain("codex/unsafe-stage0-branch");
  });

  it("rejects provider runtime paths when Stage 0 forbids them", () => {
    const result = classifyAgentReturnReport(
      report({
        branch: "codex/runtime-leak",
        taskKind: "runtime_fix",
        changedFiles: ["lib/booking-autopilot/providers/opentable.ts"],
      }),
      {
        requiredBaseBranch: REQUIRED_BASE,
        requiredBaseCommit: REQUIRED_COMMIT,
        forbidProviderRuntimeChanges: true,
      },
    );

    expect(result.decision).toBe("reject");
    expect(result.issues.map((issue) => issue.code)).toContain("provider_runtime_without_permission");
  });

  it("keeps docs-only runtime closure claims rejected from metadata alone", () => {
    const result = classifyAgentReturnReport(
      report({
        taskKind: "docs_contract",
        docsOnly: true,
        summary: "Docs-only runtime closure verified.",
        changedFiles: ["docs/30-provider-debug/CLOSURE.md"],
        claims: { runtimeClosure: true, liveVerified: true, docsOnly: true },
      }),
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );

    expect(result.decision).toBe("reject");
    expect(result.issues.map((issue) => issue.code)).toContain("docs_only_runtime_closure_claim");
  });

  it("catches missing worktree, safety statement, and tests for logic changes", () => {
    const result = classifyAgentReturnReport(
      report({
        worktree: undefined,
        safetyStatement: "",
        changedFiles: ["lib/capture/private-alpha.ts"],
      }),
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );

    expect(result.decision).toBe("needs_followup");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "missing_required_report_field",
        "missing_safety_statement",
        "missing_tests_for_logic_change",
      ]),
    );
    expect(result.codexAction).toBe("assign_next_independent_task");
    expect(result.recommendedNextPrompt).toContain("missing metadata");
  });

  it("classifies explicit rebase requirements separately from ordinary follow-up", () => {
    const result = classifyAgentReturnReport(
      report({
        dependencyEdges: [{ type: "requires_rebase_before_merge", reason: "base is behind stage0-capture-mvp" }],
      }),
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );

    expect(result.decision).toBe("requires_rebase");
    expect(result.codexAction).toBe("ask_followup");
  });

  it("requires build evidence for app shell changes and flags likely merge conflicts", () => {
    const result = classifyAgentReturnReport(
      report({
        branch: "codex/app-shell-risk",
        taskKind: "read_model_perf",
        changedFiles: ["app/page.tsx", "lib/__tests__/stage0-performance.test.ts"],
        conflictNotes: ["likely overlap with current app/page.tsx edits"],
      }),
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );

    expect(result.decision).toBe("conflicts_with_mainline");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["app_shell_without_build", "likely_merge_conflict"]),
    );
  });

  it("classifies stale Stage 0 base commits as rebase follow-up", () => {
    const result = classifyAgentReturnReport(
      report({
        branch: "codex/stale-stage0",
        base: {
          branch: REQUIRED_BASE,
          commit: "1111111",
          containsRequiredCommit: false,
        },
      }),
      { requiredBaseBranch: REQUIRED_BASE, requiredBaseCommit: REQUIRED_COMMIT },
    );

    expect(result.decision).toBe("requires_rebase");
    expect(result.issues.map((issue) => issue.code)).toContain("stale_base");
  });
});
