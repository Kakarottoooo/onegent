/**
 * NLU v2 · probing tests — actively try to break router / summary / flatten.
 *
 * Different intent from golden-composite (which documents working
 * behavior): each case here constructs a state that's INCONSISTENT or
 * MALFORMED in some way the extractor could plausibly produce — partial
 * fills, scenario-categories mismatches, undefined sub-states, etc. —
 * and asserts the router / helpers handle it without crashing AND with
 * sensible output.
 *
 * If any of these tests fails, that's a real bug. If they all pass, the
 * router has good defensive coverage and we've documented it.
 *
 * Pure-router. No LLM, no API key.
 */

import { describe, it, expect } from "vitest";
import { routeIntent, getMissingForScenario, buildStateSummary } from "../router";
import { flattenScenarioFields } from "../index";
import type { IntentState } from "../types";

const baseState = (overrides: Partial<IntentState> = {}): IntentState => ({
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
  ...overrides,
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6 — State inconsistency probing
// ═══════════════════════════════════════════════════════════════════════

describe("Probing · scenario / categories / sub-state mismatches", () => {
  it("I1. scenario='restaurant' but state.restaurant undefined → all required fields missing, no crash", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      // restaurant: deliberately undefined
    });
    expect(() => getMissingForScenario(state)).not.toThrow();
    const missing = getMissingForScenario(state);
    expect(missing).toContain("city");
    expect(missing).toContain("cuisine");
    expect(missing).toContain("date");
    expect(missing).toContain("time");
    expect(missing).toContain("party_size");
  });

  it("I2. scenario='hotel' but state.hotel undefined → city/check_in/check_out missing, no crash", () => {
    const state = baseState({
      scenario: "hotel",
      categories: ["hotel"],
    });
    expect(() => getMissingForScenario(state)).not.toThrow();
    expect(getMissingForScenario(state)).toEqual(
      expect.arrayContaining(["city", "check_in", "check_out"]),
    );
  });

  it("I3. scenario='flight' but state.flight undefined → all 3 required fields missing", () => {
    const state = baseState({
      scenario: "flight",
      categories: ["flight"],
    });
    expect(() => getMissingForScenario(state)).not.toThrow();
    expect(getMissingForScenario(state)).toEqual(
      expect.arrayContaining(["origin", "dest", "departure_date"]),
    );
  });

  it("I4. scenario does NOT match categories[0] — router still gates on scenario, not categories[0]", () => {
    // Inconsistent state: scenario points at hotel but categories starts
    // with restaurant. The router uses `state.scenario` for missing-fields
    // check, so it asks for hotel fields. This documents that scenario is
    // load-bearing — categories is a richer signal but scenario wins.
    const state = baseState({
      scenario: "hotel",
      categories: ["restaurant", "hotel"],
      // restaurant fields filled; hotel empty
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 2, cuisine: "any" },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      // Asks for hotel fields, not restaurant.
      expect(action.missing).toContain("city");
      expect(action.missing).toContain("check_in");
    }
  });

  it("I5. scenario='trip' + categories.length=4 + state.trip undefined → returns 4 missing fields cleanly", () => {
    const state = baseState({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
    });
    expect(() => routeIntent(state)).not.toThrow();
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toEqual(
        expect.arrayContaining(["destination_city", "date_range", "departure_city", "traveler_count"]),
      );
    }
  });

  it("I6. scenario='trip' + categories.length=2 → falls into trip path FIRST (line 175 before line 190)", () => {
    // The router checks scenario==='trip' BEFORE categories.length>=2.
    // So a partial trip state goes through trip path with missingTrip.
    // Documents the precedence — could be a future-refactor footgun.
    const state = baseState({
      scenario: "trip",
      categories: ["hotel", "flight"],
    });
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      // Trip's missing fields, NOT composite missing fields.
      expect(action.missing).toEqual(
        expect.arrayContaining(["destination_city"]),
      );
    }
  });

  it("I7. categories has duplicates — router treats length naively (does NOT dedupe)", () => {
    // Document: categories=["restaurant","restaurant"] has length 2,
    // so it routes through the composite path. This is a low-priority
    // bug — the extractor shouldn't produce duplicates — but worth
    // pinning so a future "dedupe categories" fix doesn't silently
    // change routing behavior.
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant", "restaurant"],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 2, cuisine: "any" },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      // Currently: routes to composite_plan because categories.length === 2.
      // If router gains a dedupe pass, this should change to "plan" — and
      // this test will catch it.
      expect(action.kind).toBe("composite_plan");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 7 — refine_existing edge cases
// ═══════════════════════════════════════════════════════════════════════

describe("Probing · refine_existing intent should always continue_chat", () => {
  it("RE1. refine_existing + party_type=solo + complete restaurant → still continue_chat", () => {
    const state = baseState({
      intent: "refine_existing",
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 2, cuisine: "any" },
      refined_target_id: "plan_abc",
    });
    const action = routeIntent(state);
    expect(action.type).toBe("continue_chat");
  });

  it("RE2. refine_existing + party_type=multi + member_names — still continue_chat, NOT room", () => {
    // Refine should NEVER escalate to a confirm_card / new room creation.
    // The user is editing something, not creating something new.
    const state = baseState({
      intent: "refine_existing",
      scenario: "restaurant",
      categories: ["restaurant"],
      party_type: "multi",
      member_names: ["朋友"],
      refined_target_id: "room_xyz",
    });
    const action = routeIntent(state);
    expect(action.type).toBe("continue_chat");
  });

  it("RE3. refine_existing + scenario=trip + complete trip state — still continue_chat", () => {
    const state = baseState({
      intent: "refine_existing",
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: {
        destination_city: "Tokyo",
        departure_city: "NYC",
        start_date: "2026-06-01",
        nights: 5,
        travelers: 2,
        activities: [],
      } as unknown as IntentState["trip"],
      refined_target_id: "trip_999",
    });
    const action = routeIntent(state);
    expect(action.type).toBe("continue_chat");
  });

  it("RE4. refine_existing without refined_target_id (orphan refine) — still continue_chat", () => {
    // Defensive: even if the extractor sets intent=refine_existing without
    // a target id (which shouldn't happen, but…), router should not crash
    // or escalate. Falls through to continue_chat.
    const state = baseState({
      intent: "refine_existing",
      scenario: "restaurant",
      categories: ["restaurant"],
      refined_target_id: null,
    });
    const action = routeIntent(state);
    expect(action.type).toBe("continue_chat");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 8 — buildStateSummary defensive behavior
// ═══════════════════════════════════════════════════════════════════════

describe("Probing · buildStateSummary handles malformed state without crashing", () => {
  it("BS1. scenario='restaurant' + state.restaurant undefined → summary mentions missing fields, no crash", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
    });
    expect(() => buildStateSummary(state)).not.toThrow();
    const summary = buildStateSummary(state);
    expect(summary).toContain("restaurant"); // mentions the scenario
    expect(summary).toContain("Still needs:"); // and the missing list
  });

  it("BS2. scenario='trip' + state.trip undefined → summary surfaces 4 trip fields as missing", () => {
    const state = baseState({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
    });
    expect(() => buildStateSummary(state)).not.toThrow();
    const summary = buildStateSummary(state);
    expect(summary).toContain("Still needs:");
    expect(summary.toLowerCase()).toContain("destination_city");
  });

  it("BS3. completely empty state (initial turn) → 'category isn't clear yet' blurb", () => {
    const state = baseState({
      intent: "create_plan",
      scenario: null,
      categories: [],
    });
    expect(() => buildStateSummary(state)).not.toThrow();
    const summary = buildStateSummary(state);
    expect(summary.toLowerCase()).toContain("category isn't clear");
  });

  it("BS4. flight roundtrip with return_date filled → return_date appears in summary", () => {
    const state = baseState({
      scenario: "flight",
      categories: ["flight"],
      flight: {
        origin: "JFK",
        dest: "LAX",
        date: "2026-05-14",
        return_date: "2026-05-20",
        is_round_trip: true,
        passengers: 2,
      },
    });
    const summary = buildStateSummary(state);
    expect(summary).toContain("2026-05-14");
    expect(summary).toContain("2026-05-20");
    expect(summary).toContain("2 pax");
  });

  it("BS5. multi-party with member_names — summary includes the names", () => {
    const state = baseState({
      intent: "create_room",
      scenario: "restaurant",
      categories: ["restaurant"],
      party_type: "multi",
      member_names: ["李明", "王芳"],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 3, cuisine: "any" },
    });
    const summary = buildStateSummary(state);
    expect(summary).toContain("李明");
    expect(summary).toContain("王芳");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 9 — member_names validation gaps (current behavior)
// ═══════════════════════════════════════════════════════════════════════

describe("Probing · member_names blank/whitespace must NOT pass DR gates (post-fix)", () => {
  // These tests pin the FIXED behavior introduced alongside this file: the
  // router (and buildStateSummary) now filter blank/whitespace-only entries
  // before counting "real" members. Pre-fix the router treated [""] as a
  // valid co-decider, which let create_room slip through and produced
  // Decision Rooms with no actual member to invite.

  it("MN1. member_names: [''] + create_room → ask_clarification missing=member_names (was: BUG)", () => {
    const state = baseState({
      intent: "create_room",
      scenario: "restaurant",
      categories: ["restaurant"],
      party_type: "multi",
      member_names: [""],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 1, cuisine: "any" },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("member_names");
    }
  });

  it("MN2. member_names: ['  '] (whitespace only) + create_room → ask_clarification (was: BUG)", () => {
    const state = baseState({
      intent: "create_room",
      scenario: "restaurant",
      categories: ["restaurant"],
      party_type: "multi",
      member_names: ["  "],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 1, cuisine: "any" },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("member_names");
    }
  });

  it("MN3. member_names: ['李明', ''] — at least one real name → kind=room (mixed valid+blank still valid)", () => {
    const state = baseState({
      intent: "create_room",
      scenario: "restaurant",
      categories: ["restaurant"],
      party_type: "multi",
      member_names: ["李明", ""],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 1, cuisine: "any" },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("room");
    }
  });

  it("MN4. party_type=multi + create_plan + member_names=[''] → ask_clarification missing=party_mode", () => {
    // Mirror of MN1 but for the create_plan ambiguous-party-mode path.
    // [""] doesn't count as a named co-decider, so we still ask whether
    // the user wants to book solo or escalate to a Decision Room.
    const state = baseState({
      intent: "create_plan",
      scenario: "restaurant",
      categories: ["restaurant"],
      party_type: "multi",
      member_names: [""],
    });
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("party_mode");
    }
  });

  it("MN5. buildStateSummary with member_names=['  '] → no broken 'with ,' suffix", () => {
    const state = baseState({
      intent: "create_room",
      scenario: "restaurant",
      categories: ["restaurant"],
      party_type: "multi",
      member_names: ["  "],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 1, cuisine: "any" },
    });
    const summary = buildStateSummary(state);
    expect(summary).not.toContain("with )");
    expect(summary).not.toContain("with ,");
    expect(summary).not.toMatch(/\(multi with \s*\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 10 — flattenScenarioFields with mismatched scenario
// ═══════════════════════════════════════════════════════════════════════

describe("Probing · flattenScenarioFields when scenario doesn't match populated sub-state", () => {
  it("FM1. scenario='flight' but state.flight undefined → empty {} (defensive)", () => {
    const state = baseState({
      scenario: "flight",
      categories: ["flight"],
    });
    expect(flattenScenarioFields(state)).toEqual({});
  });

  it("FM2. scenario='trip' but state.trip undefined → empty {}", () => {
    const state = baseState({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
    });
    expect(flattenScenarioFields(state)).toEqual({});
  });

  it("FM3. scenario='restaurant' + restaurant filled BUT also stale trip → only restaurant emitted", () => {
    // Defensive: even with junk in `state.trip` from a stale extractor turn,
    // flatten emits only the active scenario's fields.
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: { city: "NYC", date: "2026-05-14", time: "19:00", party_size: 2, cuisine: "any" },
      trip: {
        destination_city: "Tokyo",
        departure_city: "NYC",
        start_date: "2026-06-01",
        nights: 5,
        travelers: 2,
        activities: [],
      } as unknown as IntentState["trip"],
    });
    const flat = flattenScenarioFields(state);
    expect(flat.city).toBe("NYC");
    expect(flat.cuisine).toBe("any");
    expect("destination_city" in flat).toBe(false);
    expect("travelers" in flat).toBe(false);
  });

  it("FM4. scenario='hotel' + state.hotel with star_rating=null → null preserved (only undefined stripped)", () => {
    // Document: stripUndef only removes UNDEFINED, not null. So a literal
    // `null` from the extractor passes through. If we later want to also
    // strip null, this test will catch the change.
    const state = baseState({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: {
        city: "NYC",
        check_in: "2026-05-14",
        check_out: "2026-05-15",
        star_rating: null as unknown as number,
      },
    });
    const flat = flattenScenarioFields(state);
    // star_rating renamed to stars, value preserved (even when null)
    expect("stars" in flat).toBe(true);
    expect(flat.stars).toBe(null);
    expect("star_rating" in flat).toBe(false);
  });
});
