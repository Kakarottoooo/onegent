/**
 * NLU v2 — Layer 2 state extractor.
 *
 * Given the conversation so far, produces a fully-formed IntentState as
 * strict JSON. Uses OpenAI gpt-4o-mini (with response_format: json_object)
 * because it's cheap, fast, and already paid for by the Stagehand setup.
 *
 * Design invariants:
 *   - Idempotent: same inputs → same output (enables replay testing)
 *   - Merge, don't replace: newer info augments prev_state, doesn't wipe it
 *   - Resolve relative dates at extraction time ("next weekend" → ISO date)
 *   - Only populate the single scenario sub-object that matches `scenario`
 *   - If a required slot wasn't mentioned, omit the field (don't emit "")
 *
 * See NLU_REFACTOR_PLAN_C.md section 3 for the full design rationale.
 */

import { openaiChat } from "../../openai";
import { resolveDateHint } from "../trip-intent-state";
import type { IntentState, NluIntent, NluScenario, PartyType } from "./types";

// Re-exported for callers (matches v1's ChatMessage shape).
export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface ExtractStateInput {
  /** Previous IntentState, or null for the first turn of a conversation. */
  prev_state: IntentState | null;
  /** The user's latest message (this turn). */
  new_user_message: string;
  /** The assistant's latest reply (from Layer 1). Optional — helps the
   *  extractor disambiguate when the user's answer was a quick-pick click. */
  new_assistant_reply?: string;
  /** Full conversation history so far (user + assistant alternating).
   *  Used as context; the extractor can resolve "the date we talked about"
   *  type references. */
  history?: Turn[];
  /** Override model; falls back to gpt-4o-mini when absent. */
  model?: string;
  /** Optional override API key (for BYOK users). */
  apiKey?: string;
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function extractState(input: ExtractStateInput): Promise<IntentState> {
  const now = new Date();
  // Use the SERVER'S LOCAL timezone, not UTC. A dev server in CDT at
  // 23:40 Wed reads UTC=04:40 Thu, which would anchor the calendar one day
  // off from what the user sees — "tomorrow" would then resolve to two
  // days ahead in local time. For prod we'll want the client's TZ plumbed
  // through; for dev, server-local is a correct default.
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const todayDayOfWeek = now.toLocaleDateString("en-US", { weekday: "long" });
  const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  // Pre-computed 14-day calendar. Lets the LLM look up "this Friday" / "next
  // Saturday" instead of computing offsets — gpt-4o-mini is unreliable at
  // day-of-week arithmetic even when the anchor is given.
  const weekdayLookup = buildWeekdayLookup(now);
  const prevSummary = input.prev_state ? formatPrevState(input.prev_state) : "(none — this is the first turn)";
  const historyBlock = formatHistory(input.history ?? []);

  const systemPrompt = buildExtractorSystemPrompt(today, todayDayOfWeek, nowHHMM, weekdayLookup);
  const userPrompt = buildExtractorUserPrompt({
    prevSummary,
    historyBlock,
    newUser: input.new_user_message,
    newAssistant: input.new_assistant_reply ?? "",
  });

  const raw = await openaiChat({
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    max_tokens: 1200,
    timeout_ms: 20_000,
    model: input.model,
    response_format: { type: "json_object" },
  });

  const parsed = parseAndValidate(raw, input.prev_state);
  // Defensive merge: if the extractor dropped a previously-known slot (model
  // drift happens), prefer the previously-known value. This keeps the state
  // monotonic across turns — a key invariant for multi-turn UX.
  const merged = mergePrevIntoNew(input.prev_state, parsed);
  // Belt-and-suspenders: catch the "next month → whole month" trap even if the
  // model ignored prompt rule #4 (extractor_prompt.md). See scrubWholeMonthAssumption below.
  return scrubWholeMonthAssumption(merged, input.history ?? [], input.new_user_message);
}

// ─── Prompt construction ─────────────────────────────────────────────────

const SCHEMA_REFERENCE = `
IntentState schema:
{
  "confidence": number,                 // 0-1, your self-assessed confidence
  "turn_count": integer,                // total turns folded in
  "updated_at": string,                 // ISO timestamp — use "$NOW" to fill
  "intent": "chitchat" | "create_plan" | "create_room" | "refine_existing" | "unknown",
  "scenario": "restaurant" | "hotel" | "flight" | "activity" | "trip" | null,
  "party_type": "solo" | "multi",
  "member_names": string[],             // other people mentioned by name
  "refined_target_id": string | null,

  // ONLY populate the sub-object matching the "scenario" value (omit the others)
  "restaurant"?: { city?, date?, time?, party_size?, cuisine?, budget_per_person?, neighborhood?, vibe?, dietary?, notes? },
  "hotel"?: { city?, check_in?, check_out?, nights?, guests?, star_rating?, neighborhood?, budget_max_per_night?, amenities?, vibe?, notes? },
  "flight"?: { origin?, dest?, date?, return_date?, is_round_trip?, passengers?, cabin_class?, max_stops?, preferred_airlines?, avoid_red_eye?, earliest_departure?, latest_departure?, notes? },
  "activity"?: { event_name?, event_type?, city?, event_date?, event_date_to?, num_tickets?, seat_type?, budget_max_per_ticket?, section_preferences?, avoid_sections?, wheelchair_required?, notes? },
  "trip"?: {
    destination_city?, departure_city?, start_date?, end_date?, nights?,
    travelers?, hotel_star_rating?, hotel_neighborhood?,
    activities: string[], cuisine_preferences: string[],
    vibe: "trendy" | "upscale" | "local" | "mixed",
    budget_total?, planning_assumptions: string[]
  },

  "planning_assumptions": string[]      // short notes about inferred values ("assumed dinner time = 7pm")
}
`;

function buildExtractorSystemPrompt(
  today: string,
  todayDayOfWeek: string,
  nowHHMM: string,
  weekdayLookup: string,
): string {
  return `You are Onegent's structured-data extractor. Your job: read a conversation and output the CURRENT best understanding of what the user wants as a JSON object that exactly matches the IntentState schema below.

Today's date: ${today} (${todayDayOfWeek}). Current time (UTC): ${nowHHMM}.

Calendar for the next 14 days — LOOK UP RELATIVE DATES HERE, DO NOT COMPUTE:
${weekdayLookup}

Resolution rules for relative expressions (match against the table above):
  "today"         → row marked (today)
  "tomorrow"      → row marked (tomorrow)
  "this <Weekday>" → the NEXT row whose Weekday matches, within the next 7 days
  "next <Weekday>" → the row marked "next <Weekday>" (7 days after "this <Weekday>")
  "this weekend"   → Saturday row in the "this week" block
  "next weekend"   → Saturday row in the "next week" block
  "in N days"      → pick the row N rows below today
"this Friday" when today is Wednesday → the Friday 2 rows below. NEVER pick Saturday or any other day — if the table says Friday is 2026-04-24, emit 2026-04-24.

Output rules:
1. MERGE, don't replace. If prev state has city="New York" and the new turn doesn't contradict it, keep city="New York". Only overwrite when the user explicitly changes their mind.
2. Only populate ONE scenario sub-object — the one matching \`scenario\`. Omit the others entirely (don't emit empty objects).
3. If the user hasn't mentioned a slot, OMIT it (don't emit "" or null for free-text slots). For number/boolean slots, only emit when explicitly stated.
4. Use the calendar above for all relative dates. Emit YYYY-MM-DD.
   BUT: if the user mentions ONLY a month without any duration cue ("next month",
   "下个月", "in April", "本月" with no "for N days", "for a week", "N 天", explicit
   end date, or nights count), LEAVE start_date / end_date / nights BLANK. Do NOT
   default to the whole month (e.g. May 1 → May 31). The router will then ask
   the user how long they want to stay.
   TIME FIELD (restaurant.time, etc.): must be HH:MM (24-hour). If the user says
   "now" / "right now" / "asap" / "现在" / "立刻" / "马上", resolve to the current
   time ${nowHHMM} (not the literal word "now"). If they say "7pm" / "晚上7点",
   emit "19:00". Leave blank if unmentioned.
5. Scenario selection:
   - "trip" when the user wants MULTIPLE categories bundled (flight + hotel at minimum, optionally restaurants / activities). Cues: "plan a trip to X", "go to X for N days", "帮我安排X旅行".
   - "restaurant" / "hotel" / "flight" / "activity" when the user wants a SINGLE category only.
   - null when the category truly can't be inferred.
6. Intent selection — read CAREFULLY, this is the most-abused slot:
   - "chitchat" for greetings / thanks / small talk with no booking verb.
   - "create_plan" = SOLO DECISION-MAKER. One user is arranging a booking,
     even if the trip / reservation is for multiple travelers. Examples:
       * "I want a 2-person trip to NY"                        → create_plan (1 decider booking for 2)
       * "Book a table for 4 on Friday"                        → create_plan (1 decider, 4 diners)
       * "Find a hotel in Tokyo, 3 of us"                      → create_plan
     This is the DEFAULT. Only escalate to create_room when the user
     explicitly signals other people are CO-DECIDING.
   - "create_room" = MULTIPLE DECISION-MAKERS who each need input / voting.
     Requires one of these SIGNALS (mere "2 people" / "for 4" is NOT enough):
       * Named other deciders: "我和李明想...", "me and Alice want..."
       * Explicit group-decision verbs: "let's decide together", "让大家投票", "group vote"
       * Plural pronouns referring to the deciders (not the travelers):
           "we're trying to figure out", "我们一起选"
       * Explicit "create a room" / "组个房间" / "建 decision room" verbs
     When unsure, prefer create_plan.
   - "refine_existing" when the user adjusts a previously returned plan
     ("换一个酒店", "cheaper").
   - "unknown" if the message is too ambiguous.
7. party_type (separate from intent — this describes TRAVELERS, not deciders):
   - "multi" whenever OTHER PEOPLE are named or plural pronouns appear
     referring to the deciders. NOT for traveler count alone.
   - "solo" otherwise. A "for 2 people" trip can still be party_type=solo
     if only one user is deciding.
8. Member_names: only non-creator people explicitly named as CO-DECIDERS
   (not "my wife" / "my family" — those are relationships not deciding members).
9. For trip scenario, always include:
     activities: string[] (empty [] if none mentioned)
     cuisine_preferences: string[] (empty [] if none mentioned)
     vibe: default "mixed" if user didn't say
     planning_assumptions: string[]
10. Return ONLY the JSON object, no markdown fences, no prose.

${SCHEMA_REFERENCE}
`;
}

interface UserPromptArgs {
  prevSummary: string;
  historyBlock: string;
  newUser: string;
  newAssistant: string;
}

function buildExtractorUserPrompt({ prevSummary, historyBlock, newUser, newAssistant }: UserPromptArgs): string {
  return `Previous state:
${prevSummary}

Conversation history (oldest first):
${historyBlock || "(none — this is turn 1)"}

This turn:
USER: ${newUser}
${newAssistant ? `ASSISTANT: ${newAssistant}` : ""}

Output the new IntentState JSON:`;
}

// ─── Formatting helpers ─────────────────────────────────────────────────

/**
 * Build a 14-day calendar lookup table for the extractor prompt. Each row
 * is a single line like "2026-04-24 (Friday) — this Friday" so the LLM
 * can resolve "this Friday" / "next weekend" by matching instead of
 * computing offsets. Why: gpt-4o-mini's day-of-week arithmetic is flaky
 * even when given the anchor day; observed in production with
 * "this Friday on Wed" → returned Saturday.
 *
 * @internal — exported for unit tests.
 */
export function buildWeekdayLookup(anchor: Date): string {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const pad = (n: number) => String(n).padStart(2, "0");
  const rows: string[] = [];
  for (let offset = 0; offset < 14; offset++) {
    // Build dates in the server's local TZ (not UTC) so the calendar matches
    // what the user sees on their own clock when dev server + user share a host.
    const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + offset);
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const dow = dayNames[d.getDay()];
    let label: string;
    if (offset === 0) label = "(today)";
    else if (offset === 1) label = "tomorrow";
    else if (offset < 7) label = `this ${dow}`;
    else if (offset === 7) label = `next ${dow} / a week from today`;
    else label = `next ${dow}`;
    rows.push(`  ${iso} (${dow}) — ${label}`);
  }
  return rows.join("\n");
}

