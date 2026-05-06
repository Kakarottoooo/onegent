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
  | "nlu_wrong_vertical"
  | "nlu_constraint_lost"
  | "planner_missing_required_field"
  | "provider_simulated_block"
  | "task_workspace_artifact_incomplete"
  | "manual_boundary_expected"
  | "unsupported_request"
  | "stale_session_or_provider_degraded"
  | "performance_budget_exceeded";

export type InternalBenchmarkOwner =
  | "nlu"
  | "planner"
  | "task-workspace"
  | "provider-runtime"
  | "product/manual-boundary"
  | "unassigned";

export type InternalBenchmarkExpectedOutcome =
  | "pass"
  | "expected_clarification"
  | "expected_manual_boundary"
  | "expected_blocker";

export type InternalBenchmarkArtifactExpectations = {
  syntheticMarker: boolean;
  fixtureIdPresent: boolean;
  taskEvidence: boolean;
  logs: boolean;
  screenshots: boolean;
};

export type InternalBenchmarkCase = {
  id: string;
  vertical: InternalBenchmarkVertical;
  title: string;
  expectedOutcome: InternalBenchmarkExpectedOutcome;
  fixtureId?: string;
  expectedPass: boolean;
  expectedFailureClass: InternalBenchmarkFailureClass;
  artifactComplete: boolean;
  artifactExpectations: InternalBenchmarkArtifactExpectations;
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

export type InternalBenchmarkOwnerRecommendation = {
  owner: InternalBenchmarkOwner;
  failedCases: number;
};

export type InternalBenchmarkDogfoodMapping = {
  dogfoodId: string;
  caseIds: string[];
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
  routingMismatchCount: number;
  ownerUnassignedCount: number;
  byVertical: Record<InternalBenchmarkVertical, number>;
  byFailureClass: Record<InternalBenchmarkFailureClass, number>;
  bySuggestedOwner: Record<InternalBenchmarkOwner, number>;
};

export type InternalBenchmarkReport = {
  summary: InternalBenchmarkSummary;
  topFailedCases: InternalBenchmarkTopFailedCase[];
  dogfoodMapping: InternalBenchmarkDogfoodMapping[];
  nextRecommendedOwners: InternalBenchmarkOwnerRecommendation[];
  results: InternalBenchmarkCaseResult[];
  notes: string[];
};

export type InternalBenchmarkGateOptions = {
  minSuccessRate?: number;
  minArtifactCompletenessRate?: number;
  maxRoutingMismatch?: number;
  maxOwnerUnassigned?: number;
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
  nlu_wrong_vertical: 0,
  nlu_constraint_lost: 0,
  planner_missing_required_field: 0,
  provider_simulated_block: 0,
  task_workspace_artifact_incomplete: 0,
  manual_boundary_expected: 0,
  unsupported_request: 0,
  stale_session_or_provider_degraded: 0,
  performance_budget_exceeded: 0,
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
  unassigned: 0,
};

const COMPLETE_ARTIFACTS: InternalBenchmarkArtifactExpectations = {
  syntheticMarker: true,
  fixtureIdPresent: true,
  taskEvidence: true,
  logs: true,
  screenshots: true,
};

const INCOMPLETE_ARTIFACTS: InternalBenchmarkArtifactExpectations = {
  syntheticMarker: true,
  fixtureIdPresent: true,
  taskEvidence: true,
  logs: true,
  screenshots: false,
};

export const INTERNAL_BENCHMARK_MODE_NOTES = [
  "no-live mode runs deterministic routing fixtures, simulated artifact contracts, and owner/failure metadata only.",
  "small-live and live modes are documented future modes; this runner refuses them.",
  "Provider closure still requires separate runtime evidence, logs, screenshots, and human approval.",
] as const;

export const INTERNAL_BENCHMARK_CASES: InternalBenchmarkCase[] = buildInternalBenchmarkCases();

function buildInternalBenchmarkCases(): InternalBenchmarkCase[] {
  return [
    ...buildVerticalCorpus("restaurant", {
      passFixtures: [
        "zh-restaurant-japanese-complete",
        "zh-restaurant-chinese-complete",
        "en-restaurant-sushi-nyc",
        "en-restaurant-direct-carbone",
        "en-restaurant-room-named-member",
        "en-restaurant-vegan-budget",
        "en-restaurant-any-cuisine",
        "en-restaurant-dietary-shellfish",
      ],
      missingFixtures: ["en-restaurant-missing-cuisine", "en-restaurant-missing-time"],
      dogfoodId: "DOG-009",
      providerTitle: "Restaurant provider simulated no-availability/network boundary",
    }),
    ...buildVerticalCorpus("hotel", {
      passFixtures: [
        "zh-hotel-complete",
        "en-hotel-nyc-budget",
        "en-hotel-nights-satisfy-checkout",
        "en-hotel-direct-pierre",
        "en-hotel-guests-star-rating",
        "en-hotel-neighborhood",
        "en-hotel-budget-date",
      ],
      missingFixtures: ["en-hotel-missing-checkout", "en-hotel-missing-city"],
      dogfoodId: "DOG-010",
      providerTitle: "Booking.com simulated selector/network blocker",
    }),
    ...buildVerticalCorpus("flight", {
      passFixtures: [
        "zh-flight-complete",
        "en-flight-bna-nyc-oneway",
        "en-flight-roundtrip",
        "en-flight-business-passengers",
        "en-flight-avoid-red-eye",
        "en-flight-sfo-lax",
        "en-flight-family-passengers",
      ],
      missingFixtures: ["en-flight-missing-origin", "en-flight-missing-date"],
      providerTitle: "Expedia simulated card/provider blocker",
    }),
    ...buildVerticalCorpus("activity", {
      passFixtures: [
        "zh-activity-hamilton-complete",
        "en-activity-hamilton-complete",
        "en-activity-knicks",
        "en-activity-concert-budget",
        "en-activity-two-tickets",
        "en-activity-exhibition",
        "en-activity-comedy",
        "zh-activity-lion-king-trip-shaped",
        "en-activity-lion-king-trip-shaped",
      ],
      missingFixtures: ["en-activity-missing-date", "en-activity-missing-city"],
      dogfoodId: "DOG-005",
      providerTitle: "Ticketing provider simulated manual/provider boundary",
    }),
    ...buildTripAndMetaCorpus(),
  ];
}

function buildVerticalCorpus(
  vertical: Exclude<InternalBenchmarkVertical, "trip">,
  config: {
    passFixtures: string[];
    missingFixtures: string[];
    dogfoodId?: string;
    providerTitle: string;
  },
): InternalBenchmarkCase[] {
  const cases: InternalBenchmarkCase[] = [];
  for (let i = 0; i < 28; i += 1) {
    const fixtureId = config.passFixtures[i % config.passFixtures.length];
    cases.push(makeCase({
      id: `${vertical}-route-pass-${pad(i + 1)}`,
      vertical,
      title: `${vertical} routing pass fixture ${fixtureId}`,
      expectedOutcome: "pass",
      fixtureId,
      expectedPass: true,
      failureClass: "none",
      owner: i % 5 === 0 ? "planner" : "nlu",
      dogfoodId: config.dogfoodId,
      durationMs: 700 + i * 12,
    }));
  }
  for (let i = 0; i < 4; i += 1) {
    const fixtureId = config.missingFixtures[i % config.missingFixtures.length];
    cases.push(makeCase({
      id: `${vertical}-planner-missing-${pad(i + 1)}`,
      vertical,
      title: `${vertical} expected clarification fixture ${fixtureId}`,
      expectedOutcome: "expected_clarification",
      fixtureId,
      expectedPass: false,
      failureClass: "planner_missing_required_field",
      owner: "planner",
      dogfoodId: config.dogfoodId,
      durationMs: 900 + i * 30,
    }));
  }
  for (let i = 0; i < 2; i += 1) {
    cases.push(makeCase({
      id: `${vertical}-artifact-incomplete-${pad(i + 1)}`,
      vertical,
      title: `${vertical} artifact contract missing screenshot/log metadata`,
      expectedOutcome: "expected_blocker",
      expectedPass: false,
      failureClass: "task_workspace_artifact_incomplete",
      owner: "task-workspace",
      dogfoodId: "DOG-004",
      artifactComplete: false,
      artifacts: INCOMPLETE_ARTIFACTS,
      durationMs: 1000 + i * 40,
    }));
  }
  for (let i = 0; i < 2; i += 1) {
    cases.push(makeCase({
      id: `${vertical}-provider-simulated-${pad(i + 1)}`,
      vertical,
      title: config.providerTitle,
      expectedOutcome: "expected_blocker",
      expectedPass: false,
      failureClass: i === 0 ? "provider_simulated_block" : "stale_session_or_provider_degraded",
      owner: "provider-runtime",
      dogfoodId: vertical === "hotel" ? "DOG-007" : undefined,
      durationMs: 1500 + i * 120,
    }));
  }
  cases.push(makeCase({
    id: `${vertical}-manual-boundary-01`,
    vertical,
    title: `${vertical} safe manual/final-confirm boundary remains product-owned`,
    expectedOutcome: "expected_manual_boundary",
    expectedPass: false,
    failureClass: "manual_boundary_expected",
    owner: "product/manual-boundary",
    durationMs: 1300,
  }));
  cases.push(makeCase({
    id: `${vertical}-performance-budget-01`,
    vertical,
    title: `${vertical} no-live performance budget simulated regression`,
    expectedOutcome: "expected_blocker",
    expectedPass: false,
    failureClass: "performance_budget_exceeded",
    owner: "task-workspace",
    durationMs: 2600,
  }));
  cases.push(makeCase({
    id: `${vertical}-unsupported-01`,
    vertical,
    title: `${vertical} unsupported adjacent request stays out of provider runtime`,
    expectedOutcome: "expected_blocker",
    expectedPass: false,
    failureClass: "unsupported_request",
    owner: "product/manual-boundary",
    durationMs: 650,
  }));
  cases.push(makeCase({
    id: `${vertical}-route-pass-extra-01`,
    vertical,
    title: `${vertical} extra routing pass to keep 40-case balance`,
    expectedOutcome: "pass",
    fixtureId: config.passFixtures[0],
    expectedPass: true,
    failureClass: "none",
    owner: "nlu",
    dogfoodId: config.dogfoodId,
    durationMs: 780,
  }));
  return cases;
}

function buildTripAndMetaCorpus(): InternalBenchmarkCase[] {
  const cases: InternalBenchmarkCase[] = [];
  const passFixtures = [
    "en-trip-complete",
    "zh-trip-complete",
    "en-trip-lion-king-explicit-trip",
    "en-composite-restaurant-activity",
    "en-composite-hotel-flight",
    "en-room-trip-named-members",
    "en-ambiguous-travel-category",
    "zh-ambiguous-destination-only",
    "en-profile-edit-email",
    "en-profile-edit-empty-patch",
    "en-refine-existing-generic",
    "zh-refine-budget-generic",
  ];
  for (let i = 0; i < 28; i += 1) {
    const fixtureId = passFixtures[i % passFixtures.length];
    cases.push(makeCase({
      id: `trip-meta-route-pass-${pad(i + 1)}`,
      vertical: "trip",
      title: `trip/composite/ambiguous/profile/refine fixture ${fixtureId}`,
      expectedOutcome: "pass",
      fixtureId,
      expectedPass: true,
      failureClass: "none",
      owner: fixtureId.includes("profile") || fixtureId.includes("refine") ? "planner" : "nlu",
      dogfoodId: fixtureId.includes("lion-king") ? "DOG-005" : undefined,
      durationMs: 900 + i * 15,
    }));
  }
  for (let i = 0; i < 4; i += 1) {
    const fixtureId = i % 2 === 0 ? "en-trip-missing-travelers" : "en-trip-missing-date-range";
    cases.push(makeCase({
      id: `trip-meta-planner-missing-${pad(i + 1)}`,
      vertical: "trip",
      title: `trip expected clarification fixture ${fixtureId}`,
      expectedOutcome: "expected_clarification",
      fixtureId,
      expectedPass: false,
      failureClass: "planner_missing_required_field",
      owner: "planner",
      durationMs: 1100,
    }));
  }
  for (let i = 0; i < 2; i += 1) {
    cases.push(makeCase({
      id: `trip-meta-artifact-incomplete-${pad(i + 1)}`,
      vertical: "trip",
      title: "trip/task workspace evidence contract missing artifact metadata",
      expectedOutcome: "expected_blocker",
      expectedPass: false,
      failureClass: "task_workspace_artifact_incomplete",
      owner: "task-workspace",
      dogfoodId: i === 0 ? "DOG-002" : "DOG-003",
      artifactComplete: false,
      artifacts: INCOMPLETE_ARTIFACTS,
      durationMs: 900,
    }));
  }
  cases.push(makeCase({
    id: "trip-meta-manual-boundary-01",
    vertical: "trip",
    title: "trip package manual approval boundary remains product-owned",
    expectedOutcome: "expected_manual_boundary",
    expectedPass: false,
    failureClass: "manual_boundary_expected",
    owner: "product/manual-boundary",
    durationMs: 1200,
  }));
  cases.push(makeCase({
    id: "trip-meta-unsupported-01",
    vertical: "trip",
    title: "unsupported cruise/passport adjacent request stays out of provider runtime",
    expectedOutcome: "expected_blocker",
    expectedPass: false,
    failureClass: "unsupported_request",
    owner: "product/manual-boundary",
    durationMs: 760,
  }));
  cases.push(makeCase({
    id: "trip-meta-stale-session-01",
    vertical: "trip",
    title: "stale source session or degraded provider state stays classified",
    expectedOutcome: "expected_blocker",
    expectedPass: false,
    failureClass: "stale_session_or_provider_degraded",
    owner: "task-workspace",
    dogfoodId: "DOG-002",
    durationMs: 1700,
  }));
  cases.push(makeCase({
    id: "trip-meta-performance-01",
    vertical: "trip",
    title: "trip/composite performance budget simulated regression",
    expectedOutcome: "expected_blocker",
    expectedPass: false,
    failureClass: "performance_budget_exceeded",
    owner: "task-workspace",
    durationMs: 2900,
  }));
  cases.push(makeCase({
    id: "trip-meta-provider-simulated-01",
    vertical: "trip",
    title: "trip package provider dependency simulated blocker",
    expectedOutcome: "expected_blocker",
    expectedPass: false,
    failureClass: "provider_simulated_block",
    owner: "provider-runtime",
    durationMs: 1600,
  }));
  cases.push(makeCase({
    id: "trip-meta-route-pass-extra-01",
    vertical: "trip",
    title: "trip extra route pass to keep 40-case balance",
    expectedOutcome: "pass",
    fixtureId: "en-trip-complete",
    expectedPass: true,
    failureClass: "none",
    owner: "planner",
    durationMs: 980,
  }));
  return cases;
}

function makeCase(params: {
  id: string;
  vertical: InternalBenchmarkVertical;
  title: string;
  expectedOutcome: InternalBenchmarkExpectedOutcome;
  fixtureId?: string;
  expectedPass: boolean;
  failureClass: InternalBenchmarkFailureClass;
  owner: InternalBenchmarkOwner;
  dogfoodId?: string;
  artifactComplete?: boolean;
  artifacts?: InternalBenchmarkArtifactExpectations;
  durationMs?: number;
}): InternalBenchmarkCase {
  return {
    id: params.id,
    vertical: params.vertical,
    title: params.title,
    expectedOutcome: params.expectedOutcome,
    ...(params.fixtureId ? { fixtureId: params.fixtureId } : {}),
    expectedPass: params.expectedPass,
    expectedFailureClass: params.failureClass,
    artifactComplete: params.artifactComplete ?? true,
    artifactExpectations: params.artifacts ?? COMPLETE_ARTIFACTS,
    suggestedOwner: params.owner,
    ...(params.dogfoodId ? { dogfoodId: params.dogfoodId } : {}),
    durationMs: params.durationMs,
  };
}

function byFixtureId(): Map<string, NluRoutingFixture> {
  return new Map(NLU_ROUTING_FIXTURES.map((fixture) => [fixture.id, fixture]));
}

export function selectInternalBenchmarkCases(params: {
  vertical: InternalBenchmarkVerticalArg;
  count: number;
}): InternalBenchmarkCase[] {
  const filtered =
    params.vertical === "all"
      ? INTERNAL_BENCHMARK_CASES
      : INTERNAL_BENCHMARK_CASES.filter((item) => item.vertical === params.vertical);
  const count = Math.max(1, Math.min(Math.floor(params.count), filtered.length));
  return filtered.slice(0, count);
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
    const failureClass = classifyFailure(testCase, routeResult?.notes ?? [], routePass);

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
    dogfoodMapping: dogfoodMapping(results),
    nextRecommendedOwners: nextRecommendedOwners(results),
    results,
    notes: [...INTERNAL_BENCHMARK_MODE_NOTES],
  };
}

