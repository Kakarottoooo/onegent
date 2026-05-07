import {
  buildCaptureTravelObjectFromNlu,
  type CaptureActionType,
  type CaptureReadinessReason,
  type CaptureSourceType,
  type CaptureTravelObject,
} from "@/lib/capture/travel-object";
import {
  flattenScenarioFields,
  routeIntent,
  type IntentState,
  type NluScenario,
  type NluV2ParseResult,
  type RouterAction,
} from "@/lib/agent/nlu-v2";
import type { NluCategory } from "@/lib/agent/nlu-v2/types";

export type CaptureBenchmarkVertical =
  | "restaurant"
  | "hotel"
  | "flight"
  | "activity"
  | "trip"
  | "ambiguous"
  | "refine"
  | "profile"
  | "chitchat";

export type CaptureBenchmarkVerticalArg = CaptureBenchmarkVertical | "all";

export type CaptureBenchmarkSourceShape =
  | "plain_natural_language"
  | "pasted_url"
  | "screenshot_description"
  | "mixed_url_instruction"
  | "vague_inspiration"
  | "exact_task_ready"
  | "group_decision_request"
  | "save_only"
  | "compare_only"
  | "provider_url_impersonation";

export type CaptureBenchmarkObjectType =
  | "task_intent"
  | "travel_link"
  | "travel_screenshot"
  | "trip_seed"
  | "group_decision"
  | "profile_or_preference"
  | "refine_request"
  | "needs_clarification"
  | "non_task";

export type CaptureBenchmarkFailureClass =
  | "none"
  | "routing_mismatch"
  | "missing_required_field"
  | "constraint_lost"
  | "task_readiness_mismatch"
  | "source_metadata_incomplete"
  | "artifact_incomplete"
  | "ambiguous_overclaimed"
  | "unsupported_request"
  | "unknown_failure";

export type CaptureBenchmarkOwner =
  | "capture"
  | "nlu"
  | "planner"
  | "task-readiness"
  | "task-workspace"
  | "provider-runtime"
  | "product/manual-boundary"
  | "alpha-ops";

export type CaptureBenchmarkArtifactContract = {
  syntheticMarker: true;
  fixtureIdPresent: boolean;
  sourceMetadataPreserved: boolean;
  entitiesPreserved: boolean;
  taskReadinessChecked: boolean;
  evidenceRequired: string[];
};

export type CaptureBenchmarkFixture = {
  id: string;
  input: string;
  locale: "en" | "zh";
  vertical: CaptureBenchmarkVertical;
  sourceShape: CaptureBenchmarkSourceShape;
  expectedObjectType: CaptureBenchmarkObjectType;
  expectedScenario: NluScenario | null;
  expectedCategories: NluCategory[];
  expectedSourceType: CaptureSourceType;
  expectedEntityPaths: Record<string, unknown>;
  expectedActionTypes: CaptureActionType[];
  expectedTaskReadiness: {
    ready: boolean;
    reason: CaptureReadinessReason;
    missing: string[];
  };
  owner: CaptureBenchmarkOwner;
  expectedFailureClass: CaptureBenchmarkFailureClass;
  artifactContract: CaptureBenchmarkArtifactContract;
  note: string;
  dogfoodId?: string;
  parserState?: IntentState;
};

export type CaptureBenchmarkResult = {
  id: string;
  input: string;
  vertical: CaptureBenchmarkVertical;
  sourceShape: CaptureBenchmarkSourceShape;
  expectedScenario: NluScenario | null;
  actualScenario: NluScenario | null;
  expectedSourceType: CaptureSourceType;
  actualSourceType: CaptureSourceType;
  expectedObjectType: CaptureBenchmarkObjectType;
  actualObjectType: CaptureBenchmarkObjectType;
  expectedReady: boolean;
  actualReady: boolean;
  expectedReadinessReason: CaptureReadinessReason;
  actualReadinessReason: CaptureReadinessReason;
  pass: boolean;
  routingPass: boolean;
  taskReadinessPass: boolean;
  sourceMetadataComplete: boolean;
  artifactComplete: boolean;
  failureClass: CaptureBenchmarkFailureClass;
  owner: CaptureBenchmarkOwner;
  dogfoodId?: string;
  note: string;
  notes: string[];
  capture: CaptureTravelObject;
};

export type CaptureBenchmarkSummary = {
  total: number;
  pass: number;
  fail: number;
  successRate: number;
  routingMismatchCount: number;
  taskReadyAccuracy: number;
  sourceMetadataCompletenessRate: number;
  artifactCompletenessRate: number;
  unknownFailureRate: number;
  byVertical: Record<CaptureBenchmarkVertical, number>;
  bySourceShape: Record<CaptureBenchmarkSourceShape, number>;
  byFailureClass: Record<CaptureBenchmarkFailureClass, number>;
  byOwner: Record<CaptureBenchmarkOwner, number>;
};

export type CaptureBenchmarkTopFailure = {
  id: string;
  vertical: CaptureBenchmarkVertical;
  sourceShape: CaptureBenchmarkSourceShape;
  input: string;
  expected: string;
  actual: string;
  failureClass: CaptureBenchmarkFailureClass;
  owner: CaptureBenchmarkOwner;
  dogfoodId?: string;
  notes: string[];
};

export type CaptureBenchmarkReport = {
  summary: CaptureBenchmarkSummary;
  results: CaptureBenchmarkResult[];
  topFailedFixtures: CaptureBenchmarkTopFailure[];
  dogfoodLinks: Array<{
    dogfoodId: string;
    fixtureIds: string[];
  }>;
  recommendedNextActions: Array<{
    owner: CaptureBenchmarkOwner;
    action: string;
    reason: string;
  }>;
  notes: string[];
};

export type CaptureBenchmarkGateOptions = {
  maxRoutingMismatch?: number;
  minTaskReadyAccuracy?: number;
  minSourceMetadataCompleteness?: number;
  minArtifactCompleteness?: number;
  maxUnknownFailureRate?: number;
};

export type CaptureBenchmarkGateCheck = {
  name: string;
  pass: boolean;
  actual: number;
  expected: number;
};

export type CaptureBenchmarkGateResult = {
  pass: boolean;
  checks: CaptureBenchmarkGateCheck[];
  errors: string[];
};

const CAPTURED_AT = "2026-05-07T12:00:00.000Z";

const VERTICALS: CaptureBenchmarkVertical[] = [
  "restaurant",
  "hotel",
  "flight",
  "activity",
  "trip",
  "ambiguous",
  "refine",
  "profile",
  "chitchat",
];

const SOURCE_SHAPES: CaptureBenchmarkSourceShape[] = [
  "plain_natural_language",
  "pasted_url",
  "screenshot_description",
  "mixed_url_instruction",
  "vague_inspiration",
  "exact_task_ready",
  "group_decision_request",
  "save_only",
  "compare_only",
  "provider_url_impersonation",
];

const FAILURE_CLASSES: CaptureBenchmarkFailureClass[] = [
  "none",
  "routing_mismatch",
  "missing_required_field",
  "constraint_lost",
  "task_readiness_mismatch",
  "source_metadata_incomplete",
  "artifact_incomplete",
  "ambiguous_overclaimed",
  "unsupported_request",
  "unknown_failure",
];

const OWNERS: CaptureBenchmarkOwner[] = [
  "capture",
  "nlu",
  "planner",
  "task-readiness",
  "task-workspace",
  "provider-runtime",
  "product/manual-boundary",
  "alpha-ops",
];

const ZERO_VERTICALS = Object.fromEntries(VERTICALS.map((key) => [key, 0])) as Record<CaptureBenchmarkVertical, number>;
const ZERO_SOURCES = Object.fromEntries(SOURCE_SHAPES.map((key) => [key, 0])) as Record<CaptureBenchmarkSourceShape, number>;
const ZERO_FAILURES = Object.fromEntries(FAILURE_CLASSES.map((key) => [key, 0])) as Record<CaptureBenchmarkFailureClass, number>;
const ZERO_OWNERS = Object.fromEntries(OWNERS.map((key) => [key, 0])) as Record<CaptureBenchmarkOwner, number>;

export const CAPTURE_BENCHMARK_MODE_NOTES = [
  "no-live capture benchmark starts from raw homepage inputs plus deterministic fixture parser states.",
  "It exercises CaptureTravelObject source detection, projection, readiness, owner, and artifact contracts.",
  "It does not call live OpenAI and does not prove production LLM extraction quality.",
  "Provider runtime closure still requires separate task evidence and controlled human approval.",
] as const;

export const CAPTURE_BENCHMARK_FIXTURES: CaptureBenchmarkFixture[] = buildCaptureBenchmarkFixtures();

export function selectCaptureBenchmarkFixtures(params: {
  vertical: CaptureBenchmarkVerticalArg;
  count?: number;
}): CaptureBenchmarkFixture[] {
  const filtered =
    params.vertical === "all"
      ? CAPTURE_BENCHMARK_FIXTURES
      : CAPTURE_BENCHMARK_FIXTURES.filter((fixture) => fixture.vertical === params.vertical);

  const count = Math.max(1, Math.min(params.count ?? filtered.length, filtered.length));
  if (params.vertical !== "all") return filtered.slice(0, count);
  return balancedSlice(filtered, count);
}

export function runCaptureBenchmark(params: {
  vertical: CaptureBenchmarkVerticalArg;
  count?: number;
}): CaptureBenchmarkReport {
  const fixtures = selectCaptureBenchmarkFixtures(params);
  const results = fixtures.map(evaluateCaptureBenchmarkFixture);
  return {
    summary: summarizeCaptureBenchmark(results),
    results,
    topFailedFixtures: topFailedFixtures(results),
    dogfoodLinks: dogfoodLinks(results),
    recommendedNextActions: recommendedNextActions(results),
    notes: [...CAPTURE_BENCHMARK_MODE_NOTES],
  };
}

