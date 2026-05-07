import { FLIGHT_LAYERED_BENCHMARK_CASES } from "./flight-layered-benchmark-fixtures";
import { buildHotelLayeredBenchmarkCases } from "./hotel-layered-benchmark-fixtures";

export type LayeredBenchmarkVertical = "restaurant" | "hotel" | "flight" | "activity";
export type LayeredBenchmarkVerticalArg = LayeredBenchmarkVertical | "all";
export type LayeredBenchmarkMode = "no-live";

export type LayeredBenchmarkOwner =
  | "nlu"
  | "planner"
  | "provider-runtime"
  | "browser-harness"
  | "task-workspace"
  | "product/manual-boundary";

export type LayeredBenchmarkFailureClass =
  | "none"
  | "routing_mismatch"
  | "selector_drift"
  | "click_miss"
  | "iframe_miss"
  | "field_fill_miss"
  | "progress_stall"
  | "unknown_page_mutation"
  | "true_no_availability"
  | "provider_degraded"
  | "account_checkpoint"
  | "user_only_final_action"
  | "insufficient_evidence"
  | "network_model_env_issue";

export type LayeredBenchmarkL1Status = "passed" | "blocked" | "manual_boundary" | "insufficient_evidence";
export type LayeredBenchmarkL2Status = "not_applicable" | "recovered" | "not_recovered" | "needs_patch";
export type LayeredBenchmarkVerdict =
  | "l1_direct_pass"
  | "l2_recovered_pass"
  | "expected_provider_block"
  | "expected_manual_boundary"
  | "needs_runtime_patch"
  | "routing_mismatch"
  | "insufficient_evidence"
  | "not_recovered";

export type LayeredBenchmarkTaskIntent = {
  rawUtterance: string;
  fields: Record<string, string | number | boolean | string[] | null>;
};

export type LayeredBenchmarkExpectedTarget = {
  providerStage: string;
  safeTerminalState: string;
  hardStop: string;
};

export type LayeredBenchmarkEvidenceCompleteness = {
  syntheticMarker: true;
  fixtureId: string;
  hasDbRow: boolean;
  hasDecisionLog: boolean;
  hasWorkerLog: boolean;
  hasScreenshot: boolean;
  hasCurrentUrl: boolean;
  hasBenchmarkReport: boolean;
  score: number;
};

export type LayeredBenchmarkL1Result = {
  status: LayeredBenchmarkL1Status;
  terminalState: string;
  summary: string;
};

export type LayeredBenchmarkL2SimulatedResult = {
  status: LayeredBenchmarkL2Status;
  summary: string;
  recoveredTerminalState?: string;
};

export type LayeredBenchmarkPatchProposal = {
  proposed: boolean;
  title?: string;
  files?: string[];
  risk: "none" | "low" | "medium";
  notes: string;
};

export type LayeredBenchmarkArtifactExpectations = {
  requiredSources: string[];
  evidenceContract: string;
  classificationSignals: string[];
  patchProposalFields: string[];
};

export type LayeredBenchmarkHotelFallbackParams = {
  hotel: string;
  city: string;
  checkin: string;
  checkout: string;
  adults: number;
  rooms: number;
  budget: string;
};

export type LayeredBenchmarkHotelContract = {
  noAvailabilityEvidence?: {
    state: "verified_true_no_availability" | "weak_no_availability" | "not_no_availability";
    missingEvidence: string[];
    reason: string;
  };
  providerFallback?: {
    eligible: boolean;
    nextProviders: string[];
    preservedParams: LayeredBenchmarkHotelFallbackParams;
    reason: string;
  };
  artifactContract?: {
    complete: boolean;
    missing: string[];
    summary: string;
  };
  staleRunningState?: {
    staleStatus: "running" | "pending";
    ownerAction: string;
  };
};

export type LayeredBenchmarkCase = {
  id: string;
  vertical: LayeredBenchmarkVertical;
  provider: string;
  taskIntent: LayeredBenchmarkTaskIntent;
  expectedTarget: LayeredBenchmarkExpectedTarget;
  l1Result: LayeredBenchmarkL1Result;
  failureClass: LayeredBenchmarkFailureClass;
  evidenceCompleteness: LayeredBenchmarkEvidenceCompleteness;
  artifactExpectations: LayeredBenchmarkArtifactExpectations;
  l2Eligible: boolean;
  l2SimulatedResult: LayeredBenchmarkL2SimulatedResult;
  patchProposal: LayeredBenchmarkPatchProposal;
  owner: LayeredBenchmarkOwner;
  dogfoodBugLink?: string;
  hotelContract?: LayeredBenchmarkHotelContract;
};