function formatPrevState(s: IntentState): string {
  const copy: Partial<IntentState> = { ...s };
  // Strip meta to keep the prompt focused — extractor will regenerate these.
  delete (copy as { confidence?: number }).confidence;
  delete (copy as { turn_count?: number }).turn_count;
  delete (copy as { updated_at?: string }).updated_at;
  return JSON.stringify(copy, null, 2);
}

function formatHistory(turns: Turn[]): string {
  if (turns.length === 0) return "";
  return turns
    .slice(-12) // last 12 turns is plenty for most conversations
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join("\n");
}

// ─── Parsing + validation ───────────────────────────────────────────────

function parseAndValidate(raw: string, prev: IntentState | null): IntentState {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    console.warn("[nlu-v2 extractor] JSON parse failed, using fallback state. raw:", raw.slice(0, 200));
    throw new Error(`Extractor returned non-JSON: ${(err as Error).message}`);
  }
  if (!obj || typeof obj !== "object") {
    throw new Error("Extractor returned non-object");
  }
  return coerceIntentState(obj as Record<string, unknown>, prev);
}

/**
 * Defensive coercion: tolerate small shape drift from the model (wrong
 * enum casing, missing optional arrays, numeric-as-string). Anything too
 * corrupt is patched from `prev` so the state never regresses.
 */
