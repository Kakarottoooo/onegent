import { coerceIntentState } from "./extractor";
import { routeIntent } from "./router";
import type { IntentState, NluScenario, RouterAction } from "./types";
import { normalizeSingleActivityTicketRequest } from "./unified";

export type LiveExtractorEvalVertical =
  | "restaurant"
  | "hotel"
  | "flight"
  | "activity"
  | "trip"
  | "ambiguous"
  | "refine"
  | "profile-edit"
  | "chitchat";

export type LiveExtractorFailureClass =
  | "none"
  | "missing_required_field"
  | "wrong_vertical"
  | "date_parse_error"
  | "constraint_lost"
  | "over_inferred_constraint"
  | "ambiguous_needs_clarification"
  | "unsupported_request";

type ConfirmAction = Extract<RouterAction, { type: "show_confirm_card" }>;

type ConstraintSubset = {
  restaurant?: Partial<NonNullable<IntentState["restaurant"]>>;
  hotel?: Partial<NonNullable<IntentState["hotel"]>>;
  flight?: Partial<NonNullable<IntentState["flight"]>>;
  activity?: Partial<NonNullable<IntentState["activity"]>>;
  trip?: Partial<NonNullable<IntentState["trip"]>>;
  profile_patch?: NonNullable<IntentState["profile_patch"]>;
};

export type LiveExtractorFixture = {
  id: string;
  vertical: LiveExtractorEvalVertical;
  locale: "en" | "zh";
  utterance: string;
  expectedScenario: NluScenario | null;
  expectedActionType: RouterAction["type"];
  expectedKind?: ConfirmAction["kind"];
  expectedMissing?: string[];
  expectedFailureClass?: LiveExtractorFailureClass;
  expectedConstraints?: ConstraintSubset;
  forbiddenConstraints?: ConstraintSubset;
  dogfoodId?: string;
};

export type LiveExtractorEvalResult = {
  id: string;
  vertical: LiveExtractorEvalVertical;
  utterance: string;
  scenario: NluScenario | null;
  actionType: RouterAction["type"];
  kind: string | null;
  missing: string[];
  failureClass: LiveExtractorFailureClass;
  pass: boolean;
  notes: string[];
};

export type LiveExtractorEvalSummary = {
  total: number;
  pass: number;
  fail: number;
  passRate: number;
  byVertical: Record<LiveExtractorEvalVertical, number>;
  byFailureClass: Record<LiveExtractorFailureClass, number>;
};

export type LiveExtractorEvalReport = {
  summary: LiveExtractorEvalSummary;
  results: LiveExtractorEvalResult[];
  notes: string[];
};

export type LiveExtractorGateOptions = {
  minPassRate?: number;
  maxWrongVertical?: number;
  maxConstraintLost?: number;
};

export type LiveExtractorGateResult = {
  pass: boolean;
  errors: string[];
};

export type LiveExtractorVerticalArg = LiveExtractorEvalVertical | "all";

const EVAL_TODAY = new Date("2026-05-06T12:00:00.000Z");

const ZERO_VERTICALS: Record<LiveExtractorEvalVertical, number> = {
  restaurant: 0,
  hotel: 0,
  flight: 0,
  activity: 0,
  trip: 0,
  ambiguous: 0,
  refine: 0,
  "profile-edit": 0,
  chitchat: 0,
};

const ZERO_FAILURES: Record<LiveExtractorFailureClass, number> = {
  none: 0,
  missing_required_field: 0,
  wrong_vertical: 0,
  date_parse_error: 0,
  constraint_lost: 0,
  over_inferred_constraint: 0,
  ambiguous_needs_clarification: 0,
  unsupported_request: 0,
};

export const LIVE_EXTRACTOR_EVAL_NOTES = [
  "No-live raw utterance harness: raw text -> deterministic parser -> coerceIntentState -> router.",
  "This does not call OpenAI and does not prove live LLM accuracy.",
  "The harness exists to lock dogfood utterances and parser/router invariants before any live extractor run.",
] as const;

const CITY_ALIASES: Record<string, string> = {
  "new york": "New York",
  nyc: "New York",
  "纽约": "New York",
  nashville: "Nashville",
  boston: "Boston",
  chicago: "Chicago",
  austin: "Austin",
  seattle: "Seattle",
  "san francisco": "San Francisco",
  sfo: "San Francisco",
  "los angeles": "Los Angeles",
  la: "Los Angeles",
  "洛杉矶": "Los Angeles",
  miami: "Miami",
  dallas: "Dallas",
  orlando: "Orlando",
  london: "London",
  paris: "Paris",
  brooklyn: "Brooklyn",
};

const RESTAURANT_CUISINES = [
  { en: "Japanese", zh: "日料", aliases: ["japanese", "日料"] },
  { en: "Chinese", zh: "中餐", aliases: ["chinese", "中餐"] },
  { en: "Italian", zh: "意大利菜", aliases: ["italian", "意大利"] },
  { en: "Thai", zh: "泰餐", aliases: ["thai", "泰餐"] },
  { en: "Sushi", zh: "寿司", aliases: ["sushi", "寿司"] },
  { en: "Vegan", zh: "素食", aliases: ["vegan", "素食"] },
] as const;

const ACTIVITY_EVENTS = [
  { name: "The Lion King", type: "theater" as const, aliases: ["the lion king", "lion king", "狮子王"] },
  { name: "Hamilton", type: "theater" as const, aliases: ["hamilton"] },
  { name: "Knicks", type: "sports" as const, aliases: ["knicks"] },
  { name: "Sabrina Carpenter", type: "concert" as const, aliases: ["sabrina carpenter"] },
  { name: "Wicked", type: "theater" as const, aliases: ["wicked"] },
  { name: "MoMA exhibition", type: "exhibition" as const, aliases: ["moma", "exhibition"] },
] as const;

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

