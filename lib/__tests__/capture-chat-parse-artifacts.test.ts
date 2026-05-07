import { describe, expect, it } from "vitest";
import type { IntentState, NluV2ParseResult, RouterAction } from "@/lib/agent/nlu-v2";
import { buildCaptureChatParseArtifacts } from "@/lib/capture/chat-parse-artifacts";

const capturedAt = "2026-05-07T16:00:00.000Z";

function state(overrides: Partial<IntentState>): IntentState {
  return {
    confidence: 0.9,
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

function resultFor(
  s: IntentState,
  action: RouterAction,
  extra: Partial<NluV2ParseResult> = {},
): NluV2ParseResult {
  return {
    intent: s.intent,
    scenario: s.scenario,
    categories: s.categories,
    party_type: s.party_type,
    member_names: s.member_names,
    collected_constraints: {},
    missing_fields: action.type === "ask_clarification" ? action.missing : [],
    suggested_clarify_question: null,
    suggested_quick_picks: null,
    confirm_ready: action.type === "show_confirm_card",
    refined_target_id: null,
    assistant_reply: "Captured.",
    __v2_state: s,
    __v2_action: action,
    ...extra,
  };
}

describe("Capture chat parse artifacts", () => {
  it("returns a TravelObject and task boundary for complete homepage input", () => {
    const s = state({
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
    const artifacts = buildCaptureChatParseArtifacts({
      message: "Book The Lion King in New York on May 30 for 1 ticket",
      result: resultFor(s, { type: "show_confirm_card", kind: "plan", state: s }),
      sessionId: "sess_stage0",
      capturedAt,
    });

    expect(artifacts.capture_travel_object.classification.scenario).toBe("activity");
    expect(artifacts.capture_task_boundary.ok).toBe(true);
    expect(artifacts.capture_task_boundary.nextAction).toBe("show_confirmation");
    expect(artifacts.capture_task_boundary.payload?.kind).toBe("plan");
    expect(
      artifacts.capture_task_boundary.payload?.nlu.collected_constraints._capture_source,
    ).toMatchObject({
      original_input: "Book The Lion King in New York on May 30 for 1 ticket",
      source_session_id: "sess_stage0",
      source_type: "request",
    });
  });

  it("keeps unsupported screenshot-only input in review instead of creating a task", () => {
    const fallback = resultFor(
      state({ intent: "chitchat" }),
      { type: "continue_chat" },
      {
        scenario: null,
        categories: [],
        confirm_ready: false,
        __v2_state: undefined,
        __v2_action: undefined,
      },
    );
    const artifacts = buildCaptureChatParseArtifacts({
      message: "uploaded screenshot",
      result: fallback,
      capturedAt,
    });

    expect(artifacts.capture_travel_object.source.type).toBe("screenshot");
    expect(artifacts.capture_travel_object.task_readiness.reason).toBe("needs_review");
    expect(artifacts.capture_task_boundary.ok).toBe(false);
    expect(artifacts.capture_task_boundary.payload).toBeUndefined();
  });
});
