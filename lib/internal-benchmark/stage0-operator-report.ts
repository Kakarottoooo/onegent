import {
  runCaptureBenchmark,
  type CaptureBenchmarkReport,
  type CaptureBenchmarkVerticalArg,
  type CaptureBenchmarkOwner,
} from "@/lib/capture/benchmark";
import {
  runInternalNoLiveBenchmark,
  type InternalBenchmarkReport,
  type InternalBenchmarkOwner,
} from "@/lib/internal-benchmark";
import {
  runLayeredNoLiveBenchmark,
  type LayeredBenchmarkReport,
  type LayeredBenchmarkOwner,
} from "@/lib/execution-layer/layered-benchmark";
import {
  buildPrivateAlphaIntakeReport,
  type PrivateAlphaIntakeReport,
  type PrivateAlphaSubmission,
} from "@/lib/capture/private-alpha";
import {
  classifyAgentIntakeQueue,
  type AgentIntakeQueueReport,
  type AgentReturnReport,
} from "@/lib/internal-benchmark/agent-intake";
import {
  buildStage0PerformanceReport,
  type Stage0PerformanceReport,
} from "@/lib/internal-benchmark/stage0-performance";
import privateAlphaFixture from "@/lib/capture/__fixtures__/private-alpha-submissions.json";
import agentIntakeFixture from "@/lib/internal-benchmark/__fixtures__/agent-intake/stage0-returned-branches.json";

export type Stage0ReadinessVerdict = "green" | "yellow" | "red";

export type Stage0OperatorReportOptions = {
  captureCount?: number;
  captureVertical?: CaptureBenchmarkVerticalArg;
  internalCount?: number;
  layeredCount?: number;
  privateAlphaSubmissions?: PrivateAlphaSubmission[];
  agentReports?: AgentReturnReport[];
};

export type Stage0Owner = CaptureBenchmarkOwner | InternalBenchmarkOwner | LayeredBenchmarkOwner | "codex";

export type Stage0OwnerSummary = {
  owner: Stage0Owner;
  failureCount: number;
  signals: string[];
};

export type Stage0OwnerBlocker = {
  owner: Stage0Owner;
  priority: "p0" | "p1" | "p2";
  blocker: string;
  evidence: string;
};

export type Stage0NextAction = {
  owner: Stage0Owner;
  action: string;
  reason: string;
  priority: "p0" | "p1" | "p2";
};

export type Stage0FailureClassSummary = {
  failureClass: string;
  count: number;
};

export type Stage0OperatorReport = {
  generatedAt: string;
  verdict: Stage0ReadinessVerdict;
  verdictReason: string;
  capture: CaptureBenchmarkReport;
  internalBenchmark: InternalBenchmarkReport;
  layeredBenchmark: LayeredBenchmarkReport;
  privateAlpha: PrivateAlphaIntakeReport;
  agentIntake: AgentIntakeQueueReport;
  performance: Stage0PerformanceReport;
  captureBenchmarkPassRate: number;
  routingMismatchCount: number;
  taskReadyAccuracy: number;
  artifactCompleteness: number;
  unknownFailureRate: number;
  topFailureClasses: Stage0FailureClassSummary[];
  dogfoodBugLinks: CaptureBenchmarkReport["dogfoodLinks"];
  blockedBranches: string[];
  whatChangedSinceLastReport: string;
  ownerSummary: Stage0OwnerSummary[];
  topBlockersByOwner: Stage0OwnerBlocker[];
  nextFiveActions: Stage0NextAction[];
  topNextActions: Stage0NextAction[];
  notes: string[];
};

const GENERATED_AT = "2026-05-07T12:00:00.000Z";

