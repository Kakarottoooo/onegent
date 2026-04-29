/**
 * NLU v2 — extractor prompt + state-coercion helpers.
 *
 * The async public path that called the LLM lived here under
 * `extractState()`; that call is now part of the unified turn (see
 * `unified.ts`) so this file is just the prompt builder + parsing /
 * coercion / scrub helpers that the unified path consumes.
 *
 * Why split: a unified call avoids the cross-layer inconsistency the
 * old extractor + chat split had (model could emit
 * `scenario="restaurant"` AND `out_of_scope:` simultaneously, and chat
 * would decline). Keeping the helpers exported here lets `unified.ts`
 * reuse the same prompt + state coercion pipeline without duplicating
 * 600 lines of rules.
 *
 * Design invariants the helpers preserve:
 *   - Idempotent: same inputs → same output (enables replay testing)
 *   - Merge, don't replace: newer info augments prev_state, doesn't wipe it
 *   - Resolve relative dates at extraction time ("next weekend" → ISO date)
 *   - Only populate the single scenario sub-object that matches `scenario`
 *   - If a required slot wasn't mentioned, omit the field (don't emit "")
 */

import { resolveDateHint } from "../trip-intent-state";
import type { IntentState, NluIntent, NluScenario, PartyType, ProxyConstraints } from "./types";

// Re-exported for callers (matches v1's ChatMessage shape).
export interface Turn {
  role: "user" | "assistant";
  content: string;
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
  "proxy_member_constraints"?: { [member_name: string]: {
    "cuisines_dislike"?: string[], "cuisines_like"?: string[], "dietary"?: string[],
    "budget_max"?: number, "vibe"?: string, "notes"?: string
  } },