export function evaluateCaptureBenchmarkFixture(fixture: CaptureBenchmarkFixture): CaptureBenchmarkResult {
  const result = buildNluResult(fixture);
  const capture = buildCaptureTravelObjectFromNlu({
    message: fixture.input,
    result,
    sessionId: "capture-benchmark-session",
    capturedAt: CAPTURED_AT,
  });

  const notes: string[] = [];
  const routingPass =
    capture.classification.scenario === fixture.expectedScenario &&
    containsCategories(capture.classification.categories, fixture.expectedCategories);
  if (!routingPass) {
    notes.push(`scenario expected ${fixture.expectedScenario ?? "null"} got ${capture.classification.scenario ?? "null"}`);
  }

  if (capture.source.type !== fixture.expectedSourceType) {
    notes.push(`source expected ${fixture.expectedSourceType} got ${capture.source.type}`);
  }

  for (const [path, expected] of Object.entries(fixture.expectedEntityPaths)) {
    const actual = valueAtPath(capture, path);
    if (!valueMatches(actual, expected)) {
      notes.push(`${path} expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
    }
  }

  const actualActions = new Set(capture.possible_actions.map((action) => action.type));
  for (const expectedAction of fixture.expectedActionTypes) {
    if (!actualActions.has(expectedAction)) {
      notes.push(`action expected ${expectedAction}`);
    }
  }

  const taskReadinessPass =
    capture.task_readiness.ready === fixture.expectedTaskReadiness.ready &&
    capture.task_readiness.reason === fixture.expectedTaskReadiness.reason &&
    unorderedEquals(capture.task_readiness.next_missing_fields, fixture.expectedTaskReadiness.missing);
  if (!taskReadinessPass) {
    notes.push(
      `readiness expected ${fixture.expectedTaskReadiness.ready}/${fixture.expectedTaskReadiness.reason}/${fixture.expectedTaskReadiness.missing.join(",")} got ${capture.task_readiness.ready}/${capture.task_readiness.reason}/${capture.task_readiness.next_missing_fields.join(",")}`,
    );
  }

  const actualObjectType = classifyCaptureObject(capture);
  if (actualObjectType !== fixture.expectedObjectType) {
    notes.push(`object expected ${fixture.expectedObjectType} got ${actualObjectType}`);
  }

  const sourceMetadataComplete = isSourceMetadataComplete(capture, fixture);
  if (!sourceMetadataComplete) notes.push("source metadata incomplete");

  const artifactComplete =
    fixture.artifactContract.syntheticMarker === true &&
    fixture.artifactContract.fixtureIdPresent &&
    fixture.artifactContract.sourceMetadataPreserved &&
    fixture.artifactContract.entitiesPreserved &&
    fixture.artifactContract.taskReadinessChecked &&
    sourceMetadataComplete;
  if (!artifactComplete) notes.push("artifact contract incomplete");

  const failureClass = classifyCaptureFailure({
    fixture,
    routingPass,
    taskReadinessPass,
    sourceMetadataComplete,
    artifactComplete,
    notes,
  });
  const pass = notes.length === 0 && failureClass === "none";

  return {
    id: fixture.id,
    input: fixture.input,
    vertical: fixture.vertical,
    sourceShape: fixture.sourceShape,
    expectedScenario: fixture.expectedScenario,
    actualScenario: capture.classification.scenario,
    expectedSourceType: fixture.expectedSourceType,
    actualSourceType: capture.source.type,
    expectedObjectType: fixture.expectedObjectType,
    actualObjectType,
    expectedReady: fixture.expectedTaskReadiness.ready,
    actualReady: capture.task_readiness.ready,
    expectedReadinessReason: fixture.expectedTaskReadiness.reason,
    actualReadinessReason: capture.task_readiness.reason,
    pass,
    routingPass,
    taskReadinessPass,
    sourceMetadataComplete,
    artifactComplete,
    failureClass,
    owner: fixture.owner,
    dogfoodId: fixture.dogfoodId,
    note: fixture.note,
    notes,
    capture,
  };
}

export function evaluateCaptureBenchmarkGate(
  report: CaptureBenchmarkReport,
  options: CaptureBenchmarkGateOptions = {},
): CaptureBenchmarkGateResult {
  const checks: CaptureBenchmarkGateCheck[] = [
    {
      name: "routingMismatchCount",
      actual: report.summary.routingMismatchCount,
      expected: options.maxRoutingMismatch ?? 0,
      pass: report.summary.routingMismatchCount <= (options.maxRoutingMismatch ?? 0),
    },
    {
      name: "taskReadyAccuracy",
      actual: report.summary.taskReadyAccuracy,
      expected: options.minTaskReadyAccuracy ?? 0.9,
      pass: report.summary.taskReadyAccuracy >= (options.minTaskReadyAccuracy ?? 0.9),
    },
    {
      name: "sourceMetadataCompletenessRate",
      actual: report.summary.sourceMetadataCompletenessRate,
      expected: options.minSourceMetadataCompleteness ?? 0.95,
      pass: report.summary.sourceMetadataCompletenessRate >= (options.minSourceMetadataCompleteness ?? 0.95),
    },
    {
      name: "artifactCompletenessRate",
      actual: report.summary.artifactCompletenessRate,
      expected: options.minArtifactCompleteness ?? 0.95,
      pass: report.summary.artifactCompletenessRate >= (options.minArtifactCompleteness ?? 0.95),
    },
    {
      name: "unknownFailureRate",
      actual: report.summary.unknownFailureRate,
      expected: options.maxUnknownFailureRate ?? 0.05,
      pass: report.summary.unknownFailureRate <= (options.maxUnknownFailureRate ?? 0.05),
    },
  ];
  const errors = checks
    .filter((check) => !check.pass)
    .map((check) => `${check.name} expected ${check.expected}, got ${check.actual}`);
  return { pass: errors.length === 0, checks, errors };
}

export function renderCaptureBenchmarkMarkdown(report: CaptureBenchmarkReport): string {
  const lines = [
    "# Stage 0 Capture Benchmark",
    "",
    ...report.notes.map((note) => `- ${note}`),
    "",
    "## Summary",
    "",
    `Total: ${report.summary.total}`,
    `Pass: ${report.summary.pass}`,
    `Fail: ${report.summary.fail}`,
    `Success rate: ${formatRate(report.summary.successRate)}`,
    `Routing mismatch: ${report.summary.routingMismatchCount}`,
    `Task-ready accuracy: ${formatRate(report.summary.taskReadyAccuracy)}`,
    `Source metadata completeness: ${formatRate(report.summary.sourceMetadataCompletenessRate)}`,
    `Artifact completeness: ${formatRate(report.summary.artifactCompletenessRate)}`,
    `Unknown failure: ${formatRate(report.summary.unknownFailureRate)}`,
    "",
    "## By Vertical",
    "",
    "| Vertical | Count |",
    "| --- | ---: |",
  ];
  for (const vertical of VERTICALS) {
    if (report.summary.byVertical[vertical] > 0) lines.push(`| \`${vertical}\` | ${report.summary.byVertical[vertical]} |`);
  }

  lines.push("", "## Failure Classes", "", "| Failure class | Count |", "| --- | ---: |");
  for (const failureClass of FAILURE_CLASSES) {
    const count = report.summary.byFailureClass[failureClass];
    if (count > 0) lines.push(`| \`${failureClass}\` | ${count} |`);
  }

  lines.push("", "## Owners", "", "| Owner | Count |", "| --- | ---: |");
  for (const owner of OWNERS) {
    const count = report.summary.byOwner[owner];
    if (count > 0) lines.push(`| \`${owner}\` | ${count} |`);
  }

  lines.push("", "## Dogfood Links", "", "| Dogfood | Fixtures |", "| --- | ---: |");
  if (report.dogfoodLinks.length === 0) {
    lines.push("| - | 0 |");
  } else {
    for (const link of report.dogfoodLinks) {
      lines.push(`| \`${link.dogfoodId}\` | ${link.fixtureIds.length} |`);
    }
  }

  lines.push("", "## Recommended Next Actions", "", "| Owner | Action | Reason |", "| --- | --- | --- |");
  for (const action of report.recommendedNextActions) {
    lines.push(`| \`${action.owner}\` | ${action.action} | ${action.reason} |`);
  }

  lines.push(
    "",
    "## Top Failed Fixtures",
    "",
    "| Fixture | Vertical | Failure | Owner | Expected | Actual |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  if (report.topFailedFixtures.length === 0) {
    lines.push("| - | - | - | - | - | - |");
  } else {
    for (const failure of report.topFailedFixtures) {
      lines.push(
        `| \`${failure.id}\` | \`${failure.vertical}\` | \`${failure.failureClass}\` | \`${failure.owner}\` | ${escapeMd(failure.expected)} | ${escapeMd(failure.actual)} |`,
      );
    }
  }
  return lines.join("\n");
}

function buildCaptureBenchmarkFixtures(): CaptureBenchmarkFixture[] {
  return [
    ...buildRestaurantFixtures(),
    ...buildHotelFixtures(),
    ...buildFlightFixtures(),
    ...buildActivityFixtures(),
    ...buildTripFixtures(),
    ...buildAmbiguousFixtures(),
    ...buildRefineFixtures(),
    ...buildProfileFixtures(),
    ...buildChitchatFixtures(),
  ];
}

function buildRestaurantFixtures(): CaptureBenchmarkFixture[] {
  const seeds = [
    restaurantSeed("dogfood-japanese-zh", "帮我订一个明晚7点纽约2个人的日料", "zh", {
      city: "New York",
      date: "2026-05-08",
      time: "19:00",
      party_size: 2,
      cuisine: "Japanese",
    }, "DOG-009"),
    restaurantSeed("dogfood-chinese-zh", "帮我订一个明晚7点纽约2个人的中餐", "zh", {
      city: "New York",
      date: "2026-05-08",
      time: "19:00",
      party_size: 2,
      cuisine: "Chinese",
    }, "DOG-009"),
    restaurantSeed("dogfood-sirrah-en", "book Sirrah in New York next Thursday at 8pm for 1 person", "en", {
      restaurant_name: "Sirrah",
      city: "New York",
      date: "2026-05-14",
      time: "20:00",
      party_size: 1,
    }, "DOG-009"),
    restaurantSeed("sushi-nyc-en", "Find sushi in New York tomorrow at 8 for three", "en", {
      city: "New York",
      date: "2026-05-08",
      time: "20:00",
      party_size: 3,
      cuisine: "Sushi",
    }),
    restaurantSeed("vegan-sf-en", "Book a vegan dinner in San Francisco June 3 at 6:30 for four", "en", {
      city: "San Francisco",
      date: "2026-06-03",
      time: "18:30",
      party_size: 4,
      cuisine: "Vegan",
    }),
    restaurantSeed("thai-brooklyn-en", "Need Thai in Brooklyn Friday at 7 for 2", "en", {
      city: "Brooklyn",
      date: "2026-05-15",
      time: "19:00",
      party_size: 2,
      cuisine: "Thai",
    }),
    restaurantSeed("url-opentable-sirrah", "https://www.opentable.com/r/sirrah-new-york book this next Thursday at 8 for 1", "en", {
      restaurant_name: "Sirrah",
      city: "New York",
      date: "2026-05-14",
      time: "20:00",
      party_size: 1,
    }, "DOG-009", "mixed_url_instruction", "url"),
    restaurantSeed("screenshot-restaurant", "screenshot says OpenTable Sirrah New York, next Thursday 8pm, one guest", "en", {
      restaurant_name: "Sirrah",
      city: "New York",
      date: "2026-05-14",
      time: "20:00",
      party_size: 1,
    }, "DOG-009", "screenshot_description", "screenshot"),
  ];
  const fixtures = expandSeeds(seeds, 30, "restaurant");
  fixtures.push(
    urlOnlyFixture("restaurant-url-review-01", "https://www.opentable.com/r/sirrah-new-york", "restaurant", "DOG-009"),
    missingFixture("restaurant-missing-time-01", "Find Chinese food in New York tomorrow for 2", "restaurant", {
      restaurant: { city: "New York", date: "2026-05-08", party_size: 2, cuisine: "Chinese" },
    }, ["time"], "DOG-009"),
    missingFixture("restaurant-missing-cuisine-01", "Book dinner in New York tomorrow at 7 for 2", "restaurant", {
      restaurant: { city: "New York", date: "2026-05-08", time: "19:00", party_size: 2 },
    }, ["cuisine"], "DOG-009"),
    incompleteArtifactFixture("restaurant-artifact-gap-01", seeds[0]),
  );
  return topUpVerticalFixtures(fixtures, "restaurant", 80);
}

function buildHotelFixtures(): CaptureBenchmarkFixture[] {
  const seeds = [
    hotelSeed("dogfood-hotel-nyc-budget-zh", "帮我订一个5月20号到24号的纽约酒店，预算300一天", "zh", {
      city: "New York",
      check_in: "2026-05-20",
      check_out: "2026-05-24",
      budget_max_per_night: 300,
      guests: 1,
    }, "DOG-010"),
    hotelSeed("hotel-nyc-budget-en", "Book a New York hotel May 20 to May 24 under $300 a night", "en", {
      city: "New York",
      check_in: "2026-05-20",
      check_out: "2026-05-24",
      budget_max_per_night: 300,
      guests: 1,
    }, "DOG-010"),
    hotelSeed("hotel-pierre-direct", "Book The Pierre in New York June 10 to June 12 for 2 guests", "en", {
      hotel_name: "The Pierre",
      city: "New York",
      check_in: "2026-06-10",
      check_out: "2026-06-12",
      guests: 2,
    }),
    hotelSeed("hotel-chicago-family", "Find a Chicago hotel July 2 to July 6 for 4 guests under 250", "en", {
      city: "Chicago",
      check_in: "2026-07-02",
      check_out: "2026-07-06",
      budget_max_per_night: 250,
      guests: 4,
    }),
    hotelSeed("hotel-nights", "Need a Miami hotel from August 4 for 3 nights, two guests", "en", {
      city: "Miami",
      check_in: "2026-08-04",
      nights: 3,
      guests: 2,
    }),
    hotelSeed("hotel-url-booking", "https://www.booking.com/hotel/us/the-pierre-new-york.html check June 10 to June 12 for 2", "en", {
      hotel_name: "The Pierre",
      city: "New York",
      check_in: "2026-06-10",
      check_out: "2026-06-12",
      guests: 2,
    }, undefined, "mixed_url_instruction", "url"),
    hotelSeed("hotel-screenshot", "screenshot of Booking.com shows Park Hyatt NYC May 20-May 24 under 400", "en", {
      hotel_name: "Park Hyatt New York",
      city: "New York",
      check_in: "2026-05-20",
      check_out: "2026-05-24",
      budget_max_per_night: 400,
    }, "DOG-010", "screenshot_description", "screenshot"),
  ];
  const fixtures = expandSeeds(seeds, 30, "hotel");
  fixtures.push(
    urlOnlyFixture("hotel-url-review-01", "https://www.booking.com/hotel/us/the-pierre-new-york.html", "hotel"),
    missingFixture("hotel-missing-checkout-01", "Find a New York hotel on May 20 under $300", "hotel", {
      hotel: { city: "New York", check_in: "2026-05-20", budget_max_per_night: 300 },
    }, ["check_out"], "DOG-010"),
    missingFixture("hotel-missing-city-01", "Book a hotel May 20 to May 24 under $300", "hotel", {
      hotel: { check_in: "2026-05-20", check_out: "2026-05-24", budget_max_per_night: 300 },
    }, ["city"], "DOG-010"),
    incompleteArtifactFixture("hotel-artifact-gap-01", seeds[0]),
  );
  return topUpVerticalFixtures(fixtures, "hotel", 80);
}

function buildFlightFixtures(): CaptureBenchmarkFixture[] {
  const seeds = [
    flightSeed("dogfood-flight-bna-nyc-zh", "帮我订一个6月1号从Nashville到纽约的机票", "zh", {
      origin: "Nashville",
      dest: "New York",
      date: "2026-06-01",
      passengers: 1,
      is_round_trip: false,
    }),
    flightSeed("flight-bna-nyc-en", "Book a flight from Nashville to New York on June 1", "en", {
      origin: "Nashville",
      dest: "New York",
      date: "2026-06-01",
      passengers: 1,
      is_round_trip: false,
    }),
    flightSeed("flight-roundtrip", "Find a round trip from SFO to LAX June 4 returning June 8 for two", "en", {
      origin: "SFO",
      dest: "LAX",
      date: "2026-06-04",
      return_date: "2026-06-08",
      passengers: 2,
      is_round_trip: true,
    }),
    flightSeed("flight-business", "Need business class from JFK to LHR September 1 for one", "en", {
      origin: "JFK",
      dest: "LHR",
      date: "2026-09-01",
      passengers: 1,
      cabin_class: "business",
    }),
    flightSeed("flight-family", "Book 4 seats from Chicago to Orlando July 12", "en", {
      origin: "Chicago",
      dest: "Orlando",
      date: "2026-07-12",
      passengers: 4,
    }),
    flightSeed("flight-url-expedia", "https://www.expedia.com/Flights Nashville to New York June 1 one passenger", "en", {
      origin: "Nashville",
      dest: "New York",
      date: "2026-06-01",
      passengers: 1,
    }, "mixed_url_instruction", "url"),
    flightSeed("flight-screenshot", "screenshot of Expedia flight card: BNA to NYC, Jun 1, 1 passenger", "en", {
      origin: "BNA",
      dest: "NYC",
      date: "2026-06-01",
      passengers: 1,
    }, "screenshot_description", "screenshot"),
  ];
  const fixtures = expandSeeds(seeds, 30, "flight");
  fixtures.push(
    urlOnlyFixture("flight-url-review-01", "https://www.expedia.com/Flights", "flight"),
    missingFixture("flight-missing-origin-01", "Book a flight to New York on June 1", "flight", {
      flight: { dest: "New York", date: "2026-06-01", passengers: 1 },
    }, ["origin"]),
    missingFixture("flight-missing-date-01", "Book a flight from Nashville to New York", "flight", {
      flight: { origin: "Nashville", dest: "New York", passengers: 1 },
    }, ["departure_date"]),
    incompleteArtifactFixture("flight-artifact-gap-01", seeds[0]),
  );
  return topUpVerticalFixtures(fixtures, "flight", 80);
}

function buildActivityFixtures(): CaptureBenchmarkFixture[] {
  const seeds = [
    activitySeed("dogfood-lion-king-zh", "帮我预定一个纽约6月1号的百老汇狮子王看看", "zh", {
      event_name: "The Lion King",
      event_type: "theater",
      city: "New York",
      event_date: "2026-06-01",
      num_tickets: 1,
    }, "DOG-005"),
    activitySeed("dogfood-lion-king-en", "book The Lion King in New York on June 1", "en", {
      event_name: "The Lion King",
      event_type: "theater",
      city: "New York",
      event_date: "2026-06-01",
      num_tickets: 1,
    }, "DOG-005"),
    activitySeed("activity-hamilton", "Book Hamilton in New York on May 30 for 2 tickets", "en", {
      event_name: "Hamilton",
      event_type: "theater",
      city: "New York",
      event_date: "2026-05-30",
      num_tickets: 2,
    }),
    activitySeed("activity-knicks", "Find Knicks tickets at MSG March 2 for two", "en", {
      event_name: "Knicks",
      event_type: "sports",
      city: "New York",
      event_date: "2027-03-02",
      num_tickets: 2,
    }),
    activitySeed("activity-concert", "Need Taylor Swift tickets in Los Angeles October 10 under 300 each", "en", {
      event_name: "Taylor Swift",
      event_type: "concert",
      city: "Los Angeles",
      event_date: "2026-10-10",
      budget_max_per_ticket: 300,
      num_tickets: 1,
    }),
    activitySeed("activity-url-ticketmaster", "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581 June 1 one ticket", "en", {
      event_name: "The Lion King",
      event_type: "theater",
      city: "New York",
      event_date: "2026-06-01",
      num_tickets: 1,
    }, "DOG-005", "mixed_url_instruction", "url"),
    activitySeed("activity-screenshot", "screenshot shows Ticketmaster The Lion King New York June 1", "en", {
      event_name: "The Lion King",
      event_type: "theater",
      city: "New York",
      event_date: "2026-06-01",
      num_tickets: 1,
    }, "DOG-005", "screenshot_description", "screenshot"),
  ];
  const fixtures = expandSeeds(seeds, 30, "activity");
  fixtures.push(
    urlOnlyFixture("activity-url-review-01", "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581", "activity", "DOG-005"),
    missingFixture("activity-missing-date-01", "Book The Lion King in New York", "activity", {
      activity: { event_name: "The Lion King", event_type: "theater", city: "New York", num_tickets: 1 },
    }, ["event_date"], "DOG-005"),
    missingFixture("activity-missing-city-01", "Book The Lion King on June 1", "activity", {
      activity: { event_name: "The Lion King", event_type: "theater", event_date: "2026-06-01", num_tickets: 1 },
    }, ["city"], "DOG-005"),
    incompleteArtifactFixture("activity-artifact-gap-01", seeds[0]),
  );
  return topUpVerticalFixtures(fixtures, "activity", 80);
}

function buildTripFixtures(): CaptureBenchmarkFixture[] {
  const seeds = [
    tripSeed("trip-nyc-package", "Plan a New York trip June 1 to June 4 for two with hotel, flights, food, and Lion King", "en", {
      destination_city: "New York",
      departure_city: "Nashville",
      start_date: "2026-06-01",
      end_date: "2026-06-04",
      travelers: 2,
      activities: ["The Lion King"],
      cuisine_preferences: ["Japanese"],
    }),
    tripSeed("trip-zh-package", "帮我做一个6月1到4号纽约旅行计划，两个人，从Nashville出发", "zh", {
      destination_city: "New York",
      departure_city: "Nashville",
      start_date: "2026-06-01",
      end_date: "2026-06-04",
      travelers: 2,
    }),
    tripSeed("trip-url-mixed", "https://www.nycgo.com/ things to do plus hotel and flights June 1-4 for two", "en", {
      destination_city: "New York",
      departure_city: "Nashville",
      start_date: "2026-06-01",
      end_date: "2026-06-04",
      travelers: 2,
    }, "mixed_url_instruction", "url"),
    tripSeed("trip-screenshot", "screenshot description: NYC weekend itinerary with hotel, flights, dinner, Broadway", "en", {
      destination_city: "New York",
      departure_city: "Nashville",
      start_date: "2026-06-01",
      end_date: "2026-06-04",
      travelers: 2,
    }, "screenshot_description", "screenshot"),
    tripSeed("trip-group", "Create a room for Alice and me to decide a New York weekend June 1-4", "en", {
      destination_city: "New York",
      departure_city: "Nashville",
      start_date: "2026-06-01",
      end_date: "2026-06-04",
      travelers: 2,
    }, "group_decision_request", "request", "create_room", ["Alice"]),
  ];
  const fixtures = expandSeeds(seeds, 26, "trip");
  fixtures.push(
    missingTripFixture("trip-missing-dates-01", "Plan a New York trip for two", ["date_range"]),
    missingTripFixture("trip-missing-travelers-01", "Plan a New York trip June 1 to June 4", ["traveler_count"]),
  );
  return topUpVerticalFixtures(fixtures, "trip", 80);
}

function buildAmbiguousFixtures(): CaptureBenchmarkFixture[] {
  const fixtures: CaptureBenchmarkFixture[] = [];
  const inputs = [
    "I want something fun in New York",
    "NYC June 1 for two",
    "Maybe a weekend away with friends",
    "帮我看看纽约有什么可以订的",
    "screenshot with restaurants and hotels but no dates",
    "https://www.nycgo.com/",
  ];
  for (let i = 0; i < 18; i += 1) {
    const input = inputs[i % inputs.length];
    fixtures.push(baseFixture({
      id: `ambiguous-${pad(i + 1)}`,
      input: `${input}${i >= inputs.length ? ` #${i + 1}` : ""}`,
      locale: input.startsWith("帮") ? "zh" : "en",
      vertical: "ambiguous",
      sourceShape: input.includes("screenshot")
        ? "screenshot_description"
        : input.includes("http")
          ? "pasted_url"
          : "vague_inspiration",
      expectedObjectType: input.includes("screenshot")
        ? "travel_screenshot"
        : input.includes("http")
          ? "travel_link"
          : "needs_clarification",
      expectedScenario: input.includes("http") ? null : null,
      expectedCategories: [],
      expectedSourceType: input.includes("http") ? "url" : input.includes("screenshot") ? "screenshot" : "request",
      expectedEntityPaths: {},
      expectedActionTypes: ["save", "ask_clarification"],
      expectedTaskReadiness: {
        ready: false,
        reason: input.includes("http") || input.includes("screenshot") ? "needs_review" : "unsupported_source",
        missing: ["categories"],
      },
      owner: "nlu",
      expectedFailureClass: "none",
      parserState: state({ intent: "create_plan", categories: [], scenario: null, confidence: 0.5 }),
    }));
  }
  return topUpVerticalFixtures(fixtures, "ambiguous", 50);
}

function buildRefineFixtures(): CaptureBenchmarkFixture[] {
  const fixtures: CaptureBenchmarkFixture[] = [];
  const scenarios: Array<{ scenario: NluScenario; categories: NluCategory[]; input: string; fields: Partial<IntentState> }> = [
    {
      scenario: "restaurant",
      categories: ["restaurant"],
      input: "Actually make it Chinese instead of Japanese",
      fields: { restaurant: { cuisine: "Chinese" } },
    },
    {
      scenario: "hotel",
      categories: ["hotel"],
      input: "Can you lower the hotel budget to 250 a night?",
      fields: { hotel: { budget_max_per_night: 250 } },
    },
    {
      scenario: "flight",
      categories: ["flight"],
      input: "Move the flight to the morning if possible",
      fields: { flight: { earliest_departure: "06:00", latest_departure: "11:00" } },
    },
    {
      scenario: "activity",
      categories: ["activity"],
      input: "Change the tickets to two seats together",
      fields: { activity: { num_tickets: 2, section_preferences: ["together"] } },
    },
  ];
  for (let i = 0; i < 14; i += 1) {
    const seed = scenarios[i % scenarios.length];
    fixtures.push(baseFixture({
      id: `refine-${pad(i + 1)}`,
      input: `${seed.input}${i >= scenarios.length ? ` #${i + 1}` : ""}`,
      locale: "en",
      vertical: "refine",
      sourceShape: "plain_natural_language",
      expectedObjectType: "refine_request",
      expectedScenario: seed.scenario,
      expectedCategories: seed.categories,
      expectedSourceType: "request",
      expectedEntityPaths: {},
      expectedActionTypes: ["save", "preview_task"],
      expectedTaskReadiness: { ready: false, reason: "needs_review", missing: [] },
      owner: "planner",
      expectedFailureClass: "none",
      parserState: state({
        intent: "refine_existing",
        scenario: seed.scenario,
        categories: seed.categories,
        refined_target_id: `task_${i + 1}`,
        ...seed.fields,
      }),
    }));
  }
  return topUpVerticalFixtures(fixtures, "refine", 50);
}

function buildProfileFixtures(): CaptureBenchmarkFixture[] {
  const fixtures: CaptureBenchmarkFixture[] = [];
  const inputs = [
    "Remember that I prefer aisle seats",
    "Save my home airport as BNA",
    "I usually prefer boutique hotels",
    "记住我喜欢安静一点的酒店",
    "For restaurants, I prefer spicy Chinese food",
  ];
  for (let i = 0; i < 12; i += 1) {
    const input = inputs[i % inputs.length];
    fixtures.push(baseFixture({
      id: `profile-${pad(i + 1)}`,
      input: `${input}${i >= inputs.length ? ` #${i + 1}` : ""}`,
      locale: input.includes("记") ? "zh" : "en",
      vertical: "profile",
      sourceShape: "plain_natural_language",
      expectedObjectType: "profile_or_preference",
      expectedScenario: null,
      expectedCategories: [],
      expectedSourceType: "request",
      expectedEntityPaths: {},
      expectedActionTypes: ["save", "ask_clarification"],
      expectedTaskReadiness: { ready: false, reason: "unsupported_source", missing: ["categories"] },
      owner: "alpha-ops",
      expectedFailureClass: "none",
      parserState: state({
        intent: "profile_edit",
        scenario: null,
        categories: [],
        profile_patch: i % 2 === 0 ? { country: "US" } : undefined,
      }),
    }));
  }
  return topUpVerticalFixtures(fixtures, "profile", 30);
}

function buildChitchatFixtures(): CaptureBenchmarkFixture[] {
  const inputs = [
    "hello",
    "thanks",
    "what can you do?",
    "你好",
    "are you online?",
    "tell me a joke",
    "I am just browsing",
    "maybe later",
  ];
  const fixtures = inputs.map((input, index) =>
    baseFixture({
      id: `chitchat-${pad(index + 1)}`,
      input,
      locale: input === "你好" ? "zh" : "en",
      vertical: "chitchat",
      sourceShape: "plain_natural_language",
      expectedObjectType: "non_task",
      expectedScenario: null,
      expectedCategories: [],
      expectedSourceType: "request",
      expectedEntityPaths: {},
      expectedActionTypes: ["save", "ask_clarification"],
      expectedTaskReadiness: { ready: false, reason: "unsupported_source", missing: ["categories"] },
      owner: "product/manual-boundary",
      expectedFailureClass: "none",
      parserState: state({ intent: "chitchat", scenario: null, categories: [] }),
    }),
  );
  return topUpVerticalFixtures(fixtures, "chitchat", 20);
}

function topUpVerticalFixtures(
  fixtures: CaptureBenchmarkFixture[],
  vertical: CaptureBenchmarkVertical,
  minimum: number,
): CaptureBenchmarkFixture[] {
  if (fixtures.length >= minimum) return fixtures;
  const needed = minimum - fixtures.length;
  return [...fixtures, ...buildGeneratedFixtures(vertical, needed, fixtures.length + 1)];
}

function buildGeneratedFixtures(
  vertical: CaptureBenchmarkVertical,
  count: number,
  start: number,
): CaptureBenchmarkFixture[] {
  const builders: Record<CaptureBenchmarkVertical, (index: number) => CaptureBenchmarkFixture> = {
    restaurant: generatedRestaurantFixture,
    hotel: generatedHotelFixture,
    flight: generatedFlightFixture,
    activity: generatedActivityFixture,
    trip: generatedTripFixture,
    ambiguous: generatedAmbiguousFixture,
    refine: generatedRefineFixture,
    profile: generatedProfileFixture,
    chitchat: generatedChitchatFixture,
  };
  return Array.from({ length: count }, (_, i) => builders[vertical](start + i));
}

function generatedRestaurantFixture(index: number): CaptureBenchmarkFixture {
  const cuisines = ["Sichuan", "Japanese", "Chinese", "Italian", "Korean", "Vegan", "Thai", "Mexican"];
  const cities = ["New York", "Brooklyn", "San Francisco", "Chicago", "Boston", "Los Angeles"];
  const times = ["18:30", "19:00", "20:00", "20:30"];
  const cuisine = cuisines[index % cuisines.length];
  const city = cities[index % cities.length];
  const time = times[index % times.length];
  const partySize = (index % 5) + 1;
  const date = `2026-06-${String((index % 20) + 1).padStart(2, "0")}`;
  if (index % 11 === 0) {
    return groupDecisionFixture({
      id: `restaurant-group-${pad(index)}`,
      input: `Create a dinner decision room with Alice for ${cuisine} in ${city} on ${date} at ${time}`,
      scenario: "restaurant",
      categories: ["restaurant"],
      fields: { restaurant: { city, date, time, party_size: partySize, cuisine } },
      note: "Locks restaurant group-decision readiness without provider execution.",
    });
  }
  return baseFixture({
    id: `restaurant-generated-${pad(index)}`,
    input: `Book ${cuisine} dinner in ${city} on ${date} at ${time} for ${partySize}`,
    locale: "en",
    vertical: "restaurant",
    sourceShape: "exact_task_ready",
    expectedObjectType: "task_intent",
    expectedScenario: "restaurant",
    expectedCategories: ["restaurant"],
    expectedSourceType: "request",
    expectedEntityPaths: criticalEntityPaths("restaurant", { city, date, time, party_size: partySize, cuisine }),
    expectedActionTypes: ["save", "create_task"],
    expectedTaskReadiness: { ready: true, reason: "ready", missing: [] },
    owner: "nlu",
    expectedFailureClass: "none",
    note: "Locks restaurant cuisine, city, date, time, and party-size preservation across varied alpha-like inputs.",
    dogfoodId: cuisine === "Sichuan" || cuisine === "Chinese" || cuisine === "Japanese" ? "DOG-009" : undefined,
    parserState: state({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: { city, date, time, party_size: partySize, cuisine },
    }),
  });
}

function generatedHotelFixture(index: number): CaptureBenchmarkFixture {
  const cities = ["New York", "Chicago", "Miami", "Seattle", "Boston", "Los Angeles"];
  const budgets = [180, 220, 250, 300, 350, 400];
  const city = cities[index % cities.length];
  const checkInDay = (index % 20) + 1;
  const checkOutDay = checkInDay + 3;
  const checkIn = `2026-07-${String(checkInDay).padStart(2, "0")}`;
  const checkOut = `2026-07-${String(checkOutDay).padStart(2, "0")}`;
  const budget = budgets[index % budgets.length];
  const guests = (index % 4) + 1;
  if (index % 13 === 0) {
    return groupDecisionFixture({
      id: `hotel-group-${pad(index)}`,
      input: `Create a room with Bob to compare ${city} hotels ${checkIn} to ${checkOut} under ${budget}`,
      scenario: "hotel",
      categories: ["hotel"],
      fields: { hotel: { city, check_in: checkIn, check_out: checkOut, budget_max_per_night: budget, guests } },
      note: "Locks hotel group-decision readiness for compare-before-booking alpha inputs.",
    });
  }
  return baseFixture({
    id: `hotel-generated-${pad(index)}`,
    input: `Find a ${city} hotel from ${checkIn} to ${checkOut} under $${budget} for ${guests} guest${guests > 1 ? "s" : ""}`,
    locale: "en",
    vertical: "hotel",
    sourceShape: "exact_task_ready",
    expectedObjectType: "task_intent",
    expectedScenario: "hotel",
    expectedCategories: ["hotel"],
    expectedSourceType: "request",
    expectedEntityPaths: criticalEntityPaths("hotel", {
      city,
      check_in: checkIn,
      check_out: checkOut,
      budget_max_per_night: budget,
    }),
    expectedActionTypes: ["save", "create_task"],
    expectedTaskReadiness: { ready: true, reason: "ready", missing: [] },
    owner: "nlu",
    expectedFailureClass: "none",
    note: "Locks hotel date-range, budget, city, and guest preservation for Stage 0 task readiness.",
    dogfoodId: city === "New York" && budget === 300 ? "DOG-010" : undefined,
    parserState: state({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: { city, check_in: checkIn, check_out: checkOut, budget_max_per_night: budget, guests },
    }),
  });
}

function generatedFlightFixture(index: number): CaptureBenchmarkFixture {
  const routes = [
    ["Nashville", "New York"],
    ["SFO", "LAX"],
    ["Chicago", "Orlando"],
    ["Boston", "Seattle"],
    ["JFK", "LHR"],
    ["Dallas", "Miami"],
  ] as const;
  const [origin, dest] = routes[index % routes.length];
  const date = `2026-08-${String((index % 20) + 1).padStart(2, "0")}`;
  const passengers = (index % 4) + 1;
  const cabin = index % 9 === 0 ? "business" : "economy";
  return baseFixture({
    id: `flight-generated-${pad(index)}`,
    input: `Book ${passengers} ${cabin} flight${passengers > 1 ? "s" : ""} from ${origin} to ${dest} on ${date}`,
    locale: "en",
    vertical: "flight",
    sourceShape: "exact_task_ready",
    expectedObjectType: "task_intent",
    expectedScenario: "flight",
    expectedCategories: ["flight"],
    expectedSourceType: "request",
    expectedEntityPaths: criticalEntityPaths("flight", { origin, dest, date, passengers, cabin_class: cabin }),
    expectedActionTypes: ["save", "create_task"],
    expectedTaskReadiness: { ready: true, reason: "ready", missing: [] },
    owner: "nlu",
    expectedFailureClass: "none",
    note: "Locks flight origin, destination, departure date, passengers, and cabin constraints.",
    parserState: state({
      scenario: "flight",
      categories: ["flight"],
      flight: { origin, dest, date, passengers, cabin_class: cabin },
    }),
  });
}

function generatedActivityFixture(index: number): CaptureBenchmarkFixture {
  const events = [
    ["The Lion King", "theater", "New York"],
    ["Hamilton", "theater", "New York"],
    ["Knicks", "sports", "New York"],
    ["Taylor Swift", "concert", "Los Angeles"],
    ["Art Institute exhibition", "exhibition", "Chicago"],
    ["Comedy Cellar", "comedy", "New York"],
  ] as const;
  const [eventName, eventType, city] = events[index % events.length];
  const date = `2026-09-${String((index % 20) + 1).padStart(2, "0")}`;
  const numTickets = (index % 4) + 1;
  return baseFixture({
    id: `activity-generated-${pad(index)}`,
    input: `Find ${numTickets} ticket${numTickets > 1 ? "s" : ""} for ${eventName} in ${city} on ${date}`,
    locale: "en",
    vertical: "activity",
    sourceShape: "exact_task_ready",
    expectedObjectType: "task_intent",
    expectedScenario: "activity",
    expectedCategories: ["activity"],
    expectedSourceType: "request",
    expectedEntityPaths: criticalEntityPaths("activity", {
      event_name: eventName,
      event_type: eventType,
      city,
      event_date: date,
      num_tickets: numTickets,
    }),
    expectedActionTypes: ["save", "create_task"],
    expectedTaskReadiness: { ready: true, reason: "ready", missing: [] },
    owner: "nlu",
    expectedFailureClass: "none",
    note: "Locks single-event activity routing away from generic trip planning.",
    dogfoodId: eventName === "The Lion King" ? "DOG-005" : undefined,
    parserState: state({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: eventName,
        event_type: eventType as NonNullable<IntentState["activity"]>["event_type"],
        city,
        event_date: date,
        num_tickets: numTickets,
      },
    }),
  });
}

