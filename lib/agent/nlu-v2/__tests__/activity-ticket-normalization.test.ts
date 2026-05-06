import { describe, expect, it } from "vitest";
import { routeIntent } from "../router";
import { normalizeSingleActivityTicketRequest } from "../unified";
import type { IntentState } from "../types";

const baseState = (overrides: Partial<IntentState> = {}): IntentState => ({
  confidence: 0.9,
  turn_count: 1,
  updated_at: "2026-05-05T00:00:00Z",
  intent: "create_plan",
  scenario: null,
  categories: [],
  party_type: "solo",
  member_names: [],
  refined_target_id: null,
  planning_assumptions: [],
  ...overrides,
});

describe("single activity ticket normalization", () => {
  it("normalizes a Broadway show that the model shaped as a trip", () => {
    const state = baseState({
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
    });

    const result = normalizeSingleActivityTicketRequest(
      state,
      "\u5e2e\u6211\u9884\u5b9a\u4e00\u4e2a\u7ebd\u7ea66\u67081\u53f7\u7684\u767e\u8001\u6c47\u72ee\u5b50\u738b\u770b\u770b",
      "old trip reply",
    );

    expect(result.state.scenario).toBe("activity");
    expect(result.state.categories).toEqual(["activity"]);
    expect(result.state.activity).toMatchObject({
      event_name: "The Lion King",
      event_type: "theater",
      city: "New York",
      event_date: "2026-06-01",
    });
    expect(result.state.trip).toBeUndefined();
    expect(routeIntent(result.state).type).toBe("show_confirm_card");
    expect(result.reply).not.toContain("end_date");
    expect(result.reply).not.toContain("nights");
    expect(result.reply).not.toContain("travelers");
  });

  it("keeps explicit trip planning requests on the trip path", () => {
    const state = baseState({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: {
        destination_city: "New York",
        start_date: "2026-06-01",
        nights: 3,
        travelers: 2,
        activities: ["Broadway shows"],
        cuisine_preferences: [],
        vibe: "mixed",
        planning_assumptions: [],
      },
    });

    const result = normalizeSingleActivityTicketRequest(
      state,
      "\u5e2e\u6211\u89c4\u5212\u4e00\u4e2a\u7ebd\u7ea6\u4e09\u5929\u65c5\u884c\uff0c\u5305\u62ec\u9152\u5e97\u548c\u72ee\u5b50\u738b",
      "trip reply",
    );

    expect(result.state.scenario).toBe("trip");
    expect(result.state.trip).toBeDefined();
    expect(result.reply).toBe("trip reply");
  });

  it("leaves an already-correct activity state unchanged", () => {
    const state = baseState({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "The Lion King",
        event_type: "theater",
        city: "New York",
        event_date: "2026-06-01",
      },
    });

    const result = normalizeSingleActivityTicketRequest(
      state,
      "book The Lion King on Broadway in New York on June 1",
      "activity reply",
    );

    expect(result.state).toBe(state);
    expect(result.reply).toBe("activity reply");
  });
});
