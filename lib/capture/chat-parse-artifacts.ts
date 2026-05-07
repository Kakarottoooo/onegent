import type { IntentState, NluV2ParseResult, RouterAction } from "@/lib/agent/nlu-v2";
import {
  buildCaptureTravelObjectFromNlu,
  type CaptureTravelObject,
} from "@/lib/capture/travel-object";
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
    },
    missing_fields: [],
    suggested_clarify_question: null,
    suggested_quick_picks: null,
    confirm_ready: true,
    refined_target_id: null,
    assistant_reply: `I found the provider page for ${inferred.eventName}. Confirm to start from that page; I will stop before seat selection, login, payment, or final confirmation.`,
    __v2_state: state,
    __v2_action: action,
  };
}

const FALLBACK_ACTIVITY_PROVIDER_HOSTS = [
  "ticketmaster.com",
  "ticketmaster.ca",
  "ticketmaster.co.uk",
  "ticketmaster.com.au",
  "ticketmaster.de",
  "ticketmaster.fr",
  "ticketmaster.es",
  "ticketmaster.it",
  "ticketmaster.nl",
  "ticketmaster.ie",
  "seatgeek.com",
  "stubhub.com",
  "eventbrite.com",
] as const;

function inferActivityFromProviderUrl(url: string): {
  eventName: string;
  eventType: NonNullable<IntentState["activity"]>["event_type"];
} | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!isFallbackActivityProviderHost(host)) {
    return null;
  }
  const segments = parsed.pathname
    .split("/")
    .map((segment) => safeDecode(segment).trim())
    .filter(Boolean);
  if (segments.length === 0) return null;
  const markerIndex = segments.findIndex((segment) =>
    /^(artist|event|e|events|tickets)$/i.test(segment),
  );
  const slug = markerIndex > 0 ? segments[markerIndex - 1] : segments[0];
  const eventName = titleizeSlug(slug);
  if (!eventName) return null;
  return {
    eventName,
    eventType: inferActivityType(eventName, host),
  };
}

function isFallbackActivityProviderHost(host: string): boolean {
  return FALLBACK_ACTIVITY_PROVIDER_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function titleizeSlug(value: string): string {
  const cleaned = value
    .replace(/\.(html?|aspx?)$/i, "")
    .replace(/(?:^|-)(?:tickets?|events?|artist)$/gi, "")
    .replace(/-+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((word) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function inferActivityType(
  eventName: string,
  host: string,
): NonNullable<IntentState["activity"]>["event_type"] {
  if (/\b(vs?\.?|v)\b/i.test(eventName)) return "sports";
  if (host.includes("eventbrite")) return "other";
  return "concert";
}