function generatedTripFixture(index: number): CaptureBenchmarkFixture {
  const cities = ["New York", "Los Angeles", "Chicago", "Seattle", "Miami"];
  const city = cities[index % cities.length];
  const startDay = (index % 18) + 1;
  const startDate = `2026-10-${String(startDay).padStart(2, "0")}`;
  const endDate = `2026-10-${String(startDay + 3).padStart(2, "0")}`;
  const travelers = (index % 4) + 1;
  return baseFixture({
    id: `trip-generated-${pad(index)}`,
    input: `Plan a ${city} trip from ${startDate} to ${endDate} for ${travelers}, with flights, hotel, dinner, and one show`,
    locale: "en",
    vertical: "trip",
    sourceShape: "exact_task_ready",
    expectedObjectType: "trip_seed",
    expectedScenario: "trip",
    expectedCategories: ["hotel", "flight", "restaurant", "activity"],
    expectedSourceType: "request",
    expectedEntityPaths: criticalEntityPaths("trip", {
      destination_city: city,
      departure_city: "Nashville",
      start_date: startDate,
      end_date: endDate,
      travelers,
    }),
    expectedActionTypes: ["save", "create_task"],
    expectedTaskReadiness: { ready: true, reason: "ready", missing: [] },
    owner: "planner",
    expectedFailureClass: "none",
    note: "Locks explicit trip/package requests as trip seeds rather than single-vertical tasks.",
    parserState: state({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: completeTrip({
        destination_city: city,
        departure_city: "Nashville",
        start_date: startDate,
        end_date: endDate,
        travelers,
        activities: ["one show"],
      }),
    }),
  });
}