export type LayeredBenchmarkCaseResult = LayeredBenchmarkCase & {
  calculatedL2Eligible: boolean;
  finalVerdict: LayeredBenchmarkVerdict;
  pass: boolean;
  notes: string[];
};

export type LayeredBenchmarkSummary = {
  mode: LayeredBenchmarkMode;
  vertical: LayeredBenchmarkVerticalArg;
  total: number;
  pass: number;
  fail: number;
  artifactCompletenessRate: number;
  averageArtifactCompletenessScore: number;
  unknownFailureRate: number;
  routingMismatchCount: number;
  l1DirectPassRate: number;
  l1PlusL2RecoveredPassRate: number;
  byVertical: Record<LayeredBenchmarkVertical, number>;
  byFailureClass: Record<LayeredBenchmarkFailureClass, number>;
  byOwner: Record<LayeredBenchmarkOwner, number>;
  byVerdict: Record<LayeredBenchmarkVerdict, number>;
};

export type LayeredBenchmarkReport = {
  summary: LayeredBenchmarkSummary;
  topFailedCases: Array<{
    id: string;
    vertical: LayeredBenchmarkVertical;
    failureClass: LayeredBenchmarkFailureClass;
    verdict: LayeredBenchmarkVerdict;
    owner: LayeredBenchmarkOwner;
    patchProposal: boolean;
  }>;
  results: LayeredBenchmarkCaseResult[];
  notes: string[];
};

export type LayeredBenchmarkGateOptions = {
  minArtifactCompletenessRate?: number;
  maxUnknownFailureRate?: number;
  maxRoutingMismatch?: number;
  minL1DirectPassRate?: number;
  minL1PlusL2RecoveredPassRate?: number;
};

export type LayeredBenchmarkGateCheck = {
  name: string;
  pass: boolean;
  actual: number;
  expected: number;
};

export type LayeredBenchmarkGateResult = {
  pass: boolean;
  checks: LayeredBenchmarkGateCheck[];
  errors: string[];
};

const ESCALATE_TO_L2_FAILURES = new Set<LayeredBenchmarkFailureClass>([
  "selector_drift",
  "click_miss",
  "iframe_miss",
  "field_fill_miss",
  "progress_stall",
  "unknown_page_mutation",
]);

export const LAYERED_BENCHMARK_MODE_NOTES = [
  "no-live mode models post-run evidence contracts and simulated L2 recovery only.",
  "The runner never starts providers, Browser Harness, OpenAI calls, workers, payments, logins, or final checkout flows.",
  "L2 escalation is eligible only for page/control failures with complete evidence.",
] as const;

const ZERO_VERTICALS: Record<LayeredBenchmarkVertical, number> = {
  restaurant: 0,
  hotel: 0,
  flight: 0,
  activity: 0,
};

const ZERO_FAILURES: Record<LayeredBenchmarkFailureClass, number> = {
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
};

const ZERO_OWNERS: Record<LayeredBenchmarkOwner, number> = {
  nlu: 0,
  planner: 0,
  "provider-runtime": 0,
  "browser-harness": 0,
  "task-workspace": 0,
  "product/manual-boundary": 0,
};

const ZERO_VERDICTS: Record<LayeredBenchmarkVerdict, number> = {
  l1_direct_pass: 0,
  l2_recovered_pass: 0,
  expected_provider_block: 0,
  expected_manual_boundary: 0,
  needs_runtime_patch: 0,
  routing_mismatch: 0,
  insufficient_evidence: 0,
  not_recovered: 0,
};

export type LayeredBenchmarkVerticalConfig = {
  vertical: LayeredBenchmarkVertical;
  provider: string;
  dogfoodBugLink?: string;
  rawUtterance: string;
  fields: Record<string, string | number | boolean | string[] | null>;
  providerStage: string;
  safeTerminalState: string;
};