function coerceIntentState(raw: Record<string, unknown>, prev: IntentState | null): IntentState {
  const now = new Date().toISOString();

  const intent = coerceEnum<NluIntent>(raw.intent, [
    "chitchat", "create_plan", "create_room", "refine_existing", "unknown",
  ], prev?.intent ?? "unknown");

  const scenario = coerceEnumOrNull<NluScenario>(raw.scenario, [
    "restaurant", "hotel", "flight", "activity", "trip",
  ], prev?.scenario ?? null);

  const party_type = coerceEnum<PartyType>(raw.party_type, ["solo", "multi"], prev?.party_type ?? "solo");

  const member_names = Array.isArray(raw.member_names)
    ? raw.member_names.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : prev?.member_names ?? [];

  const refined_target_id =
    typeof raw.refined_target_id === "string" && raw.refined_target_id
      ? raw.refined_target_id
      : null;

  const planning_assumptions = Array.isArray(raw.planning_assumptions)
    ? raw.planning_assumptions.filter((x): x is string => typeof x === "string")
    : prev?.planning_assumptions ?? [];

  const state: IntentState = {
    confidence: typeof raw.confidence === "number" ? clamp01(raw.confidence) : 0.5,
    turn_count: typeof raw.turn_count === "number" ? raw.turn_count : (prev?.turn_count ?? 0) + 1,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : now,
    intent,
    scenario,
    party_type,
    member_names,
    refined_target_id,
    planning_assumptions,
  };

  // Attach the scenario-specific sub-object. Run a pass that normalizes
  // dates (the extractor is instructed to emit ISO, but we validate).
  if (scenario === "restaurant") {
    state.restaurant = coerceRestaurant(raw.restaurant, prev?.restaurant);
  } else if (scenario === "hotel") {
    state.hotel = coerceHotel(raw.hotel, prev?.hotel);
  } else if (scenario === "flight") {
    state.flight = coerceFlight(raw.flight, prev?.flight);
  } else if (scenario === "activity") {
    state.activity = coerceActivity(raw.activity, prev?.activity);
  } else if (scenario === "trip") {
    state.trip = coerceTrip(raw.trip, prev?.trip);
  }

  return state;
}

