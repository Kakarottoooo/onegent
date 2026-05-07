import { describe, expect, it } from "vitest";
import type { IntentState, NluV2ParseResult, RouterAction } from "@/lib/agent/nlu-v2";
import {
  buildCaptureChatParseArtifacts,
  buildProviderUrlFallbackNluResult,
} from "@/lib/capture/chat-parse-artifacts";
import { extractAllCaptureUrls } from "@/lib/capture/travel-object";

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

  it("marks exact Ticketmaster event URLs as direct booking capture tasks", () => {
    const url = "https://www.ticketmaster.com/nashville-sc-v-dc-united-eddi-nashville-tennessee-05-09-2026/event/1B0063739937BB85";
    const s = state({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "Nashville SC v DC United",
        event_type: "sports",
        city: "Nashville",
        event_date: "2026-05-09",
        num_tickets: 1,
      },
    });
    const artifacts = buildCaptureChatParseArtifacts({
      message: `${url},帮我预定一下这个`,
      result: resultFor(s, { type: "show_confirm_card", kind: "plan", state: s }),
      sessionId: "sess_ticketmaster",
      capturedAt,
    });

    expect(artifacts.capture_travel_object.source.type).toBe("url");
    expect(artifacts.capture_task_boundary.ok).toBe(true);
    expect(artifacts.capture_task_boundary.nextAction).toBe("run_direct_booking");
    expect(artifacts.capture_task_boundary.payload?.nlu.direct_booking).toBe(true);
    expect(artifacts.capture_task_boundary.payload?.nlu.collected_constraints.source_url).toContain(
      "/event/1B0063739937BB85",
    );
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

describe("provider URL fallback NLU result", () => {
  const lilWayneUrl =
    "https://www.ticketmaster.com/lil-wayne-tickets/artist/712214?ac_link=ursa_84359098-9ebf-4cbc-a046-9d852562c3bd_a_712214?ac_link=iccp_hp_t3_fallback_K8vZ917GemV";

  it("normalizes a missing leading h in pasted provider URLs", () => {
    const [url] = extractAllCaptureUrls(lilWayneUrl.replace(/^https/, "ttps"));

    expect(url).toBe(lilWayneUrl);
  });

  it("builds a deterministic activity fallback for Ticketmaster artist URLs", () => {
    const result = buildProviderUrlFallbackNluResult({
      message: `帮我订这个票：${lilWayneUrl}`,
      capturedAt,
    });

    expect(result).toMatchObject({
      intent: "create_plan",
      scenario: "activity",
      confirm_ready: true,
      assistant_reply: expect.stringContaining("Lil Wayne"),
      collected_constraints: {
        event_name: "Lil Wayne",
        event_type: "concert",
        num_tickets: 1,
        source_url: lilWayneUrl,
        source_host: "www.ticketmaster.com",
      },
    });
    expect(result?.assistant_reply).not.toContain("Sorry");
    expect(result?.__v2_state?.activity).toMatchObject({
      event_name: "Lil Wayne",
      event_type: "concert",
      num_tickets: 1,
    });
  });

  it("uses the normalized URL in the fallback result when the message starts with ttps", () => {
    const result = buildProviderUrlFallbackNluResult({
      message: `ttps://www.ticketmaster.com/lil-wayne-tickets/artist/712214 帮我订这个票`,
      capturedAt,
    });

    expect(result?.collected_constraints.source_url).toBe(
      "https://www.ticketmaster.com/lil-wayne-tickets/artist/712214",
    );
  });

  it("does not build a fallback for provider host impersonation", () => {
    expect(
      buildProviderUrlFallbackNluResult({
        message: "https://ticketmaster.com.evil.example/lil-wayne-tickets/artist/712214",
        capturedAt,
      }),
    ).toBeNull();
  });

  it("does not silently pick the first URL from a multi-URL message", () => {
    expect(
      buildProviderUrlFallbackNluResult({
        message: `${lilWayneUrl} https://www.ticketmaster.com/drake-tickets/artist/12345`,
        capturedAt,
      }),
    ).toBeNull();
  });
});
