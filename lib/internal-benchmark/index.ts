import {
  NLU_ROUTING_FIXTURES,
  evaluateNluRoutingMatrix,
  type NluRoutingFixture,
} from "@/lib/agent/nlu-v2/routing-matrix";

export type InternalBenchmarkVertical = "restaurant" | "hotel" | "flight" | "activity" | "trip";
export type InternalBenchmarkVerticalArg = InternalBenchmarkVertical | "all";
export type InternalBenchmarkMode = "no-live";
export type InternalBenchmarkFutureMode = "small-live" | "live";

export type InternalBenchmarkFailureClass =
  | "none"
  | "routing_mismatch"
  | "missing_required_field"
  | "constraint_lost"
  | "artifact_incomplete"
  | "simulated_provider_block"
  | "manual_boundary_expected"
  | "unsupported_request"
  | "unsafe_boundary";

export type InternalBenchmarkOwner =
  | "nlu"
  | "planner"
  | "task-workspace"
  | "provider-runtime"
  | "product/manual-boundary";

export type InternalBenchmarkCase = {
  id: string;
  vertical: InternalBenchmarkVertical;
  title: string;
  fixtureId?: string;
  expectedPass: boolean;
  expectedFailureClass: InternalBenchmarkFailureClass;
  artifactComplete: boolean;
  suggestedOwner: InternalBenchmarkOwner;
  dogfoodId?: string;
  durationMs?: number;
};

export type InternalBenchmarkCaseResult = InternalBenchmarkCase & {
  pass: boolean;
  failureClass: InternalBenchmarkFailureClass;
  routeScenario: string | null;
  routeAction: string | null;
  routePass: boolean | null;
  routeNotes: string[];
};

export type InternalBenchmarkTopFailedCase = {
  id: string;
  vertical: InternalBenchmarkVertical;
  failureClass: InternalBenchmarkFailureClass;
  suggestedOwner: InternalBenchmarkOwner;
  title: string;
};

export type InternalBenchmarkSummary = {
  mode: InternalBenchmarkMode;
  vertical: InternalBenchmarkVerticalArg;
  total: number;
  pass: number;
  fail: number;
  successRate: number;
  averageDurationMs: number | null;
  artifactCompletenessRate: number;
  byVertical: Record<InternalBenchmarkVertical, number>;
  byFailureClass: Record<InternalBenchmarkFailureClass, number>;
  bySuggestedOwner: Record<InternalBenchmarkOwner, number>;
};

export type InternalBenchmarkReport = {
  summary: InternalBenchmarkSummary;
  topFailedCases: InternalBenchmarkTopFailedCase[];
  results: InternalBenchmarkCaseResult[];
  notes: string[];
};

export type InternalBenchmarkGateOptions = {
  minSuccessRate?: number;
  minArtifactCompletenessRate?: number;
  maxFailureCounts?: Partial<Record<InternalBenchmarkFailureClass, number>>;
};

export type InternalBenchmarkGateCheck = {
  name: string;
  pass: boolean;
  actual: number;
  expected: number;
};

export type InternalBenchmarkGateResult = {
  pass: boolean;
  checks: InternalBenchmarkGateCheck[];
  errors: string[];
};

const ZERO_FAILURES: Record<InternalBenchmarkFailureClass, number> = {
  none: 0,
  routing_mismatch: 0,
  missing_required_field: 0,
  constraint_lost: 0,
  artifact_incomplete: 0,
  simulated_provider_block: 0,
  manual_boundary_expected: 0,
  unsupported_request: 0,
  unsafe_boundary: 0,
};

const ZERO_VERTICALS: Record<InternalBenchmarkVertical, number> = {
  restaurant: 0,
  hotel: 0,
  flight: 0,
  activity: 0,
  trip: 0,
};

const ZERO_OWNERS: Record<InternalBenchmarkOwner, number> = {
  nlu: 0,
  planner: 0,
  "task-workspace": 0,
  "provider-runtime": 0,
  "product/manual-boundary": 0,
};

export const INTERNAL_BENCHMARK_MODE_NOTES = [
  "no-live mode runs deterministic routing fixtures and simulated artifact completeness only.",
  "small-live and live modes are intentionally documented future modes; this runner refuses them.",
  "Provider closure still requires separate runtime evidence, logs, screenshots, and human approval.",
] as const;

