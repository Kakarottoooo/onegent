import { describe, it, expect } from "vitest";
import { routeIntent, getMissingForScenario, buildStateSummary } from "../router";
import type { IntentState } from "../types";

// ─── Fixtures ────────────────────────────────────────────────────────────

const emptyState = (overrides: Partial<IntentState> = {}): IntentState => {
  const base: IntentState = {
    confidence: 0.9,
    turn_count: 1,
    updated_at: "2026-04-23T00:00:00Z",
    intent: "unknown",
    scenario: null,
    categories: [],
    party_type: "solo",
    member_names: [],
    refined_target_id: null,
    planning_assumptions: [],
  };
  const merged = { ...base, ...overrides };
  // Auto-derive categories from scenario when fixtures only set scenario
  // (cuts test fixture noise — pre-composite tests didn't have to think
  // about categories).
  if (merged.categories.length === 0 && merged.scenario) {
    merged.categories = merged.scenario === "trip"
      ? ["hotel", "flight", "restaurant", "activity"]
      : [merged.scenario];
  }
  return merged;
};

// ─── routeIntent — top-level dispatch ────────────────────────────────────

describe("routeIntent — top-level dispatch", () => {
  it("chitchat → continue_chat", () => {
    const s = emptyState({ intent: "chitchat" });
    expect(routeIntent(s)).toEqual({ type: "continue_chat" });
  });

  it("unknown intent → continue_chat", () => {
    const s = emptyState({ intent: "unknown" });
    expect(routeIntent(s)).toEqual({ type: "continue_chat" });
  });

  it("refine_existing (Phase 2 stub) → continue_chat", () => {
    const s = emptyState({ intent: "refine_existing", refined_target_id: "plan-123" });
    expect(routeIntent(s)).toEqual({ type: "continue_chat" });
  });

  it("create_plan + no categories → ask_clarification for categories", () => {
    // Composite migration: scenario==null implies categories=[] (router
    // asks "想订什么？" via the new `categories` slot, not the old `scenario`).
    const s = emptyState({ intent: "create_plan", scenario: null });
    const action = routeIntent(s);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toEqual(["categories"]);
    }
  });
});

// ─── Restaurant scenario ─────────────────────────────────────────────────

describe("routeIntent — restaurant", () => {
  it("complete restaurant → show_confirm_card plan", () => {
    const s = emptyState({
      intent: "create_plan",
      scenario: "restaurant",
      restaurant: {
        city: "New York",
        cuisine: "Italian",
        date: "2026-05-02",
        time: "19:00",
        party_size: 2,
      },
    });
    const action = routeIntent(s);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("plan");
    }
  });

  it("missing party_size → ask_clarification + quick picks", () => {
    const s = emptyState({
      intent: "create_plan",
      scenario: "restaurant",
      restaurant: { city: "New York", cuisine: "Italian", date: "2026-05-02", time: "19:00" },
    });
    const action = routeIntent(s);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("party_size");
      expect(action.suggested_quick_picks).toBeDefined();
      expect(action.suggested_quick_picks!.length).toBeGreaterThan(0);
    }
  });

  it("empty restaurant state → all required fields missing", () => {
    const s = emptyState({ intent: "create_plan", scenario: "restaurant" });
    expect(getMissingForScenario(s)).toEqual(["city", "cuisine", "date", "time", "party_size"]);
  });

  it("multi-party restaurant → show_confirm_card room", () => {
    const s = emptyState({
      intent: "create_room",
      scenario: "restaurant",
      party_type: "multi",
      member_names: ["李明"],
      restaurant: {
        city: "New York",
        cuisine: "Italian",
        date: "2026-05-02",
        time: "19:00",
        party_size: 2,
      },
    });
    const action = routeIntent(s);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("room");
    }
  });
});

// ─── Hotel scenario ──────────────────────────────────────────────────────

describe("routeIntent — hotel", () => {
  it("nights satisfies check_out requirement", () => {
    const s = emptyState({
      intent: "create_plan",
      scenario: "hotel",
      hotel: { city: "Paris", check_in: "2026-05-02", nights: 3 },
    });
    expect(getMissingForScenario(s)).toEqual([]);
    expect(routeIntent(s).type).toBe("show_confirm_card");
  });

  it("missing check_in → ask_clarification", () => {
    const s = emptyState({
      intent: "create_plan",
      scenario: "hotel",
      hotel: { city: "Paris", nights: 3 },
    });
    expect(getMissingForScenario(s)).toEqual(["check_in"]);
  });

  it("missing both check_out and nights → ask_clarification for check_out", () => {
    const s = emptyState({
      intent: "create_plan",
      scenario: "hotel",
      hotel: { city: "Paris", check_in: "2026-05-02" },
    });
    expect(getMissingForScenario(s)).toEqual(["check_out"]);
  });
});

