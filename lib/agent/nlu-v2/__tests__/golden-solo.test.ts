/**
 * Golden test cases for NLU v2 · single-category solo scenarios
 * (restaurant / hotel / flight / activity) — Phase B pilot.
 *
 * Like golden-trip.test.ts, these exercise the router against hand-built
 * IntentState shapes that mirror what Layer 2 should produce. Tests also
 * verify toV1CompatShape's field renames (star_rating → stars,
 * date → departure_date) so the commit route + downstream planners see
 * v1-canonical keys regardless of which NLU version produced the state.
 */

import { describe, it, expect } from "vitest";
import { routeIntent, getMissingForScenario } from "../router";
import { flattenScenarioFields } from "../index";
import type { IntentState } from "../types";

// ─── Base state builder ─────────────────────────────────────────────────

const baseState = (overrides: Partial<IntentState> = {}): IntentState => ({
  confidence: 0.9,
  turn_count: 1,
  updated_at: "2026-04-22T00:00:00Z",
  intent: "create_plan",
  scenario: null,
  party_type: "solo",
  member_names: [],
  refined_target_id: null,
  planning_assumptions: [],
  ...overrides,
});

// ─── Restaurant ─────────────────────────────────────────────────────────

describe("Golden restaurant cases · solo create_plan", () => {
  it("R1. Full fill → show_confirm_card with kind=plan", () => {
    const state = baseState({
      scenario: "restaurant",
      restaurant: {
        city: "New York",
        date: "2026-05-02",
        time: "19:00",
        party_size: 2,
        cuisine: "Japanese",
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("plan");
    }
    expect(getMissingForScenario(state)).toEqual([]);
  });

  it("R2. Missing time → ask_clarification", () => {
    const state = baseState({
      scenario: "restaurant",
      restaurant: { city: "SF", date: "2026-05-02", party_size: 2 },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("time");
      expect(action.missing).not.toContain("city");
    }
  });

  it("R3. Missing party_size → quick picks surface 2/3/4/5+", () => {
    const state = baseState({
      scenario: "restaurant",
      restaurant: { city: "NYC", date: "2026-05-02", time: "19:00" },
    });
    const action = routeIntent(state);
    if (action.type === "ask_clarification") {
      expect(action.missing[0]).toBe("party_size");
      expect(action.suggested_quick_picks?.map((q) => q.value)).toEqual([
        "2", "3", "4", "5",
      ]);
    }
  });

  it("R4. Only scenario known → all 4 required fields missing", () => {
    const state = baseState({ scenario: "restaurant", restaurant: {} });
    const missing = getMissingForScenario(state);
    expect(missing).toEqual(["city", "date", "time", "party_size"]);
  });

  it("R5. flattenScenarioFields passes keys through unchanged (no renames for restaurant)", () => {
    const state = baseState({
      scenario: "restaurant",
      restaurant: {
        city: "NYC",
        date: "2026-05-02",
        time: "19:00",
        party_size: 2,
        cuisine: "Italian",
        budget_per_person: 80,
      },
    });
    const flat = flattenScenarioFields(state);
    expect(flat).toEqual({
      city: "NYC",
      date: "2026-05-02",
      time: "19:00",
      party_size: 2,
      cuisine: "Italian",
      budget_per_person: 80,
    });
  });

  // ── US-W5: direct-booking shortcut for named venues ────────────────────
  it("R6. restaurant_name + all required → directBooking flag on action", () => {
    const state = baseState({
      scenario: "restaurant",
      restaurant: {
        restaurant_name: "Carbone",
        city: "New York",
        date: "2026-05-02",
        time: "19:00",
        party_size: 2,
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("plan");
      expect(action.directBooking).toBe(true);
    }
  });

  it("R7. restaurant_name set but date missing → no directBooking, still asks", () => {
    const state = baseState({
      scenario: "restaurant",
      restaurant: {
        restaurant_name: "Carbone",
        city: "New York",
        time: "19:00",
        party_size: 2,
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("date");
    }
  });

  it("R8. NO restaurant_name → directBooking flag is omitted (recommendation path)", () => {
    const state = baseState({
      scenario: "restaurant",
      restaurant: {
        city: "NYC",
        date: "2026-05-02",
        time: "19:00",
        party_size: 2,
        cuisine: "Italian",
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.directBooking).toBeUndefined();
    }
  });

  it("R9. flattenScenarioFields includes restaurant_name when set", () => {
    const state = baseState({
      scenario: "restaurant",
      restaurant: {
        restaurant_name: "Carbone",
        city: "New York",
        date: "2026-05-02",
        time: "19:00",
        party_size: 2,
      },
    });
    const flat = flattenScenarioFields(state);
    expect(flat.restaurant_name).toBe("Carbone");
  });
});

// ─── Hotel ──────────────────────────────────────────────────────────────

describe("Golden hotel cases · solo create_plan", () => {
  it("H1. Full fill with check_out", () => {
    const state = baseState({
      scenario: "hotel",
      hotel: {
        city: "Paris",
        check_in: "2026-05-10",
        check_out: "2026-05-13",
        guests: 2,
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    expect(getMissingForScenario(state)).toEqual([]);
  });

  it("H2. Nights satisfies check_out requirement", () => {
    const state = baseState({
      scenario: "hotel",
      hotel: { city: "Tokyo", check_in: "2026-05-10", nights: 3 },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    expect(getMissingForScenario(state)).toEqual([]);
  });

  it("H3. Missing check_in", () => {
    const state = baseState({
      scenario: "hotel",
      hotel: { city: "Paris", nights: 3 },
    });
    const missing = getMissingForScenario(state);
    expect(missing).toEqual(["check_in"]);
  });

  // ── US-W5: direct-booking for named hotel ────────────────────────────
  it("H_DB1. hotel_name + all required → directBooking flag on action", () => {
    const state = baseState({
      scenario: "hotel",
      hotel: {
        hotel_name: "The Pierre",
        city: "New York",
        check_in: "2026-04-28",
        check_out: "2026-04-30",
        guests: 2,
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.directBooking).toBe(true);
    }
  });

  it("H_DB2. hotel_name + create_room → NO directBooking (room stays recommendation)", () => {
    const state = baseState({
      intent: "create_room",
      scenario: "hotel",
      party_type: "multi",
      member_names: ["Alice"],
      hotel: {
        hotel_name: "The Pierre",
        city: "New York",
        check_in: "2026-04-28",
        check_out: "2026-04-30",
        guests: 2,
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("room");
      expect(action.directBooking).toBeUndefined();
    }
  });

  it("H4. Missing both check_out and nights", () => {
    const state = baseState({
      scenario: "hotel",
      hotel: { city: "Paris", check_in: "2026-05-10" },
    });
    const missing = getMissingForScenario(state);
    expect(missing).toEqual(["check_out"]);
  });

  it("H5. flattenScenarioFields renames star_rating → stars", () => {
    const state = baseState({
      scenario: "hotel",
      hotel: {
        city: "Paris",
        check_in: "2026-05-10",
        nights: 3,
        star_rating: 4,
        neighborhood: "Le Marais",
      },
    });
    const flat = flattenScenarioFields(state);
    expect(flat.stars).toBe(4);
    expect(flat.star_rating).toBeUndefined(); // renamed, not duplicated
    expect(flat.neighborhood).toBe("Le Marais");
    expect(flat.city).toBe("Paris");
    expect(flat.check_in).toBe("2026-05-10");
    expect(flat.nights).toBe(3);
  });
});

// ─── Flight ─────────────────────────────────────────────────────────────

describe("Golden flight cases · solo create_plan", () => {
  it("F1. Full fill one-way", () => {
    const state = baseState({
      scenario: "flight",
      flight: {
        origin: "SFO",
        dest: "JFK",
        date: "2026-05-10",
        is_round_trip: false,
        passengers: 1,
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    expect(getMissingForScenario(state)).toEqual([]);
  });

  it("F2. Roundtrip with return_date", () => {
    const state = baseState({
      scenario: "flight",
      flight: {
        origin: "SFO",
        dest: "JFK",
        date: "2026-05-10",
        return_date: "2026-05-15",
        is_round_trip: true,
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
  });

  it("F3. Missing dest → ask_clarification", () => {
    const state = baseState({
      scenario: "flight",
      flight: { origin: "SFO", date: "2026-05-10" },
    });
    const missing = getMissingForScenario(state);
    expect(missing).toContain("dest");
  });

  it("F4. Missing departure_date (router uses 'departure_date' key, not 'date')", () => {
    const state = baseState({
      scenario: "flight",
      flight: { origin: "SFO", dest: "JFK" },
    });
    const missing = getMissingForScenario(state);
    expect(missing).toContain("departure_date");
    expect(missing).not.toContain("date");
  });

  it("F5. flattenScenarioFields renames date → departure_date", () => {
    const state = baseState({
      scenario: "flight",
      flight: {
        origin: "SFO",
        dest: "JFK",
        date: "2026-05-10",
        return_date: "2026-05-15",
        passengers: 2,
        cabin_class: "business",
      },
    });
    const flat = flattenScenarioFields(state);
    expect(flat.departure_date).toBe("2026-05-10");
    expect(flat.date).toBeUndefined(); // renamed, not duplicated
    expect(flat.return_date).toBe("2026-05-15"); // untouched
    expect(flat.origin).toBe("SFO");
    expect(flat.dest).toBe("JFK");
    expect(flat.cabin_class).toBe("business");
    expect(flat.passengers).toBe(2);
  });
});

// ─── Activity ───────────────────────────────────────────────────────────

describe("Golden activity cases · solo create_plan", () => {
  it("A1. Full fill — Hamilton 2 tickets", () => {
    const state = baseState({
      scenario: "activity",
      activity: {
        event_name: "Hamilton",
        event_type: "theater",
        city: "New York",
        event_date: "2026-05-20",
        num_tickets: 2,
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    expect(getMissingForScenario(state)).toEqual([]);
  });

  it("A2. Missing event_name → ask_clarification", () => {
    const state = baseState({
      scenario: "activity",
      activity: {
        event_type: "concert",
        city: "Los Angeles",
        event_date: "2026-05-20",
      },
    });
    const missing = getMissingForScenario(state);
    expect(missing).toEqual(["event_name"]);
  });

  it("A3. Only event_type — missing event_name, city, event_date", () => {
    const state = baseState({
      scenario: "activity",
      activity: { event_type: "theater" },
    });
    const missing = getMissingForScenario(state);
    expect(missing).toEqual(["event_name", "city", "event_date"]);
  });

  it("A4. flattenScenarioFields passes activity keys through unchanged", () => {
    const state = baseState({
      scenario: "activity",
      activity: {
        event_name: "Hamilton",
        event_type: "theater",
        city: "NYC",
        event_date: "2026-05-20",
        num_tickets: 2,
        budget_max_per_ticket: 300,
      },
    });
    const flat = flattenScenarioFields(state);
    expect(flat).toEqual({
      event_name: "Hamilton",
      event_type: "theater",
      city: "NYC",
      event_date: "2026-05-20",
      num_tickets: 2,
      budget_max_per_ticket: 300,
    });
  });
});

// ─── Cross-cutting ──────────────────────────────────────────────────────

describe("Cross-cutting routing behavior", () => {
  it("create_room + solo-scenario still routes to kind=room", () => {
    const state = baseState({
      scenario: "restaurant",
      intent: "create_room",
      party_type: "multi",
      member_names: ["Alice"],
      restaurant: {
        city: "NYC",
        date: "2026-05-02",
        time: "19:00",
        party_size: 3,
      },
    });
    const action = routeIntent(state);
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("room");
    }
  });

  it("chitchat → continue_chat regardless of scenario slot", () => {
    const state = baseState({ intent: "chitchat", scenario: null });
    const action = routeIntent(state);
    expect(action.type).toBe("continue_chat");
  });

  it("null scenario → ask_clarification for scenario itself", () => {
    const state = baseState({ intent: "create_plan", scenario: null });
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toEqual(["scenario"]);
    }
  });
});
