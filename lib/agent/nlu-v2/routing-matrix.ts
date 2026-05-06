import { routeIntent } from "./router";
import type { IntentState, RouterAction, NluScenario } from "./types";
import { normalizeSingleActivityTicketRequest } from "./unified";

export type NluRoutingFixture = {
  id: string;
  utterance: string;
  locale: "en" | "zh";
  rawState: IntentState;
  rawReply?: string;
  expectedScenario: NluScenario | null;
  expectedActionType: RouterAction["type"];
  expectedKind?: Extract<RouterAction, { type: "show_confirm_card" }>["kind"];
  expectedCuisine?: string;
};

export type NluRoutingResult = {
  id: string;
  utterance: string;
  scenario: NluScenario | null;
  actionType: RouterAction["type"];
  kind: string | null;
  cuisine: string | null;
  pass: boolean;
  notes: string[];
};

function state(overrides: Partial<IntentState>): IntentState {
  return {
    confidence: 0.9,
    turn_count: 1,
    updated_at: "2026-05-06T00:00:00.000Z",
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

export const NLU_ROUTING_FIXTURES: NluRoutingFixture[] = [
  {
    id: "zh-activity-lion-king-trip-shaped",
    utterance: "\u5e2e\u6211\u9884\u5b9a\u4e00\u4e2a\u7ebd\u7ea66\u67081\u53f7\u7684\u767e\u8001\u6c47\u72ee\u5b50\u738b\u770b\u770b",
    locale: "zh",
    rawReply: "old trip reply",
    rawState: state({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: {
        destination_city: "New York",
        start_date: "2026-06-01",
        activities: ["The Lion King"],
        cuisine_preferences: [],
        vibe: "mixed",
        planning_assumptions: [],
      },
    }),
    expectedScenario: "activity",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
  },
  {
    id: "en-activity-lion-king-trip-shaped",
    utterance: "book The Lion King in New York on June 1",
    locale: "en",
    rawReply: "old trip reply",
    rawState: state({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: {
        destination_city: "New York",
        start_date: "2026-06-01",
        activities: ["The Lion King"],
        cuisine_preferences: [],
        vibe: "mixed",
        planning_assumptions: [],
      },
    }),
    expectedScenario: "activity",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
  },
  {
    id: "zh-restaurant-japanese-complete",
    utterance: "\u5e2e\u6211\u8ba2\u4e00\u4e2a\u660e\u665a7\u70b9\u7ebd\u7ea62\u4e2a\u4eba\u7684\u65e5\u6599",
    locale: "zh",
    rawState: state({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "New York",
        date: "2026-05-07",
        time: "19:00",
        party_size: 2,
        cuisine: "Japanese",
      },
    }),
    expectedScenario: "restaurant",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedCuisine: "Japanese",
  },
  {
    id: "zh-hotel-complete",
    utterance: "\u5e2e\u6211\u8ba2\u4e00\u4e2a5\u670820\u53f7\u523024\u53f7\u7684\u7ebd\u7ea6\u9152\u5e97\uff0c\u9884\u7b97300\u4e00\u5929",
    locale: "zh",
    rawState: state({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: {
        city: "New York",
        check_in: "2026-05-20",
        check_out: "2026-05-24",
        budget_max_per_night: 300,
      },
    }),
    expectedScenario: "hotel",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
  },
  {
    id: "zh-flight-complete",
    utterance: "\u5e2e\u6211\u8ba2\u4e00\u4e2a6\u67081\u53f7\u4ece Nashville \u5230\u7ebd\u7ea6\u7684\u673a\u7968",
    locale: "zh",
    rawState: state({
      scenario: "flight",
      categories: ["flight"],
      flight: {
        origin: "Nashville",
        dest: "New York",
        date: "2026-06-01",
        passengers: 1,
      },
    }),
    expectedScenario: "flight",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
  },
  {
    id: "en-trip-complete",
    utterance: "Plan a New York trip June 1 to June 4 from Nashville for two, with hotel, food, flights, and a show",
    locale: "en",
    rawState: state({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: {
        destination_city: "New York",
        departure_city: "Nashville",
        start_date: "2026-06-01",
        end_date: "2026-06-04",
        travelers: 2,
        activities: ["Broadway show"],
        cuisine_preferences: [],
        vibe: "mixed",
        planning_assumptions: [],
      },
    }),
    expectedScenario: "trip",
    expectedActionType: "show_confirm_card",
    expectedKind: "trip",
  },
  {
    id: "en-ambiguous-travel-category",
    utterance: "I want to go to New York next month",
    locale: "en",
    rawState: state({
      scenario: null,
      categories: [],
      trip: {
        destination_city: "New York",
        activities: [],
        cuisine_preferences: [],
        vibe: "mixed",
        planning_assumptions: [],
      },
    }),
    expectedScenario: null,
    expectedActionType: "ask_clarification",
  },
];

export function evaluateNluRoutingMatrix(
  fixtures: NluRoutingFixture[] = NLU_ROUTING_FIXTURES,
): NluRoutingResult[] {
  return fixtures.map((fixture) => {
    const normalized = normalizeSingleActivityTicketRequest(
      fixture.rawState,
      fixture.utterance,
      fixture.rawReply ?? "",
    ).state;
    const action = routeIntent(normalized);
    const kind = action.type === "show_confirm_card" ? action.kind : null;
    const cuisine = normalized.restaurant?.cuisine ?? null;
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
    if (fixture.expectedCuisine && cuisine !== fixture.expectedCuisine) {
      notes.push(`cuisine expected ${fixture.expectedCuisine} got ${cuisine ?? "null"}`);
    }

    return {
      id: fixture.id,
      utterance: fixture.utterance,
      scenario: normalized.scenario,
      actionType: action.type,
      kind,
      cuisine,
      pass: notes.length === 0,
      notes,
    };
  });
}

export function renderNluRoutingMatrixMarkdown(results: NluRoutingResult[]): string {
  const passed = results.filter((result) => result.pass).length;
  const lines = [
    "# NLU Routing Matrix",
    "",
    `Cases: ${results.length}`,
    `Passed: ${passed}`,
    `Failed: ${results.length - passed}`,
    "",
    "| Case | Scenario | Action | Kind | Cuisine | Result |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const result of results) {
    const verdict = result.pass ? "PASS" : `FAIL: ${result.notes.join("; ")}`;
    lines.push(
      `| \`${result.id}\` | ${result.scenario ?? "-"} | ${result.actionType} | ${result.kind ?? "-"} | ${result.cuisine ?? "-"} | ${verdict} |`,
    );
  }

  return lines.join("\n");
}