function generatedAmbiguousFixture(index: number): CaptureBenchmarkFixture {
  const cases = [
    {
      input: "image of a cozy Kyoto ryokan for maybe spring",
      sourceShape: "vague_inspiration" as const,
      expectedSourceType: "request" as const,
      note: "Locks bare image/photo words as normal travel text, not screenshot input.",
    },
    {
      input: "photo ideas for a New York anniversary trip",
      sourceShape: "vague_inspiration" as const,
      expectedSourceType: "request" as const,
      note: "Locks broad photo/inspiration text as clarification, not attached screenshot metadata.",
    },
    {
      input: "https://ticketmaster.com.evil.example/lion-king",
      sourceShape: "provider_url_impersonation" as const,
      expectedSourceType: "url" as const,
      note: "Rejects provider URL impersonation by keeping scenario null and requiring review.",
    },
    {
      input: "https://opentable.com.evil.example/r/sirrah",
      sourceShape: "provider_url_impersonation" as const,
      expectedSourceType: "url" as const,
      note: "Rejects restaurant provider impersonation without classifying a provider.",
    },
    {
      input: "Save this travel idea for later: quiet beach and good food",
      sourceShape: "save_only" as const,
      expectedSourceType: "request" as const,
      note: "Locks save-only vague inspiration as not task-ready.",
    },
    {
      input: "Compare a beach trip versus a Broadway weekend sometime this summer",
      sourceShape: "compare_only" as const,
      expectedSourceType: "request" as const,
      note: "Locks compare-only inspiration as clarification, not execution-ready.",
    },
  ];
  const item = cases[index % cases.length];
  return baseFixture({
    id: `ambiguous-generated-${pad(index)}`,
    input: `${item.input}${index > cases.length ? ` #${index}` : ""}`,
    locale: "en",
    vertical: "ambiguous",
    sourceShape: item.sourceShape,
    expectedObjectType: item.expectedSourceType === "url" ? "travel_link" : "needs_clarification",
    expectedScenario: null,
    expectedCategories: [],
    expectedSourceType: item.expectedSourceType,
    expectedEntityPaths: {},
    expectedActionTypes: item.expectedSourceType === "url" ? ["save", "preview_task", "ask_clarification"] : ["save", "ask_clarification"],
    expectedTaskReadiness: { ready: false, reason: item.expectedSourceType === "url" ? "needs_review" : "unsupported_source", missing: ["categories"] },
    owner: "capture",
    expectedFailureClass: "none",
    note: item.note,
    parserState: undefined,
  });
}