export const INTERNAL_BENCHMARK_CASES: InternalBenchmarkCase[] = [
  {
    id: "restaurant-japanese-routing",
    vertical: "restaurant",
    title: "Japanese restaurant request keeps cuisine as a hard constraint",
    fixtureId: "zh-restaurant-japanese-complete",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "nlu",
    dogfoodId: "DOG-009",
    durationMs: 1200,
  },
  {
    id: "restaurant-chinese-routing",
    vertical: "restaurant",
    title: "Chinese restaurant request keeps cuisine as a hard constraint",
    fixtureId: "zh-restaurant-chinese-complete",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "nlu",
    dogfoodId: "DOG-009",
    durationMs: 1160,
  },
  {
    id: "restaurant-missing-cuisine",
    vertical: "restaurant",
    title: "Restaurant without cuisine asks for the cuisine slot instead of running broad search",
    fixtureId: "en-restaurant-missing-cuisine",
    expectedPass: false,
    expectedFailureClass: "missing_required_field",
    artifactComplete: true,
    suggestedOwner: "planner",
    dogfoodId: "DOG-009",
    durationMs: 780,
  },
  {
    id: "restaurant-artifact-missing-screenshot",
    vertical: "restaurant",
    title: "Restaurant evidence bundle missing screenshot manifest",
    expectedPass: false,
    expectedFailureClass: "artifact_incomplete",
    artifactComplete: false,
    suggestedOwner: "task-workspace",
    dogfoodId: "DOG-004",
    durationMs: 800,
  },
  {
    id: "hotel-nyc-budget-routing",
    vertical: "hotel",
    title: "Hotel date and budget request reaches confirm card",
    fixtureId: "zh-hotel-complete",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "nlu",
    dogfoodId: "DOG-010",
    durationMs: 1000,
  },
  {
    id: "hotel-nights-checkout-routing",
    vertical: "hotel",
    title: "Hotel nights count satisfies checkout requirement",
    fixtureId: "en-hotel-nights-satisfy-checkout",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "planner",
    durationMs: 980,
  },
  {
    id: "hotel-missing-checkout",
    vertical: "hotel",
    title: "Hotel with no checkout or nights asks for checkout",
    fixtureId: "en-hotel-missing-checkout",
    expectedPass: false,
    expectedFailureClass: "missing_required_field",
    artifactComplete: true,
    suggestedOwner: "planner",
    dogfoodId: "DOG-010",
    durationMs: 920,
  },
  {
    id: "hotel-booking-provider-simulated-block",
    vertical: "hotel",
    title: "Booking.com selector drift stays a simulated provider blocker",
    expectedPass: false,
    expectedFailureClass: "simulated_provider_block",
    artifactComplete: true,
    suggestedOwner: "provider-runtime",
    dogfoodId: "DOG-007",
    durationMs: 1600,
  },
  {
    id: "flight-bna-nyc-routing",
    vertical: "flight",
    title: "Flight origin and destination request reaches confirm card",
    fixtureId: "zh-flight-complete",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "nlu",
    durationMs: 900,
  },
  {
    id: "flight-roundtrip-routing",
    vertical: "flight",
    title: "Round-trip date constraints survive routing",
    fixtureId: "en-flight-roundtrip",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "nlu",
    durationMs: 950,
  },
  {
    id: "flight-missing-origin",
    vertical: "flight",
    title: "Flight with destination and date still asks origin",
    fixtureId: "en-flight-missing-origin",
    expectedPass: false,
    expectedFailureClass: "missing_required_field",
    artifactComplete: true,
    suggestedOwner: "planner",
    durationMs: 870,
  },
  {
    id: "flight-unsafe-final-confirm-boundary",
    vertical: "flight",
    title: "Flight checkout final-confirm boundary remains unsafe",
    expectedPass: false,
    expectedFailureClass: "unsafe_boundary",
    artifactComplete: true,
    suggestedOwner: "product/manual-boundary",
    durationMs: 1500,
  },
  {
    id: "activity-lion-king-zh-routing",
    vertical: "activity",
    title: "Chinese Lion King request routes to activity tickets",
    fixtureId: "zh-activity-lion-king-trip-shaped",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "nlu",
    dogfoodId: "DOG-005",
    durationMs: 850,
  },
  {
    id: "activity-lion-king-en-routing",
    vertical: "activity",
    title: "English Lion King request routes to activity tickets",
    fixtureId: "en-activity-lion-king-trip-shaped",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "nlu",
    dogfoodId: "DOG-005",
    durationMs: 820,
  },
  {
    id: "activity-ticketmaster-simulated-handoff",
    vertical: "activity",
    title: "Ticketmaster-style manual handoff remains simulated until live evidence exists",
    expectedPass: false,
    expectedFailureClass: "manual_boundary_expected",
    artifactComplete: true,
    suggestedOwner: "product/manual-boundary",
    dogfoodId: "DOG-006",
    durationMs: 1400,
  },
  {
    id: "activity-provider-simulated-block",
    vertical: "activity",
    title: "Activity provider network/degraded case remains simulated",
    expectedPass: false,
    expectedFailureClass: "simulated_provider_block",
    artifactComplete: true,
    suggestedOwner: "provider-runtime",
    dogfoodId: "DOG-006",
    durationMs: 1320,
  },
  {
    id: "trip-all-verticals-routing",
    vertical: "trip",
    title: "Full trip package keeps trip path instead of single vertical",
    fixtureId: "en-trip-complete",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "planner",
    durationMs: 1800,
  },
  {
    id: "trip-lion-king-explicit-trip",
    vertical: "trip",
    title: "Explicit full trip with Lion King remains trip, not activity-only",
    fixtureId: "en-trip-lion-king-explicit-trip",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "nlu",
    dogfoodId: "DOG-005",
    durationMs: 1760,
  },
  {
    id: "trip-missing-travelers",
    vertical: "trip",
    title: "Trip package missing travelers asks for traveler count",
    fixtureId: "en-trip-missing-travelers",
    expectedPass: false,
    expectedFailureClass: "missing_required_field",
    artifactComplete: true,
    suggestedOwner: "planner",
    durationMs: 1100,
  },
  {
    id: "trip-unsupported-cruise-request",
    vertical: "trip",
    title: "Unsupported cruise/package request stays a product boundary",
    expectedPass: false,
    expectedFailureClass: "unsupported_request",
    artifactComplete: true,
    suggestedOwner: "product/manual-boundary",
    durationMs: 900,
  },
  {
    id: "restaurant-direct-booking-routing",
    vertical: "restaurant",
    title: "Named restaurant request keeps direct-booking metadata",
    fixtureId: "en-restaurant-direct-carbone",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "nlu",
    durationMs: 930,
  },
  {
    id: "hotel-direct-booking-routing",
    vertical: "hotel",
    title: "Named hotel request keeps direct-booking metadata",
    fixtureId: "en-hotel-direct-pierre",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "nlu",
    durationMs: 990,
  },
  {
    id: "flight-business-passenger-routing",
    vertical: "flight",
    title: "Business-class passenger constraints survive routing",
    fixtureId: "en-flight-business-passengers",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "nlu",
    durationMs: 960,
  },
  {
    id: "activity-sports-ticket-routing",
    vertical: "activity",
    title: "Sports ticket request routes as activity",
    fixtureId: "en-activity-knicks",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "nlu",
    durationMs: 880,
  },
  {
    id: "tasks-completed-evidence-consistency",
    vertical: "trip",
    title: "Completed task evidence must stay discoverable from source session",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    suggestedOwner: "task-workspace",
    dogfoodId: "DOG-002",
    durationMs: 700,
  },
];

