import {
  evaluateLayeredBenchmarkGate,
  type LayeredBenchmarkCaseResult,
  type LayeredBenchmarkFailureClass,
  type LayeredBenchmarkGateResult,
  type LayeredBenchmarkOwner,
  type LayeredBenchmarkReport,
  type LayeredBenchmarkVerdict,
  type LayeredBenchmarkVertical,
} from "@/lib/execution-layer/layered-benchmark";
import {
  classifyAgentIntakeQueue,
  parseAgentIntakeInput,
  type AgentConflictRisk,
  type AgentIntakeQueueReport,
  type AgentIntakeResult,
  type AgentReturnReport,
  type AgentTaskKind,
} from "@/lib/internal-benchmark/agent-intake";

export type LayeredOperatorConflictRisk = AgentConflictRisk;

export type LayeredBenchmarkReportWithGate = LayeredBenchmarkReport & {
  gate?: LayeredBenchmarkGateResult;
};

export type LayeredOperatorMergedCommit = {
  commit: string;
  branch?: string;
  title?: string;
};

export type LayeredOperatorCockpitInput = {
  benchmarkReport: LayeredBenchmarkReportWithGate;
  agentReports: AgentReturnReport[];
  recentMergedCommits?: LayeredOperatorMergedCommit[];
  requiredBaseBranch?: string;
  requiredBaseCommit?: string;
  recommendedBase?: string;
};

export type LayeredOperatorMergeQueueItem = {
  rank: number;
  branch: string;
  commit: string;
  agent?: string;
  taskKind?: AgentTaskKind;
  decision: AgentIntakeResult["decision"];
  mergeState: string;
  dependencyTargets: string[];
  blockedBy: string[];
  warnings: string[];
  runtimeClosureCredible: boolean;
};

export type LayeredOperatorIndependentWorkItem = {
  agent?: string;
  branch: string;
  taskKind?: AgentTaskKind;
  canStart: boolean;
  reason: string;
  recommendedBase: string;
  conflictRisk: LayeredOperatorConflictRisk;
};

export type LayeredOperatorFailureCase = {
  id: string;
  vertical: LayeredBenchmarkVertical;
  owner: LayeredBenchmarkOwner;
  failureClass: LayeredBenchmarkFailureClass;
  verdict: LayeredBenchmarkVerdict;
  patchProposal: boolean;
  recommendedAction: string;
};

export type LayeredOperatorOwnerRecommendation = {
  owner: LayeredBenchmarkOwner;
  failedCount: number;
  topFailureClasses: Array<{ failureClass: LayeredBenchmarkFailureClass; count: number }>;
  cases: LayeredOperatorFailureCase[];
  nextTask: string;
};

export type LayeredOperatorGateSummary = {
  provided: boolean;
  pass: boolean | null;
  failedChecks: string[];
  errors: string[];
  summary: string;
};

export type LayeredOperatorCockpitReport = {
  generatedAt: string;
  mergeQueue: LayeredOperatorMergeQueueItem[];
  independentWork: LayeredOperatorIndependentWorkItem[];
  ownerRecommendations: LayeredOperatorOwnerRecommendation[];
  dependencyWarnings: string[];
  conflictWarnings: string[];
  benchmarkGate: LayeredOperatorGateSummary;
  exactNextStep: string;
  intake: AgentIntakeQueueReport;
  benchmark: {
    total: number;
    pass: number;
    fail: number;
    artifactCompletenessRate: number;
    l1DirectPassRate: number;
    l1PlusL2RecoveredPassRate: number;
  };
};

type ParsedBenchmarkSummary = LayeredBenchmarkReport["summary"];