export const LIVE_EXTRACTOR_FIXTURES: LiveExtractorFixture[] = buildLiveExtractorFixtures();

export function parseRawUtteranceToIntentState(utterance: string): IntentState {
  const raw = parseRawUtterance(utterance);
  return coerceIntentState(raw, null);
}

export function evaluateLiveExtractorFixtures(params: {
  vertical?: LiveExtractorVerticalArg;
  count?: number;
  fixtures?: LiveExtractorFixture[];
} = {}): LiveExtractorEvalReport {
  const selected = selectLiveExtractorFixtures({
    fixtures: params.fixtures ?? LIVE_EXTRACTOR_FIXTURES,
    vertical: params.vertical ?? "all",
    count: params.count ?? LIVE_EXTRACTOR_FIXTURES.length,
  });
  const results = selected.map(evaluateLiveExtractorFixture);
  return {
    summary: summarizeLiveExtractorResults(results),
    results,
    notes: [...LIVE_EXTRACTOR_EVAL_NOTES],
  };
}

export function selectLiveExtractorFixtures(params: {
  fixtures?: LiveExtractorFixture[];
  vertical: LiveExtractorVerticalArg;
  count: number;
}): LiveExtractorFixture[] {
  const fixtures = params.fixtures ?? LIVE_EXTRACTOR_FIXTURES;
  if (params.vertical !== "all") {
    const filtered = fixtures.filter((fixture) => fixture.vertical === params.vertical);
    const count = Math.max(1, Math.min(Math.floor(params.count), filtered.length));
    return filtered.slice(0, count);
  }
  const count = Math.max(1, Math.min(Math.floor(params.count), fixtures.length));
  return selectRoundRobin(fixtures, count);
}

export function evaluateLiveExtractorFixture(fixture: LiveExtractorFixture): LiveExtractorEvalResult {
  const parsed = parseRawUtteranceToIntentState(fixture.utterance);
  const normalized = normalizeSingleActivityTicketRequest(parsed, fixture.utterance, "").state;
  const action = routeIntent(normalized);
  const kind = action.type === "show_confirm_card" ? action.kind : null;
  const missing = action.type === "ask_clarification" ? action.missing : [];
  const notes: string[] = [];

  if (normalized.scenario !== fixture.expectedScenario) {
    notes.push(`scenario expected ${fixture.expectedScenario ?? "null"} got ${normalized.scenario ?? "null"}`);
  }
  if (action.type !== fixture.expectedActionType) {
    notes.push(`action expected ${fixture.expectedActionType} got ${action.type}`);
  }
  if (fixture.expectedKind && kind !== fixture.expectedKind) {
    notes.push(`kind expected ${fixture.expectedKind} got ${kind ?? "null"}`);
  }
  if (fixture.expectedMissing) {
    compareArrays("missing", fixture.expectedMissing, missing, notes);
  }
  compareConstraintSubset(fixture.expectedConstraints ?? {}, collectConstraints(normalized), notes);
  compareForbiddenConstraints(fixture.forbiddenConstraints ?? {}, collectConstraints(normalized), notes);

  const failureClass = classifyLiveExtractorFailure(fixture, normalized, action, notes);
  const expectedFailure = fixture.expectedFailureClass ?? "none";
  if (failureClass !== expectedFailure) {
    notes.push(`failureClass expected ${expectedFailure} got ${failureClass}`);
  }

  return {
    id: fixture.id,
    vertical: fixture.vertical,
    utterance: fixture.utterance,
    scenario: normalized.scenario,
    actionType: action.type,
    kind,
    missing,
    failureClass,
    pass: notes.length === 0,
    notes,
  };
}

export function summarizeLiveExtractorResults(
  results: LiveExtractorEvalResult[],
): LiveExtractorEvalSummary {
  const byVertical = { ...ZERO_VERTICALS };
  const byFailureClass = { ...ZERO_FAILURES };
  for (const result of results) {
    byVertical[result.vertical] += 1;
    byFailureClass[result.failureClass] += 1;
  }
  const pass = results.filter((result) => result.pass).length;
  return {
    total: results.length,
    pass,
    fail: results.length - pass,
    passRate: results.length === 0 ? 0 : pass / results.length,
    byVertical,
    byFailureClass,
  };
}

export function evaluateLiveExtractorGate(
  report: LiveExtractorEvalReport,
  options: LiveExtractorGateOptions,
): LiveExtractorGateResult {
  const errors: string[] = [];
  if (
    typeof options.minPassRate === "number" &&
    report.summary.passRate < options.minPassRate
  ) {
    errors.push(
      `passRate ${pct(report.summary.passRate)} is below required ${pct(options.minPassRate)}`,
    );
  }
  if (
    typeof options.maxWrongVertical === "number" &&
    report.summary.byFailureClass.wrong_vertical > options.maxWrongVertical
  ) {
    errors.push(
      `wrong_vertical count ${report.summary.byFailureClass.wrong_vertical} exceeds allowed ${options.maxWrongVertical}`,
    );
  }
  if (
    typeof options.maxConstraintLost === "number" &&
    report.summary.byFailureClass.constraint_lost > options.maxConstraintLost
  ) {
    errors.push(
      `constraint_lost count ${report.summary.byFailureClass.constraint_lost} exceeds allowed ${options.maxConstraintLost}`,
    );
  }
  return {
    pass: errors.length === 0,
    errors,
  };
}

