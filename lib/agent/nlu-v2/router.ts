/**
 * NLU v2 — Layer 3 code router.
 *
 * Pure TypeScript (no LLM, no async, no fetch). Given an IntentState
 * produced by the extractor, returns a RouterAction that tells the
 * frontend what UI behavior to execute.
 *
 * This is the LOAD-BEARING decision boundary between "what the model
 * understood" and "what happens in the product." We deliberately keep
 * LLMs out of this function so:
 *   - Decisions are 100% deterministic (no flaky reruns)
 *   - Unit tests cover every branch (no prompt tuning)
 *   - Product invariants (e.g. "payment needs confirm") hold regardless
 *     of how creative the model gets upstream
 */

import type {
  IntentState,
  RouterAction,
  NluScenario,
  QuickPick,
} from "./types";
import { getMissingFields as getMissingTripFields } from "../trip-intent-state";

// Quick-pick options for the categories=[] question. The user taps one of
// the 4 specific products OR taps "完整 plan" for a 4-category trip.
const CATEGORIES_QUICK_PICKS: QuickPick[] = [
  { label: "餐厅", value: "我想订个餐厅" },
  { label: "酒店", value: "我想订个酒店" },
  { label: "机票", value: "我想订个机票" },
  { label: "活动", value: "我想买个演出/活动票" },
  { label: "完整 plan", value: "给我一个完整的 plan：酒店、机票、餐厅、活动一起" },
];

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Decide what to do next given the current conversation state.
 */
