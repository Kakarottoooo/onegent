import { describe, expect, it } from "vitest";
import type {
  IntentState,
  NluV2ParseResult,
  RouterAction,
} from "@/lib/agent/nlu-v2";
import { buildCaptureTravelObjectFromNlu, detectCaptureSource } from "@/lib/capture/travel-object";

const capturedAt = "2026-05-07T12:00:00.000Z";

function baseState(overrides: Partial<IntentState>): IntentState {
  return {
    confidence: 0.91,
    turn_count: 1,
    updated_at: capturedAt,
    intent: "create_plan",
    scenario: null,
    categories: [],
    party_type: "solo",
    member_names: [],
    refined_target_id: null,
    ...overrides,
  };
}

function resultFor(state: IntentState, action: RouterAction, extra: Partial<NluV2ParseResult> = {}): NluV2ParseResult {
  return {
    intent: state.intent,
    scenario: state.scenario,
    categories: state.categories,
    party_type: state.party_type,
    member_names: state.member_names,
    collected_constraints: {},
    missing_fields: action.type === "ask_clarification" ? action.missing : [],
    suggested_clarify_question: null,
    suggested_quick_picks: null,
    confirm_ready: action.type === "show_confirm_card",
    refined_target_id: null,
    assistant_reply: "ok",
    __v2_state: state,
    __v2_action: action,
    ...extra,
  };
}

describe("Capture TravelObject", () => {
  it("marks a complete activity request as task-ready from the homepage parser", () => {
    const state = baseState({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "The Lion King",
        event_type: "theater",
        city: "New York",
        event_date: "2026-05-30",
        num_tickets: 1,
      },
    });
    const action: RouterAction = { type: "show_confirm_card", kind: "plan", state };
    const capture = buildCaptureTravelObjectFromNlu({
      message: "Book The Lion King in New York on May 30 for 1 ticket",
      result: resultFor(state, action, {
        collected_constraints: {
          event_name: "The Lion King",
          city: "New York",
          event_date: "2026-05-30",
          num_tickets: 1,
        },
      }),
      sessionId: "sess_123",
      capturedAt,
    });

    expect(capture.source.type).toBe("request");
    expect(capture.classification.scenario).toBe("activity");
    expect(capture.task_readiness).toEqual({
      ready: true,
      reason: "ready",
      next_missing_fields: [],
    });
    expect(capture.possible_actions.some((a) => a.type === "create_task")).toBe(true);
    expect(capture.provenance.session_id).toBe("sess_123");
  });

  it("keeps missing-field hotel requests out of task-ready state", () => {
    const state = baseState({
      scenario: "hotel",
      categories: ["hotel"],
      hotel: {
        city: "New York",
        check_in: "2026-05-20",
        budget_max_per_night: 300,
      },
    });
    const action: RouterAction = {
      type: "ask_clarification",
      missing: ["check_out"],
    };
    const capture = buildCaptureTravelObjectFromNlu({
      message: "Find a New York hotel on May 20 under $300",
      result: resultFor(state, action, {
        collected_constraints: {
          city: "New York",
          check_in: "2026-05-20",
          budget_max_per_night: 300,
        },
      }),
      capturedAt,
    });

    expect(capture.classification.scenario).toBe("hotel");
    expect(capture.task_readiness.ready).toBe(false);
    expect(capture.task_readiness.reason).toBe("missing_fields");
    expect(capture.task_readiness.next_missing_fields).toEqual(["check_out"]);
    expect(capture.possible_actions.find((a) => a.type === "ask_clarification")?.disabled_reason).toContain("check_out");
  });

  it("classifies known travel provider URLs even when NLU fallback has no scenario", () => {
    const fallback = resultFor(
      baseState({ intent: "chitchat" }),
      { type: "continue_chat" },
      {
        scenario: null,
        categories: [],
        confirm_ready: false,
        __v2_state: undefined,
        __v2_action: undefined,
      },
    );
    const capture = buildCaptureTravelObjectFromNlu({
      message: "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581",
      result: fallback,
      capturedAt,
    });

    expect(capture.source.type).toBe("url");
    expect(capture.source.host).toBe("www.ticketmaster.com");
    expect(capture.classification.scenario).toBe("activity");
    expect(capture.classification.categories).toEqual(["activity"]);
    expect(capture.task_readiness.reason).toBe("needs_review");
    expect(capture.constraints.source_url).toContain("ticketmaster.com");
  });

  it("does not turn cuisine-only restaurant search into a direct booking", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "New York",
        date: "2026-05-13",
        time: "19:00",
        party_size: 2,
        cuisine: "Sichuan",
      },
    });
    const action: RouterAction = { type: "show_confirm_card", kind: "plan", state };
    const capture = buildCaptureTravelObjectFromNlu({
      message: "Find a Sichuan restaurant in New York tomorrow at 7 for 2",
      result: resultFor(state, action),
      capturedAt,
    });

    expect(capture.classification.scenario).toBe("restaurant");
    expect(capture.classification.direct_booking).toBe(false);
    expect(capture.entities.restaurant?.restaurant_name).toBeUndefined();
  });

  it("detects screenshot-style homepage input as a source needing review", () => {
    const source = detectCaptureSource("screenshot lion-king-ticketmaster.png", capturedAt);

    expect(source.type).toBe("screenshot");
    expect(source.raw_text).toContain("lion-king");
  });
});