export function buildLayeredOperatorCockpit(input: LayeredOperatorCockpitInput): LayeredOperatorCockpitReport {
  const mergedBranches = branchesFromMergedCommits(input.agentReports, input.recentMergedCommits ?? []);
  const intake = classifyAgentIntakeQueue(input.agentReports, {
    requiredBaseBranch: input.requiredBaseBranch,
    requiredBaseCommit: input.requiredBaseCommit,
    recommendedBase: input.recommendedBase,
    mergedBranches,
  });
  const mergeQueue = buildMergeQueue(intake, new Set(mergedBranches));
  const independentWork = buildIndependentWork(intake);
  const ownerRecommendations = groupBenchmarkFailuresByOwner(input.benchmarkReport);
  const benchmarkGate = summarizeBenchmarkGate(input.benchmarkReport);
  const dependencyWarnings = dependencyWarningsFromIntake(intake);
  const conflictWarnings = conflictWarningsFromIntake(intake, benchmarkGate);
  const exactNextStep = chooseExactNextStep({
    mergeQueue,
    independentWork,
    ownerRecommendations,
    dependencyWarnings,
    benchmarkGate,
  });

  return {
    generatedAt: new Date().toISOString(),
    mergeQueue,
    independentWork,
    ownerRecommendations,
    dependencyWarnings,
    conflictWarnings,
    benchmarkGate,
    exactNextStep,
    intake,
    benchmark: {
      total: input.benchmarkReport.summary.total,
      pass: input.benchmarkReport.summary.pass,
      fail: input.benchmarkReport.summary.fail,
      artifactCompletenessRate: input.benchmarkReport.summary.artifactCompletenessRate,
      l1DirectPassRate: input.benchmarkReport.summary.l1DirectPassRate,
      l1PlusL2RecoveredPassRate: input.benchmarkReport.summary.l1PlusL2RecoveredPassRate,
    },
  };
}

export function parseLayeredOperatorBenchmarkInput(input: string, filename = ""): LayeredBenchmarkReportWithGate {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Benchmark report input is empty.");
  if (filename.endsWith(".md") || filename.endsWith(".markdown") || trimmed.startsWith("#")) {
    return parseLayeredBenchmarkMarkdown(trimmed);
  }
  return parseLayeredBenchmarkJson(trimmed);
}

export function parseLayeredOperatorAgentInput(input: string, filename = ""): AgentReturnReport[] {
  return parseAgentIntakeInput(input, filename);
}

export function parseMergedCommitsInput(input: string): LayeredOperatorMergedCommit[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.commits)
        ? parsed.commits
        : [];
    return rows
      .map((row): LayeredOperatorMergedCommit | null => {
        if (typeof row === "string") return { commit: row };
        if (!isRecord(row) || typeof row.commit !== "string") return null;
        return {
          commit: row.commit,
          branch: typeof row.branch === "string" ? row.branch : undefined,
          title: typeof row.title === "string" ? row.title : undefined,
        };
      })
      .filter((row): row is LayeredOperatorMergedCommit => row !== null);
  }
  return trimmed
    .split(/[\r\n,]+/)
    .map((commit) => commit.trim())
    .filter(Boolean)
    .map((commit) => ({ commit }));
}

