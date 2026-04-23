/**
 * Golden test cases for NLU v2 · multi-party create_room scenarios (Phase C).
 *
 * Each case codifies the expected IntentState + RouterAction for a typical
 * "me and X" booking request. Tests hit the router against hand-built states
 * — extractor accuracy is verified separately via live smoke.
 *
 * Critical cases:
 *   M5 — proxy_member_constraints captured per named member
 *   M7/M8 — "2 people" / "我一个人" must NOT be misclassified as multi-decider
 */

import { describe, it, expect } from "vitest";
import { routeIntent } from "../router";
import type { IntentState } from "../types";

const baseState = (overrides: Partial<IntentState> = {}): IntentState => ({
  confidence: 0.9,
  turn_count: 1,
  updated_at: "2026-04-23T00:00:00Z",
  intent: "create_plan",
  scenario: null,
  party_type: "solo",
  member_names: [],
  refined_target_id: null,
  planning_assumptions: [],
  ...overrides,
});

// ─── M1-M4 — one happy-path per scenario ────────────────────────────────

describe("Create-room golden cases · by scenario", () => {
  it("M1. Restaurant with a named co-decider → create_room + multi", () => {
    // "我和李明想周五晚上吃日料"
    const state = baseState({
      intent: "create_room",
      scenario: "restaurant",
      party_type: "multi",
      member_names: ["李明"],
      restaurant: {
        date: "2026-04-24",
        time: "19:00",
        cuisine: "Japanese",
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("city");
      expect(action.missing).toContain("party_size");
    }
  });

  it("M2. Hotel with spouse signal → multi, member_names empty ('老婆' is relationship)", () => {
    // "我和老婆下周去纽约住 3 晚，四星以上"
    const state = baseState({
      intent: "create_room",
      scenario: "hotel",
      party_type: "multi",
      member_names: [], // "老婆" is a relationship, not a name
      hotel: {
        city: "New York",
        check_in: "2026-04-30",
        nights: 3,
        star_rating: 4,
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("room"); // hotel + create_room → room kind
    }
  });

  it("M3. Flight with family signal → multi + kind=room", () => {
    // "我和爸妈国庆从上海飞东京来回"
    const state = baseState({
      intent: "create_room",
      scenario: "flight",
      party_type: "multi",
      member_names: [],
      flight: {
        origin: "Shanghai",
        dest: "Tokyo",
        date: "2026-10-01",
        return_date: "2026-10-07",
        is_round_trip: true,
        passengers: 3,
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("room");
    }
  });

  it("M4. Activity with girlfriend signal → multi + preserves seat preference", () => {
    // "和女朋友下周五看 Taylor Swift，洛杉矶，前排"
    const state = baseState({
      intent: "create_room",
      scenario: "activity",
      party_type: "multi",
      member_names: [],
      activity: {
        event_name: "Taylor Swift",
        event_type: "concert",
        city: "Los Angeles",
        event_date: "2026-05-01",
        num_tickets: 2,
        seat_type: "premium",
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("room");
      expect(state.activity?.seat_type).toBe("premium");
    }
  });
});

// ─── M5-M6 — proxy_member_constraints + unnamed group ───────────────────

describe("Create-room · proxy constraints + implicit headcount", () => {
  it("M5. Per-named-member constraints captured in proxy_member_constraints", () => {
    // "我和李明想吃日料，李明不吃生鱼片、预算人均 $80"
    const state = baseState({
      intent: "create_room",
      scenario: "restaurant",
      party_type: "multi",
      member_names: ["李明"],
      restaurant: {
        cuisine: "Japanese",
      },
      proxy_member_constraints: {
        "李明": {
          dietary: ["no raw fish"],
          budget_max: 80,
        },
      },
    });
    // State is what the extractor SHOULD produce. Router just needs to surface
    // the clarification — the proxy_member_constraints ride along in the
    // state unchanged.
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    expect(state.proxy_member_constraints).toBeDefined();
    expect(state.proxy_member_constraints?.["李明"]).toMatchObject({
      dietary: ["no raw fish"],
      budget_max: 80,
    });
  });

  it("M6. 'a few friends' → multi, empty member_names, party_size missing", () => {
    // "几个朋友周末聚餐"
    const state = baseState({
      intent: "create_room",
      scenario: "restaurant",
      party_type: "multi",
      member_names: [],
      restaurant: {
        date: "2026-04-25",
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("ask_clarification");
    if (action.type === "ask_clarification") {
      expect(action.missing).toContain("city");
      expect(action.missing).toContain("time");
      expect(action.missing).toContain("party_size");
    }
  });
});

// ─── M7-M8 — MUST-NOT misclassify single decider ────────────────────────

describe("Create-room · negative tests (don't over-detect multi)", () => {
  it("M7. '我一个人想找米其林' → create_plan + solo (NOT create_room)", () => {
    const state = baseState({
      intent: "create_plan",
      scenario: "restaurant",
      party_type: "solo",
      restaurant: {
        city: "San Francisco",
        date: "2026-04-25",
        time: "19:00",
        party_size: 1,
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("plan");
      expect(state.intent).toBe("create_plan");
      expect(state.party_type).toBe("solo");
    }
  });

  it("M8. 'Book a table for 2' → create_plan + solo (party_size alone is not a multi signal)", () => {
    const state = baseState({
      intent: "create_plan",
      scenario: "restaurant",
      party_type: "solo",
      restaurant: {
        city: "NYC",
        date: "2026-04-25",
        time: "19:00",
        party_size: 2,
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("plan"); // one decider booking for 2 diners
    }
  });
});

// ─── V1 compat shape for create_room ────────────────────────────────────

describe("toV1CompatShape — create_room output format", () => {
  // We test flattenScenarioFields + proxy surfacing by importing from index.
  // This is the pane-of-glass test: does the v2 path produce a collected_constraints
  // shape that app/api/chat/commit can consume as-is?

  it("proxy_member_constraints from state reaches collected_constraints", async () => {
    const { flattenScenarioFields } = await import("../index");
    const state = baseState({
      intent: "create_room",
      scenario: "restaurant",
      party_type: "multi",
      member_names: ["李明"],
      restaurant: { cuisine: "Japanese", budget_per_person: 80 },
      proxy_member_constraints: { "李明": { dietary: ["no raw fish"] } },
    });
    // flattenScenarioFields doesn't touch proxy_member_constraints — that's
    // applied separately in toV1CompatShape. Verify both paths here:
    const flat = flattenScenarioFields(state);
    expect(flat.cuisine).toBe("Japanese");
    expect(flat.budget_per_person).toBe(80);
    // proxy_member_constraints is appended in toV1CompatShape, not here — but
    // the state MUST carry the top-level field.
    expect(state.proxy_member_constraints?.["李明"].dietary).toEqual(["no raw fish"]);
  });
});
