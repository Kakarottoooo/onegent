import { routeIntent } from "./router";
import type { IntentState, RouterAction, NluScenario } from "./types";
import { normalizeSingleActivityTicketRequest } from "./unified";

export const NLU_ROUTING_MATRIX_SCOPE =
  "No-live router/normalizer fixtures only. These cases start from prebuilt IntentState objects and do not prove live model extraction.";

export const NLU_ROUTING_MATRIX_TODO =
  "Add extractor fixtures when a deterministic no-live extractor harness exists; do not count these cases as live LLM extraction coverage.";

type ConfirmAction = Extract<RouterAction, { type: "show_confirm_card" }>;
type ConstraintSubset = {
  restaurant?: Partial<NonNullable<IntentState["restaurant"]>>;
  hotel?: Partial<NonNullable<IntentState["hotel"]>>;
  flight?: Partial<NonNullable<IntentState["flight"]>>;
  activity?: Partial<NonNullable<IntentState["activity"]>>;
  trip?: Partial<NonNullable<IntentState["trip"]>>;
};

export type NluRoutingFixture = {
  id: string;
  utterance: string;
  locale: "en" | "zh";
  rawState: IntentState;
  rawReply?: string;
  expectedScenario: NluScenario | null;
  expectedActionType: RouterAction["type"];
  expectedKind?: ConfirmAction["kind"];
  expectedMissing?: string[];
  expectedDirectBooking?: boolean;
  expectedConstraints?: ConstraintSubset;
  dogfoodIds?: string[];
  benchmarkCaseId?: string;
};