function coerceRestaurant(
  raw: unknown,
  prev: IntentState["restaurant"] | undefined,
): IntentState["restaurant"] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    city: strOrUndef(r.city) ?? prev?.city,
    date: isoDateOrUndef(r.date) ?? prev?.date,
    time: normalizeTime(r.time) ?? prev?.time,
    party_size: numOrUndef(r.party_size) ?? prev?.party_size,
    cuisine: strOrUndef(r.cuisine) ?? prev?.cuisine,
    budget_per_person: numOrUndef(r.budget_per_person) ?? prev?.budget_per_person,
    neighborhood: strOrUndef(r.neighborhood) ?? prev?.neighborhood,
    vibe: strOrUndef(r.vibe) ?? prev?.vibe,
    dietary: strArrayOrUndef(r.dietary) ?? prev?.dietary,
    notes: strOrUndef(r.notes) ?? prev?.notes,
  };
}

function coerceHotel(
  raw: unknown,
  prev: IntentState["hotel"] | undefined,
): IntentState["hotel"] {
  const h = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    city: strOrUndef(h.city) ?? prev?.city,
    check_in: isoDateOrUndef(h.check_in) ?? prev?.check_in,
    check_out: isoDateOrUndef(h.check_out) ?? prev?.check_out,
    nights: numOrUndef(h.nights) ?? prev?.nights,
    guests: numOrUndef(h.guests) ?? prev?.guests,
    star_rating: numOrUndef(h.star_rating) ?? prev?.star_rating,
    neighborhood: strOrUndef(h.neighborhood) ?? prev?.neighborhood,
    budget_max_per_night: numOrUndef(h.budget_max_per_night) ?? prev?.budget_max_per_night,
    amenities: strArrayOrUndef(h.amenities) ?? prev?.amenities,
    vibe: strOrUndef(h.vibe) ?? prev?.vibe,
    notes: strOrUndef(h.notes) ?? prev?.notes,
  };
}

