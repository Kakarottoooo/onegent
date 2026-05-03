/**
 * Mock NLU pipeline for /dev/profile-gap-flow.
 *
 * The real homepage chat path looks like:
 *
 *   1. POST /api/chat/parse with the user's new message
 *   2. Server runs the LLM extractor → coerceIntentState → routeIntent
 *   3. Response carries `__v2_state` + `__v2_action` for the frontend
 *      to dispatch
 *
 * This dev-only file STUBS step 1+2 with a pattern matcher that produces
 * a synthetic raw extractor JSON, then runs the SAME coerceIntentState +
 * routeIntent the production path uses. The downstream contract is
 * therefore real — only the LLM accuracy is faked. That's the right
 * trade-off for a wiring demo: we want to exercise apply_profile_patch
 * end-to-end without burning a real OpenAI call per keystroke.
 *
 * If a wiring bug shows up here, it'll show up in production too.
 */

import { coerceIntentState } from "@/lib/agent/nlu-v2/extractor";
import {
  routeIntent,
  type IntentState,
  type RouterAction,
} from "@/lib/agent/nlu-v2";

export interface MockTurn {
  /** What the user typed verbatim. */
  userText: string;
  /** State before this turn (null on first turn). */
  prevState: IntentState | null;
}

export interface MockTurnResult {
  /** Assistant's natural-language reply (Layer 1 stub). */
  assistantReply: string;
  /** Coerced state after merging this turn. */
  state: IntentState;
  /** Action the frontend should dispatch. */
  action: RouterAction;
  /** The synthetic raw JSON we fed coerceIntentState — exposed for the
   *  debug sidebar so the user can see exactly what the "extractor" emitted. */
  rawExtractorJson: Record<string, unknown>;
}

/* ─── Public API ───────────────────────────────────────────────────── */

export function runMockTurn(turn: MockTurn): MockTurnResult {
  const raw = stubExtractor(turn.userText, turn.prevState);
  const state = coerceIntentState(raw, turn.prevState);
  const action = routeIntent(state);
  const assistantReply = composeAssistantReply(turn.userText, state, action);
  return { assistantReply, state, action, rawExtractorJson: raw };
}

/* ─── Stub extractor ───────────────────────────────────────────────── */

/**
 * Tiny pattern matcher. Recognizes the demo presets + a few free-form
 * phrasings. Real extractor is the LLM in production — this is just
 * enough to exercise the router branches.
 */
function stubExtractor(
  text: string,
  prev: IntentState | null,
): Record<string, unknown> {
  const t = text.trim();
  const tl = t.toLowerCase();

  const profilePatch = parseProfilePatch(t);
  if (profilePatch) {
    return {
      // Preserve any prev booking sub-state so the demo shows mid-flow
      // profile_edit doesn't wipe the ambient flow (matches the J4 worked
      // example in extractor.ts).
      ...carryForwardBookingState(prev),
      intent: "profile_edit",
      profile_patch: profilePatch,
    };
  }

  // Restaurant booking — naive: needs a venue or "book" verb + city + date hint
  const restaurant = parseRestaurantBooking(t);
  if (restaurant) {
    return {
      intent: "create_plan",
      scenario: "restaurant",
      categories: ["restaurant"],
      party_type: "solo",
      member_names: [],
      restaurant,
    };
  }

  // Trivial chitchat fallback
  if (/^(hi|hello|hey|你好|嗨)\b/i.test(tl)) {
    return {
      intent: "chitchat",
      scenario: null,
      categories: [],
      party_type: "solo",
      member_names: [],
    };
  }

  // Default: unknown — router will continue_chat
  return {
    intent: "unknown",
    scenario: null,
    categories: [],
    party_type: "solo",
    member_names: [],
  };
}

function carryForwardBookingState(prev: IntentState | null): Record<string, unknown> {
  if (!prev) return {};
  if (prev.intent === "profile_edit") return {}; // don't compound profile-edit turns
  // Carry whichever sub-object was present so coerce sees it and re-merges.
  const out: Record<string, unknown> = {
    scenario: prev.scenario,
    categories: prev.categories,
    party_type: prev.party_type,
    member_names: prev.member_names,
  };
  if (prev.restaurant) out.restaurant = prev.restaurant;
  if (prev.hotel) out.hotel = prev.hotel;
  if (prev.flight) out.flight = prev.flight;
  if (prev.activity) out.activity = prev.activity;
  if (prev.trip) out.trip = prev.trip;
  return out;
}

/* ─── Profile patch matchers ──────────────────────────────────────── */

