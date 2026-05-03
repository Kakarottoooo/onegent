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
  | "profile_edit"       // user is saving / updating personal profile data
                         //   ("save my DOB 1995/05/15", "我的 passport 是 A1234567")
                         //   — bypasses booking flow; router emits apply_profile_patch
  | "unknown";           // couldn't classify — treat as chitchat + ask

/**
 * Canonical profile fields the extractor may patch on `IntentState.profile_patch`.
 *
 * MIRRORED from codex's backend canonical schema (see
 * `components/profile-gap/types.ts:CANONICAL_FIELD_IDS`). The two lists must
 * stay in lockstep — if codex adds / removes a field, update both this and
 * `field-vocabulary.ts`. We don't import from components/ to avoid the
 * lib → components dependency direction; the profile-gap unit tests pin the
 * canonical set, and the golden-profile-edit tests pin this side.
 *
 * Why duplicate: NLU runs server-side and shouldn't import client React code;
 * components/profile-gap is a "use client" package. A shared schema module
 * would also work but is overkill for 13 strings.
 */
export const PROFILE_EDIT_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "date_of_birth",
  "passport_number",
  "passport_expiry",
  "passport_country",
  "address_line1",
  "city",
  "state",
  "zip",
  "country",
] as const;

export type ProfileEditField = (typeof PROFILE_EDIT_FIELDS)[number];

/**
 * Partial canonical profile values the user mentioned in the latest turn.
 * The router hands this to the frontend as the body of a
 * `PATCH /api/v1/users/me/profile` request (path TBD with codex).
 *
 * All values are pre-normalized strings:
 *   - dates are ISO YYYY-MM-DD (extractor resolves "May 15 1995" → "1995-05-15")
 *   - phone keeps the user's punctuation
 *   - country is the 2-letter ISO code when the extractor recognized it,
 *     otherwise the raw user text
 */
export type ProfilePatch = Partial<Record<ProfileEditField, string>>;

export type NluScenario =
  | "restaurant"
  | "hotel"
  | "flight"
  | "activity"
  | "trip";

/**
 * Composite categories — the new vocabulary. A user request maps to an
 * ordered list of NluCategory values (e.g. "和朋友吃饭+看电影 NYC" →
 * ["restaurant", "activity"]). The legacy `scenario` is derived as
 * categories[0] ?? null during the migration; new code should consume
 * `categories` directly.
 *
 * Note: "trip" is NOT a category — it's a UX label for a composite that
 * happens to include all four (hotel + flight + restaurant + activity).
 * The router decides UI based on categories.length, not a "trip" flag.
 */
export type NluCategory = "restaurant" | "hotel" | "flight" | "activity";

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
  /**
   * @deprecated derived from categories[0] (or "trip" when categories.length===4).
   * Kept on the type during the v1→composite migration so consumers
   * (commit/parse routes, ConfirmCard) compile unchanged. Phase 2 deletes this.
   */
  scenario: NluScenario | null;
  /**
   * Ordered list of categories the user explicitly wants. Empty list means
   * the user hasn't named any product yet — the router should ask
   * "想订什么？" + offer "完整 plan" as a one-tap upgrade. Multi-category
   * requests ("吃饭+电影") populate this with the union; the trip-style
   * full package is just `["hotel", "flight", "restaurant", "activity"]`.
   */
  categories: NluCategory[];
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

  /**
   * Profile-edit payload populated when `intent === "profile_edit"`. The
   * router uses this to emit `apply_profile_patch` so the frontend can
   * `PATCH /api/v1/users/me/profile` without going through the booking
   * pipeline. Omit when no profile fields were mentioned this turn.
   *
   * Empty object is invalid — extractor must omit the field entirely if
   * no fields were captured. Coercion enforces this.
   */
  profile_patch?: ProfilePatch;

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
   * User is saving / updating personal profile fields. Frontend should
   * PATCH the user's profile with `patch` (canonical-keyed; see
   * `ProfilePatch`) and surface a confirmation reply. Does NOT advance any
   * booking pipeline; if a booking was in flight, its IntentState is
   * preserved unchanged so the next turn picks up where the user left off.
   *
   * `patch` is non-empty by contract — coercion drops the action if the
   * extractor classified profile_edit but emitted no usable fields.
   */
  | {
      type: "apply_profile_patch";
      patch: ProfilePatch;
    }
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
      /**
       * "plan"           — solo + 1 category (existing single-cat plan path)
       * "composite_plan" — solo + 2+ categories (multi-column horizontal,
       *                    no vote actions)
       * "room"           — multi-party DR with N>=1 categories (multi-column
       *                    horizontal, vote actions; N=1 renders 1 column)
       * "trip"           — @deprecated alias for kind="room" with all 4
       *                    categories. Kept for the migration; emit "room"
       *                    going forward.
       */
      kind: "plan" | "composite_plan" | "room" | "trip";
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
  /**
   * @deprecated derived from categories[0]; kept for backward-compat with v1 callers.
   * Use `categories` instead.
   */
  scenario: NluScenario | null;
  /** New canonical field. Empty list = user hasn't picked any category yet. */
  categories: NluCategory[];
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