export function routeIntent(state: IntentState): RouterAction {
  // Chitchat / unknown → just keep chatting. Layer 1 already generated a
  // conversational reply; no structured action to take.
  if (state.intent === "chitchat" || state.intent === "unknown") {
    return { type: "continue_chat" };
  }

  // refine_existing is Phase 2+ territory — the v1 path stubbed it to
  // return 400. We mirror that here: treat as chitchat until the refine
  // pipeline is built.
  if (state.intent === "refine_existing") {
    return { type: "continue_chat" };
  }

  // No category yet — user mentioned travel intent (destination/dates) but
  // didn't name a product. Ask "想订什么？" + offer "完整 plan" as one tap.
  // This is the conservative path: we don't auto-fill all 4 categories on
  // the user's behalf because it wastes pipeline budget on what they
  // didn't ask for.
  if (state.categories.length === 0) {
    return {
      type: "ask_clarification",
      missing: ["categories"],
      suggested_quick_picks: CATEGORIES_QUICK_PICKS,
    };
  }
  // After the categories pick, scenario is derived as categories[0]. If
  // the model somehow left it null while categories is non-empty (race
  // condition between state passes), still ask for clarification.
  if (!state.scenario) {
    return {
      type: "ask_clarification",
      missing: ["categories"],
      suggested_quick_picks: CATEGORIES_QUICK_PICKS,
    };
  }

  // Ambiguous party mode: user signaled multi-person with relationship words
  // ("我和朋友 / 我和家人 / me and my friend / we") but didn't name a specific
  // co-decider. Two ways to interpret:
  //   (a) "I'm booking, party_size=2 — friend just comes along" (create_plan)
  //   (b) "I want my friend to weigh in too" (create_room → Decision Room)
  // Defaulting to (a) loses the multi-person product loop; defaulting to (b)
  // creates a DR for casual "dinner with my friend" that the user didn't
  // want. So we ASK before either path commits. Quick picks so it's a tap.
  //
  // Count members the LLM actually named — empty / whitespace-only entries
  // don't count. Without this filter, an extractor glitch that emits
  // member_names=[""] would let create_room slip through as if a real
  // co-decider were present, and we'd create a Decision Room with no
  // actual member to invite. (Surfaced by golden-probing MN1-MN3.)
  const namedMemberCount = realMemberCount(state.member_names);

  // Detection signal: extractor sets party_type=multi when relationship
  // co-decider words appear, but member_names stays empty because no proper
  // name was given. That combo is the unambiguous "we don't know which
  // bucket this belongs to" case.
  if (
    state.party_type === "multi" &&
    namedMemberCount === 0 &&
    state.intent === "create_plan"
  ) {
    return {
      type: "ask_clarification",
      missing: ["party_mode"],
      suggested_quick_picks: [
        { label: "我自己定就行", value: "我自己定，按 2 人位预订" },
        { label: "拉 ta 进 Decision Room", value: "想拉朋友进 Decision Room 决定" },
      ],
    };
  }

  // create_room without a named co-decider: agent doesn't know who to invite.
  // Ask for a contact name UNLESS the seed has an explicit numeric multi
  // signal (party_size/guests/passengers/num_tickets/travelers ≥ 2). When
  // the user said "我和老婆 2 人" the relationship word IS the implicit
  // co-decider — they'll add the actual contact at room-creation time.
  // Without an explicit count, "拉 ta 进 DR" with no name is genuinely
  // ambiguous and asking is the right move.
  if (state.intent === "create_room" && namedMemberCount === 0) {
    const hasNumericMultiSignal =
      (state.restaurant?.party_size ?? 1) >= 2 ||
      (state.hotel?.guests ?? 1) >= 2 ||
      (state.flight?.passengers ?? 1) >= 2 ||
      (state.activity?.num_tickets ?? 1) >= 2 ||
      (state.trip?.travelers ?? 1) >= 2;
    if (!hasNumericMultiSignal) {
      return {
        type: "ask_clarification",
        missing: ["member_names"],
      };
    }
  }

  // ─── 4-quadrant dispatch (party_type × categories.length) ─────────────
  //
  //                        N=1 category               N>=2 categories
  //   ──────────────────────────────────────────────────────────────────
  //   solo  (create_plan)  kind="plan"               kind="composite_plan"
  //                        single-card list flow     vertical-stack flow
  //   multi (create_room)  kind="room" (1 column)    kind="room" (N columns,
  //                                                  or kind="trip" when N=4
  //                                                  for legacy compat)
  //
  // Decision Rooms (multi) skip the per-category missing-fields gate —
  // initiator's seed is enough to create; details gather inside the room
  // as each member chats. Solo flows still need their fields before
  // confirm because they fire pipelines immediately.

  // Anything that reached here with intent=create_room is a multi-DR.
  // (The empty-member_names case was either filtered above by the
  // ask-for-name gate, or admitted because the seed has a numeric multi
  // signal like passengers=3 / travelers=4.)
  const isMultiDR = state.intent === "create_room";

  if (isMultiDR) {
    // Trip-style 4-category DR: legacy "trip" kind kept so the existing
    // TripPackageCard / TripProposalChatCard renderers don't need to
    // change for this case. Phase 2 collapses this into kind="room".
    if (state.scenario === "trip" && state.categories.length === 4) {
      // Trip DR still gates on the full trip seed because synthesis
      // happens up-front before members get their first reply.
      const missing = getMissingForScenario(state);
      if (missing.length > 0) {
        return {
          type: "ask_clarification",
          missing,
          suggested_quick_picks: getDefaultQuickPicksFor(state.scenario, missing),
        };
      }
      return { type: "show_confirm_card", kind: "trip", state };
    }
    // Single-category or partial-composite DR: confirm immediately, fill
    // category-specific fields inside the room.
    return { type: "show_confirm_card", kind: "room", state };
  }

  // Solo paths from here down.
  // Legacy solo trip planner (scenario=="trip", all 4 cats) — kept on the
  // existing kind="trip" path so the Stage 1 buildTripPackage flow doesn't
  // regress. Phase 2 collapses this into composite_plan once that handler
  // can substitute for the trip planner.
  if (state.scenario === "trip") {
    const missing = getMissingForScenario(state);
    if (missing.length > 0) {
      return {
        type: "ask_clarification",
        missing,
        suggested_quick_picks: getDefaultQuickPicksFor(state.scenario, missing),
      };
    }
    return { type: "show_confirm_card", kind: "trip", state };
  }

  // Solo + 2+ categories (partial composite — e.g. restaurant+activity) →
  // composite plan (multi-column horizontal). Gate on FIRST category's
  // required fields; the others share the same city/date seed.
  if (state.categories.length >= 2) {
    const missing = getMissingForScenario(state);
    if (missing.length > 0) {
      return {
        type: "ask_clarification",
        missing,
        suggested_quick_picks: getDefaultQuickPicksFor(state.scenario, missing),
      };
    }
    return { type: "show_confirm_card", kind: "composite_plan", state };
  }

  // Solo + 1 category → existing per-scenario plan path.
  const missing = getMissingForScenario(state);
  if (missing.length > 0) {
    return {
      type: "ask_clarification",
      missing,
      suggested_quick_picks: getDefaultQuickPicksFor(state.scenario, missing),
    };
  }

  // Direct-booking shortcut: user named one specific venue (solo only —
  // Decision Rooms keep voting flow even when initiator names a venue).
  const directBooking =
    (state.scenario === "restaurant" && truthy(state.restaurant?.restaurant_name)) ||
    (state.scenario === "hotel" && truthy(state.hotel?.hotel_name));

  return {
    type: "show_confirm_card",
    kind: "plan",
    state,
    ...(directBooking ? { directBooking: true } : {}),
  };
}

