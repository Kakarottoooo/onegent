/**
 * NLU v2 — core types (Plan C architecture).
 *
 * Replaces the 817-line single-pass `ConversationalNLUResult` with a
 * layered model:
 *
 *   Layer 1 (chat)       → produces assistant_reply text only
 *   Layer 2 (extractor)  → produces IntentState (this module)
 *   Layer 3 (router)     → consumes IntentState → produces RouterAction
 *
 * This file is the shared contract between all three layers, plus the API
 * route that hands the action off to the frontend. Keep it type-only —
 * no runtime logic here (router lives in router.ts).
 *
 * See NLU_REFACTOR_PLAN_C.md for the full migration plan.
 */

import type { TripIntentState } from "../trip-intent-state";

// ─── Primitives ───────────────────────────────────────────────────────────

export type NluIntent =
  | "chitchat"           // small talk / greetings / thanks — no action needed
  | "create_plan"        // solo user wants a recommendation or booking
  | "create_room"        // multi-party — create a Decision Room
  | "refine_existing"    // adjust a previously returned plan/proposal
  | "unknown";           // couldn't classify — treat as chitchat + ask

export type NluScenario =
  | "restaurant"
  | "hotel"
  | "flight"
  | "activity"
  | "trip";

export type PartyType = "solo" | "multi";

/** Kept shape-compatible with v1's QuickPick for backward compat. */
export interface QuickPick {
  label: string;
  value: string;
}

/**
 * Per-member preference hints the user reported on behalf of a named
 * co-decider. Example: "李明 doesn't eat raw fish, budget $80" →
 * proxy_member_constraints: { "李明": { dietary: ["no raw fish"], budget_max: 80 } }
 *
 * The commit route reads this (via its existing sanitizeProxyMemberConstraints)
 * to pre-seed the named member's row when they join the Decision Room.
 * Kept shape-compatible with v1 — field name must stay as-is.
 */
export interface ProxyConstraints {
  cuisines_dislike?: string[];
  cuisines_like?: string[];
  dietary?: string[];
  budget_max?: number;
  vibe?: string;
  notes?: string;
}

// ─── Scenario-specific sub-states ─────────────────────────────────────────
// Each scenario's fields live in an optional object on IntentState. Only
// one of {restaurant, hotel, flight, activity, trip} should be populated
// at a time — matching `state.scenario`. Flat optional fields (vs. a
// discriminated union) make the JSON easier for the LLM extractor to
// produce and for the router to test.

export interface RestaurantFields {
  /**
   * Specific venue name when the user named one (e.g. "Carbone", "Le Bernardin",
   * "北京饭店"). Set ONLY when the user pointed at one specific restaurant —
   * never inferred or "best-guessed" from cuisine + city. The router treats
   * a populated restaurant_name as a signal to skip the LLM recommendation
   * pass and go straight to a direct-booking confirm card.
   */
  restaurant_name?: string;
  city?: string;
  date?: string;         // ISO YYYY-MM-DD (resolved by extractor, not raw "Friday")
  time?: string;         // HH:MM 24h
  party_size?: number;
  cuisine?: string;
  budget_per_person?: number;
  neighborhood?: string;
  vibe?: string;
  dietary?: string[];
  notes?: string;
}

export interface HotelFields {
  /**
   * Specific hotel name when the user named one (e.g. "The Pierre",
   * "Park Hyatt NYC"). Same direct-booking semantics as
   * RestaurantFields.restaurant_name — populated only when the user
   * pointed at one specific property, never inferred.
   */
  hotel_name?: string;
  city?: string;
  check_in?: string;      // ISO YYYY-MM-DD
  check_out?: string;     // ISO YYYY-MM-DD
  nights?: number;
  guests?: number;
  star_rating?: number;
  neighborhood?: string;
  budget_max_per_night?: number;
  amenities?: string[];
  vibe?: string;
  notes?: string;
}

export interface FlightFields {
  origin?: string;         // City name or IATA code
  dest?: string;
  date?: string;           // ISO YYYY-MM-DD (outbound)
  return_date?: string;
  is_round_trip?: boolean;
  passengers?: number;
  cabin_class?: "economy" | "premium_economy" | "business" | "first";
  max_stops?: 0 | 1 | 2 | null;
  preferred_airlines?: string[];
  avoid_red_eye?: boolean;
  earliest_departure?: string;
  latest_departure?: string;
  notes?: string;
}