const VERTICAL_CONFIGS: LayeredBenchmarkVerticalConfig[] = [
  {
    vertical: "restaurant",
    provider: "OpenTable",
    dogfoodBugLink: "DOG-009",
    rawUtterance: "Book a 2-person Chinese dinner in New York tomorrow at 7pm",
    fields: {
      city: "New York",
      party_size: 2,
      cuisine: "Chinese",
      date: "tomorrow",
      time: "19:00",
    },
    providerStage: "OpenTable search and slot selection",
    safeTerminalState: "safe_handoff_before_reservation_confirmation",
  },
  {
    vertical: "hotel",
    provider: "Booking.com",
    dogfoodBugLink: "DOG-007",
    rawUtterance: "Book a New York hotel from May 20 to May 24 under 300 per night",
    fields: {
      city: "New York",
      check_in: "2026-05-20",
      check_out: "2026-05-24",
      budget_per_night_usd: 300,
      guests: 1,
    },
    providerStage: "Booking.com property search and room review",
    safeTerminalState: "safe_handoff_before_room_reservation_confirmation",
  },
  {
    vertical: "flight",
    provider: "Expedia",
    rawUtterance: "Book a flight from Nashville to New York on June 1",
    fields: {
      origin: "Nashville",
      destination: "New York",
      departure_date: "2026-06-01",
      passengers: 1,
      trip_type: "one-way",
    },
    providerStage: "Expedia flight search and fare review",
    safeTerminalState: "safe_handoff_before_ticket_purchase_confirmation",
  },
  {
    vertical: "activity",
    provider: "Ticketmaster",
    dogfoodBugLink: "DOG-005",
    rawUtterance: "Book The Lion King in New York on June 1",
    fields: {
      event_name: "The Lion King",
      city: "New York",
      event_date: "2026-06-01",
      tickets: 1,
    },
    providerStage: "Ticketing event search and seat review",
    safeTerminalState: "safe_handoff_before_ticket_checkout_confirmation",
  },
];

export const LAYERED_BENCHMARK_CASES: LayeredBenchmarkCase[] = buildLayeredBenchmarkCases();

export function isLayeredL2EscalationEligible(
  failureClass: LayeredBenchmarkFailureClass,
  evidenceCompleteness: Pick<LayeredBenchmarkEvidenceCompleteness, "score">,
): boolean {
  return ESCALATE_TO_L2_FAILURES.has(failureClass) && evidenceCompleteness.score >= 0.9;
}

export function selectLayeredBenchmarkCases(params: {
  vertical: LayeredBenchmarkVerticalArg;
  count: number;
}): LayeredBenchmarkCase[] {
  const requestedCount = Math.max(1, Math.floor(params.count));
  if (params.vertical !== "all") {
    return LAYERED_BENCHMARK_CASES.filter((testCase) => testCase.vertical === params.vertical).slice(
      0,
      requestedCount,
    );
  }

  const byVertical = new Map<LayeredBenchmarkVertical, LayeredBenchmarkCase[]>();
  for (const vertical of Object.keys(ZERO_VERTICALS) as LayeredBenchmarkVertical[]) {
    byVertical.set(
      vertical,
      LAYERED_BENCHMARK_CASES.filter((testCase) => testCase.vertical === vertical),
    );
  }

  const selected: LayeredBenchmarkCase[] = [];
  let index = 0;
  while (selected.length < requestedCount) {
    let added = false;
    for (const vertical of Object.keys(ZERO_VERTICALS) as LayeredBenchmarkVertical[]) {
      const next = byVertical.get(vertical)?.[index];
      if (next && selected.length < requestedCount) {
        selected.push(next);
        added = true;
      }
    }
    if (!added) break;
    index += 1;
  }
  return selected;
}

export function runLayeredNoLiveBenchmark(params: {
  vertical: LayeredBenchmarkVerticalArg;
  count: number;
  mode?: LayeredBenchmarkMode;
}): LayeredBenchmarkReport {
  const mode = params.mode ?? "no-live";
  if (mode !== "no-live") {
    throw new Error("Only --mode no-live is supported by the layered benchmark runner.");
  }

  const results = selectLayeredBenchmarkCases({
    vertical: params.vertical,
    count: params.count,
  }).map(evaluateLayeredBenchmarkCase);

  return {
    summary: summarizeLayeredBenchmark(params.vertical, mode, results),
    topFailedCases: topFailedCases(results),
    results,
    notes: [...LAYERED_BENCHMARK_MODE_NOTES],
  };
}