interface ProfilePatchOut {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  date_of_birth?: string;
  passport_number?: string;
  passport_expiry?: string;
  passport_country?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

/**
 * Recognize a handful of canonical "save my X" patterns. Order matters —
 * more specific matchers first so "save my passport country" doesn't
 * fall through to "save my passport".
 */
function parseProfilePatch(text: string): ProfilePatchOut | null {
  const out: ProfilePatchOut = {};
  let any = false;

  // "save my name as Jane Doe"
  const nameMatch = text.match(
    /(?:save|store|update|set|我的名字是|my name is|name as)\s+([A-Za-z一-龥][A-Za-z一-龥\s]{1,40}?)(?:[.,;]|$)/i,
  );
  if (nameMatch && /\b(name|我的名字)\b/i.test(text)) {
    const parts = nameMatch[1].trim().split(/\s+/);
    if (parts.length >= 2) {
      out.first_name = parts[0];
      out.last_name = parts.slice(1).join(" ");
      any = true;
    }
  }

  // DOB — "save my DOB 1995/05/15", "我的 DOB 是 1995-05-15", "DOB May 15 1995"
  const dobMatch =
    text.match(/(?:DOB|date of birth|我的\s*DOB|出生日期|生日)[^\d]*(\d{4}[-/年]\s*\d{1,2}[-/月]\s*\d{1,2}日?)/i) ||
    text.match(/(?:DOB|date of birth)[^A-Za-z0-9]+([A-Za-z]+\s+\d{1,2}(?:,)?\s+\d{4})/i);
  if (dobMatch) {
    const iso = normalizeIsoDate(dobMatch[1]);
    if (iso) {
      out.date_of_birth = iso;
      any = true;
    }
  }

  // Passport number — "save my passport A1234567"
  const passportMatch = text.match(
    /(?:passport(?:\s+number)?|护照号?(?:码)?)\s*(?:is|是|=|:|—)?\s*([A-Z][0-9]{6,9})\b/i,
  );
  if (passportMatch) {
    out.passport_number = passportMatch[1].toUpperCase();
    any = true;
  }

  // Email
  const emailMatch = text.match(
    /(?:email|邮箱)\s*(?:is|是|=|:|—)?\s*([^\s@]+@[^\s@]+\.[^\s@,;]+)/i,
  );
  if (emailMatch) {
    out.email = emailMatch[1];
    any = true;
  }

  // Phone — keeps user's punctuation
  const phoneMatch = text.match(
    /(?:phone|电话|手机)\s*(?:is|是|=|:|—)?\s*(\+?[\d\s().-]{7,25}\d)/i,
  );
  if (phoneMatch) {
    out.phone = phoneMatch[1].trim();
    any = true;
  }

  // Require some explicit save-intent verb if we matched ONLY phone/email
  // and no other field — anti-pattern: "call me at 555-..." shouldn't be
  // a profile patch. Save-verb gate.
  const hasSaveVerb = /\b(save|store|update|set|存|保存|记下|记一下|update)\b/i.test(text);
  if (any && !hasSaveVerb) {
    // If we only matched soft fields without a save verb, drop them.
    const hardSignal = out.date_of_birth || out.passport_number || out.first_name;
    if (!hardSignal) return null;
  }

  return any ? out : null;
}

/* ─── Restaurant booking matcher ──────────────────────────────────── */

interface RestaurantOut {
  restaurant_name?: string;
  city?: string;
  date?: string;
  time?: string;
  party_size?: number;
}

function parseRestaurantBooking(text: string): RestaurantOut | null {
  // Triggers: "book", "find me", "reserve" + a venue or city
  if (!/\b(book|reserve|find me|订|帮我订|找个|预约|订位)\b/i.test(text)) {
    return null;
  }
  const out: RestaurantOut = {};

  // Venue — capture proper nouns following "book/reserve"
  const venueMatch = text.match(/(?:book|reserve|订)\s+([A-Z][\w'&]*(?:\s+[A-Z][\w'&]*)*)/);
  if (venueMatch) out.restaurant_name = venueMatch[1];

  // Party size: "for 2", "2 人", "for 4 people"
  const partyMatch = text.match(/(?:for|—)\s*(\d{1,2})\s*(?:people|guests|位|人)?/i) || text.match(/(\d{1,2})\s*(?:人|位)/);
  if (partyMatch) out.party_size = parseInt(partyMatch[1], 10);