export function renderLiveExtractorMarkdown(report: LiveExtractorEvalReport): string {
  const lines = [
    "# Live Extractor Eval Harness",
    "",
    ...report.notes,
    "",
    `Cases: ${report.summary.total}`,
    `Passed: ${report.summary.pass}`,
    `Failed: ${report.summary.fail}`,
    `Pass rate: ${pct(report.summary.passRate)}`,
    "",
    "## Failure Taxonomy",
    "",
    "| Class | Count |",
    "| --- | ---: |",
  ];
  for (const [key, value] of Object.entries(report.summary.byFailureClass)) {
    if (value > 0) lines.push(`| \`${key}\` | ${value} |`);
  }
  lines.push("", "## Cases", "", "| Case | Vertical | Scenario | Action | Failure | Result |", "| --- | --- | --- | --- | --- | --- |");
  for (const result of report.results) {
    lines.push(
      `| \`${result.id}\` | ${result.vertical} | ${result.scenario ?? "-"} | ${result.actionType} | \`${result.failureClass}\` | ${result.pass ? "PASS" : `FAIL: ${result.notes.join("; ")}`} |`,
    );
  }
  return lines.join("\n");
}

function parseRawUtterance(utterance: string): Record<string, unknown> {
  const lower = utterance.toLowerCase();
  const base = rawBase();

  if (isChitchat(lower)) {
    return { ...base, intent: "chitchat", scenario: null, categories: [] };
  }
  if (isProfileEdit(lower)) {
    return { ...base, intent: "profile_edit", scenario: null, categories: [], profile_patch: parseProfilePatch(utterance) };
  }
  if (isRefine(lower, utterance)) {
    return parseRefine(utterance, base);
  }
  if (isUnsupported(lower)) {
    return {
      ...base,
      intent: "unknown",
      scenario: null,
      categories: [],
      planning_assumptions: ["out_of_scope: unsupported travel product"],
    };
  }
  if (isAmbiguousTravel(lower, utterance)) {
    return { ...base, scenario: null, categories: [], trip: undefined };
  }
  if (looksLikeExplicitTrip(lower, utterance)) {
    return parseTrip(utterance, base);
  }
  if (looksLikeFlight(lower, utterance)) {
    return parseFlight(utterance, base);
  }
  if (looksLikeActivity(lower, utterance)) {
    return parseActivity(utterance, base);
  }
  if (looksLikeHotel(lower, utterance)) {
    return parseHotel(utterance, base);
  }
  if (looksLikeRestaurant(lower, utterance)) {
    return parseRestaurant(utterance, base);
  }
  return { ...base, intent: "unknown", scenario: null, categories: [] };
}

function rawBase(): Record<string, unknown> {
  return {
    confidence: 0.88,
    turn_count: 1,
    updated_at: "2026-05-06T00:00:00.000Z",
    intent: "create_plan",
    scenario: null,
    categories: [],
    party_type: "solo",
    member_names: [],
    refined_target_id: null,
    planning_assumptions: [],
  };
}

function parseRestaurant(utterance: string, base: Record<string, unknown>): Record<string, unknown> {
  const restaurantName = findNamedRestaurant(utterance);
  const restaurant = compactObject({
    restaurant_name: restaurantName,
    city: findCity(utterance),
    date: findDate(utterance),
    time: findTime(utterance),
    party_size: findCount(utterance, ["people", "person", "guests", "个人", "位"]) ?? (restaurantName === "Sirrah" ? 1 : undefined),
    cuisine: findCuisine(utterance),
    budget_per_person: findMoney(utterance),
  });
  return {
    ...base,
    scenario: "restaurant",
    categories: ["restaurant"],
    restaurant,
  };
}

function parseHotel(utterance: string, base: Record<string, unknown>): Record<string, unknown> {
  const dates = findDates(utterance);
  const hotel = compactObject({
    hotel_name: findNamedHotel(utterance),
    city: findCity(utterance),
    check_in: dates[0],
    check_out: dates[1],
    nights: findNights(utterance),
    guests: findCount(utterance, ["guests", "people", "person", "位", "个人"]),
    budget_max_per_night: findMoney(utterance),
  });
  return {
    ...base,
    scenario: "hotel",
    categories: ["hotel"],
    hotel,
  };
}

function parseFlight(utterance: string, base: Record<string, unknown>): Record<string, unknown> {
  const route = findFlightRoute(utterance);
  const flight = compactObject({
    origin: route.origin,
    dest: route.dest,
    date: findDate(utterance),
    return_date: findReturnDate(utterance),
    is_round_trip: /round\s*trip|returning/i.test(utterance),
    passengers: findCount(utterance, ["passengers", "people", "person", "个人", "人"]),
    cabin_class: findCabinClass(utterance),
    avoid_red_eye: /red\s*eye|红眼/i.test(utterance) ? true : undefined,
  });
  return {
    ...base,
    scenario: "flight",
    categories: ["flight"],
    flight,
  };
}

function parseActivity(utterance: string, base: Record<string, unknown>): Record<string, unknown> {
  const event = findEvent(utterance);
  const activity = compactObject({
    event_name: event?.name,
    event_type: event?.type,
    city: findCity(utterance),
    event_date: findDate(utterance),
    num_tickets: findCount(utterance, ["tickets", "票", "张"]),
    budget_max_per_ticket: findMoney(utterance),
  });
  return {
    ...base,
    scenario: "activity",
    categories: ["activity"],
    activity,
  };
}

function parseTrip(utterance: string, base: Record<string, unknown>): Record<string, unknown> {
  const dates = findDates(utterance);
  const trip = compactObject({
    destination_city: findTripDestination(utterance) ?? findCity(utterance),
    departure_city: findTripDeparture(utterance),
    start_date: dates[0],
    end_date: dates[1],
    nights: findNights(utterance),
    travelers: findCount(utterance, ["travelers", "people", "person", "个人", "人"]),
    activities: findEvent(utterance) ? [findEvent(utterance)?.name] : /\bshow\b|演出|百老汇/i.test(utterance) ? ["Broadway show"] : [],
    cuisine_preferences: findCuisine(utterance) ? [findCuisine(utterance)] : [],
    vibe: "mixed",
    planning_assumptions: [],
  });
  return {
    ...base,
    scenario: "trip",
    categories: ["hotel", "flight", "restaurant", "activity"],
    trip,
  };
}