function coerceFlight(
  raw: unknown,
  prev: IntentState["flight"] | undefined,
): IntentState["flight"] {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cabinRaw = strOrUndef(f.cabin_class);
  const cabin_class =
    cabinRaw === "economy" || cabinRaw === "premium_economy" ||
    cabinRaw === "business" || cabinRaw === "first"
      ? cabinRaw
      : prev?.cabin_class;
  return {
    origin: strOrUndef(f.origin) ?? prev?.origin,
    dest: strOrUndef(f.dest) ?? prev?.dest,
    date: isoDateOrUndef(f.date) ?? prev?.date,
    return_date: isoDateOrUndef(f.return_date) ?? prev?.return_date,
    is_round_trip: typeof f.is_round_trip === "boolean" ? f.is_round_trip : prev?.is_round_trip,
    passengers: numOrUndef(f.passengers) ?? prev?.passengers,
    cabin_class,
    max_stops: numAs012(f.max_stops) ?? prev?.max_stops ?? null,
    preferred_airlines: strArrayOrUndef(f.preferred_airlines) ?? prev?.preferred_airlines,
    avoid_red_eye: typeof f.avoid_red_eye === "boolean" ? f.avoid_red_eye : prev?.avoid_red_eye,
    earliest_departure: strOrUndef(f.earliest_departure) ?? prev?.earliest_departure,
    latest_departure: strOrUndef(f.latest_departure) ?? prev?.latest_departure,
    notes: strOrUndef(f.notes) ?? prev?.notes,
  };
}

function coerceActivity(
  raw: unknown,
  prev: IntentState["activity"] | undefined,
): IntentState["activity"] {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const eventTypeRaw = strOrUndef(a.event_type);
  const event_type: IntentState["activity"] extends infer T ? T : never = eventTypeRaw as IntentState["activity"] extends infer T ? T : never;
  const seatTypeRaw = strOrUndef(a.seat_type);
  const seat_type =
    seatTypeRaw === "premium" || seatTypeRaw === "standard" || seatTypeRaw === "economy"
      ? seatTypeRaw
      : prev?.seat_type;
  return {
    event_name: strOrUndef(a.event_name) ?? prev?.event_name,
    event_type: (event_type as IntentState["activity"] extends object ? IntentState["activity"]["event_type"] : never) ?? prev?.event_type,
    city: strOrUndef(a.city) ?? prev?.city,
    event_date: isoDateOrUndef(a.event_date) ?? prev?.event_date,
    event_date_to: isoDateOrUndef(a.event_date_to) ?? prev?.event_date_to,
    num_tickets: numOrUndef(a.num_tickets) ?? prev?.num_tickets,
    seat_type,
    budget_max_per_ticket: numOrUndef(a.budget_max_per_ticket) ?? prev?.budget_max_per_ticket,
    section_preferences: strArrayOrUndef(a.section_preferences) ?? prev?.section_preferences,
    avoid_sections: strArrayOrUndef(a.avoid_sections) ?? prev?.avoid_sections,
    wheelchair_required: typeof a.wheelchair_required === "boolean" ? a.wheelchair_required : prev?.wheelchair_required,
    notes: strOrUndef(a.notes) ?? prev?.notes,
  };
}