export function buildStage0OperatorReport(
  options: Stage0OperatorReportOptions = {},
): Stage0OperatorReport {
  const capture = runCaptureBenchmark({
    vertical: options.captureVertical ?? "all",
    count: options.captureCount,
  });
  const internalBenchmark = runInternalNoLiveBenchmark({
    vertical: "all",
    count: options.internalCount ?? 200,
    mode: "no-live",
  });
  const layeredBenchmark = runLayeredNoLiveBenchmark({
    vertical: "all",
    count: options.layeredCount ?? 50,
    mode: "no-live",
  });
  const privateAlpha = buildPrivateAlphaIntakeReport(
    options.privateAlphaSubmissions ?? defaultPrivateAlphaSubmissions(),
  );
  const agentIntake = classifyAgentIntakeQueue(options.agentReports ?? defaultAgentReports(), {
    requiredBaseBranch: "origin/codex/stage0-capture-mvp",
    requiredBaseCommit: "2a5088a",
    forbidProviderRuntimeChanges: true,
  });
  const performance = buildStage0PerformanceReport();

  const ownerSummary = summarizeOwners(capture, internalBenchmark, layeredBenchmark);
  const topNextActions = nextActions(capture, internalBenchmark, layeredBenchmark, privateAlpha, agentIntake, performance, ownerSummary);
  const topBlockersByOwner = blockersByOwner(capture, internalBenchmark, layeredBenchmark, privateAlpha, agentIntake, performance, ownerSummary);
  const { verdict, verdictReason } = readinessVerdict(capture, internalBenchmark, layeredBenchmark, privateAlpha);
  const routingMismatchCount =
    capture.summary.routingMismatchCount +
    internalBenchmark.summary.routingMismatchCount +
    layeredBenchmark.summary.routingMismatchCount;
  const unknownFailureRate = Math.max(
    capture.summary.unknownFailureRate,
    layeredBenchmark.summary.unknownFailureRate,
  );

  return {
    generatedAt: GENERATED_AT,
    verdict,
    verdictReason,
    capture,
    internalBenchmark,
    layeredBenchmark,
    privateAlpha,
    agentIntake,
    performance,
    captureBenchmarkPassRate: capture.summary.successRate,
    routingMismatchCount,
    taskReadyAccuracy: capture.summary.taskReadyAccuracy,
    artifactCompleteness: Math.min(
      capture.summary.artifactCompletenessRate,
      internalBenchmark.summary.artifactCompletenessRate,
      layeredBenchmark.summary.artifactCompletenessRate,
    ),
    unknownFailureRate,
    topFailureClasses: topFailureClasses(capture, internalBenchmark, layeredBenchmark),
    dogfoodBugLinks: capture.dogfoodLinks,
    blockedBranches: agentIntake.results
      .filter((result) => result.decision !== "ready_to_merge")
      .map((result) => result.report.branch),
    whatChangedSinceLastReport: "deferred: no previous Stage 0 daily report snapshot was supplied.",
    ownerSummary,
    topBlockersByOwner,
    nextFiveActions: topNextActions.slice(0, 5),
    topNextActions,
    notes: [
      "Stage 0 operator report is no-live and reads deterministic benchmark fixtures only.",
      "yellow can still be the correct verdict when benchmark gates pass but private-alpha submissions have not been collected yet.",
      "green requires real private-alpha evidence, not docs, fixtures, or tooling alone.",
      "Private alpha synthetic samples are useful for gate smoke tests but cannot make the Stage 0 verdict green.",
      "The report never starts providers, workers, browser agents, OpenAI calls, payments, logins, verification, or final confirmations.",
    ],
  };
}