function classifyFailure(
  testCase: InternalBenchmarkCase,
  routeNotes: string[],
  routePass: boolean | null,
): InternalBenchmarkFailureClass {
  if (routePass === false) {
    return routeNotes.some((note) => note.startsWith("scenario expected"))
      ? "nlu_wrong_vertical"
      : "nlu_constraint_lost";
  }
  if (!testCase.artifactComplete) return "task_workspace_artifact_incomplete";
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
    routingMismatchCount: byFailureClass.nlu_wrong_vertical + byFailureClass.nlu_constraint_lost,
    ownerUnassignedCount: bySuggestedOwner.unassigned,
    byVertical,
    byFailureClass,
    bySuggestedOwner,
  };
}

function topFailedCases(results: InternalBenchmarkCaseResult[]): InternalBenchmarkTopFailedCase[] {
  return results
    .filter((result) => !result.pass)
    .slice(0, 12)
    .map((result) => ({
      id: result.id,
      vertical: result.vertical,
      failureClass: result.failureClass,
      suggestedOwner: result.suggestedOwner,
      title: result.title,
    }));
}

function dogfoodMapping(results: InternalBenchmarkCaseResult[]): InternalBenchmarkDogfoodMapping[] {
  const map = new Map<string, string[]>();
  for (const result of results) {
    if (!result.dogfoodId) continue;
    map.set(result.dogfoodId, [...(map.get(result.dogfoodId) ?? []), result.id]);
  }
  return [...map.entries()].map(([dogfoodId, caseIds]) => ({ dogfoodId, caseIds }));
}