function coerceTrip(
  raw: unknown,
  prev: IntentState["trip"] | undefined,
): IntentState["trip"] {
  const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const vibeRaw = strOrUndef(t.vibe);
  const vibe =
    vibeRaw === "trendy" || vibeRaw === "upscale" || vibeRaw === "local" || vibeRaw === "mixed"
      ? vibeRaw
      : prev?.vibe ?? "mixed";
  return {
    destination_city: strOrUndef(t.destination_city) ?? prev?.destination_city,
    departure_city: strOrUndef(t.departure_city) ?? prev?.departure_city,
    start_date: isoDateOrUndef(t.start_date) ?? prev?.start_date,
    end_date: isoDateOrUndef(t.end_date) ?? prev?.end_date,
    nights: numOrUndef(t.nights) ?? prev?.nights,
    travelers: numOrUndef(t.travelers) ?? prev?.travelers,
    hotel_star_rating: numOrUndef(t.hotel_star_rating) ?? prev?.hotel_star_rating,
    hotel_neighborhood: strOrUndef(t.hotel_neighborhood) ?? prev?.hotel_neighborhood,
    activities: strArrayOrUndef(t.activities) ?? prev?.activities ?? [],
    cuisine_preferences: strArrayOrUndef(t.cuisine_preferences) ?? prev?.cuisine_preferences ?? [],
    vibe,
    budget_total: numOrUndef(t.budget_total) ?? prev?.budget_total,
    planning_assumptions: strArrayOrUndef(t.planning_assumptions) ?? prev?.planning_assumptions ?? [],
  };
}

// ─── Value coercion primitives ──────────────────────────────────────────

function strOrUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function strArrayOrUndef(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function numOrUndef(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function numAs012(v: unknown): 0 | 1 | 2 | null | undefined {
  const n = numOrUndef(v);
  if (n === 0 || n === 1 || n === 2) return n;
  return undefined;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function coerceEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  return fallback;
}

function coerceEnumOrNull<T extends string>(
  v: unknown,
  allowed: readonly T[],
  fallback: T | null,
): T | null {
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  return fallback;
}

/**
 * Normalize a time string for restaurant.time (and any future HH:MM slot).
 * - HH:MM passes through unchanged.
 * - "now" / "asap" / "现在" / "立刻" / "马上" → current server time HH:MM.
 * - Anything else passes through as-is; the prompt asks for HH:MM so if the
 *   model emitted "7pm" we let it through and downstream can try to parse it.
 *
 * @internal — exported for unit tests.
 */
export function normalizeTime(v: unknown): string | undefined {
  const s = strOrUndef(v);
  if (!s) return undefined;
  if (/^\d{1,2}:\d{2}$/.test(s)) return s;
  if (/^(now|right\s+now|asap|immediately|现在|立刻|马上)$/i.test(s)) {
    const d = new Date();
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
  return s;
}

/**
 * Accept YYYY-MM-DD directly, otherwise pass through resolveDateHint
 * (handles "next weekend", "tomorrow", etc. as a last-resort safety net
 * if the model missed a relative expression).
 */
function isoDateOrUndef(v: unknown): string | undefined {
  const s = strOrUndef(v);
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const resolved = resolveDateHint(s);
  return resolved ?? undefined;
}

// ─── Monotonic merge ─────────────────────────────────────────────────────
// Guard against the model occasionally dropping a slot it previously knew
// about. For each scenario, if prev had a field and new doesn't, carry it
// over. This is a safety net — the prompt already tells the model to merge,
// but belt-and-suspenders.

function mergePrevIntoNew(prev: IntentState | null, next: IntentState): IntentState {
  if (!prev) return next;
  if (prev.scenario !== next.scenario) return next; // scenario changed — don't carry over stale sub-state

  const merged: IntentState = { ...next };
  if (next.scenario === "restaurant" && prev.restaurant && next.restaurant) {
    merged.restaurant = { ...prev.restaurant, ...stripUndef(next.restaurant) };
  } else if (next.scenario === "hotel" && prev.hotel && next.hotel) {
    merged.hotel = { ...prev.hotel, ...stripUndef(next.hotel) };
  } else if (next.scenario === "flight" && prev.flight && next.flight) {
    merged.flight = { ...prev.flight, ...stripUndef(next.flight) };
  } else if (next.scenario === "activity" && prev.activity && next.activity) {
    merged.activity = { ...prev.activity, ...stripUndef(next.activity) };
  } else if (next.scenario === "trip" && prev.trip && next.trip) {
    merged.trip = {
      ...prev.trip,
      ...stripUndef(next.trip),
      activities: next.trip.activities.length > 0 ? next.trip.activities : prev.trip.activities,
      cuisine_preferences:
        next.trip.cuisine_preferences.length > 0
          ? next.trip.cuisine_preferences
          : prev.trip.cuisine_preferences,
      planning_assumptions: next.trip.planning_assumptions.length > 0
        ? next.trip.planning_assumptions
        : prev.trip.planning_assumptions,
      vibe: next.trip.vibe === "mixed" ? prev.trip.vibe : next.trip.vibe,
    };
  }
  return merged;
}

function stripUndef<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj as unknown as Record<string, unknown>)) {
    if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

// ─── Whole-month assumption scrub ───────────────────────────────────────
// If the model filled start_date/end_date/nights covering a full ~month because
// the user vaguely said "next month" / "下个月" without stating duration, scrub
// those fields so the router asks "how long?".
//
// Guards against this trap in two parts:
//   - span:  do we actually have a ≥25-day window?
//   - cue:   user mentioned a bare month ("next month" / "下个月" / "in April")
//            AND didn't give an explicit duration ("for a month", "整月",
//            "for N days", "N 晚"). Both must be true so "Go to Paris for a
//            month" stays intact.

/** @internal — exported for unit tests. */
export function scrubWholeMonthAssumption(
  state: IntentState,
  history: Turn[],
  newMessage: string,
): IntentState {
  if (state.scenario !== "trip" || !state.trip) return state;

  const span = computeTripSpanDays(state.trip.nights, state.trip.start_date, state.trip.end_date);
  if (span === null || span < 25) return state;

  const text = [newMessage, ...history.map((t) => t.content)].join(" ").toLowerCase();

  const hasBareMonthCue =
    /\b(next|this|coming|following)\s+month\b/.test(text) ||
    /(下个月|下月|本月|这个月)/.test(text) ||
    /\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(text);

  const hasExplicitDurationCue =
    /\b(for\s+)?(a|one|1|the\s+whole|an?\s+entire|the\s+entire)\s+month\b/.test(text) ||
    /(一整月|一个月|整月|month[- ]long)/.test(text) ||
    /\bfor\s+\d+\s*(day|days|night|nights|week|weeks)\b/.test(text) ||
    /\d+\s*(晚|天|周)/.test(text);

  if (!hasBareMonthCue || hasExplicitDurationCue) return state;

  return {
    ...state,
    trip: {
      ...state.trip,
      start_date: undefined,
      end_date: undefined,
      nights: undefined,
    },
    planning_assumptions: [
      ...state.planning_assumptions,
      "Bare month mention without duration — cleared dates so router asks how long.",
    ],
  };
}

function computeTripSpanDays(
  nights: number | undefined,
  start: string | undefined,
  end: string | undefined,
): number | null {
  if (typeof nights === "number" && Number.isFinite(nights)) return nights;
  if (start && end) {
    const s = Date.parse(start);
    const e = Date.parse(end);
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s) {
      return Math.round((e - s) / 86_400_000);
    }
  }
  return null;
}