export function renderLayeredOperatorCockpitMarkdown(report: LayeredOperatorCockpitReport): string {
  const lines = [
    "# Layered Operator Cockpit",
    "",
    `Generated: ${report.generatedAt}`,
    `Exact next step: ${report.exactNextStep}`,
    "",
    "## Benchmark Gate",
    "",
    `Provided: ${report.benchmarkGate.provided}`,
    `Pass: ${report.benchmarkGate.pass ?? "n/a"}`,
    `Summary: ${report.benchmarkGate.summary}`,
  ];

  if (report.benchmarkGate.errors.length > 0) {
    lines.push("", "Gate errors:");
    for (const error of report.benchmarkGate.errors) lines.push(`- ${error}`);
  }

  lines.push(
    "",
    "## Ordered Merge Queue",
    "",
    "| Rank | Branch | Decision | Commit | Task Kind | Blocked By | Warnings |",
    "| ---: | --- | --- | --- | --- | --- | --- |",
  );
  for (const item of report.mergeQueue) {
    lines.push(
      `| ${item.rank} | \`${item.branch}\` | \`${item.decision}\` | \`${item.commit}\` | \`${item.taskKind ?? "-"}\` | ${item.blockedBy.length ? item.blockedBy.join(", ") : "-"} | ${item.warnings.length ? item.warnings.join(", ") : "-"} |`,
    );
  }

  lines.push(
    "",
    "## Agents That Can Start Next Independent Work",
    "",
    "| Agent | Branch | Can Start | Risk | Recommended Base | Reason |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const item of report.independentWork) {
    lines.push(
      `| ${item.agent ?? "-"} | \`${item.branch}\` | ${item.canStart} | \`${item.conflictRisk}\` | \`${item.recommendedBase}\` | ${item.reason} |`,
    );
  }

  lines.push("", "## Benchmark Failures By Owner");
  for (const owner of report.ownerRecommendations) {
    lines.push("", `### ${owner.owner}`, "", `Failed cases: ${owner.failedCount}`, `Next task: ${owner.nextTask}`);
    lines.push("", "| Case | Vertical | Failure | Verdict | Patch | Action |", "| --- | --- | --- | --- | --- | --- |");
    for (const failure of owner.cases.slice(0, 8)) {
      lines.push(
        `| \`${failure.id}\` | ${failure.vertical} | \`${failure.failureClass}\` | \`${failure.verdict}\` | ${failure.patchProposal ? "yes" : "no"} | ${failure.recommendedAction} |`,
      );
    }
  }

  if (report.dependencyWarnings.length > 0) {
    lines.push("", "## Dependency Warnings");
    for (const warning of report.dependencyWarnings) lines.push(`- ${warning}`);
  }

  if (report.conflictWarnings.length > 0) {
    lines.push("", "## Conflict Warnings");
    for (const warning of report.conflictWarnings) lines.push(`- ${warning}`);
  }

  return lines.join("\n");
}

function buildMergeQueue(
  intake: AgentIntakeQueueReport,
  mergedBranches: Set<string> = new Set(),
): LayeredOperatorMergeQueueItem[] {
  const results = [...intake.results].sort((a, b) => mergeSortScore(a) - mergeSortScore(b));
  return results.map((result, index) => {
    const dependencyTargets = (result.report.dependencyEdges ?? [])
      .filter((edge) => edge.targetBranch)
      .map((edge) => edge.targetBranch as string);
    const blockedBy = result.issues
      .filter((issue) =>
        issue.code === "unresolved_shared_schema_dependency" ||
        issue.code === "requires_rebase_before_merge" ||
        issue.code === "missing_validation",
      )
      .flatMap((issue) => issue.evidence);
    const warnings = result.issues.map((issue) => issue.code);
    return {
      rank: index + 1,
      branch: result.report.branch,
      commit: result.report.commit,
      agent: result.report.agent,
      taskKind: result.report.taskKind,
      decision: result.decision,
      mergeState: mergedBranches.has(result.report.branch) ? "merged" : result.report.mergeState ?? "unknown",
      dependencyTargets,
      blockedBy,
      warnings,
      runtimeClosureCredible: runtimeClosureCredible(result),
    };
  });
}

function buildIndependentWork(intake: AgentIntakeQueueReport): LayeredOperatorIndependentWorkItem[] {
  return intake.results.map((result) => {
    const dependencyIssue = result.issues.find((issue) => issue.code === "unresolved_shared_schema_dependency");
    const reject = result.decision === "reject";
    const canStart = !dependencyIssue && !reject && intake.nextTaskRecommendation.can_start_next_task;
    return {
      agent: result.report.agent,
      branch: result.report.branch,
      taskKind: result.report.taskKind,
      canStart,
      reason: canStart
        ? `Start independent ${result.report.taskKind ?? "follow-up"} from the recommended base.`
        : dependencyIssue
          ? "Wait for the shared contract dependency before launching dependent work."
          : reject
            ? "Do not start from a rejected branch."
            : intake.nextTaskRecommendation.reason,
      recommendedBase: intake.nextTaskRecommendation.recommended_base,
      conflictRisk: canStart ? intake.nextTaskRecommendation.conflict_risk : "high",
    };
  });
}

