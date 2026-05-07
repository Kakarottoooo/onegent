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

// Brand → scenario hints. Each entry lists the brand tokens (lowercased) we
// recognize as that vertical. Matching anchors to the *registrable* host
// suffix ("brand.tld" or "brand.co.tld"), so "ticketmaster.com.evil.example"
// — which contains the substring "ticketmaster." — does NOT match. See
// matchProviderScenarioHint for the full rule.
const PROVIDER_SCENARIO_HINTS: Array<{
  brands: readonly string[];
  scenario: NluScenario;
  category: NluCategory;
}> = [
  {
    brands: ["opentable", "resy", "tock", "sevenrooms", "tablecheck", "chope"],
    scenario: "restaurant",
    category: "restaurant",
  },
  {
    brands: [
      "booking",
      "hotels",
      "hoteltonight",
      "hilton",
      "hyatt",
      "marriott",
      "ihg",
      "airbnb",
      "vrbo",
      "agoda",
    ],
    scenario: "hotel",
    category: "hotel",
  },
  {
    brands: [
      "expedia",
      "kayak",
      "skyscanner",
      "delta",
      "southwest",
      "united",
      "aa",
      "jetblue",
      "alaskaair",
      "lufthansa",
      "britishairways",
      "airfrance",
    ],
    scenario: "flight",
    category: "flight",
  },
  {
    brands: [
      "ticketmaster",
      "seatgeek",
      "stubhub",
      "broadway",
      "telecharge",
      "eventbrite",
    ],
    scenario: "activity",
    category: "activity",
  },
];

// Multi-segment public suffixes we treat as locale TLDs. Anything else is
// a single-segment TLD ("com", "net", "io", ...). Kept short on purpose —
// the goal is to recognize the legitimate locale variants of the providers
// we already cover, not to be a full PSL.
const MULTI_SEGMENT_TLDS = new Set<string>([
  "co.uk",
  "co.jp",
  "co.kr",
  "co.in",
  "co.nz",
  "co.za",
  "com.au",
  "com.br",
  "com.cn",
  "com.hk",
  "com.mx",
  "com.sg",
  "com.tw",
]);

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
  const registrable = registrableHost(host);
  if (!registrable) return null;
  // Brand is the labels of `registrable` minus the final 1 or 2 TLD labels.
  // For "ticketmaster.com" → brand="ticketmaster". For
  // "ticketmaster.co.uk" → brand="ticketmaster". For
  // "ticketmaster.com.evil.example" → registrable="evil.example" → brand="evil".
  const brand = brandLabelOf(registrable);
  if (!brand) return null;
  for (const hint of PROVIDER_SCENARIO_HINTS) {
    if (hint.brands.includes(brand)) {
      return { scenario: hint.scenario, category: hint.category };
    }
  }
  return null;
}

/**
 * Return the registrable (eTLD+1 or eTLD+1 for known multi-segment TLDs)
 * portion of a hostname, lowercased. "www.opentable.com" → "opentable.com".
 * "www.ticketmaster.co.uk" → "ticketmaster.co.uk".
 * "ticketmaster.com.evil.example" → "evil.example".
 *
 * Returns null for IPs, single-label hosts, or anything that fails URL parse.
 */
function registrableHost(host: string): string | null {
  const lower = host.toLowerCase().trim();
  if (!lower) return null;
  // Reject IPv4/IPv6-ish.
  if (/^\d+(?:\.\d+){3}$/.test(lower)) return null;
  if (lower.includes(":")) return null;
  const parts = lower.split(".").filter((p) => p.length > 0);
  if (parts.length < 2) return null;
  // Try a 3-label match against MULTI_SEGMENT_TLDS first (e.g. ".co.uk").
  if (parts.length >= 3) {
    const tail2 = parts.slice(-2).join(".");
    if (MULTI_SEGMENT_TLDS.has(tail2)) {
      return parts.slice(-3).join(".");
    }
  }
  return parts.slice(-2).join(".");
}

function brandLabelOf(registrable: string): string | null {
  const parts = registrable.split(".");
  if (parts.length === 0) return null;
  return parts[0] || null;
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
    // kind="room" is unambiguously multi-party. kind="trip" is the legacy
    // alias the router emits for BOTH solo (intent=create_plan) and multi
    // (intent=create_room) 4-category trip flows — read state.intent to
    // decide the action label so a solo trip plan doesn't surface as
    // "Create decision room" and a multi-party DR doesn't surface as
    // "Create pending task".
    const isRoom =
      input.action.kind === "room" ||
      (input.action.kind === "trip" &&
        input.action.state.intent === "create_room");
    actions.push({
      type: isRoom ? "create_room" : "create_task",
      label: isRoom ? "Create decision room" : "Create pending task",
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
    // url + screenshot: source is supported but we need user context to
    // turn it into a Travel Object. Keep them on the "needs_review"
    // branch so the homepage UI nudges for context (a description of
    // what's in the screenshot, or an explicit category for the URL)
    // instead of declining as unsupported.
    const needsReviewSource =
      input.sourceType === "url" || input.sourceType === "screenshot";
    return {
      ready: false,
      reason: needsReviewSource ? "needs_review" : "unsupported_source",
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
  // Image filename — strongest signal.
  if (/\.(png|jpe?g|webp|gif|heic|bmp)\b/i.test(value)) return true;
  // Whole-word screenshot/截图 — second-strongest. We require word
  // boundaries so "screenshotting" still matches but inert substrings
  // don't (e.g. an arbitrary URL slug containing "screenshot").
  if (/\bscreenshot(?:s|ting)?\b/i.test(value)) return true;
  if (/\bscreen\s+shots?\b/i.test(value)) return true;
  if (/(?:截图|屏幕截图|屏幕快照|抓图|抓屏)/u.test(value)) return true;
  // "image" / "photo" / "picture" alone are too broad ("famous photos of
  // Yosemite", "image of the skyline" are travel descriptions, not
  // screenshot references). Require an explicit pointer that the user is
  // referring to AN attached/uploaded/visible image.
  if (
    /\b(?:this|that|the|attached|uploaded|sent|here'?s?\s+(?:an?|the))\s+(?:image|photo|picture|pic|snapshot)s?\b/i.test(
      value,
    )
  ) {
    return true;
  }
  if (/(?:这张|那张|这个|这份|附件)\s*(?:图片?|照片|快照|图)/u.test(value)) return true;
  return false;
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