export function evaluateLayeredBenchmarkCase(testCase: LayeredBenchmarkCase): LayeredBenchmarkCaseResult {
  const calculatedL2Eligible = isLayeredL2EscalationEligible(
    testCase.failureClass,
    testCase.evidenceCompleteness,
  );
  const finalVerdict = classifyFinalVerdict(testCase, calculatedL2Eligible);
  const notes: string[] = [];
  if (calculatedL2Eligible !== testCase.l2Eligible) {
    notes.push(`fixture_l2_eligibility_mismatch expected=${testCase.l2Eligible}`);
  }
  if (testCase.evidenceCompleteness.score < 0.9) {
    notes.push("artifact_contract_incomplete");
  }
  if (testCase.patchProposal.proposed) {
    notes.push(`patch_proposal=${testCase.patchProposal.title ?? "unnamed"}`);
  }

  return {
    ...testCase,
    calculatedL2Eligible,
    finalVerdict,
    pass: isPassingVerdict(finalVerdict),
    notes,
  };
}

export function summarizeLayeredBenchmark(
  vertical: LayeredBenchmarkVerticalArg,
  mode: LayeredBenchmarkMode,
  results: LayeredBenchmarkCaseResult[],
): LayeredBenchmarkSummary {
  const byVertical = { ...ZERO_VERTICALS };
  const byFailureClass = { ...ZERO_FAILURES };
  const byOwner = { ...ZERO_OWNERS };
  const byVerdict = { ...ZERO_VERDICTS };

  let artifactComplete = 0;
  let artifactScoreTotal = 0;

  for (const result of results) {
    byVertical[result.vertical] += 1;
    byFailureClass[result.failureClass] += 1;
    byOwner[result.owner] += 1;
    byVerdict[result.finalVerdict] += 1;
    artifactScoreTotal += result.evidenceCompleteness.score;
    if (result.evidenceCompleteness.score >= 0.9) artifactComplete += 1;
  }

  const total = results.length;
  const pass = results.filter((result) => result.pass).length;
  const l1DirectPass = byVerdict.l1_direct_pass;
  const l1PlusL2RecoveredPass = byVerdict.l1_direct_pass + byVerdict.l2_recovered_pass;

  return {
    mode,
    vertical,
    total,
    pass,
    fail: total - pass,
    artifactCompletenessRate: total === 0 ? 0 : artifactComplete / total,
    averageArtifactCompletenessScore: total === 0 ? 0 : roundRate(artifactScoreTotal / total),
    unknownFailureRate: total === 0 ? 0 : byFailureClass.unknown_page_mutation / total,
    routingMismatchCount: byFailureClass.routing_mismatch,
    l1DirectPassRate: total === 0 ? 0 : l1DirectPass / total,
    l1PlusL2RecoveredPassRate: total === 0 ? 0 : l1PlusL2RecoveredPass / total,
    byVertical,
    byFailureClass,
    byOwner,
    byVerdict,
  };
}

export function evaluateLayeredBenchmarkGate(
  report: LayeredBenchmarkReport,
  options: LayeredBenchmarkGateOptions,
): LayeredBenchmarkGateResult {
  const checks: LayeredBenchmarkGateCheck[] = [];

  if (typeof options.minArtifactCompletenessRate === "number") {
    checks.push({
      name: "min_artifact_completeness",
      pass: report.summary.artifactCompletenessRate >= options.minArtifactCompletenessRate,
      actual: report.summary.artifactCompletenessRate,
      expected: options.minArtifactCompletenessRate,
    });
  }
  if (typeof options.maxUnknownFailureRate === "number") {
    checks.push({
      name: "max_unknown_failure_rate",
      pass: report.summary.unknownFailureRate <= options.maxUnknownFailureRate,
      actual: report.summary.unknownFailureRate,
      expected: options.maxUnknownFailureRate,
    });
  }
  if (typeof options.maxRoutingMismatch === "number") {
    checks.push({
      name: "max_routing_mismatch",
      pass: report.summary.routingMismatchCount <= options.maxRoutingMismatch,
      actual: report.summary.routingMismatchCount,
      expected: options.maxRoutingMismatch,
    });
  }
  if (typeof options.minL1DirectPassRate === "number") {
    checks.push({
      name: "min_l1_direct_pass",
      pass: report.summary.l1DirectPassRate >= options.minL1DirectPassRate,
      actual: report.summary.l1DirectPassRate,
      expected: options.minL1DirectPassRate,
    });
  }
  if (typeof options.minL1PlusL2RecoveredPassRate === "number") {
    checks.push({
      name: "min_l1_l2_recovered_pass",
      pass: report.summary.l1PlusL2RecoveredPassRate >= options.minL1PlusL2RecoveredPassRate,
      actual: report.summary.l1PlusL2RecoveredPassRate,
      expected: options.minL1PlusL2RecoveredPassRate,
    });
  }

  const errors = checks
    .filter((check) => !check.pass)
    .map(
      (check) =>
        `${check.name} expected ${formatRate(check.expected)} got ${formatRate(check.actual)}`,
    );
  return {
    pass: errors.length === 0,
    checks,
    errors,
  };
}