export type NluRoutingResult = {
  id: string;
  utterance: string;
  scenario: NluScenario | null;
  actionType: RouterAction["type"];
  kind: string | null;
  directBooking: boolean | null;
  missing: string[];
  constraints: ConstraintSubset;
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

function trip(overrides: Partial<NonNullable<IntentState["trip"]>>): NonNullable<IntentState["trip"]> {
  return {
    destination_city: "New York",
    departure_city: "Nashville",
    start_date: "2026-06-01",
    end_date: "2026-06-04",
    travelers: 2,
    activities: [],
    cuisine_preferences: [],
    vibe: "mixed",
    planning_assumptions: [],
    ...overrides,
  };
}

export const NLU_ROUTING_FIXTURES: NluRoutingFixture[] = [
  {
    id: "zh-activity-lion-king-trip-shaped",
    utterance: "帮我预定一个纽约6月1号的百老汇狮子王看看",
    locale: "zh",
    rawReply: "old trip reply",
    rawState: state({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: trip({
        destination_city: "New York",
        start_date: "2026-06-01",
        activities: ["The Lion King"],
      }),
    }),
    expectedScenario: "activity",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      activity: {
        event_name: "The Lion King",
        city: "New York",
        event_date: "2026-06-01",
        event_type: "theater",
      },
    },
    dogfoodIds: ["DOG-005"],
    benchmarkCaseId: "activity-lion-king-zh-routing",
  },
  {
    id: "en-activity-lion-king-trip-shaped",
    utterance: "book The Lion King in New York on June 1",
    locale: "en",
    rawReply: "old trip reply",
    rawState: state({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: trip({
        destination_city: "New York",
        start_date: "2026-06-01",
        activities: ["The Lion King"],
      }),
    }),
    expectedScenario: "activity",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      activity: {
        event_name: "The Lion King",
        city: "New York",
        event_date: "2026-06-01",
        event_type: "theater",
      },
    },
    dogfoodIds: ["DOG-005"],
    benchmarkCaseId: "activity-lion-king-en-routing",
  },
  {
    id: "zh-restaurant-japanese-complete",
    utterance: "帮我订一个明晚7点纽约2个人的日料",
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
    expectedConstraints: {
      restaurant: {
        city: "New York",
        date: "2026-05-07",
        time: "19:00",
        party_size: 2,
        cuisine: "Japanese",
      },
    },
    dogfoodIds: ["DOG-009"],
    benchmarkCaseId: "restaurant-japanese-routing",
  },
  {
    id: "zh-restaurant-chinese-complete",
    utterance: "帮我订一个明晚7点纽约2个人的中餐",
    locale: "zh",
    rawState: state({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "New York",
        date: "2026-05-07",
        time: "19:00",
        party_size: 2,
        cuisine: "Chinese",
      },
    }),
    expectedScenario: "restaurant",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      restaurant: {
        city: "New York",
        date: "2026-05-07",
        time: "19:00",
        party_size: 2,
        cuisine: "Chinese",
      },
    },
    dogfoodIds: ["DOG-009"],
    benchmarkCaseId: "restaurant-chinese-routing",
  },
  {
    id: "en-restaurant-sushi-nyc",
    utterance: "Find sushi in New York tomorrow at 8 for three",
    locale: "en",
    rawState: state({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "New York",
        date: "2026-05-07",
        time: "20:00",
        party_size: 3,
        cuisine: "Sushi",
      },
    }),
    expectedScenario: "restaurant",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      restaurant: { cuisine: "Sushi", party_size: 3 },
    },
  },
  {
    id: "en-restaurant-direct-carbone",
    utterance: "Book Carbone NYC on May 12 at 7pm for 2",
    locale: "en",
    rawState: state({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        restaurant_name: "Carbone",
        city: "New York",
        date: "2026-05-12",
        time: "19:00",
        party_size: 2,
      },
    }),
    expectedScenario: "restaurant",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedDirectBooking: true,
    expectedConstraints: {
      restaurant: { restaurant_name: "Carbone", city: "New York" },
    },
  },
  {
    id: "en-restaurant-missing-cuisine",
    utterance: "Book dinner in New York tomorrow at 7 for 2",
    locale: "en",
    rawState: state({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "New York",
        date: "2026-05-07",
        time: "19:00",
        party_size: 2,
      },
    }),
    expectedScenario: "restaurant",
    expectedActionType: "ask_clarification",
    expectedMissing: ["cuisine"],
    expectedConstraints: {
      restaurant: { city: "New York", date: "2026-05-07", party_size: 2 },
    },
  },
  {
    id: "en-restaurant-missing-time",
    utterance: "Book Japanese in New York tomorrow for 2",
    locale: "en",
    rawState: state({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "New York",
        date: "2026-05-07",
        party_size: 2,
        cuisine: "Japanese",
      },
    }),
    expectedScenario: "restaurant",
    expectedActionType: "ask_clarification",
    expectedMissing: ["time"],
    expectedConstraints: {
      restaurant: { cuisine: "Japanese", party_size: 2 },
    },
  },
  {
    id: "en-restaurant-party-mode-ambiguous",
    utterance: "Book dinner with my friend in New York tomorrow at 7",
    locale: "en",
    rawState: state({
      scenario: "restaurant",
      categories: ["restaurant"],
      party_type: "multi",
      restaurant: {
        city: "New York",
        date: "2026-05-07",
        time: "19:00",
        party_size: 2,
        cuisine: "Italian",
      },
    }),
    expectedScenario: "restaurant",
    expectedActionType: "ask_clarification",
    expectedMissing: ["party_mode"],
  },
  {
    id: "en-restaurant-room-named-member",
    utterance: "Create a room with Maya for Thai in Brooklyn tomorrow at 7",
    locale: "en",
    rawState: state({
      intent: "create_room",
      scenario: "restaurant",
      categories: ["restaurant"],
      party_type: "multi",
      member_names: ["Maya"],
      restaurant: {
        city: "Brooklyn",
        date: "2026-05-07",
        time: "19:00",
        party_size: 2,
        cuisine: "Thai",
      },
    }),
    expectedScenario: "restaurant",
    expectedActionType: "show_confirm_card",
    expectedKind: "room",
    expectedConstraints: {
      restaurant: { cuisine: "Thai", city: "Brooklyn" },
    },
  },
  {
    id: "en-restaurant-vegan-budget",
    utterance: "Reserve vegan dinner in Austin Friday at 6:30 for 4 under $60 each",
    locale: "en",
    rawState: state({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "Austin",
        date: "2026-05-08",
        time: "18:30",
        party_size: 4,
        cuisine: "Vegan",
        budget_per_person: 60,
        dietary: ["vegan"],
      },
    }),
    expectedScenario: "restaurant",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      restaurant: { cuisine: "Vegan", budget_per_person: 60, dietary: ["vegan"] },
    },
  },
  {
    id: "zh-restaurant-refine-cuisine",
    utterance: "把刚才的餐厅改成中餐",
    locale: "zh",
    rawState: state({
      intent: "refine_existing",
      scenario: "restaurant",
      categories: ["restaurant"],
      refined_target_id: "plan_123",
      restaurant: { city: "New York", cuisine: "Chinese" },
    }),
    expectedScenario: "restaurant",
    expectedActionType: "continue_chat",
    expectedConstraints: {
      restaurant: { cuisine: "Chinese" },
    },
    dogfoodIds: ["DOG-009"],
  },
  {
    id: "en-restaurant-any-cuisine",
    utterance: "Any cuisine is fine, book Boston tomorrow at 7 for 2",
    locale: "en",
    rawState: state({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "Boston",
        date: "2026-05-07",
        time: "19:00",
        party_size: 2,
        cuisine: "any",
      },
    }),
    expectedScenario: "restaurant",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      restaurant: { cuisine: "any" },
    },
  },
  {
    id: "en-restaurant-dietary-shellfish",
    utterance: "Dinner in Seattle tomorrow 7pm for 2, no shellfish",
    locale: "en",
    rawState: state({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "Seattle",
        date: "2026-05-07",
        time: "19:00",
        party_size: 2,
        cuisine: "Seafood",
        dietary: ["no shellfish"],
      },
    }),
    expectedScenario: "restaurant",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      restaurant: { dietary: ["no shellfish"], cuisine: "Seafood" },
    },
  },
  {
    id: "zh-hotel-complete",
    utterance: "帮我订一个5月20号到24号的纽约酒店，预算300一天",
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
    expectedConstraints: {
      hotel: {
        city: "New York",
        check_in: "2026-05-20",
        check_out: "2026-05-24",
        budget_max_per_night: 300,
      },
    },
    dogfoodIds: ["DOG-010"],
    benchmarkCaseId: "hotel-nyc-budget-routing",
  },
  {
    id: "en-hotel-nyc-budget",
    utterance: "Book a New York hotel May 20 to May 24 under $300 a night",
    locale: "en",
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
    expectedConstraints: {
      hotel: { city: "New York", budget_max_per_night: 300 },
    },
    dogfoodIds: ["DOG-010"],
  },
  {
    id: "en-hotel-nights-satisfy-checkout",
    utterance: "Find a Chicago hotel starting June 1 for 3 nights",
    locale: "en",
    rawState: state({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: {
        city: "Chicago",
        check_in: "2026-06-01",
        nights: 3,
      },
    }),
    expectedScenario: "hotel",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      hotel: { city: "Chicago", check_in: "2026-06-01", nights: 3 },
    },
  },
  {
    id: "en-hotel-missing-checkout",
    utterance: "Find a hotel in Chicago on June 1",
    locale: "en",
    rawState: state({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: {
        city: "Chicago",
        check_in: "2026-06-01",
      },
    }),
    expectedScenario: "hotel",
    expectedActionType: "ask_clarification",
    expectedMissing: ["check_out"],
  },
  {
    id: "en-hotel-direct-pierre",
    utterance: "Book The Pierre in New York May 20 to May 24",
    locale: "en",
    rawState: state({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: {
        hotel_name: "The Pierre",
        city: "New York",
        check_in: "2026-05-20",
        check_out: "2026-05-24",
      },
    }),
    expectedScenario: "hotel",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedDirectBooking: true,
    expectedConstraints: {
      hotel: { hotel_name: "The Pierre", city: "New York" },
    },
  },
  {
    id: "en-hotel-guests-star-rating",
    utterance: "Four star hotel in Miami June 5 to 8 for two guests",
    locale: "en",
    rawState: state({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: {
        city: "Miami",
        check_in: "2026-06-05",
        check_out: "2026-06-08",
        guests: 2,
        star_rating: 4,
      },
    }),
    expectedScenario: "hotel",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      hotel: { guests: 2, star_rating: 4 },
    },
  },
  {
    id: "en-hotel-neighborhood",
    utterance: "Find a SoHo hotel in New York May 20 to 24",
    locale: "en",
    rawState: state({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: {
        city: "New York",
        check_in: "2026-05-20",
        check_out: "2026-05-24",
        neighborhood: "SoHo",
      },
    }),
    expectedScenario: "hotel",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      hotel: { neighborhood: "SoHo" },
    },
  },
  {
    id: "en-hotel-budget-date",
    utterance: "LA hotel June 10 to June 12, budget 180 per night",
    locale: "en",
    rawState: state({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: {
        city: "Los Angeles",
        check_in: "2026-06-10",
        check_out: "2026-06-12",
        budget_max_per_night: 180,
      },
    }),
    expectedScenario: "hotel",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      hotel: { city: "Los Angeles", budget_max_per_night: 180 },
    },
  },
  {
    id: "en-hotel-refine-budget",
    utterance: "Change that hotel budget to 300 max",
    locale: "en",
    rawState: state({
      intent: "refine_existing",
      scenario: "hotel",
      categories: ["hotel"],
      refined_target_id: "hotel_plan_1",
      hotel: {
        city: "New York",
        budget_max_per_night: 300,
      },
    }),
    expectedScenario: "hotel",
    expectedActionType: "continue_chat",
    expectedConstraints: {
      hotel: { budget_max_per_night: 300 },
    },
    dogfoodIds: ["DOG-010"],
  },
  {
    id: "en-hotel-missing-city",
    utterance: "Book a hotel May 20 to May 24 under 300",
    locale: "en",
    rawState: state({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: {
        check_in: "2026-05-20",
        check_out: "2026-05-24",
        budget_max_per_night: 300,
      },
    }),
    expectedScenario: "hotel",
    expectedActionType: "ask_clarification",
    expectedMissing: ["city"],
  },
  {
    id: "zh-flight-complete",
    utterance: "帮我订一个6月1号从Nashville到纽约的机票",
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
    expectedConstraints: {
      flight: {
        origin: "Nashville",
        dest: "New York",
        date: "2026-06-01",
        passengers: 1,
      },
    },
    benchmarkCaseId: "flight-bna-nyc-routing",
  },
  {
    id: "en-flight-bna-nyc-oneway",
    utterance: "Book a flight from Nashville to New York on June 1",
    locale: "en",
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
    expectedConstraints: {
      flight: { origin: "Nashville", dest: "New York", date: "2026-06-01" },
    },
  },
  {
    id: "en-flight-roundtrip",
    utterance: "Round trip SFO to New York June 1 returning June 5",
    locale: "en",
    rawState: state({
      scenario: "flight",
      categories: ["flight"],
      flight: {
        origin: "San Francisco",
        dest: "New York",
        date: "2026-06-01",
        return_date: "2026-06-05",
        is_round_trip: true,
      },
    }),
    expectedScenario: "flight",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      flight: { return_date: "2026-06-05", is_round_trip: true },
    },
  },
  {
    id: "en-flight-business-passengers",
    utterance: "Business class from Boston to London July 2 for two",
    locale: "en",
    rawState: state({
      scenario: "flight",
      categories: ["flight"],
      flight: {
        origin: "Boston",
        dest: "London",
        date: "2026-07-02",
        passengers: 2,
        cabin_class: "business",
      },
    }),
    expectedScenario: "flight",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      flight: { passengers: 2, cabin_class: "business" },
    },
  },
  {
    id: "en-flight-missing-origin",
    utterance: "Get me to New York on June 1",
    locale: "en",
    rawState: state({
      scenario: "flight",
      categories: ["flight"],
      flight: {
        dest: "New York",
        date: "2026-06-01",
      },
    }),
    expectedScenario: "flight",
    expectedActionType: "ask_clarification",
    expectedMissing: ["origin"],
  },
  {
    id: "en-flight-avoid-red-eye",
    utterance: "Flight from Seattle to New York June 1, avoid red eyes",
    locale: "en",
    rawState: state({
      scenario: "flight",
      categories: ["flight"],
      flight: {
        origin: "Seattle",
        dest: "New York",
        date: "2026-06-01",
        avoid_red_eye: true,
      },
    }),
    expectedScenario: "flight",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      flight: { avoid_red_eye: true },
    },
  },
  {
    id: "en-flight-sfo-lax",
    utterance: "SFO to LAX next Friday for one passenger",
    locale: "en",
    rawState: state({
      scenario: "flight",
      categories: ["flight"],
      flight: {
        origin: "SFO",
        dest: "LAX",
        date: "2026-05-08",
        passengers: 1,
      },
    }),
    expectedScenario: "flight",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      flight: { origin: "SFO", dest: "LAX", passengers: 1 },
    },
  },
  {
    id: "en-flight-family-passengers",
    utterance: "Book flights from Dallas to Orlando June 20 for four people",
    locale: "en",
    rawState: state({
      scenario: "flight",
      categories: ["flight"],
      flight: {
        origin: "Dallas",
        dest: "Orlando",
        date: "2026-06-20",
        passengers: 4,
      },
    }),
    expectedScenario: "flight",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      flight: { passengers: 4 },
    },
  },
  {
    id: "en-flight-refine-departure-window",
    utterance: "Make the flight after 2pm",
    locale: "en",
    rawState: state({
      intent: "refine_existing",
      scenario: "flight",
      categories: ["flight"],
      refined_target_id: "flight_plan_1",
      flight: {
        origin: "Nashville",
        dest: "New York",
        date: "2026-06-01",
        earliest_departure: "14:00",
      },
    }),
    expectedScenario: "flight",
    expectedActionType: "continue_chat",
    expectedConstraints: {
      flight: { earliest_departure: "14:00" },
    },
  },
  {
    id: "en-flight-missing-date",
    utterance: "Book Nashville to New York",
    locale: "en",
    rawState: state({
      scenario: "flight",
      categories: ["flight"],
      flight: {
        origin: "Nashville",
        dest: "New York",
      },
    }),
    expectedScenario: "flight",
    expectedActionType: "ask_clarification",
    expectedMissing: ["departure_date"],
  },
  {
    id: "zh-activity-hamilton-complete",
    utterance: "帮我买6月1号纽约Hamilton两张票",
    locale: "zh",
    rawState: state({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "Hamilton",
        event_type: "theater",
        city: "New York",
        event_date: "2026-06-01",
        num_tickets: 2,
      },
    }),
    expectedScenario: "activity",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      activity: { event_name: "Hamilton", city: "New York", num_tickets: 2 },
    },
  },
  {
    id: "en-activity-hamilton-complete",
    utterance: "Book Hamilton in New York on June 1",
    locale: "en",
    rawState: state({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "Hamilton",
        event_type: "theater",
        city: "New York",
        event_date: "2026-06-01",
      },
    }),
    expectedScenario: "activity",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      activity: { event_name: "Hamilton", event_type: "theater" },
    },
  },
  {
    id: "en-activity-knicks",
    utterance: "Find Knicks tickets in New York on May 18",
    locale: "en",
    rawState: state({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "Knicks",
        event_type: "sports",
        city: "New York",
        event_date: "2026-05-18",
      },
    }),
    expectedScenario: "activity",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      activity: { event_type: "sports", city: "New York" },
    },
  },
  {
    id: "en-activity-concert-budget",
    utterance: "Two Sabrina Carpenter tickets in LA June 7 under $200 each",
    locale: "en",
    rawState: state({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "Sabrina Carpenter",
        event_type: "concert",
        city: "Los Angeles",
        event_date: "2026-06-07",
        num_tickets: 2,
        budget_max_per_ticket: 200,
      },
    }),
    expectedScenario: "activity",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      activity: { event_type: "concert", budget_max_per_ticket: 200 },
    },
  },
  {
    id: "en-activity-missing-date",
    utterance: "Book The Lion King in New York",
    locale: "en",
    rawState: state({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "The Lion King",
        event_type: "theater",
        city: "New York",
      },
    }),
    expectedScenario: "activity",
    expectedActionType: "ask_clarification",
    expectedMissing: ["event_date"],
  },
  {
    id: "en-activity-missing-city",
    utterance: "Book The Lion King on June 1",
    locale: "en",
    rawState: state({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "The Lion King",
        event_type: "theater",
        event_date: "2026-06-01",
      },
    }),
    expectedScenario: "activity",
    expectedActionType: "ask_clarification",
    expectedMissing: ["city"],
  },
  {
    id: "en-activity-two-tickets",
    utterance: "Two tickets for Wicked in Chicago on June 3",
    locale: "en",
    rawState: state({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "Wicked",
        event_type: "theater",
        city: "Chicago",
        event_date: "2026-06-03",
        num_tickets: 2,
      },
    }),
    expectedScenario: "activity",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      activity: { event_name: "Wicked", num_tickets: 2 },
    },
  },
  {
    id: "en-activity-refine-seats",
    utterance: "Make the seats premium",
    locale: "en",
    rawState: state({
      intent: "refine_existing",
      scenario: "activity",
      categories: ["activity"],
      refined_target_id: "activity_plan_1",
      activity: {
        event_name: "Hamilton",
        city: "New York",
        event_date: "2026-06-01",
        seat_type: "premium",
      },
    }),
    expectedScenario: "activity",
    expectedActionType: "continue_chat",
    expectedConstraints: {
      activity: { seat_type: "premium" },
    },
  },
  {
    id: "en-activity-exhibition",
    utterance: "Get MoMA exhibition tickets in New York on May 21",
    locale: "en",
    rawState: state({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "MoMA exhibition",
        event_type: "exhibition",
        city: "New York",
        event_date: "2026-05-21",
      },
    }),
    expectedScenario: "activity",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      activity: { event_type: "exhibition" },
    },
  },
  {
    id: "en-activity-comedy",
    utterance: "Comedy show in Austin on June 2",
    locale: "en",
    rawState: state({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "Comedy show",
        event_type: "comedy",
        city: "Austin",
        event_date: "2026-06-02",
      },
    }),
    expectedScenario: "activity",
    expectedActionType: "show_confirm_card",
    expectedKind: "plan",
    expectedConstraints: {
      activity: { event_type: "comedy", city: "Austin" },
    },
  },
  {
    id: "en-trip-complete",
    utterance: "Plan a New York trip June 1 to June 4 from Nashville for two, with hotel, food, flights, and a show",
    locale: "en",
    rawState: state({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: trip({
        destination_city: "New York",
        departure_city: "Nashville",
        start_date: "2026-06-01",
        end_date: "2026-06-04",
        travelers: 2,
        activities: ["Broadway show"],
      }),
    }),
    expectedScenario: "trip",
    expectedActionType: "show_confirm_card",
    expectedKind: "trip",
    expectedConstraints: {
      trip: {
        destination_city: "New York",
        departure_city: "Nashville",
        travelers: 2,
      },
    },
    benchmarkCaseId: "trip-all-verticals-routing",
  },
  {
    id: "zh-trip-complete",
    utterance: "帮我订一个纽约四天三晚的行程，酒店机票餐厅演出都要",
    locale: "zh",
    rawState: state({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: trip({
        destination_city: "New York",
        departure_city: "Nashville",
        start_date: "2026-06-01",
        nights: 3,
        travelers: 2,
        activities: ["Broadway show"],
        cuisine_preferences: ["Chinese"],
      }),
    }),
    expectedScenario: "trip",
    expectedActionType: "show_confirm_card",
    expectedKind: "trip",
    expectedConstraints: {
      trip: { nights: 3, travelers: 2, cuisine_preferences: ["Chinese"] },
    },
  },
  {
    id: "en-trip-lion-king-explicit-trip",
    utterance: "Plan a full New York trip with The Lion King on June 1, hotel, flights, and restaurants",
    locale: "en",
    rawReply: "old trip reply",
    rawState: state({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: trip({
        destination_city: "New York",
        departure_city: "Nashville",
        start_date: "2026-06-01",
        end_date: "2026-06-04",
        travelers: 2,
        activities: ["The Lion King"],
      }),
    }),
    expectedScenario: "trip",
    expectedActionType: "show_confirm_card",
    expectedKind: "trip",
    expectedConstraints: {
      trip: { activities: ["The Lion King"] },
    },
  },
  {
    id: "en-trip-missing-travelers",
    utterance: "Plan a New York trip June 1 to June 4 from Nashville",
    locale: "en",
    rawState: state({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: trip({
        destination_city: "New York",
        departure_city: "Nashville",
        start_date: "2026-06-01",
        end_date: "2026-06-04",
        travelers: undefined,
      }),
    }),
    expectedScenario: "trip",
    expectedActionType: "ask_clarification",
    expectedMissing: ["traveler_count"],
  },
  {
    id: "en-trip-missing-date-range",
    utterance: "Plan a New York package from Nashville for two",
    locale: "en",
    rawState: state({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: trip({
        destination_city: "New York",
        departure_city: "Nashville",
        start_date: undefined,
        end_date: undefined,
        nights: undefined,
        travelers: 2,
      }),
    }),
    expectedScenario: "trip",
    expectedActionType: "ask_clarification",
    expectedMissing: ["date_range"],
  },
  {
    id: "en-composite-restaurant-activity",
    utterance: "Plan dinner and a show in New York tomorrow for two",
    locale: "en",
    rawState: state({
      scenario: "restaurant",
      categories: ["restaurant", "activity"],
      restaurant: {
        city: "New York",
        date: "2026-05-07",
        time: "19:00",
        party_size: 2,
        cuisine: "any",
      },
      activity: {
        city: "New York",
        event_date: "2026-05-07",
        event_name: "Broadway show",
        num_tickets: 2,
      },
    }),
    expectedScenario: "restaurant",
    expectedActionType: "show_confirm_card",
    expectedKind: "composite_plan",
    expectedConstraints: {
      restaurant: { city: "New York", party_size: 2 },
      activity: { event_name: "Broadway show" },
    },
  },
  {
    id: "en-composite-hotel-flight",
    utterance: "Book my flight and hotel for New York June 1 to 4",
    locale: "en",
    rawState: state({
      scenario: "flight",
      categories: ["flight", "hotel"],
      flight: {
        origin: "Nashville",
        dest: "New York",
        date: "2026-06-01",
      },
      hotel: {
        city: "New York",
        check_in: "2026-06-01",
        check_out: "2026-06-04",
      },
    }),
    expectedScenario: "flight",
    expectedActionType: "show_confirm_card",
    expectedKind: "composite_plan",
    expectedConstraints: {
      flight: { origin: "Nashville", dest: "New York" },
      hotel: { city: "New York" },
    },
  },
  {
    id: "en-room-trip-named-members",
    utterance: "Create a room with Alex for a New York trip June 1 to 4 from Nashville",
    locale: "en",
    rawState: state({
      intent: "create_room",
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      party_type: "multi",
      member_names: ["Alex"],
      trip: trip({
        destination_city: "New York",
        departure_city: "Nashville",
        start_date: "2026-06-01",
        end_date: "2026-06-04",
        travelers: 2,
      }),
    }),
    expectedScenario: "trip",
    expectedActionType: "show_confirm_card",
    expectedKind: "trip",
    expectedConstraints: {
      trip: { destination_city: "New York", travelers: 2 },
    },
  },
  {
    id: "en-ambiguous-travel-category",
    utterance: "I want to go to New York next month",
    locale: "en",
    rawState: state({
      scenario: null,
      categories: [],
      trip: trip({
        destination_city: "New York",
        start_date: undefined,
        end_date: undefined,
      }),
    }),
    expectedScenario: null,
    expectedActionType: "ask_clarification",
    expectedMissing: ["categories"],
  },
  {
    id: "zh-ambiguous-destination-only",
    utterance: "我想去纽约，下个月",
    locale: "zh",
    rawState: state({
      scenario: null,
      categories: [],
      trip: trip({
        destination_city: "New York",
        start_date: undefined,
        end_date: undefined,
      }),
    }),
    expectedScenario: null,
    expectedActionType: "ask_clarification",
    expectedMissing: ["categories"],
  },
  {
    id: "en-chitchat",
    utterance: "hello, what can you do?",
    locale: "en",
    rawState: state({
      intent: "chitchat",
      scenario: null,
      categories: [],
    }),
    expectedScenario: null,
    expectedActionType: "continue_chat",
  },
  {
    id: "en-unknown-nontravel",
    utterance: "Write me a Python script for Fibonacci",
    locale: "en",
    rawState: state({
      intent: "unknown",
      scenario: null,
      categories: [],
    }),
    expectedScenario: null,
    expectedActionType: "continue_chat",
  },
  {
    id: "en-profile-edit-email",
    utterance: "Save my email as founder@example.test",
    locale: "en",
    rawState: state({
      intent: "profile_edit",
      scenario: null,
      categories: [],
      profile_patch: {
        email: "founder@example.test",
      },
    }),
    expectedScenario: null,
    expectedActionType: "apply_profile_patch",
  },
  {
    id: "en-profile-edit-empty-patch",
    utterance: "Save that",
    locale: "en",
    rawState: state({
      intent: "profile_edit",
      scenario: null,
      categories: [],
      profile_patch: {},
    }),
    expectedScenario: null,
    expectedActionType: "continue_chat",
  },
  {
    id: "en-refine-existing-generic",
    utterance: "Make it cheaper",
    locale: "en",
    rawState: state({
      intent: "refine_existing",
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      refined_target_id: "trip_1",
      trip: trip({
        budget_total: 1200,
      }),
    }),
    expectedScenario: "trip",
    expectedActionType: "continue_chat",
    expectedConstraints: {
      trip: { budget_total: 1200 },
    },
  },
  {
    id: "zh-refine-budget-generic",
    utterance: "改成预算300以内",
    locale: "zh",
    rawState: state({
      intent: "refine_existing",
      scenario: "hotel",
      categories: ["hotel"],
      refined_target_id: "hotel_1",
      hotel: {
        city: "New York",
        budget_max_per_night: 300,
      },
    }),
    expectedScenario: "hotel",
    expectedActionType: "continue_chat",
    expectedConstraints: {
      hotel: { budget_max_per_night: 300 },
    },
    dogfoodIds: ["DOG-010"],
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
    const directBooking = action.type === "show_confirm_card" ? Boolean(action.directBooking) : null;
    const missing = action.type === "ask_clarification" ? action.missing : [];
    const constraints = collectConstraints(normalized);
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
    if (
      typeof fixture.expectedDirectBooking === "boolean" &&
      directBooking !== fixture.expectedDirectBooking
    ) {
      notes.push(`directBooking expected ${fixture.expectedDirectBooking} got ${directBooking ?? "null"}`);
    }
    if (fixture.expectedMissing) {
      compareArrays("missing", fixture.expectedMissing, missing, notes);
    }
    compareConstraintSubset(fixture.expectedConstraints ?? {}, constraints, notes);

    return {
      id: fixture.id,
      utterance: fixture.utterance,
      scenario: normalized.scenario,
      actionType: action.type,
      kind,
      directBooking,
      missing,
      constraints,
      pass: notes.length === 0,
      notes,
    };
  });
}