/**
 * List the REQUIRED fields that are still missing for the current scenario.
 * Returns [] when the state is ready to advance.
 *
 * Kept aligned with the existing planner pre-conditions so downstream
 * code doesn't need a second definition of "what must be filled."
 */
export function getMissingForScenario(state: IntentState): string[] {
  switch (state.scenario) {
    case "restaurant":
      return missingRestaurant(state);
    case "hotel":
      return missingHotel(state);
    case "flight":
      return missingFlight(state);
    case "activity":
      return missingActivity(state);
    case "trip":
      return missingTrip(state);
    default:
      return ["scenario"];
  }
}

/**
 * Human-readable summary of the current state for the Layer 1 chat prompt.
 * Gives the chat model enough context to reply naturally ("Got it, NY for
 * 3 nights — where are you flying from?") without needing to re-parse
 * the whole conversation history itself.
 */
export function buildStateSummary(state: IntentState): string {
  const assumptions = (state.planning_assumptions ?? []).filter(
    (a): a is string => typeof a === "string" && a.trim().length > 0,
  );
  const assumptionsSuffix = assumptions.length > 0
    ? ` Planning assumptions: ${assumptions.join("; ")}.`
    : "";

  if (!state.scenario) {
    const base = state.intent === "chitchat"
      ? "User is chatting casually — no booking intent yet."
      : "User wants to book something but the category isn't clear yet.";
    return base + assumptionsSuffix;
  }

  const parts: string[] = [];
  const label = scenarioLabel(state.scenario);
  // Filter blank / whitespace-only names so the summary doesn't render
  // "with ," for a malformed extractor output. Mirrors the routeIntent
  // gate above — see realMemberCount().
  const namedMembers = (state.member_names ?? []).filter(
    (n): n is string => typeof n === "string" && n.trim().length > 0,
  );
  parts.push(`User wants a ${label} booking (${state.party_type}${namedMembers.length ? ` with ${namedMembers.join(", ")}` : ""})`);

  switch (state.scenario) {
    case "restaurant":
      if (state.restaurant) parts.push(...summarizeRestaurant(state.restaurant));
      break;
    case "hotel":
      if (state.hotel) parts.push(...summarizeHotel(state.hotel));
      break;
    case "flight":
      if (state.flight) parts.push(...summarizeFlight(state.flight));
      break;
    case "activity":
      if (state.activity) parts.push(...summarizeActivity(state.activity));
      break;
    case "trip":
      if (state.trip) parts.push(...summarizeTrip(state.trip));
      break;
  }

  const missing = getMissingForScenario(state);
  if (missing.length > 0) {
    parts.push(`Still needs: ${missing.join(", ")}.`);
  } else {
    parts.push("All required info collected — ready to confirm.");
  }
  return parts.join(" ") + assumptionsSuffix;
}

// ─── Per-scenario missing-field checks ────────────────────────────────────

function missingRestaurant(state: IntentState): string[] {
  const r = state.restaurant ?? {};
  const missing: string[] = [];
  if (!truthy(r.city)) missing.push("city");
  // cuisine is soft-required: not strictly needed (the agent can still
  // recommend mixed cuisines), but asking surfaces a quick-pick row of
  // common cuisines so the user taps instead of types. The first quick
  // pick option is "都可以" which sets cuisine="any" to skip.
  // Skipped when the user named a specific venue — cuisine is moot for
  // direct booking (Carbone is Italian whether you specified or not).
  if (!truthy(r.cuisine) && !truthy(r.restaurant_name)) missing.push("cuisine");
  if (!truthy(r.date)) missing.push("date");
  if (!truthy(r.time)) missing.push("time");
  if (!(typeof r.party_size === "number" && r.party_size > 0)) missing.push("party_size");
  return missing;
}