function generatedRefineFixture(index: number): CaptureBenchmarkFixture {
  const cases = [
    ["restaurant", ["restaurant"], "Change it to Sichuan and keep 7pm", { restaurant: { cuisine: "Sichuan", time: "19:00" } }],
    ["hotel", ["hotel"], "Actually make the hotel budget 350 and keep the same dates", { hotel: { budget_max_per_night: 350 } }],
    ["flight", ["flight"], "Prefer nonstop flights only", { flight: { max_stops: 0 } }],
    ["activity", ["activity"], "Make the Broadway tickets two seats together", { activity: { num_tickets: 2, section_preferences: ["together"] as string[] } }],
  ] as const;
  const [scenario, categories, input, fields] = cases[index % cases.length];
  return baseFixture({
    id: `refine-generated-${pad(index)}`,
    input: `${input}${index > cases.length ? ` #${index}` : ""}`,
    locale: "en",
    vertical: "refine",
    sourceShape: "plain_natural_language",
    expectedObjectType: "refine_request",
    expectedScenario: scenario,
    expectedCategories: [...categories],
    expectedSourceType: "request",
    expectedEntityPaths: {},
    expectedActionTypes: ["save", "preview_task"],
    expectedTaskReadiness: { ready: false, reason: "needs_review", missing: [] },
    owner: "planner",
    expectedFailureClass: "none",
    note: "Locks follow-up/refine text as plan modification context, not a new provider run.",
    parserState: state({
      intent: "refine_existing",
      scenario,
      categories: [...categories],
      refined_target_id: `task_refine_${index}`,
      ...fields,
    }),
  });
}