// ─── Flight scenario ─────────────────────────────────────────────────────

describe("routeIntent — flight", () => {
  it("complete flight one-way → show_confirm_card plan", () => {
    const s = emptyState({
      intent: "create_plan",
      scenario: "flight",
      flight: {
        origin: "SFO",
        dest: "JFK",
        date: "2026-05-02",
        passengers: 1,
        is_round_trip: false,
      },
    });
    expect(routeIntent(s).type).toBe("show_confirm_card");
  });

  it("missing origin → ask_clarification", () => {
    const s = emptyState({
      intent: "create_plan",
      scenario: "flight",
      flight: { dest: "JFK", date: "2026-05-02" },
    });
    const action = routeIntent(s);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("origin");
    }
  });
});

// ─── Activity scenario ───────────────────────────────────────────────────

describe("routeIntent — activity", () => {
  it("complete activity → show_confirm_card plan", () => {
    const s = emptyState({
      intent: "create_plan",
      scenario: "activity",
      activity: {
        event_name: "Hamilton",
        city: "New York",
        event_date: "2026-05-02",
      },
    });
    expect(routeIntent(s).type).toBe("show_confirm_card");
  });

  it("missing event_name → ask_clarification", () => {
    const s = emptyState({
      intent: "create_plan",
      scenario: "activity",
      activity: { city: "New York", event_date: "2026-05-02" },
    });
    const action = routeIntent(s);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("event_name");
    }
  });
});

// ─── Trip scenario ───────────────────────────────────────────────────────

describe("routeIntent — trip", () => {
  it("complete trip → show_confirm_card trip (not plan)", () => {
    const s = emptyState({
      intent: "create_plan",
      scenario: "trip",
      trip: {
        destination_city: "New York",
        departure_city: "San Francisco",
        start_date: "2026-05-02",
        end_date: "2026-05-05",
        nights: 3,
        travelers: 2,
        activities: ["Broadway shows"],
        cuisine_preferences: [],
        vibe: "mixed",
        planning_assumptions: [],
      },
    });
    const action = routeIntent(s);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("trip");
    }
  });

  it("missing departure_city → ask_clarification", () => {
    const s = emptyState({
      intent: "create_plan",
      scenario: "trip",
      trip: {
        destination_city: "New York",
        start_date: "2026-05-02",
        nights: 3,
        travelers: 2,
        activities: [],
        cuisine_preferences: [],
        vibe: "mixed",
        planning_assumptions: [],
      },
    });
    const action = routeIntent(s);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("departure_city");
    }
  });

  it("no trip sub-state → all 4 trip fields missing", () => {
    const s = emptyState({ intent: "create_plan", scenario: "trip" });
    expect(getMissingForScenario(s)).toEqual([
      "destination_city",
      "date_range",
      "departure_city",
      "traveler_count",
    ]);
  });
});

// ─── buildStateSummary ───────────────────────────────────────────────────

describe("buildStateSummary", () => {
  it("chitchat → casual blurb", () => {
    const s = emptyState({ intent: "chitchat" });
    const summary = buildStateSummary(s);
    expect(summary).toContain("chatting casually");
  });

  it("complete trip → mentions all filled fields", () => {
    const s = emptyState({
      intent: "create_plan",
      scenario: "trip",
      trip: {
        destination_city: "New York",
        departure_city: "San Francisco",
        start_date: "2026-05-02",
        end_date: "2026-05-05",
        nights: 3,
        travelers: 2,
        activities: ["Broadway shows"],
        cuisine_preferences: [],
        vibe: "mixed",
        planning_assumptions: [],
      },
    });
    const summary = buildStateSummary(s);
    expect(summary).toContain("New York");
    expect(summary).toContain("San Francisco");
    expect(summary).toContain("3 night");
    expect(summary).toContain("ready to confirm");
  });

  it("incomplete state → tells model what's still needed", () => {
    const s = emptyState({
      intent: "create_plan",
      scenario: "restaurant",
      restaurant: { city: "New York" },
    });
    const summary = buildStateSummary(s);
    expect(summary).toContain("Still needs:");
    expect(summary).toContain("date");
    expect(summary).toContain("party_size");
  });

  it("multi-party includes member names", () => {
    const s = emptyState({
      intent: "create_room",
      scenario: "restaurant",
      party_type: "multi",
      member_names: ["Alice", "Bob"],
      restaurant: {
        city: "New York",
        date: "2026-05-02",
        time: "19:00",
        party_size: 3,
      },
    });
    const summary = buildStateSummary(s);
    expect(summary).toContain("multi");
    expect(summary).toContain("Alice");
    expect(summary).toContain("Bob");
  });
});