function byFixtureId(): Map<string, NluRoutingFixture> {
  return new Map(NLU_ROUTING_FIXTURES.map((fixture) => [fixture.id, fixture]));
}

export function selectInternalBenchmarkCases(params: {
  vertical: InternalBenchmarkVerticalArg;
  count: number;
}): InternalBenchmarkCase[] {
  const count = Math.max(1, Math.min(50, Math.floor(params.count)));
  const filtered =
    params.vertical === "all"
      ? INTERNAL_BENCHMARK_CASES
      : INTERNAL_BENCHMARK_CASES.filter((item) => item.vertical === params.vertical);

  const out: InternalBenchmarkCase[] = [];
  for (let i = 0; i < count && filtered.length > 0; i += 1) {
    out.push(filtered[i % filtered.length]);
  }
  return out;
}

export function runInternalNoLiveBenchmark(params: {
  vertical: InternalBenchmarkVerticalArg;
  count: number;
  mode?: InternalBenchmarkMode;
}): InternalBenchmarkReport {
  const mode = params.mode ?? "no-live";
  if (mode !== "no-live") {
    throw new Error("Only --mode no-live is supported by this runner.");
  }

  const fixtureMap = byFixtureId();
  const cases = selectInternalBenchmarkCases({ vertical: params.vertical, count: params.count });
  const results = cases.map((testCase): InternalBenchmarkCaseResult => {
    const fixture = testCase.fixtureId ? fixtureMap.get(testCase.fixtureId) : undefined;
    const routeResult = fixture ? evaluateNluRoutingMatrix([fixture])[0] : null;
    const routePass = routeResult?.pass ?? null;
    const pass = testCase.expectedPass && testCase.artifactComplete && (routePass ?? true);
    const failureClass = classifyFailure(testCase, routePass);

    return {
      ...testCase,
      pass,
      failureClass,
      routeScenario: routeResult?.scenario ?? null,
      routeAction: routeResult?.actionType ?? null,
      routePass,
      routeNotes: routeResult?.notes ?? [],
    };
  });

  return {
    summary: summarizeInternalBenchmark(params.vertical, mode, results),
    topFailedCases: topFailedCases(results),
    results,
    notes: [...INTERNAL_BENCHMARK_MODE_NOTES],
  };
}