  // Time: "8pm" / "19:00" / "晚上 7点"
  const timeMatch = text.match(/(\d{1,2}):(\d{2})/) || text.match(/(\d{1,2})\s*(am|pm)\b/i);
  if (timeMatch) {
    if (timeMatch[2] && /am|pm/i.test(timeMatch[2])) {
      let h = parseInt(timeMatch[1], 10);
      if (/pm/i.test(timeMatch[2]) && h < 12) h += 12;
      if (/am/i.test(timeMatch[2]) && h === 12) h = 0;
      out.time = `${String(h).padStart(2, "0")}:00`;
    } else {
      out.time = `${String(timeMatch[1]).padStart(2, "0")}:${timeMatch[2]}`;
    }
  }

  // Date hints — "tomorrow" / "tonight" / "today" / "明天" / "今晚"
  if (/\btomorrow\b|明天/i.test(text)) {
    out.date = isoOffset(1);
  } else if (/\btonight\b|今晚/i.test(text)) {
    out.date = isoOffset(0);
  }

  // City — "in <City>" or "<City>" before a known marker
  const cityMatch = text.match(/\bin\s+(New York|NYC|San Francisco|SF|LA|Los Angeles|Boston|Chicago|Tokyo|纽约|洛杉矶|波士顿)\b/i);
  if (cityMatch) {
    out.city = canonicalCity(cityMatch[1]);
  }

  if (Object.keys(out).length === 0) return null;
  return out;
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

function normalizeIsoDate(raw: string): string | null {
  // 1995-05-15 / 1995/05/15
  const slash = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (slash) {
    return `${slash[1]}-${pad2(slash[2])}-${pad2(slash[3])}`;
  }
  // 1995年5月15日
  const cn = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
  if (cn) {
    return `${cn[1]}-${pad2(cn[2])}-${pad2(cn[3])}`;
  }
  // May 15, 1995 / May 15 1995
  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const text = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (text) {
    const month = months.indexOf(text[1].toLowerCase());
    if (month >= 0) {
      return `${text[3]}-${pad2(month + 1)}-${pad2(text[2])}`;
    }
  }
  return null;
}

function pad2(n: string | number): string {
  return String(n).padStart(2, "0");
}

function isoOffset(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function canonicalCity(raw: string): string {
  const map: Record<string, string> = {
    "nyc": "New York",
    "new york": "New York",
    "纽约": "New York",
    "sf": "San Francisco",
    "san francisco": "San Francisco",
    "la": "Los Angeles",
    "los angeles": "Los Angeles",
    "洛杉矶": "Los Angeles",
    "boston": "Boston",
    "波士顿": "Boston",
    "chicago": "Chicago",
    "tokyo": "Tokyo",
  };
  return map[raw.toLowerCase()] ?? raw;
}

/* ─── Assistant-reply composer (Layer 1 stub) ─────────────────────── */

function composeAssistantReply(
  userText: string,
  state: IntentState,
  action: RouterAction,
): string {
  switch (action.type) {
    case "apply_profile_patch": {
      const fields = Object.entries(action.patch)
        .map(([k, v]) => `${prettyField(k)} → ${v}`)
        .join(", ");
      return `Saved ${fields}. ✓ I'll keep this for your next booking.`;
    }
    case "ask_clarification":
      return clarifyReply(state, action.missing);
    case "show_confirm_card":
      return confirmReply(state, action.kind);
    case "continue_chat":
      if (state.intent === "chitchat") return "Hi! What would you like to plan today?";
      return "I'm not sure I caught that — could you rephrase or tap one of the suggestions?";
  }
}

function clarifyReply(state: IntentState, missing: string[]): string {
  if (missing.includes("categories")) {
    return "What would you like to book? Restaurant, hotel, flight, activity — or a full plan?";
  }
  if (missing.includes("party_mode")) {
    return "Got it — should I book this for you yourself, or pull others into a Decision Room to weigh in?";
  }
  if (missing.includes("member_names")) {
    return "Sure — who else should join the Decision Room?";
  }
  return `I need a bit more: ${missing.join(", ")}.`;
}

function confirmReply(state: IntentState, kind: string): string {
  if (kind === "plan" && state.scenario === "restaurant") {
    const r = state.restaurant;
    const venue = r?.restaurant_name ? `at ${r.restaurant_name}` : `in ${r?.city ?? "your city"}`;
    return `Let me put together a restaurant booking ${venue}.`;
  }
  return `Got it — let me put together a ${state.scenario ?? "booking"} for you.`;
}

function prettyField(key: string): string {
  switch (key) {
    case "first_name": return "first name";
    case "last_name": return "last name";
    case "date_of_birth": return "date of birth";
    case "passport_number": return "passport number";
    case "passport_expiry": return "passport expiry";
    case "passport_country": return "passport country";
    case "address_line1": return "street address";
    default: return key.replace(/_/g, " ");
  }
}