export function groupBenchmarkFailuresByOwner(
  report: LayeredBenchmarkReportWithGate,
): LayeredOperatorOwnerRecommendation[] {
  const failures = benchmarkFailures(report);
  const byOwner = new Map<LayeredBenchmarkOwner, LayeredOperatorFailureCase[]>();
  for (const failure of failures) {
    const existing = byOwner.get(failure.owner) ?? [];
    existing.push(failure);
    byOwner.set(failure.owner, existing);
  }

  return Array.from(byOwner.entries())
    .map(([owner, cases]) => ({
      owner,
      failedCount: cases.length,
      topFailureClasses: topFailureClasses(cases),
      cases,
      nextTask: nextTaskForOwner(owner, cases),
    }))
    .sort((a, b) => b.failedCount - a.failedCount || a.owner.localeCompare(b.owner));
}

function benchmarkFailures(report: LayeredBenchmarkReportWithGate): LayeredOperatorFailureCase[] {
  if (report.results.length > 0) {
    return report.results
      .filter((result) => !result.pass)
      .map((result) => failureFromCaseResult(result));
  }
  return report.topFailedCases.map((failure) => ({
    id: failure.id,
    vertical: failure.vertical,
    owner: failure.owner,
    failureClass: failure.failureClass,
    verdict: failure.verdict,
    patchProposal: failure.patchProposal,
    recommendedAction: recommendedActionForFailure(failure.owner, failure.failureClass, failure.verdict, failure.patchProposal),
  }));
}

function failureFromCaseResult(result: LayeredBenchmarkCaseResult): LayeredOperatorFailureCase {
  return {
    id: result.id,
    vertical: result.vertical,
    owner: result.owner,
    failureClass: result.failureClass,
    verdict: result.finalVerdict,
    patchProposal: result.patchProposal.proposed,
    recommendedAction: recommendedActionForFailure(
      result.owner,
      result.failureClass,
      result.finalVerdict,
      result.patchProposal.proposed,
    ),
  };
}

function summarizeBenchmarkGate(report: LayeredBenchmarkReportWithGate): LayeredOperatorGateSummary {
  const gate = report.gate ?? evaluateLayeredBenchmarkGate(report, {
    minArtifactCompletenessRate: 0.9,
    maxUnknownFailureRate: 0.1,
    maxRoutingMismatch: 0,
    minL1DirectPassRate: 0.2,
    minL1PlusL2RecoveredPassRate: 0.4,
  });
  return {
    provided: Boolean(report.gate),
    pass: gate.pass,
    failedChecks: gate.checks.filter((check) => !check.pass).map((check) => check.name),
    errors: gate.errors,
    summary: gate.pass
      ? "Layered benchmark gate passes current no-live thresholds."
      : `Layered benchmark gate fails: ${gate.errors.join("; ")}`,
  };
}

function dependencyWarningsFromIntake(intake: AgentIntakeQueueReport): string[] {
  return intake.results.flatMap((result) =>
    result.issues
      .filter((issue) =>
        issue.code === "unresolved_shared_schema_dependency" ||
        issue.code === "requires_rebase_before_merge" ||
        issue.code === "superseded_by_newer_branch",
      )
      .map((issue) => `${result.report.branch}: ${issue.message} (${issue.evidence.join(", ")})`),
  );
}

function conflictWarningsFromIntake(intake: AgentIntakeQueueReport, gate: LayeredOperatorGateSummary): string[] {
  const warnings = intake.results.flatMap((result) =>
    result.issues
      .filter((issue) =>
        issue.code === "docs_only_runtime_closure_claim" ||
        issue.code === "forbidden_artifact" ||
        issue.code === "wrong_base",
      )
      .map((issue) => `${result.report.branch}: ${issue.message} (${issue.evidence.join(", ")})`),
  );
  if (gate.pass === false) warnings.push(gate.summary);
  return warnings;
}