function nextRecommendedOwners(results: InternalBenchmarkCaseResult[]): InternalBenchmarkOwnerRecommendation[] {
  const counts = { ...ZERO_OWNERS };
  for (const result of results) {
    if (!result.pass) counts[result.suggestedOwner] += 1;
  }
  return Object.entries(counts)
    .filter(([, failedCases]) => failedCases > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([owner, failedCases]) => ({ owner: owner as InternalBenchmarkOwner, failedCases }));
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
    `Routing mismatch: ${summary.routingMismatchCount}`,
    `Owner unassigned: ${summary.ownerUnassignedCount}`,
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

  lines.push("", "## Next Recommended Owners", "", "| Owner | Failed cases |", "| --- | ---: |");
  for (const item of report.nextRecommendedOwners) {
    lines.push(`| \`${item.owner}\` | ${item.failedCases} |`);
  }
  if (report.nextRecommendedOwners.length === 0) lines.push("| - | 0 |");

  lines.push("", "## Dogfood Mapping", "", "| DOG | Case count |", "| --- | ---: |");
  for (const item of report.dogfoodMapping) {
    lines.push(`| \`${item.dogfoodId}\` | ${item.caseIds.length} |`);
  }
  if (report.dogfoodMapping.length === 0) lines.push("| - | 0 |");

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
  if (typeof options.maxRoutingMismatch === "number") {
    checks.push({
      name: "max_routing_mismatch",
      pass: report.summary.routingMismatchCount <= options.maxRoutingMismatch,
      actual: report.summary.routingMismatchCount,
      expected: options.maxRoutingMismatch,
    });
  }
  if (typeof options.maxOwnerUnassigned === "number") {
    checks.push({
      name: "max_owner_unassigned",
      pass: report.summary.ownerUnassignedCount <= options.maxOwnerUnassigned,
      actual: report.summary.ownerUnassignedCount,
      expected: options.maxOwnerUnassigned,
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
  if (check.name === "max_routing_mismatch") {
    return `routing mismatch count ${check.actual} exceeds allowed ${check.expected}`;
  }
  if (check.name === "max_owner_unassigned") {
    return `owner unassigned count ${check.actual} exceeds allowed ${check.expected}`;
  }
  return `${check.name.replace(/^max_/, "")} count ${check.actual} exceeds allowed ${check.expected}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
