import type {
  ActivityFields,
  HotelFields,
  IntentState,
  NluScenario,
  NluV2ParseResult,
  RestaurantFields,
  RouterAction,
  FlightFields,
} from "@/lib/agent/nlu-v2";
import type { NluCategory } from "@/lib/agent/nlu-v2/types";

export type CaptureSourceType = "request" | "url" | "text" | "screenshot";

export type CaptureActionType =
  | "ask_clarification"
  | "preview_task"
  | "create_task"
  | "create_room"
  | "save"
  | "compare";

export type CaptureReadinessReason =
  | "ready"
  | "missing_fields"
  | "needs_review"
  | "unsupported_source"
  | "low_confidence";

export interface CaptureSource {
  type: CaptureSourceType;
  raw_text?: string;
  url?: string;
  host?: string;
  captured_at: string;
}

export interface CaptureAction {
  type: CaptureActionType;
  label: string;
  disabled_reason?: string;
}

export interface CaptureTaskReadiness {
  ready: boolean;
  reason: CaptureReadinessReason;
  next_missing_fields: string[];
}

export interface CaptureTravelObject {
  source: CaptureSource;
  classification: {
    scenario: NluScenario | null;
    categories: NluCategory[];
    confidence: number;
    direct_booking: boolean;
  };
  entities: {
    restaurant?: RestaurantFields;
    hotel?: HotelFields;
    flight?: FlightFields;
    activity?: ActivityFields;
    trip?: IntentState["trip"];
  };
  constraints: Record<string, unknown>;
  missing_fields: string[];
  possible_actions: CaptureAction[];
  task_readiness: CaptureTaskReadiness;
  provenance: {
    parser: "nlu-v2" | "url-parser" | "fallback";
    nlu_state?: IntentState;
    nlu_action?: RouterAction;
    session_id?: string;
  };
}

export interface BuildCaptureTravelObjectInput {
  message: string;
  result: NluV2ParseResult;
  sessionId?: string | null;
  capturedAt?: string;
}

