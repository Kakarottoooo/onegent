/**
 * Golden test cases for NLU v2 · trip scenario pilot.
 *
 * Each case codifies a real-world user input + expected IntentState shape +
 * expected RouterAction type. Tests run the router (Layer 3) against
 * HAND-CONSTRUCTED states that mirror what a well-behaved Layer 2 extractor
 * should have produced. This separates router correctness (unit-testable)
 * from extractor correctness (needs live LLM + integration test).
 *
 * The full extractor + chat pipeline is integration-tested manually via the
 * /api/chat/parse endpoint with NLU_V2_ENABLED_FOR_TRIP=true.
 */

import { describe, it, expect } from "vitest";
import { routeIntent, getMissingForScenario, buildStateSummary } from "../router";
import type { IntentState } from "../types";

// ─── Common state builders ──────────────────────────────────────────────

const baseState = (overrides: Partial<IntentState> = {}): IntentState => ({
  confidence: 0.9,
  turn_count: 1,
  updated_at: "2026-04-23T00:00:00Z",
  intent: "create_plan",
  scenario: "trip",
  party_type: "solo",
  member_names: [],
  refined_target_id: null,
  planning_assumptions: [],
  ...overrides,
});

const tripState = (trip: Partial<IntentState["trip"]>): IntentState =>
  baseState({
    scenario: "trip",
    trip: {
      destination_city: undefined,
      departure_city: undefined,
      start_date: undefined,
      end_date: undefined,
      nights: undefined,
      travelers: undefined,
      hotel_star_rating: undefined,
      hotel_neighborhood: undefined,
      activities: [],
      cuisine_preferences: [],
      vibe: "mixed",
      budget_total: undefined,
      planning_assumptions: [],
      ...trip,
    },
  });

// ─── Golden cases ───────────────────────────────────────────────────────

describe("Golden trip cases · user intent → router decision", () => {
  it("G1. Single-turn: full trip request in one message", () => {
    // "Plan me a 3-day NY trip next weekend, flying from SFO, 2 people,
    //  mid budget, I love Broadway"
    const state = tripState({
      destination_city: "New York",
      departure_city: "San Francisco",
      start_date: "2026-05-02",
      end_date: "2026-05-05",
      nights: 3,
      travelers: 2,
      activities: ["Broadway shows"],
      vibe: "mixed",
    });

    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("trip");
    }
    expect(getMissingForScenario(state)).toEqual([]);
  });

  it("G2. Multi-turn: destination first, nothing else", () => {
    // "I want to go to NY"
    const state = tripState({
      destination_city: "New York",
    });

    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("date_range");
      expect(action.missing).toContain("departure_city");
      expect(action.missing).toContain("traveler_count");
    }
  });

  it("G3. Multi-turn: destination + dates", () => {
    // Turn 1: "I want NY" → asks for more
    // Turn 2: "next weekend for 3 nights"
    const state = tripState({
      destination_city: "New York",
      start_date: "2026-05-02",
      nights: 3,
    });

    const missing = getMissingForScenario(state);
    expect(missing).toContain("departure_city");
    expect(missing).toContain("traveler_count");
    expect(missing).not.toContain("date_range"); // nights satisfies
  });

  it("G4. Chinese multi-turn: 全家去洛杉矶", () => {
    // "我下个月想全家去洛杉矶玩一周，从上海出发，四个人"
    const state = tripState({
      destination_city: "Los Angeles",
      departure_city: "Shanghai",
      start_date: "2026-05-20",
      nights: 7,
      travelers: 4,
      vibe: "mixed",
    });

    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    expect(getMissingForScenario(state)).toEqual([]);
  });

  it("G5. Ambiguous — just 'plan a trip'", () => {
    // "帮我安排一个旅行"
    const state = tripState({});

    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("G6. Vibe keyword detection: 'luxury honeymoon'", () => {
    // "Book us a luxury honeymoon trip to Paris from NYC, April 15-22"
    const state = tripState({
      destination_city: "Paris",
      departure_city: "New York",
      start_date: "2026-04-15",
      end_date: "2026-04-22",
      nights: 7,
      travelers: 2,
      vibe: "upscale",
    });

    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    expect(state.trip?.vibe).toBe("upscale");
  });

  it("G7. Activity hint preserved: 'wanna see Hamilton'", () => {
    // "NY trip, 3 nights from LA, 2 people, gotta see Hamilton"
    const state = tripState({
      destination_city: "New York",
      departure_city: "Los Angeles",
      start_date: "2026-05-02",
      nights: 3,
      travelers: 2,
      activities: ["Hamilton"],
    });

    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    expect(state.trip?.activities).toContain("Hamilton");
  });

  it("G8. Missing dates — asks for date_range, not date", () => {
    // "NY from SFO, 2 people"
    const state = tripState({
      destination_city: "New York",
      departure_city: "San Francisco",
      travelers: 2,
    });

    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("date_range");
      expect(action.missing).not.toContain("date"); // trip uses "date_range"
    }
  });

  it("G9. Multi-party signal: 'me and 3 friends'", () => {
    // "me and 3 friends going to NY this weekend from SFO"
    const state = tripState({
      destination_city: "New York",
      departure_city: "San Francisco",
      start_date: "2026-04-25",
      nights: 2,
      travelers: 4,
    });
    state.party_type = "multi";
    state.intent = "create_room";
    state.member_names = []; // "3 friends" isn't a name

    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      // Trip scenario overrides — even multi-party trip goes to trip card,
      // not room card, per current Phase 1 design (Stage 2 will change this).
      expect(action.kind).toBe("trip");
    }
  });

  it("G10. State summary surfaces what's missing", () => {
    const state = tripState({
      destination_city: "Tokyo",
      start_date: "2026-06-01",
      nights: 5,
    });

    const summary = buildStateSummary(state);
    expect(summary).toContain("Tokyo");
    expect(summary).toContain("5 night");
    expect(summary).toContain("Still needs:");
    expect(summary).toContain("departure_city");
    expect(summary).toContain("traveler_count");
  });
});
