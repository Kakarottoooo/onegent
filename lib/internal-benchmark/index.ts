import {
  NLU_ROUTING_FIXTURES,
  evaluateNluRoutingMatrix,
  type NluRoutingFixture,
} from "@/lib/agent/nlu-v2/routing-matrix";

export type InternalBenchmarkVertical = "restaurant" | "hotel" | "flight" | "activity";
export type InternalBenchmarkVerticalArg = InternalBenchmarkVertical | "all";
export type InternalBenchmarkMode = "no-live";

export type InternalBenchmarkFailureClass =
  | "none"
  | "routing_mismatch"
  | "planner_missing_fields"
  | "artifact_incomplete"
  | "provider_simulated_block"
  | "unsafe_boundary";

export type InternalBenchmarkCase = {
  id: string;
  vertical: InternalBenchmarkVertical;
  title: string;
  fixtureId?: string;
  expectedPass: boolean;
  expectedFailureClass: InternalBenchmarkFailureClass;
  artifactComplete: boolean;
  durationMs?: number;
};

export type InternalBenchmarkCaseResult = InternalBenchmarkCase & {
  pass: boolean;
  failureClass: InternalBenchmarkFailureClass;
  routeScenario: string | null;
  routeAction: string | null;
  routePass: boolean | null;
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
};

export type InternalBenchmarkReport = {
  summary: InternalBenchmarkSummary;
  results: InternalBenchmarkCaseResult[];
};

export type InternalBenchmarkGateOptions = {
  minSuccessRate?: number;
  minArtifactCompletenessRate?: number;
  maxFailureCounts?: Partial<Record<InternalBenchmarkFailureClass, number>>;
};

export type InternalBenchmarkGateResult = {
  pass: boolean;
  errors: string[];
};

const ZERO_FAILURES: Record<InternalBenchmarkFailureClass, number> = {
  none: 0,
  routing_mismatch: 0,
  planner_missing_fields: 0,
  artifact_incomplete: 0,
  provider_simulated_block: 0,
  unsafe_boundary: 0,
};

const ZERO_VERTICALS: Record<InternalBenchmarkVertical, number> = {
  restaurant: 0,
  hotel: 0,
  flight: 0,
  activity: 0,
};

export const INTERNAL_BENCHMARK_CASES: InternalBenchmarkCase[] = [
  {
    id: "restaurant-japanese-routing",
    vertical: "restaurant",
    title: "Japanese restaurant request keeps cuisine as a hard constraint",
    fixtureId: "zh-restaurant-japanese-complete",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    durationMs: 1200,
  },
  {
    id: "restaurant-artifact-missing-screenshot",
    vertical: "restaurant",
    title: "Restaurant evidence bundle missing screenshot manifest",
    expectedPass: false,
    expectedFailureClass: "artifact_incomplete",
    artifactComplete: false,
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
    durationMs: 1000,
  },
  {
    id: "hotel-booking-provider-simulated-block",
    vertical: "hotel",
    title: "Booking.com selector drift stays a simulated blocker",
    expectedPass: false,
    expectedFailureClass: "provider_simulated_block",
    artifactComplete: true,
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
    durationMs: 900,
  },
  {
    id: "flight-unsafe-final-confirm-boundary",
    vertical: "flight",
    title: "Flight checkout final-confirm boundary remains unsafe",
    expectedPass: false,
    expectedFailureClass: "unsafe_boundary",
    artifactComplete: true,
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
    durationMs: 820,
  },
  {
    id: "activity-ticketmaster-simulated-handoff",
    vertical: "activity",
    title: "Ticketmaster-style manual handoff remains simulated until live evidence exists",
    expectedPass: false,
    expectedFailureClass: "provider_simulated_block",
    artifactComplete: true,
    durationMs: 1400,
  },
  {
    id: "trip-all-verticals-routing",
    vertical: "hotel",
    title: "Full trip package keeps trip path instead of single vertical",
    fixtureId: "en-trip-complete",
    expectedPass: true,
    expectedFailureClass: "none",
    artifactComplete: true,
    durationMs: 1800,
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
    const failureClass =
      pass
        ? "none"
        : !testCase.artifactComplete
          ? "artifact_incomplete"
          : routePass === false
            ? "routing_mismatch"
            : testCase.expectedFailureClass;

    return {
      ...testCase,
      pass,
      failureClass,
      routeScenario: routeResult?.scenario ?? null,
      routeAction: routeResult?.actionType ?? null,
      routePass,
    };
  });

  return {
    summary: summarizeInternalBenchmark(params.vertical, mode, results),
    results,
  };
}

export function summarizeInternalBenchmark(
  vertical: InternalBenchmarkVerticalArg,
  mode: InternalBenchmarkMode,
  results: InternalBenchmarkCaseResult[],
): InternalBenchmarkSummary {
  const byVertical = { ...ZERO_VERTICALS };
  const byFailureClass = { ...ZERO_FAILURES };
  let durationTotal = 0;
  let durationCount = 0;
  let artifactComplete = 0;

  for (const result of results) {
    byVertical[result.vertical] += 1;
    byFailureClass[result.failureClass] += 1;
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
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderInternalBenchmarkMarkdown(report: InternalBenchmarkReport): string {
  const { summary, results } = report;
  const lines = [
    "# Internal Benchmark v2",
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
    "## Failure Taxonomy",
    "",
    "| Class | Count |",
    "| --- | ---: |",
  ];

  for (const [key, value] of Object.entries(summary.byFailureClass)) {
    if (value > 0) lines.push(`| \`${key}\` | ${value} |`);
  }

  lines.push("", "## Cases", "", "| Case | Vertical | Route | Artifacts | Result |", "| --- | --- | --- | --- | --- |");
  for (const result of results) {
    const route =
      result.routePass === null
        ? "-"
        : `${result.routeScenario ?? "-"} / ${result.routeAction ?? "-"} / ${result.routePass ? "pass" : "fail"}`;
    lines.push(
      `| \`${result.id}\` | ${result.vertical} | ${route} | ${result.artifactComplete ? "complete" : "missing"} | ${result.pass ? "PASS" : `FAIL (${result.failureClass})`} |`,
    );
  }

  return lines.join("\n");
}

export function evaluateInternalBenchmarkGate(
  report: InternalBenchmarkReport,
  options: InternalBenchmarkGateOptions,
): InternalBenchmarkGateResult {
  const errors: string[] = [];
  if (
    typeof options.minSuccessRate === "number" &&
    report.summary.successRate < options.minSuccessRate
  ) {
    errors.push(
      `successRate ${pct(report.summary.successRate)} is below required ${pct(options.minSuccessRate)}`,
    );
  }
  if (
    typeof options.minArtifactCompletenessRate === "number" &&
    report.summary.artifactCompletenessRate < options.minArtifactCompletenessRate
  ) {
    errors.push(
      `artifactCompleteness ${pct(report.summary.artifactCompletenessRate)} is below required ${pct(options.minArtifactCompletenessRate)}`,
    );
  }

  for (const [failureClass, maxAllowed] of Object.entries(options.maxFailureCounts ?? {})) {
    if (typeof maxAllowed !== "number") continue;
    const actual =
      report.summary.byFailureClass[failureClass as InternalBenchmarkFailureClass] ?? 0;
    if (actual > maxAllowed) {
      errors.push(`${failureClass} count ${actual} exceeds allowed ${maxAllowed}`);
    }
  }

  return {
    pass: errors.length === 0,
    errors,
  };
}