function missingHotel(state: IntentState): string[] {
  const h = state.hotel ?? {};
  const missing: string[] = [];
  if (!truthy(h.city)) missing.push("city");
  if (!truthy(h.check_in)) missing.push("check_in");
  // check_out is satisfied either by an explicit date OR by a night count.
  if (!truthy(h.check_out) && !(typeof h.nights === "number" && h.nights > 0)) {
    missing.push("check_out");
  }
  return missing;
}

function missingFlight(state: IntentState): string[] {
  const f = state.flight ?? {};
  const missing: string[] = [];
  if (!truthy(f.origin)) missing.push("origin");
  if (!truthy(f.dest)) missing.push("dest");
  if (!truthy(f.date)) missing.push("departure_date");
  return missing;
}

function missingActivity(state: IntentState): string[] {
  const a = state.activity ?? {};
  const missing: string[] = [];
  if (!truthy(a.event_name)) missing.push("event_name");
  if (!truthy(a.city)) missing.push("city");
  if (!truthy(a.event_date)) missing.push("event_date");
  return missing;
}

function missingTrip(state: IntentState): string[] {
  if (!state.trip) {
    return ["destination_city", "date_range", "departure_city", "traveler_count"];
  }
  // Reuse Phase-1 logic — single source of truth for trip required fields.
  return getMissingTripFields(state.trip);
}

// ─── Default quick picks for clarification ────────────────────────────────
// Surface a small, closed-set choice when the missing field has one
// (e.g. party_size 2/3/4+, cabin class). Free-text slots (city, date,
// event_name) get no quick picks — just the natural-language ask.

function getDefaultQuickPicksFor(
  scenario: NluScenario | null,
  missing: string[],
): QuickPick[] | undefined {
  const m = missing[0];
  if (!m) return undefined;

  if (m === "party_size" || m === "traveler_count" || m === "guests" || m === "passengers") {
    return [
      { label: "2 人", value: "2" },
      { label: "3 人", value: "3" },
      { label: "4 人", value: "4" },
      { label: "5+ 人", value: "5" },
    ];
  }
  // Restaurant cuisine picks — common cuisines + a "skip" option so the
  // user can bypass the question if they don't have a preference.
  if (scenario === "restaurant" && m === "cuisine") {
    return [
      { label: "都可以", value: "any" },
      { label: "日料", value: "Japanese" },
      { label: "意大利菜", value: "Italian" },
      { label: "中餐", value: "Chinese" },
      { label: "泰餐", value: "Thai" },
      { label: "墨西哥菜", value: "Mexican" },
    ];
  }
  // Restaurant time picks — dinner-window defaults. Common-case prefill:
  // user says "tonight / 今晚" → date filled, time blank → these surface
  // so they don't have to type "7pm".
  if (scenario === "restaurant" && m === "time") {
    return [
      { label: "6:00 pm", value: "18:00" },
      { label: "7:00 pm", value: "19:00" },
      { label: "8:00 pm", value: "20:00" },
      { label: "9:00 pm", value: "21:00" },
    ];
  }
  // Restaurant date — when user said "餐厅" without a date cue.
  if (scenario === "restaurant" && m === "date") {
    return [
      { label: "今晚", value: "tonight" },
      { label: "明晚", value: "tomorrow" },
      { label: "本周末", value: "this weekend" },
    ];
  }
  if (scenario === "flight" && m === "cabin_class") {
    return [
      { label: "经济舱", value: "economy" },
      { label: "豪华经济", value: "premium_economy" },
      { label: "商务舱", value: "business" },
      { label: "头等舱", value: "first" },
    ];
  }
  if (scenario === "hotel" && m === "star_rating") {
    return [
      { label: "3 星", value: "3" },
      { label: "4 星", value: "4" },
      { label: "5 星", value: "5" },
    ];
  }
  return undefined;
}

// ─── Scenario summary helpers (for buildStateSummary) ─────────────────────