export interface ActivityFields {
  event_name?: string;        // e.g. "Hamilton", "Taylor Swift", "Knicks"
  event_type?: "concert" | "theater" | "sports" | "exhibition" | "comedy" | "festival" | "other";
  city?: string;
  event_date?: string;        // ISO YYYY-MM-DD
  event_date_to?: string;     // For date-range searches
  num_tickets?: number;
  seat_type?: "premium" | "standard" | "economy";
  budget_max_per_ticket?: number;
  section_preferences?: string[];
  avoid_sections?: string[];
  wheelchair_required?: boolean;
  notes?: string;
}

// ─── Core state ───────────────────────────────────────────────────────────

export interface IntentState {
  // Meta — extractor self-assessment + bookkeeping
  /** 0-1, extractor's confidence the classification is correct. */
  confidence: number;
  /** How many conversation turns have been folded into this state. */
  turn_count: number;
  /** ISO timestamp of last extractor update. */
  updated_at: string;

  // Classification
  intent: NluIntent;
  scenario: NluScenario | null;
  party_type: PartyType;
  /** Names of non-creator members mentioned in conversation. */
  member_names: string[];

  // Scenario-specific sub-states (only one should be set at a time,
  // matching `scenario`). Trip reuses the Phase-1 TripIntentState so
  // downstream planner/commit can consume it unchanged.
  restaurant?: RestaurantFields;
  hotel?: HotelFields;
  flight?: FlightFields;
  activity?: ActivityFields;
  trip?: TripIntentState;

  // Refinement — when intent === "refine_existing", points at the plan
  // being edited. Null for fresh conversations.
  refined_target_id: string | null;

  // Per-member preference hints keyed by member display name. Populated when
  // the user speaks on behalf of a named co-decider ("李明 doesn't eat
  // seafood"). Consumed downstream to seed that member's Decision Room row.
  proxy_member_constraints?: Record<string, ProxyConstraints>;

  // Human-readable caveats the LLM inferred (e.g. "user didn't specify
  // time — assuming dinner"). Surfaced back in the UI.
  planning_assumptions: string[];
}

// ─── Router action ────────────────────────────────────────────────────────
// Layer 3 (router) consumes IntentState and decides one of four
// high-level UI behaviors. The frontend already has handlers for each
// of these (continue chat bubble / clarification + quick picks /
// confirm card). Keeping these four forms means we don't have to
// touch the frontend during migration.

export type RouterAction =
  /** Show the assistant reply as a regular chat bubble and wait for more input. */
  | { type: "continue_chat" }
  /**
   * One or more REQUIRED fields still missing. Show the assistant reply
   * (which should be asking for the missing info) plus optional quick-pick
   * buttons for closed-choice slots like party_size.
   */
  | {
      type: "ask_clarification";
      missing: string[];
      suggested_quick_picks?: QuickPick[];
    }
  /**
   * All required fields present, scenario + party decided. Show the inline
   * confirm card so the user can commit (create room / run plan / package trip).
   * The `kind` maps 1:1 to the current ConfirmCard component's kind prop.
   *
   * When `directBooking=true`, the user named one specific venue
   * (restaurant_name / hotel_name set). The commit route should bypass the
   * recommendation pipeline and create a booking-job pointing at that exact
   * venue instead of LLM-picking one. Frontend may also render the confirm
   * card with venue-specific copy ("Book Carbone for 2 on Apr 28").
   */
  | {
      type: "show_confirm_card";
      kind: "plan" | "room" | "trip";
      state: IntentState;
      directBooking?: boolean;
    };

// ─── Backward-compat shape returned by /api/chat/parse ────────────────────
// We keep emitting a v1-shaped response so the existing homepage chat
// + ConfirmCard components work unchanged during the migration. Internally
// we populate this from the new (state, action) pair; see `toV1Response()`
// in router.ts once we write it.

export interface NluV2ParseResult {
  intent: NluIntent;
  scenario: NluScenario | null;
  party_type: PartyType;
  member_names: string[];
  collected_constraints: Record<string, unknown>;
  missing_fields: string[];
  suggested_clarify_question: string | null;
  suggested_quick_picks: QuickPick[] | null;
  confirm_ready: boolean;
  refined_target_id: string | null;
  /** The natural-language reply from Layer 1. */
  assistant_reply: string | null;

  /**
   * True when the user named one specific venue (restaurant_name or
   * hotel_name) so /api/chat/commit should skip the LLM-recommendation
   * pass and create a booking-job pointing directly at that venue.
   * Frontend may also render the confirm card with venue-specific copy.
   * Always undefined when scenario is not restaurant/hotel.
   */
  direct_booking?: boolean;

  /** Debug-only: the raw IntentState + RouterAction for server-side logs.
   *  Not rendered by the frontend. */
  __v2_state?: IntentState;
  __v2_action?: RouterAction;
}