function generatedProfileFixture(index: number): CaptureBenchmarkFixture {
  const inputs = [
    "Remember I prefer aisle seats and morning flights",
    "Save that I like boutique hotels near transit",
    "I usually want spicy Sichuan or Japanese restaurants",
    "记住我不喜欢红眼航班",
  ];
  const input = inputs[index % inputs.length];
  return baseFixture({
    id: `profile-generated-${pad(index)}`,
    input: `${input}${index > inputs.length ? ` #${index}` : ""}`,
    locale: input.startsWith("记") ? "zh" : "en",
    vertical: "profile",
    sourceShape: "save_only",
    expectedObjectType: "profile_or_preference",
    expectedScenario: null,
    expectedCategories: [],
    expectedSourceType: "request",
    expectedEntityPaths: {},
    expectedActionTypes: ["save", "ask_clarification"],
    expectedTaskReadiness: { ready: false, reason: "unsupported_source", missing: ["categories"] },
    owner: "alpha-ops",
    expectedFailureClass: "none",
    note: "Locks preference/profile updates as save-only capture input, not booking tasks.",
    parserState: state({ intent: "profile_edit", scenario: null, categories: [], profile_patch: { country: "US" } }),
  });
}

function generatedChitchatFixture(index: number): CaptureBenchmarkFixture {
  const inputs = [
    "can you help with travel?",
    "not sure yet",
    "tell me how Onegent works",
    "谢谢，先不用了",
    "unsupported: renew my passport",
    "unsupported: apply for a visa",
  ];
  const input = inputs[index % inputs.length];
  return baseFixture({
    id: `chitchat-generated-${pad(index)}`,
    input: `${input}${index > inputs.length ? ` #${index}` : ""}`,
    locale: input.match(/[谢谢先不用]/u) ? "zh" : "en",
    vertical: "chitchat",
    sourceShape: "plain_natural_language",
    expectedObjectType: "non_task",
    expectedScenario: null,
    expectedCategories: [],
    expectedSourceType: "request",
    expectedEntityPaths: {},
    expectedActionTypes: ["save", "ask_clarification"],
    expectedTaskReadiness: { ready: false, reason: "unsupported_source", missing: ["categories"] },
    owner: "product/manual-boundary",
    expectedFailureClass: "none",
    note: "Locks chitchat or unsupported adjacent requests out of task/provider execution.",
    parserState: state({ intent: "chitchat", scenario: null, categories: [] }),
  });
}

function groupDecisionFixture(input: {
  id: string;
  input: string;
  scenario: Exclude<NluScenario, "trip">;
  categories: NluCategory[];
  fields: Partial<Pick<IntentState, "restaurant" | "hotel" | "flight" | "activity">>;
  note: string;
}): CaptureBenchmarkFixture {
  return baseFixture({
    id: input.id,
    input: input.input,
    locale: "en",
    vertical: input.scenario,
    sourceShape: "group_decision_request",
    expectedObjectType: "group_decision",
    expectedScenario: input.scenario,
    expectedCategories: input.categories,
    expectedSourceType: "request",
    expectedEntityPaths: {},
    expectedActionTypes: ["save", "create_room"],
    expectedTaskReadiness: { ready: true, reason: "ready", missing: [] },
    owner: "planner",
    expectedFailureClass: "none",
    note: input.note,
    parserState: state({
      intent: "create_room",
      scenario: input.scenario,
      categories: input.categories,
      party_type: "multi",
      member_names: ["Alice"],
      ...input.fields,
    }),
  });
}

type BaseSeed = Omit<CaptureBenchmarkFixture, "id" | "artifactContract" | "note"> & {
  id: string;
  note?: string;
  artifactContract?: CaptureBenchmarkArtifactContract;
};

function restaurantSeed(
  slug: string,
  input: string,
  locale: "en" | "zh",
  restaurant: NonNullable<IntentState["restaurant"]>,
  dogfoodId?: string,
  sourceShape: CaptureBenchmarkSourceShape = "exact_task_ready",
  expectedSourceType: CaptureSourceType = "request",
): BaseSeed {
  return seedFixture({
    id: slug,
    input,
    locale,
    vertical: "restaurant",
    sourceShape,
    expectedObjectType: sourceShape === "screenshot_description" ? "travel_screenshot" : sourceShape.includes("url") ? "travel_link" : "task_intent",
    expectedScenario: "restaurant",
    expectedCategories: ["restaurant"],
    expectedSourceType,
    expectedEntityPaths: criticalEntityPaths("restaurant", restaurant),
    expectedActionTypes: ["save", "create_task"],
    expectedTaskReadiness: { ready: true, reason: "ready", missing: [] },
    owner: "nlu",
    expectedFailureClass: "none",
    dogfoodId,
    parserState: state({ scenario: "restaurant", categories: ["restaurant"], restaurant }),
  });
}