function parseRefine(utterance: string, base: Record<string, unknown>): Record<string, unknown> {
  const lower = utterance.toLowerCase();
  if (findCuisine(utterance)) {
    return {
      ...base,
      intent: "refine_existing",
      scenario: "restaurant",
      categories: ["restaurant"],
      refined_target_id: "previous",
      restaurant: { cuisine: findCuisine(utterance) },
    };
  }
  if (/hotel|酒店|budget|预算/i.test(utterance)) {
    return {
      ...base,
      intent: "refine_existing",
      scenario: "hotel",
      categories: ["hotel"],
      refined_target_id: "previous",
      hotel: compactObject({ budget_max_per_night: findMoney(utterance) }),
    };
  }
  if (/flight|depart|after|机票|航班/i.test(lower)) {
    return {
      ...base,
      intent: "refine_existing",
      scenario: "flight",
      categories: ["flight"],
      refined_target_id: "previous",
      flight: compactObject({ earliest_departure: findTime(utterance) }),
    };
  }
  return {
    ...base,
    intent: "refine_existing",
    scenario: "trip",
    categories: ["hotel", "flight", "restaurant", "activity"],
    refined_target_id: "previous",
    trip: {
      activities: [],
      cuisine_preferences: [],
      vibe: "mixed",
      planning_assumptions: [],
      budget_total: findMoney(utterance),
    },
  };
}

function classifyLiveExtractorFailure(
  fixture: LiveExtractorFixture,
  state: IntentState,
  action: RouterAction,
  notes: string[],
): LiveExtractorFailureClass {
  if (
    fixture.expectedFailureClass &&
    fixture.expectedFailureClass !== "none" &&
    state.scenario === fixture.expectedScenario &&
    action.type === fixture.expectedActionType
  ) {
    return fixture.expectedFailureClass;
  }
  if (state.scenario !== fixture.expectedScenario) return "wrong_vertical";
  if (notes.some((note) => note.includes("forbidden"))) return "over_inferred_constraint";
  if (notes.some((note) => note.includes(".") && note.includes("expected"))) return "constraint_lost";
  if (action.type === "ask_clarification") {
    const missing = action.missing.join(" ");
    if (/date|check_in|check_out|departure_date|event_date/.test(missing) && hasDateCue(fixture.utterance)) {
      return "date_parse_error";
    }
    if (fixture.vertical === "ambiguous") return "ambiguous_needs_clarification";
    return "missing_required_field";
  }
  return "none";
}