function chooseExactNextStep(params: {
  mergeQueue: LayeredOperatorMergeQueueItem[];
  independentWork: LayeredOperatorIndependentWorkItem[];
  ownerRecommendations: LayeredOperatorOwnerRecommendation[];
  dependencyWarnings: string[];
  benchmarkGate: LayeredOperatorGateSummary;
}): string {
  const firstReady = params.mergeQueue.find((item) => item.decision === "ready_to_merge" && item.mergeState !== "merged");
  if (firstReady) {
    return `Merge-validate ${firstReady.branch} first, then rerun the cockpit with that branch marked merged.`;
  }
  if (params.dependencyWarnings.length > 0) {
    return "Resolve shared-schema/rebase dependency warnings before launching dependent vertical work.";
  }
  const owner = params.ownerRecommendations[0];
  if (owner) return owner.nextTask;
  if (params.benchmarkGate.pass === false) return "Fix the failing benchmark gate checks before expanding the benchmark batch.";
  return "Start the next independent no-live benchmark fixture task from the accepted base.";
}

function runtimeClosureCredible(result: AgentIntakeResult): boolean {
  if (!result.report.claims?.runtimeClosure && !result.report.claims?.liveVerified) return false;
  return !result.issues.some((issue) => issue.code === "docs_only_runtime_closure_claim") && result.decision !== "reject";
}

function mergeSortScore(result: AgentIntakeResult): number {
  const decisionScore = result.decision === "ready_to_merge" ? 0 : result.decision === "needs_followup" ? 10 : 20;
  const dependencyPenalty = result.issues.some((issue) => issue.code === "unresolved_shared_schema_dependency") ? 5 : 0;
  const rebasePenalty = result.issues.some((issue) => issue.code === "requires_rebase_before_merge") ? 3 : 0;
  return decisionScore + dependencyPenalty + rebasePenalty;
}

function branchesFromMergedCommits(
  reports: AgentReturnReport[],
  mergedCommits: LayeredOperatorMergedCommit[],
): string[] {
  const merged = new Set<string>();
  for (const mergedCommit of mergedCommits) {
    if (mergedCommit.branch) merged.add(mergedCommit.branch);
    const matching = reports.find((report) => report.commit.startsWith(mergedCommit.commit) || mergedCommit.commit.startsWith(report.commit));
    if (matching) merged.add(matching.branch);
  }
  return Array.from(merged);
}

function topFailureClasses(cases: LayeredOperatorFailureCase[]): Array<{
  failureClass: LayeredBenchmarkFailureClass;
  count: number;
}> {
  const counts = new Map<LayeredBenchmarkFailureClass, number>();
  for (const testCase of cases) counts.set(testCase.failureClass, (counts.get(testCase.failureClass) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([failureClass, count]) => ({ failureClass, count }))
    .sort((a, b) => b.count - a.count || a.failureClass.localeCompare(b.failureClass));
}

function nextTaskForOwner(owner: LayeredBenchmarkOwner, cases: LayeredOperatorFailureCase[]): string {
  const top = topFailureClasses(cases)[0]?.failureClass ?? "none";
  switch (owner) {
    case "provider-runtime":
      return `Patch the smallest L1 provider-runtime path for repeated ${top}; add a fixture and rerun layered benchmark.`;
    case "browser-harness":
      return `Add or tune L2 Browser Harness recovery for ${top}; keep provider runtime untouched until recovery evidence repeats.`;
    case "task-workspace":
      return `Fix evidence/status artifact completeness for ${top}; prove logs/screenshots/status agree in no-live tests.`;
    case "nlu":
      return `Add routing/extractor regression for ${top}; do not run providers until the wrong-vertical path is fixed.`;
    case "planner":
      return `Fix planner/env classification for ${top}; separate model/env transient from provider failure.`;
    case "product/manual-boundary":
      return `Document/confirm manual boundary handling for ${top}; avoid runtime retries when user-only action is expected.`;
  }
}

function recommendedActionForFailure(
  owner: LayeredBenchmarkOwner,
  failureClass: LayeredBenchmarkFailureClass,
  verdict: LayeredBenchmarkVerdict,
  patchProposal: boolean,
): string {
  if (verdict === "insufficient_evidence") return "Complete artifact capture before rerun or merge.";
  if (owner === "provider-runtime" || patchProposal) return `Prepare focused runtime patch for ${failureClass}.`;
  if (owner === "browser-harness") return `Try L2 recovery fixture for ${failureClass}.`;
  if (owner === "task-workspace") return `Fix task evidence/status surface for ${failureClass}.`;
  if (owner === "nlu") return `Add no-live NLU fixture for ${failureClass}.`;
  if (owner === "planner") return `Add planner classification guard for ${failureClass}.`;
  return `Treat ${failureClass} as product/manual boundary unless new evidence says otherwise.`;
}

function parseLayeredBenchmarkJson(input: string): LayeredBenchmarkReportWithGate {
  const parsed = JSON.parse(input) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.summary) || !Array.isArray(parsed.results)) {
    throw new Error("Expected Layered Benchmark JSON report with summary and results.");
  }
  return parsed as LayeredBenchmarkReportWithGate;
}