export function renderLayeredBenchmarkMarkdown(report: LayeredBenchmarkReport): string {
  const { summary } = report;
  const lines = [
    "# Layered Benchmark V2",
    "",
    ...report.notes,
    "",
    `Mode: ${summary.mode}`,
    `Vertical: ${summary.vertical}`,
    `Cases: ${summary.total}`,
    `Pass: ${summary.pass}`,
    `Fail: ${summary.fail}`,
    `Artifact completeness: ${pct(summary.artifactCompletenessRate)}`,
    `Average artifact score: ${pct(summary.averageArtifactCompletenessScore)}`,
    `Unknown failure rate: ${pct(summary.unknownFailureRate)}`,
    `Routing mismatches: ${summary.routingMismatchCount}`,
    `L1 direct pass: ${pct(summary.l1DirectPassRate)}`,
    `L1 + L2 recovered pass: ${pct(summary.l1PlusL2RecoveredPassRate)}`,
    "",
    "## By Vertical",
    "",
    "| Vertical | Cases |",
    "| --- | ---: |",
  ];

  for (const [vertical, count] of Object.entries(summary.byVertical)) {
    if (count > 0) lines.push(`| \`${vertical}\` | ${count} |`);
  }

  lines.push("", "## Final Verdicts", "", "| Verdict | Count |", "| --- | ---: |");
  for (const [verdict, count] of Object.entries(summary.byVerdict)) {
    if (count > 0) lines.push(`| \`${verdict}\` | ${count} |`);
  }

  lines.push("", "## Failure Classes", "", "| Failure Class | Count |", "| --- | ---: |");
  for (const [failureClass, count] of Object.entries(summary.byFailureClass)) {
    if (count > 0) lines.push(`| \`${failureClass}\` | ${count} |`);
  }

  lines.push("", "## Owners", "", "| Owner | Count |", "| --- | ---: |");
  for (const [owner, count] of Object.entries(summary.byOwner)) {
    if (count > 0) lines.push(`| \`${owner}\` | ${count} |`);
  }

  lines.push(
    "",
    "## Top Failed Cases",
    "",
    "| Case | Vertical | Failure | Verdict | Owner | Patch |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const failed of report.topFailedCases) {
    lines.push(
      `| \`${failed.id}\` | ${failed.vertical} | \`${failed.failureClass}\` | \`${failed.verdict}\` | ${failed.owner} | ${failed.patchProposal ? "yes" : "no"} |`,
    );
  }

  lines.push(
    "",
    "## Sample Case Trace",
    "",
    "| Case | Provider | L1 | L2 Eligible | L2 Result | Final Verdict |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const result of report.results.slice(0, 12)) {
    lines.push(
      `| \`${result.id}\` | ${result.provider} | \`${result.l1Result.status}\` | ${result.calculatedL2Eligible ? "yes" : "no"} | \`${result.l2SimulatedResult.status}\` | \`${result.finalVerdict}\` |`,
    );
  }

  return lines.join("\n");
}

function buildLayeredBenchmarkCases(): LayeredBenchmarkCase[] {
  return VERTICAL_CONFIGS.flatMap((config) =>
    config.vertical === "flight"
      ? [...FLIGHT_LAYERED_BENCHMARK_CASES, ...buildCasesForVertical(config, 11)]
      : config.vertical === "hotel"
        ? buildHotelLayeredBenchmarkCases(config)
      : buildCasesForVertical(config),
  );
}