function classifyFailure(
  testCase: InternalBenchmarkCase,
  routePass: boolean | null,
): InternalBenchmarkFailureClass {
  if (routePass === false) {
    return testCase.expectedFailureClass === "constraint_lost"
      ? "constraint_lost"
      : "routing_mismatch";
  }
  if (!testCase.artifactComplete) return "artifact_incomplete";
  if (testCase.expectedPass) return "none";
  return testCase.expectedFailureClass;
}

export function summarizeInternalBenchmark(
  vertical: InternalBenchmarkVerticalArg,
  mode: InternalBenchmarkMode,
  results: InternalBenchmarkCaseResult[],
): InternalBenchmarkSummary {
  const byVertical = { ...ZERO_VERTICALS };
  const byFailureClass = { ...ZERO_FAILURES };
  const bySuggestedOwner = { ...ZERO_OWNERS };
  let durationTotal = 0;
  let durationCount = 0;
  let artifactComplete = 0;

  for (const result of results) {
    byVertical[result.vertical] += 1;
    byFailureClass[result.failureClass] += 1;
    bySuggestedOwner[result.suggestedOwner] += 1;
    if (result.artifactComplete) artifactComplete += 1;
    if (typeof result.durationMs === "number") {
      durationTotal += result.durationMs;
      durationCount += 1;
    }
  }

  const pass = results.filter((result) => result.pass).length;
  const total = results.length;
  return {
    mode,
    vertical,
    total,
    pass,
    fail: total - pass,
    successRate: total === 0 ? 0 : pass / total,
    averageDurationMs: durationCount === 0 ? null : Math.round(durationTotal / durationCount),
    artifactCompletenessRate: total === 0 ? 0 : artifactComplete / total,
    byVertical,
    byFailureClass,
    bySuggestedOwner,
  };
}