  // ONLY populate the sub-object matching the "scenario" value (omit the others)
  "restaurant"?: { restaurant_name?, city?, date?, time?, party_size?, cuisine?, budget_per_person?, neighborhood?, vibe?, dietary?, notes? },
  "hotel"?: { hotel_name?, city?, check_in?, check_out?, nights?, guests?, star_rating?, neighborhood?, budget_max_per_night?, amenities?, vibe?, notes? },
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

export function buildExtractorSystemPrompt(
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

CRITICAL — OUT-OF-SCOPE DETECTION (check this BEFORE applying rules 5-6 below):
   Onegent is a TRAVEL assistant: restaurants, hotels, flights, activities, trip planning.

   PRE-CHECK (do this FIRST): if the message mentions ANY travel keyword in any
   language — restaurant / 餐厅 / 餐馆 / 馆子 / hotel / 酒店 / 民宿 / flight /
   机票 / 航班 / trip / 旅行 / 行程 / 出行 / activity / 演唱会 / 活动 / city
   names / specific venues / "吃饭" / "订" / "find me" / "book" / "plan" / "去"
   followed by a place — the message is IN SCOPE. Do NOT flag out-of-scope.
   Casual phrasings like "今晚帮我找个 X 好吃的餐厅" or "帮我订..." or
   "去 X 玩两天" are ALWAYS in scope as long as a travel keyword is present.

   Only AFTER the pre-check confirms zero travel keywords, consider whether the
   message is clearly about a NON-TRAVEL topic — specifically one of these 6
   categories:
     • electronics      (laptops, smartphones, headphones, computers, gadgets, TVs)
     • shopping         (non-travel goods — clothing, appliances, general retail)
     • gifts            (gift ideas for a friend / parent / birthday / holiday)
     • fitness          (yoga classes, gym memberships, personal training, workouts)
     • credit cards     (card recommendations / rewards / applications outside a trip context)
     • personal advice  (dating, career, life coaching, general Q&A beyond greetings)
   For any out-of-scope message, emit ALL THREE of these together:
     intent            = "chitchat"
     scenario          = null
     planning_assumptions  append a string in the EXACT format:
                         "out_of_scope: <brief 1-4 word topic>"
                         e.g. "out_of_scope: electronics shopping",
                              "out_of_scope: gift ideas",
                              "out_of_scope: yoga class",
                              "out_of_scope: credit card advice".
   The literal "out_of_scope:" prefix is REQUIRED verbatim — downstream chat layer
   keys off it to produce the decline reply. Do NOT omit it, do NOT reword it, do
   NOT put it in a different field. All other IntentState fields should be left at
   their defaults (no scenario sub-object).

   MUTUAL EXCLUSION: out_of_scope and a non-null scenario are MUTUALLY EXCLUSIVE.
   If you decide scenario = "restaurant" / "hotel" / "flight" / "activity" / "trip",
   you MUST NOT add ANY "out_of_scope:" entry to planning_assumptions. The two
   states cannot coexist. If a previous turn emitted "out_of_scope:" and the
   current turn clarifies to a real booking, DROP the old tag — do not carry it
   forward in planning_assumptions.

5. Scenario selection:
   - "trip" when the user wants MULTIPLE categories bundled (flight + hotel at minimum, optionally restaurants / activities). Cues: "plan a trip to X", "go to X for N days", "帮我安排X旅行".
   - "restaurant" / "hotel" / "flight" / "activity" when the user wants a SINGLE category — even if multiple people are co-deciding. "我和李明想吃日料" is scenario="restaurant", NOT "trip". The presence of a co-decider does NOT change the scenario.
   - null ONLY when the category truly cannot be inferred (e.g. pure chitchat, pure greeting).

WORKED EXAMPLES — use these to calibrate before answering:

  A. 多方餐厅 (most common error source):
     Input: "我和李明想周五晚上吃日料"
     → scenario="restaurant", intent="create_room", party_type="multi", member_names=["李明"],
       restaurant={ date="<this Friday's date>", cuisine="Japanese" }
     WHY: 单一类别=restaurant; "我和李明想..."是显式co-decider信号→create_room; 日料=cuisine.

  B. 多方活动 (relationship label, not a name):
     Input: "和女朋友下周五看 Taylor Swift 演唱会，洛杉矶，前排"
     → scenario="activity", intent="create_room", party_type="multi", member_names=[],
       activity={ event_name="Taylor Swift", event_type="concert", city="Los Angeles",
                  event_date="<next Friday>", num_tickets=2, seat_type="premium" }
     WHY: "女朋友" is a relationship label, not a proper name → member_names stays [].

  C. 单人决策订2人位 (NOT create_room):
     Input: "Book a table for 2 on Friday"
     → scenario="restaurant", intent="create_plan", party_type="solo",
       restaurant={ date="<this Friday>", party_size=2 }
     WHY: "for 2" = traveler count only, no co-decider signal → create_plan.

  D. 多人旅行 (trip = multiple categories):
     Input: "我和爸妈国庆从上海飞东京，住5晚，顺便逛一下"
     → scenario="trip", intent="create_room", party_type="multi",
       trip={ destination_city="Tokyo", departure_city="Shanghai", nights=5, travelers=3, ... }
     WHY: flight + hotel + activities bundled together = trip scenario.

  E. 非旅行话题 (out-of-scope):
     Input: "help me buy a laptop for coding"
     → intent="chitchat", scenario=null, party_type="solo", member_names=[],
       planning_assumptions=["out_of_scope: electronics shopping"]
     WHY: electronics category → out-of-scope. Emit chitchat + null scenario +
          the "out_of_scope:" tag. No restaurant / hotel / flight / activity / trip
          sub-object.
     Same pattern for: "推荐 brooklyn 周六早上的瑜伽课" → "out_of_scope: yoga class";
                       "gift ideas for my mom birthday budget 150" → "out_of_scope: gift ideas".

  E2. CASUAL CHINESE RESTAURANT REQUEST (often misclassified — stay alert):
     Input: "今晚帮我找个 nashville 好吃的餐厅"
     → scenario="restaurant", intent="create_plan", party_type="solo",
       restaurant={ city="Nashville", date="<today>" }
     WHY: 餐厅=restaurant keyword + city name. The casual "帮我找个..."
          phrasing does NOT make it out-of-scope. Travel keyword wins.
     Same applies to:
       "帮我订个酒店"           → scenario="hotel"
       "我想去东京玩"           → scenario="trip"
       "推荐个洛杉矶的日料"     → scenario="restaurant" (cuisine + city)
       "今晚有啥好吃的"         → scenario="restaurant" (food intent, ask city)

  E3. RELATIONSHIP CO-DECIDER WORDS (party_type=multi without member_names):
     Input: "今晚帮我和朋友找个 nashville 好吃的餐厅"
     → scenario="restaurant", intent="create_plan", party_type="multi",
       member_names=[], restaurant={ city="Nashville", date="<today>" }
     WHY: "朋友" is a relationship word → party_type MUST be "multi" per
          rule 7 (broader signal than just named co-deciders). member_names
          stays [] because no proper name. The router uses this combo
          (multi + member_names=[] + intent=create_plan) to ask the user
          "solo or DR?" before proceeding.
     Same pattern for:
       "我和家人想吃日料"        → party_type="multi", member_names=[]
       "我和同事想找个酒店"      → party_type="multi", member_names=[]
       "me and my friend want dinner" → party_type="multi", member_names=[]
       "we want to fly to NYC"        → party_type="multi", member_names=[]
     Contrast with:
       "我和李明想吃日料"        → party_type="multi", member_names=["李明"],
                                  intent="create_room" (NAMED co-decider).

  F. 指定具体餐厅 (named-venue direct booking):
     Input: "Book Carbone in NYC tomorrow 7pm for 2"
     → scenario="restaurant", intent="create_plan", party_type="solo",
       restaurant={ restaurant_name="Carbone", city="New York", date="<tomorrow>", time="19:00", party_size=2 }
     WHY: User pointed at ONE specific venue ("Carbone") and used a booking verb
          ("Book"). Capture the proper noun in restaurant_name verbatim — do NOT
          translate / normalize / "expand" it. Skip cuisine because the venue
          implies it. Downstream router uses restaurant_name to skip the
          recommendation pass and go straight to a direct-booking confirm card.

  G. 指定具体餐厅 — 中文:
     Input: "给我订北京饭店明晚 7 点 2 人"
     → scenario="restaurant", intent="create_plan", party_type="solo",
       restaurant={ restaurant_name="北京饭店", date="<tomorrow>", time="19:00", party_size=2 }
     WHY: 显式店名 + 订位动词 → direct booking。restaurant_name 保持中文原文。
          city 未提则不填,router 会问。

  H. 指定具体酒店:
     Input: "Reserve The Pierre New York April 28 to 30 2 guests"
     → scenario="hotel", intent="create_plan", party_type="solo",
       hotel={ hotel_name="The Pierre", city="New York", check_in="2026-04-28",
               check_out="2026-04-30", guests=2 }
     WHY: Same pattern as F/G but for hotel. star_rating + neighborhood are
          implied by the named venue — leave them blank.

  CRITICAL — DO NOT populate restaurant_name / hotel_name speculatively:
     "Find me a romantic Italian place" → restaurant_name STAYS BLANK (the
     user is describing taste, not naming a venue). Only fill the slot when
     the user explicitly names ONE specific venue. False positives turn the
     direct-booking shortcut into a venue lottery.

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
7-PRE. NO-PREFERENCE / SKIP signal — when the user says they have no
   preference for a soft-required field ("any" / "都可以" / "随便" / "什么
   都行" / "no preference" / "up to you" / "都行" / "无所谓"), record the
   field as "any" (the literal string) so the router stops asking. This
   applies especially to:
     restaurant.cuisine     — "都可以", "any cuisine"           → cuisine="any"
     hotel.neighborhood     — "都可以", "anywhere"              → neighborhood="any"
     hotel.vibe             — "随便", "any vibe"                → vibe="any"
     restaurant.vibe        — "都可以"                          → vibe="any"
   Do NOT use "any" for required scalar fields like city/date/time —
   those need a real value, "any" doesn't make sense for them.

7. party_type (separate from intent — this describes whether OTHER PEOPLE
   are involved at all, named or not):
   - "multi" whenever ANY of these signals appear:
        · Named co-deciders ("我和李明", "me and Alice")
        · Plural pronouns referring to deciders ("we", "我们")
        · Relationship co-decider words ("朋友 / 家人 / 同事 / 老婆 / 老公 /
          friend / family / coworker / wife / husband / spouse / partner /
          team / 同学 / classmate / colleague")
     This is broader than create_room — "我和朋友" sets party_type=multi
     even though intent stays create_plan (no NAMED co-decider). The
     downstream router uses (party_type=multi, member_names=[]) as the
     "ambiguous — should ask solo-vs-DR" signal.
   - "solo" only when the user is clearly the only person involved
     ("book ME a flight", "找个 hotel 给我自己住"). A "for 2 people" trip
     stays solo unless the second person is mentioned.
8. Member_names: only non-creator people explicitly named as CO-DECIDERS
   (not "my wife" / "my family" — those are relationships not deciding members).
8a. proxy_member_constraints — when the user reports a taste/budget preference
    ON BEHALF OF a named member, capture it here keyed by that member's name:
      {
        "<member_name>": {
          "cuisines_dislike"?: string[],  // "李明 不吃生鱼片" → ["no raw fish"]
          "cuisines_like"?: string[],
          "dietary"?: string[],            // vegetarian / vegan / gluten-free / etc.
          "budget_max"?: number,           // "李明 每人预算 80" → 80
          "vibe"?: string,
          "notes"?: string                 // catch-all free-form ("李明 要靠窗")
        }
      }
    Rules:
      - Only populate for members ALSO listed in member_names.
      - Do NOT use this for group-wide hints. If the user says "we both want
        Japanese, budget $80 per person", store cuisine/budget at the scenario
        level (restaurant.cuisine / restaurant.budget_per_person) — NOT here.
      - Omit the field entirely when nothing is reported on a specific member's
        behalf. Do NOT emit "proxy_member_constraints": {} or empty objects.
9. For trip scenario, always include:
     activities: string[] (empty [] if none mentioned)
     cuisine_preferences: string[] (empty [] if none mentioned)
     vibe: default "mixed" if user didn't say
     planning_assumptions: string[]
10. Return ONLY the JSON object, no markdown fences, no prose.

${SCHEMA_REFERENCE}
`;
}

export interface UserPromptArgs {
  prevSummary: string;
  historyBlock: string;
  newUser: string;
  newAssistant: string;
}

export function buildExtractorUserPrompt({ prevSummary, historyBlock, newUser, newAssistant }: UserPromptArgs): string {
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

export function formatPrevState(s: IntentState): string {
  const copy: Partial<IntentState> = { ...s };
  // Strip meta to keep the prompt focused — extractor will regenerate these.
  delete (copy as { confidence?: number }).confidence;
  delete (copy as { turn_count?: number }).turn_count;
  delete (copy as { updated_at?: string }).updated_at;
  return JSON.stringify(copy, null, 2);
}

export function formatHistory(turns: Turn[]): string {
  if (turns.length === 0) return "";
  return turns
    .slice(-12) // last 12 turns is plenty for most conversations
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join("\n");
}

// ─── Coercion ───────────────────────────────────────────────────────────

/**
 * Defensive coercion: tolerate small shape drift from the model (wrong
 * enum casing, missing optional arrays, numeric-as-string). Anything too
 * corrupt is patched from `prev` so the state never regresses.
 */
export function coerceIntentState(raw: Record<string, unknown>, prev: IntentState | null): IntentState {
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

  const rawPlanningAssumptions = Array.isArray(raw.planning_assumptions)
    ? raw.planning_assumptions.filter((x): x is string => typeof x === "string")
    : prev?.planning_assumptions ?? [];
  // Self-consistency: if scenario is set, the message is in-scope by definition.
  // Strip any stray "out_of_scope:" tags the model emitted alongside a scenario
  // (and any inherited from a prev OOS turn that was clarified to a real
  // booking scenario in the next turn). The chat layer keys off out_of_scope:
  // to decline, so leaving stale tags here causes the user to be told "I only
  // do travel" right after they typed a perfectly good restaurant request.
  const planning_assumptions = scenario
    ? rawPlanningAssumptions.filter((a) => !a.trim().toLowerCase().startsWith("out_of_scope:"))
    : rawPlanningAssumptions;

  const proxy_member_constraints = coerceProxyMemberConstraints(
    raw.proxy_member_constraints,
    prev?.proxy_member_constraints,
    member_names,
  );

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
    ...(proxy_member_constraints ? { proxy_member_constraints } : {}),
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

/**
 * Coerce the raw `proxy_member_constraints` object from the extractor into
 * a validated Record<string, ProxyConstraints>. Merges with previous state
 * per-member (so turn 1's "李明 不吃生鱼片" survives turn 2's "张华吃素"
 * — different keys add, same-person fields deep-merge with new values winning).
 * Drops entries for members NOT in member_names (the prompt explicitly forbids
 * this but LLMs drift — belt-and-suspenders).
 */
function coerceProxyMemberConstraints(
  raw: unknown,
  prev: IntentState["proxy_member_constraints"] | undefined,
  memberNames: string[],
): IntentState["proxy_member_constraints"] | undefined {
  const fromRaw = parseProxyRecord(raw);
  const merged: Record<string, ProxyConstraints> = { ...(prev ?? {}) };
  for (const [name, next] of Object.entries(fromRaw)) {
    const existing = merged[name] ?? {};
    merged[name] = {
      ...existing,
      ...next,
      // Array fields: concat + dedupe so "李明 不吃生鱼片" (turn 1) + "李明 also no shrimp" (turn 2) doesn't lose turn 1.
      ...(mergeArray(existing.cuisines_dislike, next.cuisines_dislike) && {
        cuisines_dislike: mergeArray(existing.cuisines_dislike, next.cuisines_dislike),
      }),
      ...(mergeArray(existing.cuisines_like, next.cuisines_like) && {
        cuisines_like: mergeArray(existing.cuisines_like, next.cuisines_like),
      }),
      ...(mergeArray(existing.dietary, next.dietary) && {
        dietary: mergeArray(existing.dietary, next.dietary),
      }),
    };
  }
  // Drop any entries whose names dropped out of member_names (model hallucinated).
  const allowed = new Set(memberNames);
  for (const name of Object.keys(merged)) {
    if (!allowed.has(name)) delete merged[name];
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function parseProxyRecord(raw: unknown): Record<string, ProxyConstraints> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, ProxyConstraints> = {};
  for (const [name, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!name.trim() || !val || typeof val !== "object" || Array.isArray(val)) continue;
    const v = val as Record<string, unknown>;
    const entry: ProxyConstraints = {};
    const cd = strArrayOrUndef(v.cuisines_dislike);
    if (cd) entry.cuisines_dislike = cd;
    const cl = strArrayOrUndef(v.cuisines_like);
    if (cl) entry.cuisines_like = cl;
    const d = strArrayOrUndef(v.dietary);
    if (d) entry.dietary = d;
    const b = numOrUndef(v.budget_max);
    if (b) entry.budget_max = b;
    const vi = strOrUndef(v.vibe);
    if (vi) entry.vibe = vi;
    const n = strOrUndef(v.notes);
    if (n) entry.notes = n;
    if (Object.keys(entry).length > 0) out[name.trim()] = entry;
  }
  return out;
}

function mergeArray(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (!a && !b) return undefined;
  const combined = [...(a ?? []), ...(b ?? [])];
  const deduped = Array.from(new Set(combined));
  return deduped.length > 0 ? deduped : undefined;
}

function coerceRestaurant(
  raw: unknown,
  prev: IntentState["restaurant"] | undefined,
): IntentState["restaurant"] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    restaurant_name: strOrUndef(r.restaurant_name) ?? prev?.restaurant_name,
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
    hotel_name: strOrUndef(h.hotel_name) ?? prev?.hotel_name,
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

export function mergePrevIntoNew(prev: IntentState | null, next: IntentState): IntentState {
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

/**
 * For create_room restaurant with named co-deciders, inject party_size =
 * member_names.length + 1 (members + creator) when the user didn't state it.
 * "我和李明想吃日料" → party_size=2 without asking a follow-up question.
 * Only applies when party_size is genuinely missing — never overwrites an
 * explicit value the user gave.
 */
export function fillCreateRoomPartySize(state: IntentState): IntentState {
  // Restaurant: party_size = members + creator.
  if (
    state.intent === "create_room" &&
    state.scenario === "restaurant" &&
    state.restaurant &&
    typeof state.restaurant.party_size !== "number" &&
    state.member_names.length > 0
  ) {
    const inferred = state.member_names.length + 1;
    return {
      ...state,
      restaurant: { ...state.restaurant, party_size: inferred },
      planning_assumptions: [
        ...state.planning_assumptions,
        `Inferred party_size=${inferred} from ${state.member_names.length} named member(s) + creator`,
      ],
    };
  }
  // Trip: travelers = members + creator. Applies whether or not intent was
  // already upgraded to create_room — fires on party_type=multi alone so
  // "我和 ziwei Guo 去纽约" doesn't get asked "how many travelers?" when the
  // count is literally right there in the first sentence.
  if (
    state.scenario === "trip" &&
    state.trip &&
    typeof state.trip.travelers !== "number" &&
    state.member_names.length > 0
  ) {
    const inferred = state.member_names.length + 1;
    return {
      ...state,
      trip: { ...state.trip, travelers: inferred },
      planning_assumptions: [
        ...state.planning_assumptions,
        `Inferred travelers=${inferred} from ${state.member_names.length} named member(s) + creator`,
      ],
    };
  }
  return state;
}

/**
 * Safety-net upgrade: extractor prompt rule #6 says named co-deciders ALWAYS
 * trigger create_room, but gpt-4o-mini occasionally keeps intent=create_plan
 * when the name is ambiguous (English usernames like "ziweiB", abbreviations,
 * etc.) while still correctly extracting member_names and party_type=multi.
 * We flip it here: if the model already agreed this is a multi-party party
 * (member_names non-empty AND party_type=multi), the intent must be
 * create_room (or refine_existing / chitchat, which we don't touch).
 *
 * Narrower condition than "member_names.length > 0 alone" so we don't disturb
 * the cases where the prompt deliberately kept create_plan (e.g. user says
 * "book for me and my wife" — "老婆" is relationship, not name; member_names
 * stays empty; this function no-ops).
 */
export function upgradeMultiPartyToRoom(state: IntentState): IntentState {
  if (state.intent !== "create_plan") return state;
  if (state.party_type !== "multi") return state;
  if (state.member_names.length === 0) return state;
  return {
    ...state,
    intent: "create_room",
    planning_assumptions: [
      ...state.planning_assumptions,
      `Upgraded intent → create_room because ${state.member_names.length} named co-decider(s) present`,
    ],
  };
}

/**
 * Safety-net downgrade: `refine_existing` should only fire when the user is
 * adjusting a PREVIOUSLY returned plan. If this is the first turn of a fresh
 * session (or no refined_target_id is set AND no meaningful prior history
 * exists), the model misread the request — downgrade back to create_plan /
 * create_room so the router can advance to a ConfirmCard.
 *
 * Seen on trip requests with comma-separated preference lists ("想看百老汇,
 * 自由女神, 住希尔顿") — model interpreted the list as refinements and
 * tagged refine_existing even though nothing is there to refine.
 *
 * Downgrade target chosen by member_names: named co-deciders → create_room,
 * otherwise create_plan. Same rule upgradeMultiPartyToRoom uses.
 */
export function downgradeSpuriousRefine(state: IntentState, history: Turn[]): IntentState {
  if (state.intent !== "refine_existing") return state;
  // Keep refine_existing when the extractor found a target id OR when there
  // was a real multi-turn conversation before this one. Threshold kept loose
  // (≥3 history turns) to avoid catching one-off "hmm, actually cheaper"
  // edits — those legitimately refine whatever just got shown.
  if (state.refined_target_id) return state;
  if (history.length >= 3) return state;
  const target: NluIntent = state.member_names.length > 0 ? "create_room" : "create_plan";
  return {
    ...state,
    intent: target,
    planning_assumptions: [
      ...state.planning_assumptions,
      `Downgraded intent refine_existing → ${target} (no target id + fresh session)`,
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