function buildCasesForVertical(config: LayeredBenchmarkVerticalConfig, startIndex = 1): LayeredBenchmarkCase[] {
  return [
    directPassCase(config, startIndex),
    directPassCase(config, startIndex + 1),
    directPassCase(config, startIndex + 2),
    directPassCase(config, startIndex + 3),
    l2Case(config, "selector_drift", "recovered", startIndex + 4),
    l2Case(config, "click_miss", "recovered", startIndex + 5),
    l2Case(config, "iframe_miss", "needs_patch", startIndex + 6),
    l2Case(config, "field_fill_miss", "recovered", startIndex + 7),
    l2Case(config, "progress_stall", "not_recovered", startIndex + 8),
    l2Case(config, "unknown_page_mutation", "needs_patch", startIndex + 9),
    blockedCase(config, "true_no_availability", startIndex + 10),
    blockedCase(config, "provider_degraded", startIndex + 11),
    manualBoundaryCase(config, "account_checkpoint", startIndex + 12),
    manualBoundaryCase(config, "user_only_final_action", startIndex + 13),
    blockedCase(config, "network_model_env_issue", startIndex + 14),
    insufficientEvidenceCase(config, startIndex + 15),
    l2Case(config, "selector_drift", "needs_patch", startIndex + 16),
    routingMismatchCase(config, startIndex + 17),
  ];
}

function directPassCase(config: LayeredBenchmarkVerticalConfig, index: number): LayeredBenchmarkCase {
  return baseCase(config, index, {
    failureClass: "none",
    l1Result: {
      status: "passed",
      terminalState: config.safeTerminalState,
      summary: "L1 provider runtime reached the safe handoff boundary with complete evidence.",
    },
    evidenceCompleteness: completeEvidence(config, index),
    l2Eligible: false,
    l2SimulatedResult: {
      status: "not_applicable",
      summary: "L2 Browser Harness recovery is not needed after a direct L1 pass.",
    },
    patchProposal: noPatch("Direct pass does not require a patch proposal."),
    owner: "product/manual-boundary",
  });
}

function l2Case(
  config: LayeredBenchmarkVerticalConfig,
  failureClass: Extract<
    LayeredBenchmarkFailureClass,
    | "selector_drift"
    | "click_miss"
    | "iframe_miss"
    | "field_fill_miss"
    | "progress_stall"
    | "unknown_page_mutation"
  >,
  l2Status: Exclude<LayeredBenchmarkL2Status, "not_applicable">,
  index: number,
): LayeredBenchmarkCase {
  const recovered = l2Status === "recovered";
  return baseCase(config, index, {
    failureClass,
    l1Result: {
      status: "blocked",
      terminalState: failureClass,
      summary: `L1 stopped on page/control failure ${failureClass}.`,
    },
    evidenceCompleteness: completeEvidence(config, index),
    l2Eligible: true,
    l2SimulatedResult: {
      status: l2Status,
      summary: recovered
        ? "Simulated L2 Browser Harness recovery found the control and reached handoff."
        : "Simulated L2 Browser Harness could not fully recover without a code change.",
      recoveredTerminalState: recovered ? config.safeTerminalState : undefined,
    },
    patchProposal:
      l2Status === "needs_patch"
        ? {
            proposed: true,
            title: `${config.provider} ${failureClass} recovery guard`,
            files: ["provider runtime mirror pair, exact file TBD by vertical owner"],
            risk: "medium",
            notes: "Patch proposal only; benchmark does not edit or execute provider code.",
          }
        : noPatch("No patch proposed unless simulated L2 cannot recover."),
    owner: l2Status === "needs_patch" ? "provider-runtime" : "browser-harness",
  });
}

function blockedCase(
  config: LayeredBenchmarkVerticalConfig,
  failureClass: Extract<
    LayeredBenchmarkFailureClass,
    "true_no_availability" | "provider_degraded" | "network_model_env_issue"
  >,
  index: number,
): LayeredBenchmarkCase {
  const owner: LayeredBenchmarkOwner =
    failureClass === "network_model_env_issue" ? "planner" : "product/manual-boundary";
  return baseCase(config, index, {
    failureClass,
    l1Result: {
      status: "blocked",
      terminalState: failureClass,
      summary: `L1 produced evidence-backed non-control blocker ${failureClass}.`,
    },
    evidenceCompleteness: completeEvidence(config, index),
    l2Eligible: false,
    l2SimulatedResult: {
      status: "not_applicable",
      summary: "L2 is not eligible because this is not a page/control recovery class.",
    },
    patchProposal: noPatch("No Browser Harness escalation or runtime patch should be proposed for this class."),
    owner,
  });
}