function collectConstraints(state: IntentState): ConstraintSubset {
  return {
    ...(state.restaurant ? { restaurant: state.restaurant } : {}),
    ...(state.hotel ? { hotel: state.hotel } : {}),
    ...(state.flight ? { flight: state.flight } : {}),
    ...(state.activity ? { activity: state.activity } : {}),
    ...(state.trip ? { trip: state.trip } : {}),
  };
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
        notes.push(`${key}.${field} expected ${formatValue(expectedValue)} got ${formatValue(actualValue)}`);
      }
    }
  }
}

function compareArrays(
  label: string,
  expected: unknown[],
  actual: unknown[],
  notes: string[],
): void {
  if (expected.length !== actual.length || expected.some((value, index) => actual[index] !== value)) {
    notes.push(`${label} expected ${formatValue(expected)} got ${formatValue(actual)}`);
  }
}

function formatValue(value: unknown): string {
  return JSON.stringify(value);
}

export function renderNluRoutingMatrixMarkdown(results: NluRoutingResult[]): string {
  const passed = results.filter((result) => result.pass).length;
  const lines = [
    "# NLU Routing Matrix",
    "",
    NLU_ROUTING_MATRIX_SCOPE,
    "",
    `Cases: ${results.length}`,
    `Passed: ${passed}`,
    `Failed: ${results.length - passed}`,
    "",
    "## Extractor Coverage Gap",
    "",
    NLU_ROUTING_MATRIX_TODO,
    "",
    "| Case | Scenario | Action | Kind | Missing | Result |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const result of results) {
    const verdict = result.pass ? "PASS" : `FAIL: ${result.notes.join("; ")}`;
    lines.push(
      `| \`${result.id}\` | ${result.scenario ?? "-"} | ${result.actionType} | ${result.kind ?? "-"} | ${result.missing.join(", ") || "-"} | ${verdict} |`,
    );
  }

  return lines.join("\n");
}