function hotelSeed(
  slug: string,
  input: string,
  locale: "en" | "zh",
  hotel: NonNullable<IntentState["hotel"]>,
  dogfoodId?: string,
  sourceShape: CaptureBenchmarkSourceShape = "exact_task_ready",
  expectedSourceType: CaptureSourceType = "request",
): BaseSeed {
  return seedFixture({
    id: slug,
    input,
    locale,
    vertical: "hotel",
    sourceShape,
    expectedObjectType: sourceShape === "screenshot_description" ? "travel_screenshot" : sourceShape.includes("url") ? "travel_link" : "task_intent",
    expectedScenario: "hotel",
    expectedCategories: ["hotel"],
    expectedSourceType,
    expectedEntityPaths: criticalEntityPaths("hotel", hotel),
    expectedActionTypes: ["save", "create_task"],
    expectedTaskReadiness: { ready: true, reason: "ready", missing: [] },
    owner: "nlu",
    expectedFailureClass: "none",
    dogfoodId,
    parserState: state({ scenario: "hotel", categories: ["hotel"], hotel }),
  });
}

function flightSeed(
  slug: string,
  input: string,
  locale: "en" | "zh",
  flight: NonNullable<IntentState["flight"]>,
  sourceShape: CaptureBenchmarkSourceShape = "exact_task_ready",
  expectedSourceType: CaptureSourceType = "request",
): BaseSeed {
  return seedFixture({
    id: slug,
    input,
    locale,
    vertical: "flight",
    sourceShape,
    expectedObjectType: sourceShape === "screenshot_description" ? "travel_screenshot" : sourceShape.includes("url") ? "travel_link" : "task_intent",
    expectedScenario: "flight",
    expectedCategories: ["flight"],
    expectedSourceType,
    expectedEntityPaths: criticalEntityPaths("flight", flight),
    expectedActionTypes: ["save", "create_task"],
    expectedTaskReadiness: { ready: true, reason: "ready", missing: [] },
    owner: "nlu",
    expectedFailureClass: "none",
    parserState: state({ scenario: "flight", categories: ["flight"], flight }),
  });
}

function activitySeed(
  slug: string,
  input: string,
  locale: "en" | "zh",
  activity: NonNullable<IntentState["activity"]>,
  dogfoodId?: string,
  sourceShape: CaptureBenchmarkSourceShape = "exact_task_ready",
  expectedSourceType: CaptureSourceType = "request",
): BaseSeed {
  return seedFixture({
    id: slug,
    input,
    locale,
    vertical: "activity",
    sourceShape,
    expectedObjectType: sourceShape === "screenshot_description" ? "travel_screenshot" : sourceShape.includes("url") ? "travel_link" : "task_intent",
    expectedScenario: "activity",
    expectedCategories: ["activity"],
    expectedSourceType,
    expectedEntityPaths: criticalEntityPaths("activity", activity),
    expectedActionTypes: ["save", "create_task"],
    expectedTaskReadiness: { ready: true, reason: "ready", missing: [] },
    owner: "nlu",
    expectedFailureClass: "none",
    dogfoodId,
    parserState: state({ scenario: "activity", categories: ["activity"], activity }),
  });
}

function tripSeed(
  slug: string,
  input: string,
  locale: "en" | "zh",
  trip: Partial<NonNullable<IntentState["trip"]>>,
  sourceShape: CaptureBenchmarkSourceShape = "exact_task_ready",
  expectedSourceType: CaptureSourceType = "request",
  intent: IntentState["intent"] = "create_plan",
  memberNames: string[] = [],
): BaseSeed {
  const fullTrip = completeTrip(trip);
  return seedFixture({
    id: slug,
    input,
    locale,
    vertical: "trip",
    sourceShape,
    expectedObjectType: sourceShape === "screenshot_description" ? "travel_screenshot" : expectedSourceType === "url" ? "travel_link" : "trip_seed",
    expectedScenario: "trip",
    expectedCategories: ["hotel", "flight", "restaurant", "activity"],
    expectedSourceType,
    expectedEntityPaths: criticalEntityPaths("trip", fullTrip),
    expectedActionTypes: ["save", intent === "create_room" ? "create_room" : "create_task"],
    expectedTaskReadiness: { ready: true, reason: "ready", missing: [] },
    owner: "planner",
    expectedFailureClass: "none",
    parserState: state({
      intent,
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      party_type: intent === "create_room" ? "multi" : "solo",
      member_names: memberNames,
      trip: fullTrip,
    }),
  });
}

function seedFixture(seed: BaseSeed): BaseSeed {
  return seed;
}

function expandSeeds(seeds: BaseSeed[], count: number, vertical: CaptureBenchmarkVertical): CaptureBenchmarkFixture[] {
  const fixtures: CaptureBenchmarkFixture[] = [];
  for (let i = 0; i < count; i += 1) {
    const seed = seeds[i % seeds.length];
    fixtures.push(baseFixture({
      ...seed,
      id: `${vertical}-${seed.id}-${pad(Math.floor(i / seeds.length) + 1)}`,
      input: i < seeds.length ? seed.input : `${seed.input} (${vertical} fixture ${i + 1})`,
    }));
  }
  return fixtures;
}

function urlOnlyFixture(
  id: string,
  input: string,
  expectedScenario: Extract<NluScenario, "restaurant" | "hotel" | "flight" | "activity">,
  dogfoodId?: string,
): CaptureBenchmarkFixture {
  return baseFixture({
    id,
    input,
    locale: "en",
    vertical: expectedScenario,
    sourceShape: "pasted_url",
    expectedObjectType: "travel_link",
    expectedScenario,
    expectedCategories: [expectedScenario],
    expectedSourceType: "url",
    expectedEntityPaths: {},
    expectedActionTypes: ["save", "preview_task"],
    expectedTaskReadiness: { ready: false, reason: "needs_review", missing: [] },
    owner: "capture",
    expectedFailureClass: "none",
    dogfoodId,
    parserState: undefined,
  });
}

function missingFixture(
  id: string,
  input: string,
  scenario: Exclude<NluScenario, "trip">,
  fields: Partial<Pick<IntentState, "restaurant" | "hotel" | "flight" | "activity">>,
  missing: string[],
  dogfoodId?: string,
): CaptureBenchmarkFixture {
  return baseFixture({
    id,
    input,
    locale: input.startsWith("帮") ? "zh" : "en",
    vertical: scenario,
    sourceShape: "plain_natural_language",
    expectedObjectType: "needs_clarification",
    expectedScenario: scenario,
    expectedCategories: [scenario],
    expectedSourceType: "request",
    expectedEntityPaths: {},
    expectedActionTypes: ["save", "ask_clarification"],
    expectedTaskReadiness: { ready: false, reason: "missing_fields", missing },
    owner: "planner",
    expectedFailureClass: "none",
    dogfoodId,
    parserState: state({ scenario, categories: [scenario], ...fields }),
  });
}

function missingTripFixture(id: string, input: string, missing: string[]): CaptureBenchmarkFixture {
  return baseFixture({
    id,
    input,
    locale: "en",
    vertical: "trip",
    sourceShape: "vague_inspiration",
    expectedObjectType: "needs_clarification",
    expectedScenario: "trip",
    expectedCategories: ["hotel", "flight", "restaurant", "activity"],
    expectedSourceType: "request",
    expectedEntityPaths: {},
    expectedActionTypes: ["save", "ask_clarification"],
    expectedTaskReadiness: { ready: false, reason: "missing_fields", missing },
    owner: "planner",
    expectedFailureClass: "none",
    parserState: state({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: {
        destination_city: "New York",
        departure_city: "Nashville",
        start_date: missing.includes("date_range") ? undefined : "2026-06-01",
        end_date: missing.includes("date_range") ? undefined : "2026-06-04",
        travelers: missing.includes("traveler_count") ? undefined : 2,
        activities: [],
        cuisine_preferences: [],
        vibe: "mixed",
        planning_assumptions: [],
      },
    }),
  });
}

function incompleteArtifactFixture(id: string, seed: BaseSeed): CaptureBenchmarkFixture {
  return baseFixture({
    ...seed,
    id,
    expectedFailureClass: "artifact_incomplete",
    owner: "task-workspace",
    artifactContract: {
      syntheticMarker: true,
      fixtureIdPresent: true,
      sourceMetadataPreserved: true,
      entitiesPreserved: true,
      taskReadinessChecked: false,
      evidenceRequired: ["fixture_id", "source", "entities", "task_readiness"],
    },
  });
}

function baseFixture(input: BaseSeed & { artifactContract?: CaptureBenchmarkArtifactContract }): CaptureBenchmarkFixture {
  return {
    ...input,
    note: input.note ?? defaultFixtureNote(input),
    artifactContract: input.artifactContract ?? completeArtifact(input.id),
  };
}

function defaultFixtureNote(input: BaseSeed): string {
  const scenario = input.expectedScenario ?? input.vertical;
  return `Locks ${scenario} ${input.sourceShape} capture behavior as ${input.expectedObjectType}.`;
}

function completeArtifact(fixtureId: string): CaptureBenchmarkArtifactContract {
  return {
    syntheticMarker: true,
    fixtureIdPresent: fixtureId.length > 0,
    sourceMetadataPreserved: true,
    entitiesPreserved: true,
    taskReadinessChecked: true,
    evidenceRequired: ["fixture_id", "source", "entities", "task_readiness"],
  };
}

function state(overrides: Partial<IntentState>): IntentState {
  return {
    confidence: 0.92,
    turn_count: 1,
    updated_at: CAPTURED_AT,
    intent: "create_plan",
    scenario: null,
    categories: [],
    party_type: "solo",
    member_names: [],
    refined_target_id: null,
    planning_assumptions: [],
    ...overrides,
  };
}