function manualBoundaryCase(
  config: LayeredBenchmarkVerticalConfig,
  failureClass: Extract<LayeredBenchmarkFailureClass, "account_checkpoint" | "user_only_final_action">,
  index: number,
): LayeredBenchmarkCase {
  return baseCase(config, index, {
    failureClass,
    l1Result: {
      status: "manual_boundary",
      terminalState: failureClass,
      summary: `L1 reached a human-only boundary: ${failureClass}.`,
    },
    evidenceCompleteness: completeEvidence(config, index),
    l2Eligible: false,
    l2SimulatedResult: {
      status: "not_applicable",
      summary: "L2 must not bypass account, user-only, payment, or final-action boundaries.",
    },
    patchProposal: noPatch("Manual boundary is expected product behavior."),
    owner: "product/manual-boundary",
  });
}

function insufficientEvidenceCase(config: LayeredBenchmarkVerticalConfig, index: number): LayeredBenchmarkCase {
  return baseCase(config, index, {
    failureClass: "insufficient_evidence",
    l1Result: {
      status: "insufficient_evidence",
      terminalState: "missing_artifact_contract",
      summary: "L1 did not produce enough evidence to classify the terminal state.",
    },
    evidenceCompleteness: incompleteEvidence(config, index),
    l2Eligible: false,
    l2SimulatedResult: {
      status: "not_applicable",
      summary: "L2 is not eligible until the evidence bundle is complete enough to justify recovery.",
    },
    patchProposal: {
      proposed: true,
      title: `${config.provider} evidence capture completeness`,
      files: ["logs/screenshots/report capture path, exact file TBD by vertical owner"],
      risk: "low",
      notes: "Fix artifact capture before attempting recovery.",
    },
    owner: "task-workspace",
  });
}

function routingMismatchCase(config: LayeredBenchmarkVerticalConfig, index: number): LayeredBenchmarkCase {
  return baseCase(config, index, {
    failureClass: "routing_mismatch",
    l1Result: {
      status: "blocked",
      terminalState: "wrong_vertical_before_provider",
      summary: "The request would have entered the wrong vertical before L1 provider execution.",
    },
    evidenceCompleteness: completeEvidence(config, index),
    l2Eligible: false,
    l2SimulatedResult: {
      status: "not_applicable",
      summary: "L2 page recovery is irrelevant when routing selected the wrong vertical.",
    },
    patchProposal: {
      proposed: true,
      title: `${config.vertical} routing guard`,
      files: ["lib/agent/nlu-v2/routing-matrix.ts", "scripts/eval-live-extractor.ts"],
      risk: "low",
      notes: "Route/extractor regression coverage should be fixed before provider execution.",
    },
    owner: "nlu",
  });
}

function baseCase(
  config: LayeredBenchmarkVerticalConfig,
  index: number,
  overrides: Omit<
    LayeredBenchmarkCase,
    | "id"
    | "vertical"
    | "provider"
    | "taskIntent"
    | "expectedTarget"
    | "dogfoodBugLink"
    | "artifactExpectations"
  > & { artifactExpectations?: LayeredBenchmarkArtifactExpectations },
): LayeredBenchmarkCase {
  const caseId = `lbv2-${config.vertical}-${String(index).padStart(2, "0")}`;
  const { artifactExpectations, ...rest } = overrides;
  return {
    id: caseId,
    vertical: config.vertical,
    provider: config.provider,
    taskIntent: {
      rawUtterance: config.rawUtterance,
      fields: config.fields,
    },
    expectedTarget: {
      providerStage: config.providerStage,
      safeTerminalState: config.safeTerminalState,
      hardStop: "Stop before login, verification, payment/CVV, final confirmation, or any user-only action.",
    },
    dogfoodBugLink: config.dogfoodBugLink,
    artifactExpectations:
      artifactExpectations ??
      defaultArtifactExpectations(
        config,
        index,
        rest.failureClass,
        rest.patchProposal.proposed,
      ),
    ...rest,
  };
}

