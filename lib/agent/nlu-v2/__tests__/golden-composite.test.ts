/**
 * Golden test cases for NLU v2 · gaps left by the original suite.
 *
 * Adds coverage for branches that golden-solo / golden-multi / golden-trip /
 * router.test.ts didn't reach:
 *
 *   1. Composite plans  (solo + N≥2 categories → kind="composite_plan")
 *      The whole composite branch in routeIntent (lines 187-200) had ZERO
 *      golden tests before this file.
 *
 *   2. Multi-DR routing edge cases (categories.length × scenario interactions)
 *
 *   3. Boundary conditions on required-field validators (party_size=0/1,
 *      hotel nights=0/1, restaurant_name short-circuit on empty cuisine)
 *
 *   4. planning_assumptions preservation in buildStateSummary
 *
 *   5. flattenScenarioFields edge cases (composite, hotel_name with multi,
 *      stripUndef boundary)
 *
 * Pure-router tests — no LLM, no API key needed. Run via:
 *   npx vitest run lib/agent/nlu-v2/__tests__/golden-composite.test.ts
 */

import { describe, it, expect } from "vitest";
import { routeIntent, getMissingForScenario, buildStateSummary } from "../router";
import { flattenScenarioFields } from "../index";
import type { IntentState } from "../types";

// ─── Base state builder ─────────────────────────────────────────────────

const baseState = (overrides: Partial<IntentState> = {}): IntentState => {
  const base: IntentState = {
    confidence: 0.9,
    turn_count: 1,
    updated_at: "2026-05-02T00:00:00Z",
    intent: "create_plan",
    scenario: null,
    categories: [],
    party_type: "solo",
    member_names: [],
    refined_target_id: null,
    planning_assumptions: [],
  };
  return { ...base, ...overrides };
};

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1 — Composite plans (solo + N≥2 categories)
// ═══════════════════════════════════════════════════════════════════════

