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

export type Stage0ReadinessVerdict = "green" | "yellow" | "red";

export type Stage0OperatorReportOptions = {
  captureCount?: number;
  captureVertical?: CaptureBenchmarkVerticalArg;
  internalCount?: number;
  layeredCount?: number;
};

export type Stage0Owner = CaptureBenchmarkOwner | InternalBenchmarkOwner | LayeredBenchmarkOwner | "codex";

export type Stage0OwnerSummary = {
  owner: Stage0Owner;
  failureCount: number;
  signals: string[];
};

export type Stage0NextAction = {
  owner: Stage0Owner;
  action: string;
  reason: string;
  priority: "p0" | "p1" | "p2";
};

export type Stage0OperatorReport = {
  generatedAt: string;
  verdict: Stage0ReadinessVerdict;
  verdictReason: string;
  capture: CaptureBenchmarkReport;
  internalBenchmark: InternalBenchmarkReport;
  layeredBenchmark: LayeredBenchmarkReport;
  ownerSummary: Stage0OwnerSummary[];
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

  const ownerSummary = summarizeOwners(capture, internalBenchmark, layeredBenchmark);
  const topNextActions = nextActions(capture, internalBenchmark, layeredBenchmark, ownerSummary);
  const { verdict, verdictReason } = readinessVerdict(capture, internalBenchmark, layeredBenchmark);

  return {
    generatedAt: GENERATED_AT,
    verdict,
    verdictReason,
    capture,
    internalBenchmark,
    layeredBenchmark,
    ownerSummary,
    topNextActions,
    notes: [
      "Stage 0 operator report is no-live and reads deterministic benchmark fixtures only.",
      "yellow can still be the correct verdict when benchmark gates pass but private-alpha submissions have not been collected yet.",
      "green requires real private-alpha evidence, not docs, fixtures, or tooling alone.",
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
    "## Owner Summary",
    "",
    "| Owner | Failures | Signals |",
    "| --- | ---: | --- |",
  ];

  for (const owner of report.ownerSummary) {
    lines.push(`| \`${owner.owner}\` | ${owner.failureCount} | ${owner.signals.join("; ")} |`);
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
  return lines.join("\n");
}

function readinessVerdict(
  capture: CaptureBenchmarkReport,
  internalBenchmark: InternalBenchmarkReport,
  layeredBenchmark: LayeredBenchmarkReport,
): { verdict: Stage0ReadinessVerdict; verdictReason: string } {
  if (
    capture.summary.routingMismatchCount > 0 ||
    capture.summary.taskReadyAccuracy < 0.9 ||
    capture.summary.artifactCompletenessRate < 0.95 ||
    capture.summary.unknownFailureRate > 0.05 ||
    internalBenchmark.summary.routingMismatchCount > 0 ||
    layeredBenchmark.summary.routingMismatchCount > 0 ||
    layeredBenchmark.summary.unknownFailureRate > 0.05
  ) {
    return {
      verdict: "red",
      verdictReason: "Block private alpha until routing, task-readiness, artifact, or unknown-failure gates recover.",
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

function nextActions(
  capture: CaptureBenchmarkReport,
  internalBenchmark: InternalBenchmarkReport,
  layeredBenchmark: LayeredBenchmarkReport,
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

function formatRate(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}