function defaultArtifactExpectations(
  config: LayeredBenchmarkVerticalConfig,
  index: number,
  failureClass: LayeredBenchmarkFailureClass,
  patchProposed: boolean,
): LayeredBenchmarkArtifactExpectations {
  const caseId = `lbv2-${config.vertical}-${String(index).padStart(2, "0")}`;
  return {
    requiredSources: [
      "booking_jobs row",
      "decisionLog",
      "worker log excerpt",
      "provider screenshot",
      "current URL",
      "benchmark report",
    ],
    evidenceContract: `${caseId} must contain enough evidence to classify ${failureClass}.`,
    classificationSignals: [
      `failureClass=${failureClass}`,
      `provider=${config.provider}`,
      `stage=${config.providerStage}`,
    ],
    patchProposalFields: patchProposed
      ? ["title", "files", "risk", "notes"]
      : ["proposed=false", "risk=none", "notes"],
  };
}

function completeEvidence(config: LayeredBenchmarkVerticalConfig, index: number): LayeredBenchmarkEvidenceCompleteness {
  return {
    syntheticMarker: true,
    fixtureId: `synthetic-${config.vertical}-${String(index).padStart(2, "0")}`,
    hasDbRow: true,
    hasDecisionLog: true,
    hasWorkerLog: true,
    hasScreenshot: true,
    hasCurrentUrl: true,
    hasBenchmarkReport: true,
    score: 1,
  };
}

function incompleteEvidence(config: LayeredBenchmarkVerticalConfig, index: number): LayeredBenchmarkEvidenceCompleteness {
  return {
    syntheticMarker: true,
    fixtureId: `synthetic-${config.vertical}-${String(index).padStart(2, "0")}`,
    hasDbRow: true,
    hasDecisionLog: false,
    hasWorkerLog: true,
    hasScreenshot: false,
    hasCurrentUrl: false,
    hasBenchmarkReport: true,
    score: 0.5,
  };
}

function noPatch(notes: string): LayeredBenchmarkPatchProposal {
  return {
    proposed: false,
    risk: "none",
    notes,
  };
}

function classifyFinalVerdict(
  testCase: LayeredBenchmarkCase,
  calculatedL2Eligible: boolean,
): LayeredBenchmarkVerdict {
  if (testCase.l1Result.status === "passed" && testCase.failureClass === "none") {
    return "l1_direct_pass";
  }
  if (testCase.failureClass === "routing_mismatch") {
    return "routing_mismatch";
  }
  if (testCase.failureClass === "insufficient_evidence" || testCase.evidenceCompleteness.score < 0.9) {
    return "insufficient_evidence";
  }
  if (testCase.failureClass === "true_no_availability" || testCase.failureClass === "provider_degraded") {
    return "expected_provider_block";
  }
  if (testCase.failureClass === "network_model_env_issue") {
    return "expected_provider_block";
  }
  if (testCase.failureClass === "account_checkpoint" || testCase.failureClass === "user_only_final_action") {
    return "expected_manual_boundary";
  }
  if (calculatedL2Eligible && testCase.l2SimulatedResult.status === "recovered") {
    return "l2_recovered_pass";
  }
  if (calculatedL2Eligible && testCase.l2SimulatedResult.status === "needs_patch") {
    return "needs_runtime_patch";
  }
  return "not_recovered";
}

function isPassingVerdict(verdict: LayeredBenchmarkVerdict): boolean {
  return (
    verdict === "l1_direct_pass" ||
    verdict === "l2_recovered_pass" ||
    verdict === "expected_provider_block" ||
    verdict === "expected_manual_boundary"
  );
}

function topFailedCases(results: LayeredBenchmarkCaseResult[]): LayeredBenchmarkReport["topFailedCases"] {
  return results
    .filter((result) => !result.pass)
    .slice(0, 12)
    .map((result) => ({
      id: result.id,
      vertical: result.vertical,
      failureClass: result.failureClass,
      verdict: result.finalVerdict,
      owner: result.owner,
      patchProposal: result.patchProposal.proposed,
    }));
}

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function pct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function formatRate(value: number): string {
  return Number.isInteger(value) ? String(value) : String(roundRate(value));
}