const scenarioLabel = (s: NluScenario): string => {
  switch (s) {
    case "restaurant": return "restaurant";
    case "hotel": return "hotel";
    case "flight": return "flight";
    case "activity": return "event/activity ticket";
    case "trip": return "multi-category trip";
  }
};

function summarizeRestaurant(r: NonNullable<IntentState["restaurant"]>): string[] {
  const parts: string[] = [];
  if (r.restaurant_name) parts.push(`at "${r.restaurant_name}"`);
  if (r.city) parts.push(`in ${r.city}`);
  if (r.date) parts.push(`on ${r.date}`);
  if (r.time) parts.push(`at ${r.time}`);
  if (r.party_size) parts.push(`for ${r.party_size}`);
  if (r.cuisine && !r.restaurant_name) parts.push(`cuisine: ${r.cuisine}`);
  if (r.budget_per_person) parts.push(`budget $${r.budget_per_person}/person`);
  return parts;
}

function summarizeHotel(h: NonNullable<IntentState["hotel"]>): string[] {
  const parts: string[] = [];
  if (h.hotel_name) parts.push(`at "${h.hotel_name}"`);
  if (h.city) parts.push(`in ${h.city}`);
  if (h.check_in) parts.push(`check in ${h.check_in}`);
  if (h.check_out) parts.push(`check out ${h.check_out}`);
  else if (h.nights) parts.push(`${h.nights} night${h.nights === 1 ? "" : "s"}`);
  if (h.guests) parts.push(`${h.guests} guest${h.guests === 1 ? "" : "s"}`);
  if (h.star_rating && !h.hotel_name) parts.push(`${h.star_rating}-star`);
  if (h.neighborhood && !h.hotel_name) parts.push(`${h.neighborhood} area`);
  return parts;
}

function summarizeFlight(f: NonNullable<IntentState["flight"]>): string[] {
  const parts: string[] = [];
  if (f.origin && f.dest) parts.push(`${f.origin}→${f.dest}`);
  else if (f.origin) parts.push(`from ${f.origin}`);
  else if (f.dest) parts.push(`to ${f.dest}`);
  if (f.date) parts.push(`departing ${f.date}`);
  if (f.return_date) parts.push(`returning ${f.return_date}`);
  if (f.passengers) parts.push(`${f.passengers} pax`);
  if (f.cabin_class) parts.push(f.cabin_class);
  return parts;
}

function summarizeActivity(a: NonNullable<IntentState["activity"]>): string[] {
  const parts: string[] = [];
  if (a.event_name) parts.push(`"${a.event_name}"`);
  else if (a.event_type) parts.push(a.event_type);
  if (a.city) parts.push(`in ${a.city}`);
  if (a.event_date) parts.push(`on ${a.event_date}`);
  if (a.num_tickets) parts.push(`${a.num_tickets} ticket${a.num_tickets === 1 ? "" : "s"}`);
  if (a.seat_type) parts.push(`${a.seat_type} seats`);
  return parts;
}

function summarizeTrip(t: NonNullable<IntentState["trip"]>): string[] {
  const parts: string[] = [];
  if (t.destination_city) parts.push(`to ${t.destination_city}`);
  if (t.departure_city) parts.push(`from ${t.departure_city}`);
  if (t.start_date) parts.push(`starting ${t.start_date}`);
  if (t.nights) parts.push(`${t.nights} night${t.nights === 1 ? "" : "s"}`);
  if (t.travelers) parts.push(`${t.travelers} traveler${t.travelers === 1 ? "" : "s"}`);
  if (t.activities.length > 0) parts.push(`activities: ${t.activities.slice(0, 3).join(", ")}`);
  return parts;
}

// ─── Utilities ────────────────────────────────────────────────────────────

function truthy(v: string | undefined | null): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Count member names the LLM actually emitted as non-blank strings.
 * Defensive against extractor glitches that produce [""] or ["  "] —
 * those entries shouldn't pass any "do we have a real co-decider?" gate.
 *
 * Used by routeIntent to short-circuit DR creation when the seed only
 * has whitespace, and mirrored in buildStateSummary's "with X" suffix
 * so the chat prompt doesn't render "(multi with )".
 */
function realMemberCount(names: unknown): number {
  if (!Array.isArray(names)) return 0;
  let count = 0;
  for (const n of names) {
    if (typeof n === "string" && n.trim().length > 0) count++;
  }
  return count;
}