function parseLayeredBenchmarkMarkdown(input: string): LayeredBenchmarkReportWithGate {
  const summary: ParsedBenchmarkSummary = {
    mode: "no-live",
    vertical: "all",
    total: numberFromLine(input, "Cases"),
    pass: numberFromLine(input, "Pass"),
    fail: numberFromLine(input, "Fail"),
    artifactCompletenessRate: percentFromLine(input, "Artifact completeness"),
    averageArtifactCompletenessScore: percentFromLine(input, "Average artifact score"),
    unknownFailureRate: percentFromLine(input, "Unknown failure rate"),
    routingMismatchCount: numberFromLine(input, "Routing mismatches"),
    l1DirectPassRate: percentFromLine(input, "L1 direct pass"),
    l1PlusL2RecoveredPassRate: percentFromLine(input, "L1 + L2 recovered pass"),
    byVertical: { restaurant: 0, hotel: 0, flight: 0, activity: 0 },
    byFailureClass: {
      none: 0,
      routing_mismatch: 0,
      selector_drift: 0,
      click_miss: 0,
      iframe_miss: 0,
      field_fill_miss: 0,
      progress_stall: 0,
      unknown_page_mutation: 0,
      true_no_availability: 0,
      provider_degraded: 0,
      account_checkpoint: 0,
      user_only_final_action: 0,
      insufficient_evidence: 0,
      network_model_env_issue: 0,
    },
    byOwner: {
      nlu: 0,
      planner: 0,
      "provider-runtime": 0,
      "browser-harness": 0,
      "task-workspace": 0,
      "product/manual-boundary": 0,
    },
    byVerdict: {
      l1_direct_pass: 0,
      l2_recovered_pass: 0,
      expected_provider_block: 0,
      expected_manual_boundary: 0,
      needs_runtime_patch: 0,
      routing_mismatch: 0,
      insufficient_evidence: 0,
      not_recovered: 0,
    },
  };

  return {
    summary,
    topFailedCases: topFailedCasesFromMarkdown(input),
    results: [],
    notes: ["Parsed from Layered Benchmark markdown; case detail is limited to top failed cases."],
  };
}

function topFailedCasesFromMarkdown(input: string): LayeredBenchmarkReport["topFailedCases"] {
  const topSection = input.split("## Top Failed Cases")[1]?.split("## ")[0] ?? "";
  return topSection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("| `"))
    .map((line) => line.split("|").map((part) => part.trim()))
    .map((cells) => ({
      id: stripTicks(cells[1]),
      vertical: stripTicks(cells[2]) as LayeredBenchmarkVertical,
      failureClass: stripTicks(cells[3]) as LayeredBenchmarkFailureClass,
      verdict: stripTicks(cells[4]) as LayeredBenchmarkVerdict,
      owner: stripTicks(cells[5]) as LayeredBenchmarkOwner,
      patchProposal: /yes|true/i.test(cells[6] ?? ""),
    }))
    .filter((row) => row.id && row.owner);
}

function numberFromLine(input: string, label: string): number {
  const match = input.match(new RegExp(`${escapeRegExp(label)}:\\s*([0-9.]+)`, "i"));
  return match ? Number(match[1]) : 0;
}

function percentFromLine(input: string, label: string): number {
  const match = input.match(new RegExp(`${escapeRegExp(label)}:\\s*([0-9.]+)%`, "i"));
  return match ? Number(match[1]) / 100 : 0;
}

function stripTicks(value: string | undefined): string {
  return (value ?? "").replace(/`/g, "").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