function buildLiveExtractorFixtures(): LiveExtractorFixture[] {
  const out: LiveExtractorFixture[] = [];

  out.push(
    {
      id: "dogfood-activity-lion-king-zh",
      vertical: "activity",
      locale: "zh",
      utterance: "帮我预定一个纽约6月1号的百老汇狮子王看看",
      expectedScenario: "activity",
      expectedActionType: "show_confirm_card",
      expectedKind: "plan",
      expectedConstraints: {
        activity: { event_name: "The Lion King", city: "New York", event_date: "2026-06-01" },
      },
      forbiddenConstraints: { trip: { destination_city: "New York" } },
      dogfoodId: "DOG-005",
    },
    {
      id: "dogfood-hotel-nyc-budget-zh",
      vertical: "hotel",
      locale: "zh",
      utterance: "帮我订一个5月20号到24号的纽约酒店，预算300一天",
      expectedScenario: "hotel",
      expectedActionType: "show_confirm_card",
      expectedKind: "plan",
      expectedConstraints: {
        hotel: { city: "New York", check_in: "2026-05-20", check_out: "2026-05-24", budget_max_per_night: 300 },
      },
      dogfoodId: "DOG-010",
    },
    {
      id: "dogfood-restaurant-sirrah-next-thursday",
      vertical: "restaurant",
      locale: "en",
      utterance: "book Sirrah in New York next Thursday at 8pm for 1 person",
      expectedScenario: "restaurant",
      expectedActionType: "show_confirm_card",
      expectedKind: "plan",
      expectedConstraints: {
        restaurant: { restaurant_name: "Sirrah", city: "New York", date: "2026-05-14", time: "20:00", party_size: 1 },
      },
    },
    {
      id: "dogfood-restaurant-chinese-zh",
      vertical: "restaurant",
      locale: "zh",
      utterance: "帮我订一个明晚7点纽约2个人的中餐",
      expectedScenario: "restaurant",
      expectedActionType: "show_confirm_card",
      expectedKind: "plan",
      expectedConstraints: {
        restaurant: { city: "New York", date: "2026-05-07", time: "19:00", party_size: 2, cuisine: "Chinese" },
      },
      dogfoodId: "DOG-009",
    },
    {
      id: "dogfood-flight-nashville-nyc-zh",
      vertical: "flight",
      locale: "zh",
      utterance: "帮我订一个6月1号从nashville飞纽约的机票",
      expectedScenario: "flight",
      expectedActionType: "show_confirm_card",
      expectedKind: "plan",
      expectedConstraints: {
        flight: { origin: "Nashville", dest: "New York", date: "2026-06-01" },
      },
    },
  );

  out.push(
    {
      id: "restaurant-missing-time-raw",
      vertical: "restaurant",
      locale: "en",
      utterance: "Book Chinese in New York tomorrow for 2 people",
      expectedScenario: "restaurant",
      expectedActionType: "ask_clarification",
      expectedMissing: ["time"],
      expectedFailureClass: "missing_required_field",
      expectedConstraints: {
        restaurant: { city: "New York", date: "2026-05-07", party_size: 2, cuisine: "Chinese" },
      },
    },
    {
      id: "hotel-missing-checkout-raw",
      vertical: "hotel",
      locale: "en",
      utterance: "Book a New York hotel from May 20 under $300 a night",
      expectedScenario: "hotel",
      expectedActionType: "ask_clarification",
      expectedMissing: ["check_out"],
      expectedFailureClass: "missing_required_field",
      expectedConstraints: {
        hotel: { city: "New York", check_in: "2026-05-20", budget_max_per_night: 300 },
      },
    },
    {
      id: "flight-missing-origin-raw",
      vertical: "flight",
      locale: "en",
      utterance: "Book a flight to New York on June 1",
      expectedScenario: "flight",
      expectedActionType: "ask_clarification",
      expectedMissing: ["origin"],
      expectedFailureClass: "missing_required_field",
      expectedConstraints: {
        flight: { dest: "New York", date: "2026-06-01" },
      },
    },
    {
      id: "activity-missing-date-raw",
      vertical: "activity",
      locale: "en",
      utterance: "Book The Lion King in New York",
      expectedScenario: "activity",
      expectedActionType: "ask_clarification",
      expectedMissing: ["event_date"],
      expectedFailureClass: "missing_required_field",
      expectedConstraints: {
        activity: { event_name: "The Lion King", city: "New York" },
      },
    },
  );

  const cities = ["New York", "Boston", "Chicago", "Austin", "Seattle", "Los Angeles", "Miami", "San Francisco"];
  const dates = ["May 20", "May 21", "June 1", "June 5", "June 7", "July 2"];
  const datePairs = [
    ["May 20", "May 24"],
    ["May 21", "May 24"],
    ["June 1", "June 4"],
    ["June 5", "June 8"],
    ["June 7", "June 10"],
    ["July 2", "July 5"],
  ] as const;
  const times = ["6pm", "7pm", "8pm"];
  for (let i = 0; i < 27; i += 1) {
    const cuisine = RESTAURANT_CUISINES[i % RESTAURANT_CUISINES.length];
    const city = cities[i % cities.length];
    const dateText = dates[i % dates.length];
    const timeText = times[i % times.length];
    const party = (i % 4) + 1;
    const date = findDate(dateText) ?? "2026-05-20";
    out.push({
      id: `restaurant-raw-${String(i + 1).padStart(2, "0")}`,
      vertical: "restaurant",
      locale: "en",
      utterance: `Book ${cuisine.en} in ${city} on ${dateText} at ${timeText} for ${party} people`,
      expectedScenario: "restaurant",
      expectedActionType: "show_confirm_card",
      expectedKind: "plan",
      expectedConstraints: {
        restaurant: { cuisine: cuisine.en, city, date, time: findTime(timeText), party_size: party },
      },
    });
  }

  for (let i = 0; i < 24; i += 1) {
    const city = cities[i % cities.length];
    const [checkInText, checkOutText] = datePairs[i % datePairs.length];
    const checkIn = findDate(checkInText) ?? "2026-05-20";
    const checkOut = findDate(checkOutText) ?? "2026-05-22";
    const budget = 160 + (i % 6) * 30;
    out.push({
      id: `hotel-raw-${String(i + 1).padStart(2, "0")}`,
      vertical: "hotel",
      locale: "en",
      utterance: `Book a ${city} hotel from ${checkInText} to ${checkOutText} under $${budget} a night`,
      expectedScenario: "hotel",
      expectedActionType: "show_confirm_card",
      expectedKind: "plan",
      expectedConstraints: {
        hotel: { city, check_in: checkIn, check_out: checkOut, budget_max_per_night: budget },
      },
    });
  }

  const routes = [
    ["Nashville", "New York"],
    ["Boston", "Chicago"],
    ["Seattle", "Miami"],
    ["Dallas", "Orlando"],
    ["San Francisco", "Los Angeles"],
    ["New York", "London"],
  ] as const;
  for (let i = 0; i < 24; i += 1) {
    const [origin, dest] = routes[i % routes.length];
    const dateText = dates[i % dates.length];
    const passengers = (i % 4) + 1;
    out.push({
      id: `flight-raw-${String(i + 1).padStart(2, "0")}`,
      vertical: "flight",
      locale: "en",
      utterance: `Book a flight from ${origin} to ${dest} on ${dateText} for ${passengers} passengers`,
      expectedScenario: "flight",
      expectedActionType: "show_confirm_card",
      expectedKind: "plan",
      expectedConstraints: {
        flight: { origin, dest, date: findDate(dateText), passengers },
      },
    });
  }

  for (let i = 0; i < 24; i += 1) {
    const event = ACTIVITY_EVENTS[i % ACTIVITY_EVENTS.length];
    const city = cities[i % cities.length];
    const dateText = dates[i % dates.length];
    const tickets = (i % 4) + 1;
    out.push({
      id: `activity-raw-${String(i + 1).padStart(2, "0")}`,
      vertical: "activity",
      locale: "en",
      utterance: `Book ${event.name} in ${city} on ${dateText} for ${tickets} tickets`,
      expectedScenario: "activity",
      expectedActionType: "show_confirm_card",
      expectedKind: "plan",
      expectedConstraints: {
        activity: { event_name: event.name, city, event_date: findDate(dateText), num_tickets: tickets },
      },
    });
  }

  for (let i = 0; i < 12; i += 1) {
    const [origin, dest] = routes[i % routes.length];
    const [startText, endText] = datePairs[i % datePairs.length];
    const travelers = (i % 4) + 1;
    out.push({
      id: `trip-raw-${String(i + 1).padStart(2, "0")}`,
      vertical: "trip",
      locale: "en",
      utterance: `Plan a full ${dest} trip from ${origin} ${startText} to ${endText} for ${travelers} travelers with hotel, flights, restaurants, and a show`,
      expectedScenario: "trip",
      expectedActionType: "show_confirm_card",
      expectedKind: "trip",
      expectedConstraints: {
        trip: { destination_city: dest, departure_city: origin, start_date: findDate(startText), end_date: findDate(endText), travelers },
      },
    });
  }

  const ambiguous = ["I want to go to New York next month", "我想去纽约，下个月", "Need a trip idea for Boston", "Maybe Chicago in June"];
  ambiguous.forEach((utterance, index) => {
    out.push({
      id: `ambiguous-raw-${index + 1}`,
      vertical: "ambiguous",
      locale: /[\u4e00-\u9fff]/u.test(utterance) ? "zh" : "en",
      utterance,
      expectedScenario: null,
      expectedActionType: "ask_clarification",
      expectedMissing: ["categories"],
      expectedFailureClass: "ambiguous_needs_clarification",
    });
  });

  ["Book a cruise to Alaska", "Help me renew my passport"].forEach((utterance, index) => {
    out.push({
      id: `unsupported-raw-${index + 1}`,
      vertical: "ambiguous",
      locale: "en",
      utterance,
      expectedScenario: null,
      expectedActionType: "continue_chat",
      expectedFailureClass: "unsupported_request",
    });
  });

  [
    ["refine-restaurant-cuisine", "Change the restaurant to Chinese", "restaurant", { restaurant: { cuisine: "Chinese" } }],
    ["refine-hotel-budget", "Change the hotel budget to $300", "hotel", { hotel: { budget_max_per_night: 300 } }],
    ["refine-flight-time", "Make the flight after 2pm", "flight", { flight: { earliest_departure: "14:00" } }],
    ["refine-trip-budget", "Make it under $1200", "trip", { trip: { budget_total: 1200 } }],
  ].forEach(([id, utterance, scenario, expectedConstraints]) => {
    out.push({
      id: String(id),
      vertical: "refine",
      locale: "en",
      utterance: String(utterance),
      expectedScenario: scenario as NluScenario,
      expectedActionType: "continue_chat",
      expectedConstraints: expectedConstraints as ConstraintSubset,
    });
  });

  [
    ["profile-email", "Save my email as founder@example.test", { profile_patch: { email: "founder@example.test" } }],
    ["profile-phone", "Save my phone as 555-0100", { profile_patch: { phone: "555-0100" } }],
    ["profile-city", "My city is New York", { profile_patch: { city: "New York" } }],
  ].forEach(([id, utterance, expectedConstraints]) => {
    out.push({
      id: String(id),
      vertical: "profile-edit",
      locale: "en",
      utterance: String(utterance),
      expectedScenario: null,
      expectedActionType: "apply_profile_patch",
      expectedConstraints: expectedConstraints as ConstraintSubset,
    });
  });

  ["hello", "thanks, what can you do?", "你好，你能做什么？"].forEach((utterance, index) => {
    out.push({
      id: `chitchat-raw-${index + 1}`,
      vertical: "chitchat",
      locale: /[\u4e00-\u9fff]/u.test(utterance) ? "zh" : "en",
      utterance,
      expectedScenario: null,
      expectedActionType: "continue_chat",
    });
  });

  return out;
}

