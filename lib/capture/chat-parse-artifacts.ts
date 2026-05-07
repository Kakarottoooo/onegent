import type { IntentState, NluV2ParseResult, RouterAction } from "@/lib/agent/nlu-v2";
import {
  buildCaptureTravelObjectFromNlu,
  type CaptureTravelObject,
} from "@/lib/capture/travel-object";
import { parseDirectActivityProviderUrl } from "@/lib/capture/direct-provider-url";
import {
  buildCaptureTaskBoundary,
  type CaptureTaskBoundaryResult,
} from "@/lib/capture/task-boundary";

export interface BuildCaptureChatParseArtifactsInput {
  message: string;
  result: NluV2ParseResult;
  sessionId?: string | null;
  chatId?: string | null;
  capturedAt?: string;
}

export interface CaptureChatParseArtifacts {
  capture_travel_object: CaptureTravelObject;
  capture_task_boundary: CaptureTaskBoundaryResult;
}

export function buildCaptureChatParseArtifacts(
  input: BuildCaptureChatParseArtifactsInput,
): CaptureChatParseArtifacts {
  const captureTravelObject = buildCaptureTravelObjectFromNlu({
    message: input.message,
    result: input.result,
    sessionId: input.sessionId,
    chatId: input.chatId,
    capturedAt: input.capturedAt,
  });
  const captureTaskBoundary = buildCaptureTaskBoundary(captureTravelObject, {
    sourceSessionId: input.sessionId,
    sourceChatId: input.chatId,
  });

  return {
    capture_travel_object: captureTravelObject,
    capture_task_boundary: captureTaskBoundary,
  };
}

export function buildProviderUrlFallbackNluResult(input: {
  message: string;
  capturedAt?: string;
}): NluV2ParseResult | null {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const baseResult: NluV2ParseResult = {
    intent: "chitchat",
    scenario: null,
    categories: [],
    party_type: "solo",
    member_names: [],
    collected_constraints: {},
    missing_fields: [],
    suggested_clarify_question: null,
    suggested_quick_picks: null,
    confirm_ready: false,
    refined_target_id: null,
    assistant_reply: null,
  };
  const capture = buildCaptureTravelObjectFromNlu({
    message: input.message,
    result: baseResult,
    capturedAt,
  });

  if (capture.source.type !== "url" || !capture.source.url) return null;
  if ((capture.source.additional_urls?.length ?? 0) > 0) return null;
  if (capture.classification.scenario !== "activity") return null;

  const inferred = inferActivityFromProviderUrl(capture.source.url);
  if (!inferred) return null;

  const state: IntentState = {
    confidence: 0.62,
    turn_count: 1,
    updated_at: capturedAt,
    intent: "create_plan",
    scenario: "activity",
    categories: ["activity"],
    party_type: "solo",
    member_names: [],
    refined_target_id: null,
    planning_assumptions: ["provider_url_fallback"],
    activity: {
      event_name: inferred.eventName,
      event_type: inferred.eventType,
      num_tickets: 1,
      notes: `Provider URL: ${capture.source.url}`,
    },
  };
  const action: RouterAction = {
    type: "show_confirm_card",
    kind: "plan",
    state,
  };
  return {
    intent: "create_plan",
    scenario: "activity",
    categories: ["activity"],
    party_type: "solo",
    member_names: [],
    collected_constraints: {
      event_name: inferred.eventName,
      event_type: inferred.eventType,
      num_tickets: 1,
      source_url: capture.source.url,
      ...(capture.source.host ? { source_host: capture.source.host } : {}),
      provider: inferred.provider,
      provider_page_type: inferred.pageType,
      provider_page_id: inferred.providerPageId,
      source_execution_mode: inferred.executionMode,
      source_needs_user_choice: inferred.needsUserChoice,
    },
    missing_fields: [],
    suggested_clarify_question: null,
    suggested_quick_picks: null,
    confirm_ready: true,
    refined_target_id: null,
    assistant_reply: buildProviderUrlFallbackReply(inferred),
    __v2_state: state,
    __v2_action: action,
  };
}

function inferActivityFromProviderUrl(url: string): {
  eventName: string;
  eventType: NonNullable<IntentState["activity"]>["event_type"];
  provider: string;
  pageType: string;
  providerPageId: string;
  needsUserChoice: boolean;
  executionMode: "direct_execution" | "provider_start";
} | null {
  const direct = parseDirectActivityProviderUrl(url);
  if (!direct) return null;
  const eventName = direct.titleHint || "Provider event";
  if (!eventName) return null;
  return {
    eventName,
    eventType: inferActivityType(eventName, direct.host),
    provider: direct.provider,
    pageType: direct.pageType,
    providerPageId: direct.providerPageId,
    needsUserChoice: direct.needsUserChoice,
    executionMode: direct.executionMode,
  };
}

function buildProviderUrlFallbackReply(input: {
  eventName: string;
  provider: string;
  executionMode: "direct_execution" | "provider_start";
  needsUserChoice: boolean;
}): string {
  const provider = labelForProvider(input.provider);
  if (input.executionMode === "provider_start" || input.needsUserChoice) {
    return [
      `I found the ${provider} provider page for ${input.eventName}.`,
      "I can start from that page directly and use its listings as the source of truth.",
      "If multiple events, dates, cities, or seats require a choice, I will pause for you.",
      "I will stop before seat selection, login, payment, or final confirmation.",
    ].join(" ");
  }
  return [
    `I found the exact ${provider} event page for ${input.eventName}.`,
    "I can start this task directly from that event link.",
    "I will stop before seat selection, login, payment, or final confirmation.",
  ].join(" ");
}

function labelForProvider(provider: string): string {
  if (provider === "ticketmaster") return "Ticketmaster";
  if (provider === "stubhub") return "StubHub";
  if (provider === "seatgeek") return "SeatGeek";
  if (provider === "eventbrite") return "Eventbrite";
  return "provider";
}

function inferActivityType(
  eventName: string,
  host: string,
): NonNullable<IntentState["activity"]>["event_type"] {
  if (/\b(vs?\.?|v)\b/i.test(eventName)) return "sports";
  if (host.includes("eventbrite")) return "other";
  return "concert";
}