function buildNluResult(fixture: CaptureBenchmarkFixture): NluV2ParseResult {
  const parserState = fixture.parserState;
  if (!parserState) {
    return {
      intent: "unknown",
      scenario: null,
      categories: [],
      party_type: "solo",
      member_names: [],
      collected_constraints: {},
      missing_fields: [],
      suggested_clarify_question: null,
      suggested_quick_picks: null,
      confirm_ready: false,
      refined_target_id: null,
      assistant_reply: null,
    };
  }
  const action = routeIntent(parserState);
  const missing = action.type === "ask_clarification" ? action.missing : [];
  return {
    intent: parserState.intent,
    scenario: parserState.scenario,
    categories: parserState.categories,
    party_type: parserState.party_type,
    member_names: parserState.member_names,
    collected_constraints: flattenScenarioFields(parserState),
    missing_fields: missing,
    suggested_clarify_question: action.type === "ask_clarification" ? "Need one more detail." : null,
    suggested_quick_picks: action.type === "ask_clarification" ? action.suggested_quick_picks ?? null : null,
    confirm_ready: action.type === "show_confirm_card",
    refined_target_id: parserState.refined_target_id,
    assistant_reply: "Synthetic no-live capture benchmark result.",
    ...(action.type === "show_confirm_card" && action.directBooking ? { direct_booking: true } : {}),
    __v2_state: parserState,
    __v2_action: action,
  };
}

function summarizeCaptureBenchmark(results: CaptureBenchmarkResult[]): CaptureBenchmarkSummary {
  const byVertical = { ...ZERO_VERTICALS };
  const bySourceShape = { ...ZERO_SOURCES };
  const byFailureClass = { ...ZERO_FAILURES };
  const byOwner = { ...ZERO_OWNERS };
  let taskReadyCorrect = 0;
  let sourceMetadataComplete = 0;
  let artifactComplete = 0;

  for (const result of results) {
    byVertical[result.vertical] += 1;
    bySourceShape[result.sourceShape] += 1;
    byFailureClass[result.failureClass] += 1;
    byOwner[result.owner] += 1;
    if (result.taskReadinessPass) taskReadyCorrect += 1;
    if (result.sourceMetadataComplete) sourceMetadataComplete += 1;
    if (result.artifactComplete) artifactComplete += 1;
  }

  const total = results.length;
  const pass = results.filter((result) => result.pass).length;
  return {
    total,
    pass,
    fail: total - pass,
    successRate: safeRate(pass, total),
    routingMismatchCount: results.filter((result) => !result.routingPass).length,
    taskReadyAccuracy: safeRate(taskReadyCorrect, total),
    sourceMetadataCompletenessRate: safeRate(sourceMetadataComplete, total),
    artifactCompletenessRate: safeRate(artifactComplete, total),
    unknownFailureRate: safeRate(results.filter((result) => result.failureClass === "unknown_failure").length, total),
    byVertical,
    bySourceShape,
    byFailureClass,
    byOwner,
  };
}

function topFailedFixtures(results: CaptureBenchmarkResult[]): CaptureBenchmarkTopFailure[] {
  return results
    .filter((result) => !result.pass)
    .slice(0, 10)
    .map((result) => ({
      id: result.id,
      vertical: result.vertical,
      sourceShape: result.sourceShape,
      input: result.input,
      expected: `${result.expectedScenario ?? "null"} / ${result.expectedReadinessReason}`,
      actual: `${result.actualScenario ?? "null"} / ${result.actualReadinessReason}`,
      failureClass: result.failureClass,
      owner: result.owner,
      dogfoodId: result.dogfoodId,
      notes: result.notes,
    }));
}

function dogfoodLinks(results: CaptureBenchmarkResult[]): CaptureBenchmarkReport["dogfoodLinks"] {
  const byDogfood = new Map<string, string[]>();
  for (const result of results) {
    if (!result.dogfoodId) continue;
    const list = byDogfood.get(result.dogfoodId) ?? [];
    list.push(result.id);
    byDogfood.set(result.dogfoodId, list);
  }
  return Array.from(byDogfood.entries())
    .map(([dogfoodId, fixtureIds]) => ({ dogfoodId, fixtureIds }))
    .sort((a, b) => a.dogfoodId.localeCompare(b.dogfoodId));
}

function recommendedNextActions(results: CaptureBenchmarkResult[]): CaptureBenchmarkReport["recommendedNextActions"] {
  const failed = results.filter((result) => !result.pass);
  const byOwner = new Map<CaptureBenchmarkOwner, CaptureBenchmarkResult[]>();
  for (const result of failed) {
    const list = byOwner.get(result.owner) ?? [];
    list.push(result);
    byOwner.set(result.owner, list);
  }
  const actions = Array.from(byOwner.entries()).map(([owner, ownerResults]) => ({
    owner,
    action: actionForOwner(owner),
    reason: `${ownerResults.length} failing capture fixture(s), top class ${ownerResults[0]?.failureClass ?? "none"}.`,
  }));
  if (!actions.some((action) => action.owner === "alpha-ops")) {
    actions.push({
      owner: "alpha-ops",
      action: "Keep collecting high-intent submissions and convert safe misses into benchmark seeds.",
      reason: "No-live capture coverage is healthy, but private alpha still needs real user-value evidence.",
    });
  }
  return actions.slice(0, 8);
}

function actionForOwner(owner: CaptureBenchmarkOwner): string {
  switch (owner) {
    case "nlu":
      return "Patch parser/router fixture class before adding more provider work.";
    case "planner":
      return "Tighten missing-field and Travel Object readiness rules.";
    case "task-workspace":
      return "Close artifact-contract gaps for source, entities, readiness, and evidence links.";
    case "capture":
      return "Harden source metadata classification and provider URL validation.";
    case "task-readiness":
      return "Review task-ready versus needs-review decisions.";
    case "provider-runtime":
      return "Do not run providers; convert this into a no-live runtime fixture first.";
    case "product/manual-boundary":
      return "Clarify product boundary and safe next action copy.";
    case "alpha-ops":
    default:
      return "Ask a safe follow-up and convert the submission into a benchmark seed only after clarification.";
  }
}

function classifyCaptureFailure(input: {
  fixture: CaptureBenchmarkFixture;
  routingPass: boolean;
  taskReadinessPass: boolean;
  sourceMetadataComplete: boolean;
  artifactComplete: boolean;
  notes: string[];
}): CaptureBenchmarkFailureClass {
  if (!input.routingPass) return "routing_mismatch";
  if (!input.taskReadinessPass) return "task_readiness_mismatch";
  if (!input.sourceMetadataComplete) return "source_metadata_incomplete";
  if (!input.artifactComplete) return "artifact_incomplete";
  if (input.notes.some((note) => note.includes("expected"))) return "constraint_lost";
  return input.fixture.expectedFailureClass === "artifact_incomplete"
    ? "artifact_incomplete"
    : input.fixture.expectedFailureClass;
}

function classifyCaptureObject(capture: CaptureTravelObject): CaptureBenchmarkObjectType {
  if (capture.source.type === "url") return "travel_link";
  if (capture.source.type === "screenshot") return "travel_screenshot";
  if (capture.provenance.nlu_state?.intent === "refine_existing") return "refine_request";
  if (capture.provenance.nlu_state?.intent === "profile_edit") return "profile_or_preference";
  if (!capture.classification.scenario) {
    return capture.provenance.nlu_state?.intent === "chitchat" ? "non_task" : "needs_clarification";
  }
  if (!capture.task_readiness.ready) return "needs_clarification";
  if (capture.classification.scenario === "trip") return "trip_seed";
  if (capture.possible_actions.some((action) => action.type === "create_room")) return "group_decision";
  return "task_intent";
}

function isSourceMetadataComplete(capture: CaptureTravelObject, fixture: CaptureBenchmarkFixture): boolean {
  if (capture.source.type !== fixture.expectedSourceType) return false;
  if (capture.source.captured_at !== CAPTURED_AT) return false;
  if (fixture.expectedSourceType === "url") return Boolean(capture.source.url && capture.source.host);
  return capture.source.raw_text === fixture.input;
}

function criticalEntityPaths(scenario: NluScenario, fields: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const record = fields as Record<string, unknown>;
  const important: Record<NluScenario, string[]> = {
    restaurant: ["restaurant_name", "city", "date", "time", "party_size", "cuisine"],
    hotel: ["hotel_name", "city", "check_in", "check_out", "nights", "budget_max_per_night"],
    flight: ["origin", "dest", "date", "return_date", "passengers", "cabin_class"],
    activity: ["event_name", "event_type", "city", "event_date", "num_tickets", "budget_max_per_ticket"],
    trip: ["destination_city", "departure_city", "start_date", "end_date", "travelers"],
  };
  for (const key of important[scenario]) {
    if (record[key] !== undefined) out[`entities.${scenario}.${key}`] = record[key];
  }
  return out;
}

function completeTrip(
  trip: Partial<NonNullable<IntentState["trip"]>>,
): NonNullable<IntentState["trip"]> {
  return {
    activities: trip.activities ?? [],
    cuisine_preferences: trip.cuisine_preferences ?? [],
    vibe: trip.vibe ?? "mixed",
    planning_assumptions: trip.planning_assumptions ?? [],
    ...trip,
  };
}

function balancedSlice(fixtures: CaptureBenchmarkFixture[], count: number): CaptureBenchmarkFixture[] {
  const byVertical = new Map<CaptureBenchmarkVertical, CaptureBenchmarkFixture[]>();
  for (const vertical of VERTICALS) byVertical.set(vertical, []);
  for (const fixture of fixtures) byVertical.get(fixture.vertical)?.push(fixture);
  const selected: CaptureBenchmarkFixture[] = [];
  let cursor = 0;
  while (selected.length < count) {
    const vertical = VERTICALS[cursor % VERTICALS.length];
    const group = byVertical.get(vertical) ?? [];
    const index = Math.floor(cursor / VERTICALS.length);
    if (group[index]) selected.push(group[index]);
    cursor += 1;
    if (cursor > fixtures.length * VERTICALS.length) break;
  }
  return selected;
}

function containsCategories(actual: NluCategory[], expected: NluCategory[]): boolean {
  if (actual.length !== expected.length) return false;
  return expected.every((category, index) => actual[index] === category);
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function valueMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((item) => actual.includes(item));
  }
  return actual === expected;
}

function unorderedEquals(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const l = [...left].sort();
  const r = [...right].sort();
  return l.every((value, index) => value === r[index]);
}

function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function formatRate(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|");
}