function collectConstraints(state: IntentState): ConstraintSubset {
  return {
    ...(state.restaurant ? { restaurant: state.restaurant } : {}),
    ...(state.hotel ? { hotel: state.hotel } : {}),
    ...(state.flight ? { flight: state.flight } : {}),
    ...(state.activity ? { activity: state.activity } : {}),
    ...(state.trip ? { trip: state.trip } : {}),
    ...(state.profile_patch ? { profile_patch: state.profile_patch } : {}),
  };
}

function selectRoundRobin(fixtures: LiveExtractorFixture[], count: number): LiveExtractorFixture[] {
  const verticals: LiveExtractorEvalVertical[] = [
    "restaurant",
    "hotel",
    "flight",
    "activity",
    "trip",
    "ambiguous",
    "refine",
    "profile-edit",
    "chitchat",
  ];
  const buckets = new Map<LiveExtractorEvalVertical, LiveExtractorFixture[]>();
  for (const vertical of verticals) {
    buckets.set(vertical, fixtures.filter((fixture) => fixture.vertical === vertical));
  }
  const selected: LiveExtractorFixture[] = [];
  let index = 0;
  while (selected.length < count) {
    let added = false;
    for (const vertical of verticals) {
      const bucket = buckets.get(vertical) ?? [];
      if (index < bucket.length) {
        selected.push(bucket[index]);
        added = true;
        if (selected.length >= count) break;
      }
    }
    if (!added) break;
    index += 1;
  }
  return selected;
}

function compareConstraintSubset(
  expected: ConstraintSubset,
  actual: ConstraintSubset,
  notes: string[],
): void {
  for (const key of Object.keys(expected) as (keyof ConstraintSubset)[]) {
    const expectedFields = expected[key] as Record<string, unknown> | undefined;
    const actualFields = actual[key] as Record<string, unknown> | undefined;
    if (!expectedFields) continue;
    if (!actualFields) {
      notes.push(`${key} expected fields but got null`);
      continue;
    }
    for (const [field, expectedValue] of Object.entries(expectedFields)) {
      const actualValue = actualFields[field];
      if (Array.isArray(expectedValue)) {
        compareArrays(`${key}.${field}`, expectedValue, Array.isArray(actualValue) ? actualValue : [], notes);
      } else if (actualValue !== expectedValue) {
        notes.push(`${key}.${field} expected ${JSON.stringify(expectedValue)} got ${JSON.stringify(actualValue)}`);
      }
    }
  }
}