const URL_RE = /https?:\/\/[^\s<>"')]+/i;

const PROVIDER_SCENARIO_HINTS: Array<{
  host: RegExp;
  scenario: NluScenario;
  category: NluCategory;
}> = [
  { host: /(opentable|resy|tock|sevenrooms)\./i, scenario: "restaurant", category: "restaurant" },
  { host: /(booking|hotels|hoteltonight|hilton|hyatt|marriott|ihg)\./i, scenario: "hotel", category: "hotel" },
  { host: /(expedia|kayak|skyscanner|google\..*\/travel\/flights|delta|southwest|united|aa)\./i, scenario: "flight", category: "flight" },
  { host: /(ticketmaster|seatgeek|stubhub|broadway|telecharge)\./i, scenario: "activity", category: "activity" },
];

export function buildCaptureTravelObjectFromNlu(
  input: BuildCaptureTravelObjectInput,
): CaptureTravelObject {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const source = detectCaptureSource(input.message, capturedAt);
  const urlHint = source.host ? inferScenarioFromHost(source.host) : null;
  const state = input.result.__v2_state;
  const action = input.result.__v2_action;
  const scenario = input.result.scenario ?? urlHint?.scenario ?? null;
  const categories =
    input.result.categories.length > 0
      ? input.result.categories
      : urlHint
        ? [urlHint.category]
      : [];
  const confidence = state?.confidence ?? (input.result.confirm_ready ? 0.8 : 0.4);
  const missingFields = input.result.missing_fields ?? [];
  const constraints = {
    ...input.result.collected_constraints,
    ...(source.url ? { source_url: source.url } : {}),
    ...(source.host ? { source_host: source.host } : {}),
  };

  return {
    source,
    classification: {
      scenario,
      categories,
      confidence: normalizeConfidence(confidence),
      direct_booking: input.result.direct_booking === true,
    },
    entities: collectEntities(state),
    constraints,
    missing_fields: missingFields,
    possible_actions: buildCaptureActions({
      action,
      scenario,
      hasUrl: Boolean(source.url),
      missingFields,
    }),
    task_readiness: buildTaskReadiness({
      action,
      scenario,
      missingFields,
      confidence: state?.confidence,
      sourceType: source.type,
    }),
    provenance: {
      parser: state ? "nlu-v2" : source.url ? "url-parser" : "fallback",
      ...(state ? { nlu_state: state } : {}),
      ...(action ? { nlu_action: action } : {}),
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
    },
  };
}

export function detectCaptureSource(message: string, capturedAt: string): CaptureSource {
  const raw = message.trim();
  const url = raw.match(URL_RE)?.[0];
  if (url) {
    const parsed = safeParseUrl(url);
    return {
      type: "url",
      raw_text: raw,
      url,
      ...(parsed?.hostname ? { host: parsed.hostname.toLowerCase() } : {}),
      captured_at: capturedAt,
    };
  }

  if (looksLikeScreenshotReference(raw)) {
    return {
      type: "screenshot",
      raw_text: raw,
      captured_at: capturedAt,
    };
  }

  return {
    type: raw.length > 220 ? "text" : "request",
    raw_text: raw,
    captured_at: capturedAt,
  };
}

function inferScenarioFromHost(host: string): { scenario: NluScenario; category: NluCategory } | null {
  for (const hint of PROVIDER_SCENARIO_HINTS) {
    if (hint.host.test(host)) {
      return { scenario: hint.scenario, category: hint.category };
    }
  }
  return null;
}

function collectEntities(state: IntentState | undefined): CaptureTravelObject["entities"] {
  if (!state) return {};
  return {
    ...(state.restaurant ? { restaurant: state.restaurant } : {}),
    ...(state.hotel ? { hotel: state.hotel } : {}),
    ...(state.flight ? { flight: state.flight } : {}),
    ...(state.activity ? { activity: state.activity } : {}),
    ...(state.trip ? { trip: state.trip } : {}),
  };
}

function buildCaptureActions(input: {
  action?: RouterAction;
  scenario: NluScenario | null;
  hasUrl: boolean;
  missingFields: string[];
}): CaptureAction[] {
  const actions: CaptureAction[] = [{ type: "save", label: "Save to Onegent" }];
  if (input.hasUrl) {
    actions.push({ type: "preview_task", label: "Preview travel task" });
  }
  if (!input.scenario) {
    actions.push({
      type: "ask_clarification",
      label: "Clarify travel intent",
      disabled_reason: "Onegent needs to know whether this is restaurant, hotel, flight, activity, or trip.",
    });
    return actions;
  }

  if (input.action?.type === "ask_clarification") {
    actions.push({
      type: "ask_clarification",
      label: "Ask for missing details",
      disabled_reason: `Missing: ${input.missingFields.join(", ") || "required fields"}`,
    });
    return actions;
  }

  if (input.action?.type === "show_confirm_card") {
    actions.push({
      type: input.action.kind === "room" || input.action.kind === "trip" ? "create_room" : "create_task",
      label: input.action.kind === "room" ? "Create decision room" : "Create pending task",
    });
    actions.push({ type: "compare", label: "Compare options" });
    return actions;
  }

  actions.push({ type: "preview_task", label: "Preview travel task" });
  return actions;
}

function buildTaskReadiness(input: {
  action?: RouterAction;
  scenario: NluScenario | null;
  missingFields: string[];
  confidence: number | undefined;
  sourceType: CaptureSourceType;
}): CaptureTaskReadiness {
  if (!input.scenario) {
    return {
      ready: false,
      reason: input.sourceType === "url" ? "needs_review" : "unsupported_source",
      next_missing_fields: input.missingFields.length ? input.missingFields : ["categories"],
    };
  }

  if ((input.confidence ?? 1) < 0.35) {
    return {
      ready: false,
      reason: "low_confidence",
      next_missing_fields: input.missingFields,
    };
  }

  if (input.action?.type === "ask_clarification" || input.missingFields.length > 0) {
    return {
      ready: false,
      reason: "missing_fields",
      next_missing_fields: input.missingFields,
    };
  }

  if (input.action?.type === "show_confirm_card") {
    return {
      ready: true,
      reason: "ready",
      next_missing_fields: [],
    };
  }

  return {
    ready: false,
    reason: "needs_review",
    next_missing_fields: input.missingFields,
  };
}

function looksLikeScreenshotReference(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("screenshot") ||
    lower.includes("screen shot") ||
    lower.includes("image") ||
    lower.includes("photo") ||
    lower.includes("截图") ||
    /\.(png|jpe?g|webp|gif)\b/i.test(value)
  );
}

function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeConfidence(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.4;
  return Math.max(0, Math.min(1, value));
}