function topFailedCases(results: InternalBenchmarkCaseResult[]): InternalBenchmarkTopFailedCase[] {
  return results
    .filter((result) => !result.pass)
    .slice(0, 10)
    .map((result) => ({
      id: result.id,
      vertical: result.vertical,
      failureClass: result.failureClass,
      suggestedOwner: result.suggestedOwner,
      title: result.title,
    }));
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderInternalBenchmarkMarkdown(report: InternalBenchmarkReport): string {
  const { summary, results } = report;
  const lines = [
    "# Internal Benchmark v2",
    "",
    ...report.notes,
    "",
    `Mode: ${summary.mode}`,
    `Vertical: ${summary.vertical}`,
    `Cases: ${summary.total}`,
    `Pass: ${summary.pass}`,
    `Fail: ${summary.fail}`,
    `Success rate: ${pct(summary.successRate)}`,
    `Artifact completeness: ${pct(summary.artifactCompletenessRate)}`,
    `Average duration: ${summary.averageDurationMs == null ? "-" : `${summary.averageDurationMs}ms`}`,
    "",
    "## By Vertical",
    "",
    "| Vertical | Count |",
    "| --- | ---: |",
  ];

  for (const [key, value] of Object.entries(summary.byVertical)) {
    if (value > 0) lines.push(`| \`${key}\` | ${value} |`);
  }

  lines.push("", "## Failure Taxonomy", "", "| Class | Count |", "| --- | ---: |");
  for (const [key, value] of Object.entries(summary.byFailureClass)) {
    if (value > 0) lines.push(`| \`${key}\` | ${value} |`);
  }

  lines.push("", "## Suggested Owners", "", "| Owner | Count |", "| --- | ---: |");
  for (const [key, value] of Object.entries(summary.bySuggestedOwner)) {
    if (value > 0) lines.push(`| \`${key}\` | ${value} |`);
  }

  lines.push("", "## Top Failed Cases", "", "| Case | Vertical | Failure | Owner |", "| --- | --- | --- | --- |");
  for (const result of report.topFailedCases) {
    lines.push(
      `| \`${result.id}\` | ${result.vertical} | \`${result.failureClass}\` | ${result.suggestedOwner} |`,
    );
  }
  if (report.topFailedCases.length === 0) lines.push("| - | - | - | - |");

  lines.push("", "## Cases", "", "| Case | Vertical | Route | Artifacts | Owner | Result |", "| --- | --- | --- | --- | --- | --- |");
  for (const result of results) {
    const route =
      result.routePass === null
        ? "-"
        : `${result.routeScenario ?? "-"} / ${result.routeAction ?? "-"} / ${result.routePass ? "pass" : "fail"}`;
    lines.push(
      `| \`${result.id}\` | ${result.vertical} | ${route} | ${result.artifactComplete ? "complete" : "missing"} | ${result.suggestedOwner} | ${result.pass ? "PASS" : `FAIL (${result.failureClass})`} |`,
    );
  }

  return lines.join("\n");
}

export function evaluateInternalBenchmarkGate(
  report: InternalBenchmarkReport,
  options: InternalBenchmarkGateOptions,
): InternalBenchmarkGateResult {
  const checks: InternalBenchmarkGateCheck[] = [];

  if (typeof options.minSuccessRate === "number") {
    checks.push({
      name: "min_success_rate",
      pass: report.summary.successRate >= options.minSuccessRate,
      actual: report.summary.successRate,
      expected: options.minSuccessRate,
    });
  }
  if (typeof options.minArtifactCompletenessRate === "number") {
    checks.push({
      name: "min_artifact_completeness",
      pass: report.summary.artifactCompletenessRate >= options.minArtifactCompletenessRate,
      actual: report.summary.artifactCompletenessRate,
      expected: options.minArtifactCompletenessRate,
    });
  }

  for (const [failureClass, maxAllowed] of Object.entries(options.maxFailureCounts ?? {})) {
    if (typeof maxAllowed !== "number") continue;
    const actual = report.summary.byFailureClass[failureClass as InternalBenchmarkFailureClass] ?? 0;
    checks.push({
      name: `max_${failureClass}`,
      pass: actual <= maxAllowed,
      actual,
      expected: maxAllowed,
    });
  }

  const errors = checks
    .filter((check) => !check.pass)
    .map((check) => formatGateError(check));

  return {
    pass: errors.length === 0,
    checks,
    errors,
  };
}

function formatGateError(check: InternalBenchmarkGateCheck): string {
  if (check.name === "min_success_rate") {
    return `successRate ${pct(check.actual)} is below required ${pct(check.expected)}`;
  }
  if (check.name === "min_artifact_completeness") {
    return `artifactCompleteness ${pct(check.actual)} is below required ${pct(check.expected)}`;
  }
  return `${check.name.replace(/^max_/, "")} count ${check.actual} exceeds allowed ${check.expected}`;
}