export function renderStage0OperatorMarkdown(report: Stage0OperatorReport): string {
  const lines = [
    "# Stage 0 Operator Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Verdict: ${report.verdict}`,
    `Reason: ${report.verdictReason}`,
    "",
    "## Capture Benchmark",
    "",
    `Fixtures: ${report.capture.summary.total}`,
    `Routing mismatch: ${report.capture.summary.routingMismatchCount}`,
    `Task-ready accuracy: ${formatRate(report.capture.summary.taskReadyAccuracy)}`,
    `Artifact completeness: ${formatRate(report.capture.summary.artifactCompletenessRate)}`,
    `Unknown failure: ${formatRate(report.capture.summary.unknownFailureRate)}`,
    `Artifact gap closures: ${report.capture.artifactGapClosures.filter((closure) => closure.outcome === "closed").length}/${report.capture.artifactGapClosures.length}`,
    `Dogfood links: ${report.dogfoodBugLinks.map((link) => link.dogfoodId).join(", ") || "-"}`,
    "",
    "## Internal Benchmark",
    "",
    `Cases: ${report.internalBenchmark.summary.total}`,
    `Success rate: ${formatRate(report.internalBenchmark.summary.successRate)}`,
    `Artifact completeness: ${formatRate(report.internalBenchmark.summary.artifactCompletenessRate)}`,
    `Routing mismatch: ${report.internalBenchmark.summary.routingMismatchCount}`,
    "",
    "## Layered Benchmark",
    "",
    `Cases: ${report.layeredBenchmark.summary.total}`,
    `Artifact completeness: ${formatRate(report.layeredBenchmark.summary.artifactCompletenessRate)}`,
    `Unknown failure: ${formatRate(report.layeredBenchmark.summary.unknownFailureRate)}`,
    `L1 direct pass: ${formatRate(report.layeredBenchmark.summary.l1DirectPassRate)}`,
    `L1 + L2 recovered pass: ${formatRate(report.layeredBenchmark.summary.l1PlusL2RecoveredPassRate)}`,
    "",
    "## Private Alpha Intake",
    "",
    `Readiness: ${report.privateAlpha.summary.readiness}`,
    `Gate: ${report.privateAlpha.summary.gatePass ? "PASS" : "FAIL"}`,
    `Fixture seeds: ${report.privateAlpha.summary.fixtureSeedCount}`,
    `Sensitive submissions: ${report.privateAlpha.summary.sensitiveCount}`,
    "",
    "## Agent Intake",
    "",
    `Ready to merge: ${report.agentIntake.summary.readyToMerge}`,
    `Needs follow-up: ${report.agentIntake.summary.needsFollowup}`,
    `Reject: ${report.agentIntake.summary.reject}`,
    `Blocked branches: ${report.blockedBranches.join(", ") || "-"}`,
    "",
    "## Performance Measurement",
    "",
    `Mode: ${report.performance.mode}`,
    `Endpoints: ${report.performance.totalEndpoints}`,
    `High risk: ${report.performance.highRiskEndpoints}`,
    `Medium risk: ${report.performance.mediumRiskEndpoints}`,
    `Findings: ${report.performance.probes.reduce((sum, probe) => sum + probe.findings.length, 0)}`,
    "",
    "| Endpoint | Owner | Risk | Findings | Suggested next patch |",
    "| --- | --- | --- | ---: | --- |",
  ];

  for (const probe of report.performance.probes) {
    lines.push(
      `| \`${probe.endpoint}\` | \`${probe.owner}\` | \`${probe.riskLevel}\` | ${probe.findings.length} | ${probe.suggestedNextPatch} |`,
    );
  }

  lines.push(
    "",
    "## Top Failure Classes",
    "",
    "| Failure class | Count |",
    "| --- | ---: |",
  );

  for (const failure of report.topFailureClasses) {
    lines.push(`| \`${failure.failureClass}\` | ${failure.count} |`);
  }

  lines.push(
    "",
    "## Owner Summary",
    "",
    "| Owner | Failures | Signals |",
    "| --- | ---: | --- |",
  );

  for (const owner of report.ownerSummary) {
    lines.push(`| \`${owner.owner}\` | ${owner.failureCount} | ${owner.signals.join("; ")} |`);
  }

  lines.push(
    "",
    "## Top Blockers By Owner",
    "",
    "| Priority | Owner | Blocker | Evidence |",
    "| --- | --- | --- | --- |",
  );
  for (const blocker of report.topBlockersByOwner) {
    lines.push(`| \`${blocker.priority}\` | \`${blocker.owner}\` | ${blocker.blocker} | ${blocker.evidence} |`);
  }

  lines.push(
    "",
    "## Next 5 Actions",
    "",
    "| Priority | Owner | Action | Reason |",
    "| --- | --- | --- | --- |",
  );
  for (const action of report.nextFiveActions) {
    lines.push(`| \`${action.priority}\` | \`${action.owner}\` | ${action.action} | ${action.reason} |`);
  }

  lines.push(
    "",
    "## Top 10 Next Engineering Actions",
    "",
    "| Priority | Owner | Action | Reason |",
    "| --- | --- | --- | --- |",
  );
  for (const action of report.topNextActions) {
    lines.push(`| \`${action.priority}\` | \`${action.owner}\` | ${action.action} | ${action.reason} |`);
  }

  lines.push("", "## Notes", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push(`- ${report.whatChangedSinceLastReport}`);
  return lines.join("\n");
}

function readinessVerdict(
  capture: CaptureBenchmarkReport,
  internalBenchmark: InternalBenchmarkReport,
  layeredBenchmark: LayeredBenchmarkReport,
  privateAlpha: PrivateAlphaIntakeReport,
): { verdict: Stage0ReadinessVerdict; verdictReason: string } {
  if (
    capture.summary.routingMismatchCount > 0 ||
    capture.summary.taskReadyAccuracy < 0.9 ||
    capture.summary.artifactCompletenessRate < 0.95 ||
    capture.summary.unknownFailureRate > 0.05 ||
    internalBenchmark.summary.routingMismatchCount > 0 ||
    layeredBenchmark.summary.routingMismatchCount > 0 ||
    layeredBenchmark.summary.unknownFailureRate > 0.05 ||
    !privateAlpha.summary.gatePass ||
    privateAlpha.summary.red > 0
  ) {
    return {
      verdict: "red",
      verdictReason: "Block private alpha until routing, task-readiness, artifact, or unknown-failure gates recover.",
    };
  }

  if (privateAlpha.summary.readiness === "green") {
    return {
      verdict: "green",
      verdictReason:
        "Private alpha can proceed: capture gates pass and real submissions are green with fixture seeds and safe next actions.",
    };
  }

  return {
    verdict: "yellow",
    verdictReason:
      "Dogfood-only: no-live benchmark gates pass, but private alpha cannot be called green until real submissions and user value scores are collected.",
  };
}

function summarizeOwners(
  capture: CaptureBenchmarkReport,
  internalBenchmark: InternalBenchmarkReport,
  layeredBenchmark: LayeredBenchmarkReport,
): Stage0OwnerSummary[] {
  const byOwner = new Map<Stage0Owner, Stage0OwnerSummary>();
  const add = (owner: Stage0Owner, signal: string, failures: number) => {
    if (failures <= 0) return;
    const current = byOwner.get(owner) ?? { owner, failureCount: 0, signals: [] };
    current.failureCount += failures;
    current.signals.push(signal);
    byOwner.set(owner, current);
  };

  for (const [owner, count] of Object.entries(capture.summary.byOwner)) {
    const failed = capture.results.filter((result) => result.owner === owner && !result.pass).length;
    add(owner as Stage0Owner, `capture failures ${failed}/${count}`, failed);
  }
  for (const [owner, count] of Object.entries(internalBenchmark.summary.bySuggestedOwner)) {
    const failed = internalBenchmark.results.filter((result) => result.suggestedOwner === owner && !result.pass).length;
    add(owner as Stage0Owner, `internal benchmark failures ${failed}/${count}`, failed);
  }
  for (const [owner, count] of Object.entries(layeredBenchmark.summary.byOwner)) {
    const failed = layeredBenchmark.results.filter((result) => result.owner === owner && !result.pass).length;
    add(owner as Stage0Owner, `layered benchmark failures ${failed}/${count}`, failed);
  }

  return Array.from(byOwner.values()).sort((a, b) => b.failureCount - a.failureCount);
}

function blockersByOwner(
  capture: CaptureBenchmarkReport,
  internalBenchmark: InternalBenchmarkReport,
  layeredBenchmark: LayeredBenchmarkReport,
  privateAlpha: PrivateAlphaIntakeReport,
  agentIntake: AgentIntakeQueueReport,
  performance: Stage0PerformanceReport,
  ownerSummary: Stage0OwnerSummary[],
): Stage0OwnerBlocker[] {
  const blockers: Stage0OwnerBlocker[] = [];
  if (privateAlpha.summary.readiness !== "green") {
    blockers.push({
      owner: "alpha-ops",
      priority: "p0",
      blocker: "Private alpha is not green from real supervised submissions.",
      evidence: `${privateAlpha.summary.total} intake sample(s), readiness ${privateAlpha.summary.readiness}, ${privateAlpha.summary.safeMissSeedCount} safe-miss seed(s).`,
    });
  }
  if (capture.summary.routingMismatchCount > 0 || capture.summary.byFailureClass.artifact_incomplete > 0) {
    blockers.push({
      owner: "task-workspace",
      priority: "p1",
      blocker: "Capture artifact or routing contracts still need closure.",
      evidence: `${capture.summary.byFailureClass.artifact_incomplete} artifact gaps, ${capture.summary.routingMismatchCount} routing mismatches.`,
    });
  }
  if (layeredBenchmark.summary.unknownFailureRate > 0 || internalBenchmark.summary.byFailureClass.provider_simulated_block > 0) {
    blockers.push({
      owner: "provider-runtime",
      priority: "p1",
      blocker: "Provider-runtime no-live failures need fixture-backed patches before more live attempts.",
      evidence: `${formatRate(layeredBenchmark.summary.unknownFailureRate)} layered unknown failures, ${internalBenchmark.summary.byFailureClass.provider_simulated_block} simulated provider blockers.`,
    });
  }
  if (performance.highRiskEndpoints > 0 || performance.mediumRiskEndpoints > 0) {
    blockers.push({
      owner: "codex",
      priority: performance.highRiskEndpoints > 0 ? "p1" : "p2",
      blocker: "App-shell performance risks must stay out of route-level payloads.",
      evidence: `${performance.highRiskEndpoints} high-risk and ${performance.mediumRiskEndpoints} medium-risk endpoint(s).`,
    });
  }
  if (agentIntake.summary.reject > 0 || agentIntake.summary.needsFollowup > 0 || agentIntake.summary.requiresRebase > 0) {
    blockers.push({
      owner: "codex",
      priority: "p1",
      blocker: "Returned agent branches need metadata triage before merge validation.",
      evidence: `${agentIntake.summary.readyToMerge} ready, ${agentIntake.summary.needsFollowup} follow-up, ${agentIntake.summary.requiresRebase} rebase, ${agentIntake.summary.reject} reject.`,
    });
  }
  for (const owner of ownerSummary.slice(0, 5)) {
    if (blockers.some((blocker) => blocker.owner === owner.owner)) continue;
    blockers.push({
      owner: owner.owner,
      priority: "p2",
      blocker: "Benchmark failures remain for this owner.",
      evidence: `${owner.failureCount} failure(s): ${owner.signals[0] ?? "see benchmark report"}.`,
    });
  }
  return blockers.slice(0, 8);
}

function nextActions(
  capture: CaptureBenchmarkReport,
  internalBenchmark: InternalBenchmarkReport,
  layeredBenchmark: LayeredBenchmarkReport,
  privateAlpha: PrivateAlphaIntakeReport,
  agentIntake: AgentIntakeQueueReport,
  performance: Stage0PerformanceReport,
  ownerSummary: Stage0OwnerSummary[],
): Stage0NextAction[] {
  const actions: Stage0NextAction[] = [];
  if (capture.summary.routingMismatchCount > 0) {
    actions.push({
      owner: "nlu",
      priority: "p0",
      action: "Fix capture routing mismatches before accepting more alpha inputs.",
      reason: `${capture.summary.routingMismatchCount} capture fixture(s) routed to the wrong vertical.`,
    });
  }
  if (capture.summary.byFailureClass.artifact_incomplete > 0) {
    actions.push({
      owner: "task-workspace",
      priority: "p1",
      action: "Close Capture artifact-contract gaps for source, entity, and readiness evidence.",
      reason: `${capture.summary.byFailureClass.artifact_incomplete} fixture(s) intentionally expose incomplete artifact contracts.`,
    });
  }
  if (internalBenchmark.summary.byFailureClass.provider_simulated_block > 0) {
    actions.push({
      owner: "provider-runtime",
      priority: "p1",
      action: "Use layered benchmark failures to pick the next fixture-backed provider hardening branch.",
      reason: `${internalBenchmark.summary.byFailureClass.provider_simulated_block} simulated provider blockers remain in the no-live corpus.`,
    });
  }
  if (layeredBenchmark.summary.l1PlusL2RecoveredPassRate < 0.5) {
    actions.push({
      owner: "provider-runtime",
      priority: "p1",
      action: "Prioritize L1 runtime patches over claiming L2 recovery readiness.",
      reason: `Layered L1+L2 recovered pass rate is ${formatRate(layeredBenchmark.summary.l1PlusL2RecoveredPassRate)}.`,
    });
  }
  if (privateAlpha.summary.readiness !== "green") {
    actions.push({
      owner: "alpha-ops",
      priority: "p0",
      action: "Collect supervised private-alpha submissions and score them through the intake gate.",
      reason: `Private alpha readiness is ${privateAlpha.summary.readiness}; synthetic fixtures cannot make it green.`,
    });
  }
  if (agentIntake.summary.reject > 0 || agentIntake.summary.needsFollowup > 0) {
    actions.push({
      owner: "codex",
      priority: "p1",
      action: "Use agent intake results to block unsafe branches and ask follow-up only where metadata is incomplete.",
      reason: `${agentIntake.summary.needsFollowup} branch(es) need follow-up and ${agentIntake.summary.reject} are rejected.`,
    });
  }
  if (performance.highRiskEndpoints > 0) {
    actions.push({
      owner: "codex",
      priority: "p1",
      action: "Review Stage 0 performance heavy-field risks before adding new app-shell payloads.",
      reason: `${performance.highRiskEndpoints} endpoint(s) are high-risk in the static compact-contract scan.`,
    });
  }
  actions.push({
    owner: "alpha-ops",
    priority: "p1",
    action: "Start private-alpha intake only as supervised dogfood and convert failures into capture fixtures.",
    reason: "No-live gates can support intake, but green alpha readiness requires real submissions and value scoring.",
  });
  actions.push({
    owner: "codex",
    priority: "p2",
    action: "Keep agent branches flowing through Stage 0 intake before merge validation.",
    reason: "Returned branches should be triaged by metadata so independent agents can start the next bounded task.",
  });

  for (const owner of ownerSummary.slice(0, 6)) {
    if (actions.length >= 10) break;
    if (actions.some((action) => action.owner === owner.owner)) continue;
    actions.push({
      owner: owner.owner,
      priority: "p2",
      action: `Review the highest-volume ${owner.owner} failure class in the benchmark report.`,
      reason: owner.signals[0] ?? "Owner has benchmark failures.",
    });
  }
  return actions.slice(0, 10);
}

function topFailureClasses(
  capture: CaptureBenchmarkReport,
  internalBenchmark: InternalBenchmarkReport,
  layeredBenchmark: LayeredBenchmarkReport,
): Stage0FailureClassSummary[] {
  const counts = new Map<string, number>();
  const add = (failureClass: string, count: number) => {
    if (failureClass === "none" || count <= 0) return;
    counts.set(failureClass, (counts.get(failureClass) ?? 0) + count);
  };
  for (const [failureClass, count] of Object.entries(capture.summary.byFailureClass)) {
    if (failureClass !== "none") add(`capture:${failureClass}`, count);
  }
  for (const [failureClass, count] of Object.entries(internalBenchmark.summary.byFailureClass)) {
    if (failureClass !== "none") add(`internal:${failureClass}`, count);
  }
  for (const [failureClass, count] of Object.entries(layeredBenchmark.summary.byFailureClass)) {
    if (failureClass !== "none") add(`layered:${failureClass}`, count);
  }
  return Array.from(counts.entries())
    .map(([failureClass, count]) => ({ failureClass, count }))
    .sort((a, b) => b.count - a.count || a.failureClass.localeCompare(b.failureClass))
    .slice(0, 10);
}

function defaultPrivateAlphaSubmissions(): PrivateAlphaSubmission[] {
  return (privateAlphaFixture as { submissions: PrivateAlphaSubmission[] }).submissions;
}

function defaultAgentReports(): AgentReturnReport[] {
  return (agentIntakeFixture as { reports: AgentReturnReport[] }).reports;
}

function formatRate(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}