describe("Golden composite plan · solo create_plan with N≥2 categories", () => {
  it("C1. restaurant+activity, both filled → kind=composite_plan", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant", "activity"],
      restaurant: {
        city: "New York",
        date: "2026-05-14",
        time: "19:00",
        party_size: 2,
        cuisine: "Italian",
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("composite_plan");
      expect(action.directBooking).toBeUndefined();
    }
  });

  it("C2. restaurant+activity, restaurant missing time → ask_clarification (gates on first scenario)", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant", "activity"],
      restaurant: { city: "NYC", date: "2026-05-14", party_size: 2, cuisine: "Italian" },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("time");
    }
  });

  it("C3. hotel+flight, both filled → kind=composite_plan", () => {
    const state = baseState({
      scenario: "hotel",
      categories: ["hotel", "flight"],
      hotel: { city: "Tokyo", check_in: "2026-06-01", check_out: "2026-06-05" },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("composite_plan");
    }
  });

  it("C4. 3 categories with first scenario complete → kind=composite_plan", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant", "hotel", "activity"],
      restaurant: { city: "LA", date: "2026-05-15", time: "20:00", party_size: 3, cuisine: "any" },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("composite_plan");
    }
  });

  it("C5. Solo + 4 categories with scenario!='trip' → composite_plan (NOT trip — trip requires scenario='trip')", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant", "hotel", "flight", "activity"],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 2, cuisine: "Japanese" },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("composite_plan");
      // Importantly, NOT "trip" — that's reserved for scenario==="trip" path.
    }
  });

  it("C6. composite + restaurant_name set → composite_plan, NO directBooking flag", () => {
    // Direct-booking shortcut only applies on the solo+1-category branch.
    // Composite plans always render the multi-column layout regardless of
    // whether the user named one specific venue for one of the slots.
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant", "activity"],
      restaurant: {
        restaurant_name: "Carbone",
        city: "NYC",
        date: "2026-05-14",
        time: "19:00",
        party_size: 2,
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("composite_plan");
      expect(action.directBooking).toBeUndefined();
    }
  });

  it("C7. flight+restaurant where flight is FIRST category — gating uses scenario (flight) fields", () => {
    // categories[0] = "flight", but scenario explicitly = "flight" — so
    // missing-field check runs against flight fields, not restaurant.
    const state = baseState({
      scenario: "flight",
      categories: ["flight", "restaurant"],
      flight: { origin: "JFK", dest: "LAX", date: "2026-05-14", passengers: 1 },
      // restaurant deliberately empty — should not block since gating is
      // on scenario (flight) not the unfilled "restaurant" slot.
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("composite_plan");
    }
  });

  it("C8. composite missing first scenario's required field → ask + quick picks for that field", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant", "activity"],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", cuisine: "Italian" },
      // missing party_size
    });
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("party_size");
      // Restaurant party_size has known quick-pick options.
      expect(action.suggested_quick_picks).toBeDefined();
      expect(action.suggested_quick_picks?.length).toBeGreaterThan(0);
    }
  });

  it("C9. flattenScenarioFields on composite emits FIRST scenario's keys with renames", () => {
    // Composite path uses scenario==="flight" gating. flatten should
    // rename date → departure_date.
    const state = baseState({
      scenario: "flight",
      categories: ["flight", "hotel"],
      flight: { origin: "JFK", dest: "LAX", date: "2026-05-14", passengers: 1 },
    });
    const flat = flattenScenarioFields(state);
    expect(flat.departure_date).toBe("2026-05-14");
    expect(flat.date).toBeUndefined();
    expect(flat.origin).toBe("JFK");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2 — Multi-DR routing edge cases (categories × scenario × member)
// ═══════════════════════════════════════════════════════════════════════

describe("Golden multi-DR routing · edge cases on category × scenario interactions", () => {
  it("D1. Multi + 2 categories with named member → kind=room", () => {
    const state = baseState({
      intent: "create_room",
      scenario: "restaurant",
      categories: ["restaurant", "activity"],
      party_type: "multi",
      member_names: ["李明"],
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("room");
    }
  });

  it("D2. Multi + 4 categories with scenario!='trip' → kind=room (NOT trip)", () => {
    // Trip kind ONLY when scenario==="trip" AND categories.length===4.
    // 4 categories with scenario==="restaurant" stays a room.
    const state = baseState({
      intent: "create_room",
      scenario: "restaurant",
      categories: ["restaurant", "hotel", "flight", "activity"],
      party_type: "multi",
      member_names: ["小红"],
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("room");
    }
  });

  it("D3. Multi + scenario='trip' + 4 categories, all trip fields filled → kind=trip", () => {
    const state = baseState({
      intent: "create_room",
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      party_type: "multi",
      member_names: ["朋友"],
      trip: {
        destination_city: "Tokyo",
        departure_city: "NYC",
        start_date: "2026-06-01",
        nights: 5,
        travelers: 2,
        activities: [],
      } as IntentState["trip"],
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("trip");
    }
  });

  it("D4. Multi + scenario='trip' + categories.length=3 (mismatch) → kind=room", () => {
    // Trip kind requires BOTH scenario==='trip' AND categories.length===4.
    // Falling short on either falls through to kind=room.
    const state = baseState({
      intent: "create_room",
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant"],
      party_type: "multi",
      member_names: ["朋友"],
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("room");
    }
  });

  it("D5. create_room + no member_names + numeric multi signal (party_size=3) → kind=room", () => {
    // Numeric multi signal admits the request without asking for names.
    const state = baseState({
      intent: "create_room",
      scenario: "restaurant",
      categories: ["restaurant"],
      party_type: "multi",
      member_names: [],
      restaurant: {
        city: "NYC",
        date: "2026-05-14",
        time: "19:00",
        party_size: 3,
        cuisine: "any",
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("room");
    }
  });

  it("D6. create_room + no member_names + NO numeric signal → ask_clarification for member_names", () => {
    const state = baseState({
      intent: "create_room",
      scenario: "restaurant",
      categories: ["restaurant"],
      party_type: "multi",
      member_names: [],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 1, cuisine: "any" },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("member_names");
    }
  });

  it("D7. Multi + 1 category + create_room — DR skips per-category missing-fields gate", () => {
    // Decision Room initiator's seed is enough; details gather inside the
    // room as members chat. So even with restaurant fields missing, the
    // confirm card surfaces for kind=room.
    const state = baseState({
      intent: "create_room",
      scenario: "restaurant",
      categories: ["restaurant"],
      party_type: "multi",
      member_names: ["朋友"],
      restaurant: { city: "NYC" },
      // intentionally missing date / time / party_size / cuisine — DR fills these later
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("room");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3 — Required-field boundary conditions
// ═══════════════════════════════════════════════════════════════════════

describe("Golden boundary conditions · required-field validators", () => {
  it("E1. restaurant party_size=0 → still missing (treated as falsy)", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", cuisine: "any", party_size: 0 },
    });
    expect(getMissingForScenario(state)).toContain("party_size");
  });

  it("E2. restaurant party_size=1 → satisfied (single-person solo dinner is valid)", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", cuisine: "any", party_size: 1 },
    });
    expect(getMissingForScenario(state)).not.toContain("party_size");
    expect(getMissingForScenario(state)).toEqual([]);
  });

  it("E3. restaurant_name set + cuisine='' → cuisine NOT missing (DB short-circuit)", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        restaurant_name: "Carbone",
        cuisine: "",
        city: "NYC",
        date: "2026-05-14",
        time: "19:00",
        party_size: 2,
      },
    });
    expect(getMissingForScenario(state)).not.toContain("cuisine");
  });

  it("E4. restaurant_name='' + cuisine='' → cuisine IS missing", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        restaurant_name: "",
        cuisine: "",
        city: "NYC",
        date: "2026-05-14",
        time: "19:00",
        party_size: 2,
      },
    });
    expect(getMissingForScenario(state)).toContain("cuisine");
  });

  it("E5. restaurant cuisine whitespace-only → still missing (truthy() trims)", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", cuisine: "   ", party_size: 2 },
    });
    expect(getMissingForScenario(state)).toContain("cuisine");
  });

  it("E6. hotel nights=0 + no check_out → check_out still missing", () => {
    const state = baseState({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: { city: "NYC", check_in: "2026-05-14", nights: 0 },
    });
    expect(getMissingForScenario(state)).toContain("check_out");
  });

  it("E7. hotel nights=1 (one-night stay) satisfies check_out", () => {
    const state = baseState({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: { city: "NYC", check_in: "2026-05-14", nights: 1 },
    });
    expect(getMissingForScenario(state)).not.toContain("check_out");
    expect(getMissingForScenario(state)).toEqual([]);
  });

  it("E8. hotel negative nights (-1) → check_out missing (only > 0 satisfies)", () => {
    const state = baseState({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: { city: "NYC", check_in: "2026-05-14", nights: -1 },
    });
    expect(getMissingForScenario(state)).toContain("check_out");
  });

  it("E9. flight passengers=0 NOT a required field — only origin/dest/date are", () => {
    const state = baseState({
      scenario: "flight",
      categories: ["flight"],
      flight: { origin: "JFK", dest: "LAX", date: "2026-05-14", passengers: 0 },
    });
    expect(getMissingForScenario(state)).toEqual([]);
  });

  it("E10. activity event_date_to set but event_date missing → event_date STILL required", () => {
    const state = baseState({
      scenario: "activity",
      categories: ["activity"],
      activity: { event_name: "Hamilton", city: "NYC", event_date_to: "2026-05-20" },
    });
    expect(getMissingForScenario(state)).toContain("event_date");
  });

  it("E11. unknown scenario → ['scenario'] missing (defensive default)", () => {
    const state = baseState({
      // intent is create_plan but scenario is null and categories has stuff
      // — this should never happen in practice (router asks for categories
      // first), but defensive default returns ['scenario'].
      scenario: null,
      categories: ["restaurant"], // pretend categories was set without scenario derive
    });
    // bypass router (which routes empty scenario to ask categories);
    // call getMissingForScenario directly to test its default.
    expect(getMissingForScenario(state)).toEqual(["scenario"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4 — planning_assumptions preservation in buildStateSummary
// ═══════════════════════════════════════════════════════════════════════

describe("Golden state summary · planning_assumptions handling", () => {
  it("P1. Empty assumptions → no suffix in summary", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 2, cuisine: "any" },
      planning_assumptions: [],
    });
    const summary = buildStateSummary(state);
    expect(summary).not.toContain("Planning assumptions:");
  });

  it("P2. Single assumption → suffix appears with the assumption", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 2, cuisine: "any" },
      planning_assumptions: ["assuming dinner reservation, not lunch"],
    });
    const summary = buildStateSummary(state);
    expect(summary).toContain("Planning assumptions: assuming dinner reservation, not lunch");
  });

  it("P3. Multiple assumptions → joined with '; '", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 2, cuisine: "any" },
      planning_assumptions: ["dinner not lunch", "midtown not downtown", "casual not formal"],
    });
    const summary = buildStateSummary(state);
    expect(summary).toContain("dinner not lunch; midtown not downtown; casual not formal");
  });

  it("P4. Whitespace-only / non-string assumptions filtered out", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 2, cuisine: "any" },
      // intentionally include junk values to verify filtering
      planning_assumptions: ["   ", "real one", "", "another real"] as unknown as string[],
    });
    const summary = buildStateSummary(state);
    expect(summary).toContain("real one; another real");
    expect(summary).not.toContain("   ;"); // no empty entries
  });

  it("P5. State summary mentions all filled restaurant fields", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "NYC",
        date: "2026-05-14",
        time: "19:00",
        party_size: 4,
        cuisine: "Japanese",
        budget_per_person: 80,
      },
    });
    const summary = buildStateSummary(state);
    expect(summary).toContain("NYC");
    expect(summary).toContain("2026-05-14");
    expect(summary).toContain("19:00");
    expect(summary).toContain("4"); // party_size
    expect(summary).toContain("Japanese");
    expect(summary).toContain("$80");
  });

  it("P6. State summary in chitchat mode (no scenario) — short blurb", () => {
    const state = baseState({
      intent: "chitchat",
      scenario: null,
      categories: [],
    });
    const summary = buildStateSummary(state);
    expect(summary.toLowerCase()).toContain("chatting");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5 — flattenScenarioFields edge cases
// ═══════════════════════════════════════════════════════════════════════

describe("Golden flattenScenarioFields · field rename + stripUndef edges", () => {
  it("F1. hotel undefined fields stripped", () => {
    const state = baseState({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: {
        city: "NYC",
        check_in: "2026-05-14",
        check_out: "2026-05-15",
        nights: undefined,
        star_rating: undefined,
        guests: undefined,
      },
    });
    const flat = flattenScenarioFields(state);
    expect(flat.city).toBe("NYC");
    expect("nights" in flat).toBe(false);
    expect("stars" in flat).toBe(false);
    expect("star_rating" in flat).toBe(false);
  });

  it("F2. flight without `date` field — no rename needed, returns as-is minus undefined", () => {
    const state = baseState({
      scenario: "flight",
      categories: ["flight"],
      flight: { origin: "JFK", dest: "LAX", passengers: 2 },
    });
    const flat = flattenScenarioFields(state);
    expect(flat.origin).toBe("JFK");
    expect(flat.dest).toBe("LAX");
    expect(flat.passengers).toBe(2);
    expect("date" in flat).toBe(false);
    expect("departure_date" in flat).toBe(false);
  });

  it("F3. activity flatten passes all fields through unchanged (no renames)", () => {
    const state = baseState({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "Hamilton",
        city: "NYC",
        event_date: "2026-05-14",
        num_tickets: 2,
        seat_type: "standard",
      },
    });
    const flat = flattenScenarioFields(state);
    expect(flat.event_name).toBe("Hamilton");
    expect(flat.event_date).toBe("2026-05-14");
    expect(flat.num_tickets).toBe(2);
    expect(flat.seat_type).toBe("standard");
  });

  it("F4. scenario===null → empty object (defensive default)", () => {
    const state = baseState({
      scenario: null,
      categories: [],
    });
    expect(flattenScenarioFields(state)).toEqual({});
  });

  it("F5. flatten doesn't leak fields from non-active scenario", () => {
    // Even if state has stale `hotel` fields lingering, flatten keys off
    // state.scenario only — so a restaurant scenario's flatten emits ONLY
    // restaurant fields.
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "NYC",
        date: "2026-05-14",
        time: "19:00",
        party_size: 2,
        cuisine: "Italian",
      },
      hotel: { city: "Tokyo", check_in: "2026-06-01" }, // STALE
    });
    const flat = flattenScenarioFields(state);
    expect(flat.cuisine).toBe("Italian");
    expect(flat.city).toBe("NYC"); // restaurant city, not Tokyo
    expect("check_in" in flat).toBe(false);
  });
});