function compareForbiddenConstraints(
  forbidden: ConstraintSubset,
  actual: ConstraintSubset,
  notes: string[],
): void {
  for (const key of Object.keys(forbidden) as (keyof ConstraintSubset)[]) {
    const fields = forbidden[key] as Record<string, unknown> | undefined;
    const actualFields = actual[key] as Record<string, unknown> | undefined;
    if (!fields || !actualFields) continue;
    for (const [field, forbiddenValue] of Object.entries(fields)) {
      if (actualFields[field] === forbiddenValue) {
        notes.push(`${key}.${field} forbidden over-inferred ${JSON.stringify(forbiddenValue)}`);
      }
    }
  }
}

function compareArrays(label: string, expected: unknown[], actual: unknown[], notes: string[]): void {
  if (expected.length !== actual.length || expected.some((value, index) => actual[index] !== value)) {
    notes.push(`${label} expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}

function findCity(utterance: string): string | undefined {
  const lower = utterance.toLowerCase();
  const keys = Object.keys(CITY_ALIASES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key) || utterance.includes(key)) return CITY_ALIASES[key];
  }
  return undefined;
}

function findCuisine(utterance: string): string | undefined {
  const lower = utterance.toLowerCase();
  for (const cuisine of RESTAURANT_CUISINES) {
    if (cuisine.aliases.some((alias) => lower.includes(alias) || utterance.includes(alias))) {
      return cuisine.en;
    }
  }
  return undefined;
}

function findEvent(utterance: string): (typeof ACTIVITY_EVENTS)[number] | undefined {
  const lower = utterance.toLowerCase();
  return ACTIVITY_EVENTS.find((event) =>
    event.aliases.some((alias) => lower.includes(alias) || utterance.includes(alias)),
  );
}

function findNamedRestaurant(utterance: string): string | undefined {
  if (/sirrah/i.test(utterance)) return "Sirrah";
  if (/carbone/i.test(utterance)) return "Carbone";
  return undefined;
}

function findNamedHotel(utterance: string): string | undefined {
  if (/the pierre/i.test(utterance)) return "The Pierre";
  return undefined;
}

function findDates(utterance: string): string[] {
  const dates: string[] = [];
  const zhRange = utterance.match(/(\d{1,2})月(\d{1,2})[号日]?到(\d{1,2})[号日]?/);
  if (zhRange) {
    dates.push(toIso(Number(zhRange[1]), Number(zhRange[2])));
    dates.push(toIso(Number(zhRange[1]), Number(zhRange[3])));
    return dates;
  }
  const monthRange = utterance.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\s+(?:to|-)\s+(?:(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?(\d{1,2})\b/i,
  );
  if (monthRange) {
    const firstMonth = MONTHS[monthRange[1].toLowerCase()];
    const secondMonth = MONTHS[(monthRange[3] ?? monthRange[1]).toLowerCase()];
    dates.push(toIso(firstMonth, Number(monthRange[2])));
    dates.push(toIso(secondMonth, Number(monthRange[4])));
    return dates;
  }
  const single = findDate(utterance);
  return single ? [single] : [];
}

function findDate(utterance: string): string | undefined {
  const lower = utterance.toLowerCase();
  if (/\bnext thursday\b/.test(lower)) return nextWeekday(EVAL_TODAY, 4, 1);
  if (/\btomorrow\b/.test(lower) || /明晚|明天/.test(utterance)) return offsetDate(EVAL_TODAY, 1);
  const iso = utterance.match(/\b(2026-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const zh = utterance.match(/(\d{1,2})月(\d{1,2})[号日]?/);
  if (zh) return toIso(Number(zh[1]), Number(zh[2]));
  const month = utterance.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/i,
  );
  if (month) return toIso(MONTHS[month[1].toLowerCase()], Number(month[2]));
  return undefined;
}

function findReturnDate(utterance: string): string | undefined {
  const returning = utterance.match(/returning\s+(.+)$/i);
  return returning ? findDate(returning[1]) : undefined;
}

function findTime(utterance: string): string | undefined {
  const text = utterance.toLowerCase();
  const at = text.match(/\b(?:at|after)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (at) {
    const hour = Number(at[1]);
    const minute = at[2] ?? "00";
    const meridiem = at[3];
    if (meridiem === "am") return `${String(hour % 12).padStart(2, "0")}:${minute}`;
    return `${String(hour === 12 ? 12 : hour + (hour < 12 ? 12 : 0)).padStart(2, "0")}:${minute}`;
  }
  const compact = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (compact) {
    const hour = Number(compact[1]);
    const minute = compact[2] ?? "00";
    return `${String(compact[3] === "pm" && hour < 12 ? hour + 12 : hour % 12).padStart(2, "0")}:${minute}`;
  }
  const zh = utterance.match(/(\d{1,2})点/);
  if (zh) {
    const hour = Number(zh[1]);
    return `${String(hour < 12 ? hour + 12 : hour).padStart(2, "0")}:00`;
  }
  return undefined;
}

function findCount(utterance: string, labels: string[]): number | undefined {
  const labelPattern = labels.map(escapeRegExp).join("|");
  const numeric = utterance.match(new RegExp(`(\\d+)\\s*(?:${labelPattern})`, "i"));
  if (numeric) return Number(numeric[1]);
  if (/\btwo\b/i.test(utterance)) return 2;
  if (/\bone\b/i.test(utterance)) return 1;
  if (/两|二/.test(utterance)) return 2;
  return undefined;
}

function findMoney(utterance: string): number | undefined {
  const dollar = utterance.match(/\$(\d{2,5})\b/);
  if (dollar) return Number(dollar[1]);
  const before = utterance.match(/(?:under|budget|max|预算)\s*\$?(\d{2,5})/i);
  if (before) return Number(before[1]);
  const after = utterance.match(/\b(\d{2,5})\s*(?:a night|per night|each|以内|一天)\b/i);
  return after ? Number(after[1]) : undefined;
}

function findNights(utterance: string): number | undefined {
  const en = utterance.match(/(\d+)\s*nights?/i);
  if (en) return Number(en[1]);
  const zh = utterance.match(/(\d+)\s*晚/);
  if (zh) return Number(zh[1]);
  return undefined;
}

function findCabinClass(utterance: string): NonNullable<IntentState["flight"]>["cabin_class"] | undefined {
  if (/business/i.test(utterance)) return "business";
  if (/first class/i.test(utterance)) return "first";
  if (/premium economy/i.test(utterance)) return "premium_economy";
  return undefined;
}

function findFlightRoute(utterance: string): { origin?: string; dest?: string } {
  const lower = utterance.toLowerCase();
  const zh = lower.match(/从\s*([a-z\s]+?)\s*(?:飞|到)\s*([\u4e00-\u9fffa-z\s]+)/i);
  if (zh) {
    return { origin: normalizeCityText(zh[1]), dest: normalizeCityText(zh[2]) };
  }
  const fromTo = utterance.match(/from\s+(.+?)\s+to\s+(.+?)(?:\s+on|\s+for|,|$)/i);
  if (fromTo) {
    return { origin: normalizeCityText(fromTo[1]), dest: normalizeCityText(fromTo[2]) };
  }
  return { dest: findCity(utterance) };
}

function findTripDestination(utterance: string): string | undefined {
  const fullTrip = utterance.match(/full\s+(.+?)\s+trip/i);
  if (fullTrip) return normalizeCityText(fullTrip[1]);
  const planTrip = utterance.match(/plan\s+(?:a\s+)?(.+?)\s+trip/i);
  if (planTrip) return normalizeCityText(planTrip[1]);
  return undefined;
}

function findTripDeparture(utterance: string): string | undefined {
  const from = utterance.match(/\bfrom\s+([A-Za-z\s]+?)\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}-\d{2}-\d{2})/i);
  return from ? normalizeCityText(from[1]) : undefined;
}

function normalizeCityText(value: string): string | undefined {
  return findCity(value.trim()) ?? value.trim().replace(/\s+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function looksLikeRestaurant(lower: string, utterance: string): boolean {
  return /restaurant|dinner|reserve|table|sirrah|carbone|sushi|japanese|chinese|italian|thai|vegan/.test(lower) ||
    /餐厅|餐馆|订一个|日料|中餐|寿司|泰餐|素食/.test(utterance);
}

function looksLikeHotel(lower: string, utterance: string): boolean {
  return /hotel|motel|resort|the pierre/.test(lower) || /酒店|民宿/.test(utterance);
}

function looksLikeFlight(lower: string, utterance: string): boolean {
  return /flight|fly|flying|round trip|sfo|lax/.test(lower) || /机票|航班|飞/.test(utterance);
}

function looksLikeActivity(lower: string, utterance: string): boolean {
  return /ticket|broadway|lion king|hamilton|knicks|concert|show|wicked|moma|exhibition/.test(lower) ||
    /票|百老汇|狮子王|演出|音乐剧/.test(utterance);
}

function looksLikeExplicitTrip(lower: string, utterance: string): boolean {
  const hasTripCue = /full .*trip|trip|itinerary|package|plan a full|vacation/.test(lower) ||
    /行程|旅行|酒店机票餐厅演出都要/.test(utterance);
  const mentionsMultiple = Number(looksLikeHotel(lower, utterance)) +
    Number(looksLikeFlight(lower, utterance)) +
    Number(looksLikeRestaurant(lower, utterance)) +
    Number(looksLikeActivity(lower, utterance)) >= 2;
  return hasTripCue && (mentionsMultiple || /full|package|行程|旅行/.test(lower + utterance));
}

function isAmbiguousTravel(lower: string, utterance: string): boolean {
  return /i want to go to|need a trip idea|maybe .* in/.test(lower) || /我想去/.test(utterance);
}

function isRefine(lower: string, utterance: string): boolean {
  return /change|make it|make the|modify|cheaper|after/.test(lower) || /改成|换成|把刚才/.test(utterance);
}

function isProfileEdit(lower: string): boolean {
  return /save my|my email is|my phone is|my city is/.test(lower);
}

function isChitchat(lower: string): boolean {
  return /^(hello|hi|thanks|thank you)/.test(lower) || /你好|你能做什么/.test(lower);
}

function isUnsupported(lower: string): boolean {
  return /cruise|visa|passport renewal|mortgage|laptop/.test(lower);
}

function parseProfilePatch(utterance: string): Record<string, string> {
  const lower = utterance.toLowerCase();
  const email = utterance.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email) return { email };
  const phone = utterance.match(/\b\d{3}[-.\s]\d{4}\b/)?.[0];
  if (phone) return { phone };
  if (/my city is/.test(lower)) {
    const city = findCity(utterance);
    return city ? { city } : {};
  }
  return {};
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""),
  ) as Partial<T>;
}

function hasDateCue(utterance: string): boolean {
  return /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|tomorrow|next)\b/i.test(utterance) ||
    /\d{1,2}月|明天|明晚/.test(utterance);
}

function toIso(month: number, day: number): string {
  return `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function offsetDate(from: Date, days: number): string {
  const next = new Date(from);
  next.setUTCDate(next.getUTCDate() + days);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function nextWeekday(from: Date, targetWeekday: number, weeksAhead: number): string {
  const next = new Date(from);
  const current = next.getUTCDay();
  let delta = (targetWeekday - current + 7) % 7;
  if (delta === 0) delta = 7;
  delta += weeksAhead * 7;
  next.setUTCDate(next.getUTCDate() + delta);
  return offsetDate(next, 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
