export interface UserRequirements {
  cuisine?: string;
  purpose?: string; // date, business, family, friends, solo
  budget_per_person?: number;
  budget_total?: number;
  atmosphere?: string[];
  noise_level?: "quiet" | "moderate" | "lively" | "any";
  location?: string;
  neighborhood?: string;
  near_location?: string; // specific landmark/street/area to search near
  party_size?: number;
  constraints?: string[]; // no chains, no tourist traps, etc.
  priorities?: string[]; // what matters most
  service_pace_required?: "fast" | "normal";
}

export interface ReviewSignals {
  noise_level: "quiet" | "moderate" | "loud" | "unknown";
  wait_time: string; // e.g. "30-45min on weekends", "no wait on weekdays"
  date_suitability: number; // 1-10
  service_pace: string; // e.g. "attentive but not rushed"
  notable_dishes: string[];
  red_flags: string[];
  best_for: string[];
  review_confidence: "high" | "medium" | "low";
}

export interface GoogleReview {
  author_name: string;
  rating: number;
  relative_time_description: string;
  text: string;
}

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  price: string; // $, $$, $$$, $$$$
  rating: number;
  review_count: number;
  address: string;
  phone?: string;
  url?: string;
  image_url?: string;
  images?: string[];
  description?: string;
  is_closed: boolean;
  distance?: number;
  lat?: number;
  lng?: number;
  review_signals?: ReviewSignals;
  google_reviews?: GoogleReview[];
}

export interface ScoringDimensions {
  budget_match: number; // 0-10
  scene_match: number; // 0-10
  review_quality: number; // 0-10
  location_convenience: number; // 0-10
  preference_match: number; // 0-10 (default 5 if unknown)
  red_flag_penalty: number; // 0-5
  weighted_total: number; // system-computed
}

export interface RecommendationCard {
  restaurant: Restaurant;
  rank: number;
  score: number;
  why_recommended: string;
  best_for: string;
  watch_out: string;
  not_great_if: string;
  estimated_total: string;
  opentable_url?: string;
  scoring?: ScoringDimensions;
  suggested_refinements?: string[];
}

export interface SessionPreferences {
  noise_preference?: "quiet" | "moderate" | "lively";
  budget_ceiling?: number; // per person
  exclude_chains: boolean;
  excluded_cuisines: string[];
  required_features: string[]; // e.g. ["outdoor seating", "private room"]
  occasion?: string;
  refined_from_query_count: number;
}

/** A single preference signal discovered automatically from conversations. */
export interface DiscoveredPreference {
  id: string;                   // stable UUID for updates/removals
  category: "dining" | "travel" | "hotels" | "shopping" | "general";
  key: string;                  // machine key e.g. "noise_level", "cabin_class", "hotel_stars"
  label: string;                // human label e.g. "Prefers quiet atmosphere"
  value: string;                // raw value e.g. "quiet", "economy", "4"
  seen_count: number;           // how many times this signal was observed
  source: string;               // e.g. "From: 'romantic dinner, no chains'"
  discovered_at: string;        // ISO timestamp of first discovery
  updated_at: string;           // ISO timestamp of last update
  user_confirmed?: boolean;     // user explicitly confirmed or edited this
}

export interface UserPreferenceProfile {
  version: 2;
  updated_at: string; // ISO timestamp
  // Auto-discovered from conversations (the primary preference store)
  discovered: DiscoveredPreference[];
  // Explicit dietary restrictions (still allow user to set these directly)
  dietary_restrictions: string[];
  // Legacy fields kept for backward-compat and formatProfileForPrompt
  noise_preference?: "quiet" | "moderate" | "lively";
  typical_budget_per_person?: number;
  cuisine_dislikes: string[];
  always_exclude_chains: boolean;
  preferred_occasions: string[];
  dislike_tourist_traps: boolean;
  recent_search_keywords: string[];
  favorite_signals: Array<{
    cuisine: string;
    price: string;
    purpose?: string;
    saved_at: string;
  }>;
}

export interface FeedbackRecord {
  restaurant_id: string;
  restaurant_name: string;
  query: string;
  satisfied: boolean;
  issues?: string[];
  created_at: string;
}

export interface LearnedWeights {
  budget_match: number;
  scene_match: number;
  review_quality: number;
  location_convenience: number;
  preference_match: number;
  updated_at: string;
  sample_size: number;
}

export interface AgentResponse {
  requirements: UserRequirements | ParsedIntent | ScenarioIntent;
  recommendations: RecommendationCard[];
  hotelRecommendations?: HotelRecommendationCard[];
  flightRecommendations?: FlightRecommendationCard[];
  creditCardRecommendations?: CreditCardRecommendationCard[];
  laptopRecommendations?: LaptopRecommendationCard[];
  smartphoneRecommendations?: SmartphoneRecommendationCard[];
  headphoneRecommendations?: HeadphoneRecommendationCard[];
  decisionPlan?: DecisionPlan | null;
  scenarioIntent?: ScenarioIntent | null;
  result_mode?: ResultMode;
  category?: CategoryType;
  output_language?: OutputLanguage;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  cards?: RecommendationCard[];
  hotelCards?: HotelRecommendationCard[];
  flightCards?: FlightRecommendationCard[];
  creditCardCards?: CreditCardRecommendationCard[];
  laptopCards?: LaptopRecommendationCard[];
  smartphoneCards?: SmartphoneRecommendationCard[];
  headphoneCards?: HeadphoneRecommendationCard[];
  activityCards?: ActivityRecommendationCard[];
  decisionPlan?: DecisionPlan;
  result_mode?: ResultMode;
  scenario?: ScenarioType;
  category?: CategoryType;
  output_language?: OutputLanguage;
  /** When set, renders an inline booking job card instead of plain text */
  bookingJobId?: string;
  /**
   * Phase 1 #7 path B: when set, renders an inline ProfileGapCard
   * underneath the assistant message. Triggered when the backend's
   * direct_booking commit response includes `profile_gap` (i.e. the
   * user's profile lacks scenario-required fields per `buildProfileGap`).
   *
   * The card's onSave handler is wired in app/page.tsx to (a) PATCH the
   * profile via the apply_profile_patch dispatcher, then (b) resume the
   * pending booking via `startDirectBookingWithProfile`. The pending
   * commit payload is carried in `pendingPayload` so the resume is
   * idempotent across chat-replay reloads.
   */
  profileGapCard?: {
    /** Stable id so we can replace/remove the card after the user saves. */
    id: string;
    /** Canonical 13-field gap state from `buildProfileGap` (server-side). */
    state: import("@/components/profile-gap/types").ProfileGapState;
    /**
     * The original commit response so the pending booking can resume
     * after the profile is patched. Persisted via chat-replay so a
     * page refresh mid-flow doesn't drop the booking.
     */
    pendingPayload: import("@/components/ConfirmCard").CommitResponse;
  };
}

export type ResultMode =
  | "category_cards"
  | "scenario_plan"
  | "followup_refinement"
  | "execution_actions";

export type ScenarioType = "date_night" | "weekend_trip" | "city_trip" | "big_purchase" | "concert_event" | "gift" | "fitness";
export type InputLanguage = "en" | "zh" | "mixed" | "other" | "unknown";
export type OutputLanguage = "en" | "zh";

export interface MultilingualQueryContext {
  input_language: InputLanguage;
  output_language: OutputLanguage;
  normalized_query: string;
  intent_summary: string;
  category_hint?: CategoryType | null;
  scenario_hint?: ScenarioType | null;
  location_hint?: string;
  cuisine_hint?: string;
  purpose_hint?: string;
  party_size_hint?: number;
  budget_per_person_hint?: number;
  budget_total_hint?: number;
  date_text_hint?: string;
  time_hint?: string;
  constraints_hint?: string[];
  /** G-3: which module to replace in a partial-refine request */
  refine_module?: "hotel" | "flight" | "restaurant" | "venue";
  /** G-3: plan ID whose other modules should be kept unchanged */
  pinned_plan_id?: string;
}

export interface AfterDinnerVenue {
  name: string;
  address: string;
  walk_minutes: number;
  vibe: string;
  google_maps_url: string;
}

export interface PlanLinkAction {
  id: string;
  label: string;
  url: string;
}

export interface PlanAction {
  id: string;
  type:
    | "share_plan"
    | "send_for_vote"
    | "watch_price"
    | "export_brief"
    | "refine"
    | "swap_backup"
    | "approve_plan"
    | "request_changes"
    | "open_link";
  label: string;
  description: string;
  prompt?: string;
  option_id?: string;
  url?: string;
  outcome_action?: string;
}

export interface PlanOption {
  id: string;
  label: string;
  option_category: CategoryType;
  title: string;
  subtitle: string;
  summary: string;
  why_this_now: string;
  best_for: string;
  estimated_total: string;
  timing_note: string;
  risks: string[];
  tradeoffs: string[];
  highlights: string[];
  primary_action?: PlanLinkAction;
  secondary_actions?: PlanLinkAction[];
  evidence_card_id?: string;
  score: number;
  fallback_reason?: string;
  tradeoff_reason?: string;
  tradeoff_detail?: string;
  product_model?: string;
  /** After-dinner venue for date_night primary plans. Travels with the option so backup promotion stays correct. */
  after_dinner_option?: AfterDinnerVenue;
  /** Venue coordinates for map display (concert_event and city_trip). */
  venue_lat?: number;
  venue_lng?: number;
}

export interface DecisionEvidenceItem {
  id: string;
  title: string;
  detail: string;
  tag?: string;
}

export interface DecisionPlan {
  id: string;
  scenario: ScenarioType;
  output_language: OutputLanguage;
  title: string;
  summary: string;
  approval_prompt: string;
  confidence: "high" | "medium" | "low";
  scenario_brief: string[];
  primary_plan: PlanOption;
  backup_plans: PlanOption[];
  /** Plan-level comparative summary: why primary beats the backups, and what each backup trades off. */
  tradeoff_summary?: string;
  /** ISO 8601 datetime for the primary event (e.g. "2026-04-12T19:00:00"). Enables ICS export. */
  event_datetime?: string;
  /** Human-readable location for the primary event. Included in the ICS file. */
  event_location?: string;
  /** One-line credit card recommendation for trip scenarios (weekend_trip, city_trip). */
  trip_card_callout?: string;
  /** True when the planner found more than 2 backup options but capped the display at 2. */
  show_more_available?: boolean;
  /** Context for booking autopilot — city/dates/travelers from the original scenario intent. */
  autopilot_context?: {
    city?: string;           // destination city
    departure_city?: string; // origin city (for flights)
    start_date?: string;     // YYYY-MM-DD (checkin / trip start)
    end_date?: string;       // YYYY-MM-DD (checkout / trip end)
    travelers?: number;
    time_hint?: string;      // HH:MM preferred dining time
  };
  /** True when this plan was shared in group-vote mode — enables vote UI on the share page. */
  vote_mode?: boolean;
  risks: string[];
  next_actions: PlanAction[];
  evidence_card_ids: string[];
  evidence_items: DecisionEvidenceItem[];
}

export type PlanOutcomeType =
  | "went"
  | "skipped"
  | "rated_positive"
  | "rated_negative"
  | "partner_approved"
  | "post_experience_feedback"
  | "price_drop_alert";

export type FeedbackRating = "great" | "ok" | "did_not_go";
export type FeedbackIssue = "too_noisy" | "too_expensive" | "too_far" | "bad_service" | "other";

export interface PostExperienceFeedback {
  rating: FeedbackRating;
  issues?: FeedbackIssue[];
  note?: string;
}

// ─── Big Purchase types ───────────────────────────────────────────────────────

export type BigPurchaseCategory = "laptop" | "headphone" | "smartphone" | "tablet" | "camera" | "tv" | "appliance" | "other";

export interface BigPurchaseIntent extends BaseIntent {
  category: "unknown";
  scenario: "big_purchase";
  product_category: BigPurchaseCategory;
  query: string;
  budget_usd_max: number | null;
  os_preference?: string;
  use_case?: string;
  constraints?: string[];
}

// ─── Phase 7: Multi-category types ───────────────────────────────────────────

export type CategoryType = "restaurant" | "hotel" | "flight" | "activity" | "credit_card" | "laptop" | "smartphone" | "headphone" | "subscription" | "trip" | "big_purchase" | "gift" | "fitness" | "unknown";

export interface BaseIntent {
  category: CategoryType;
  budget_per_person?: number;
  budget_total?: number;
  location?: string;
  purpose?: string;
  constraints?: string[];
  priorities?: string[];
}

export interface RestaurantIntent extends BaseIntent {
  category: "restaurant";
  cuisine?: string;
  noise_level?: "quiet" | "moderate" | "lively" | "any";
  atmosphere?: string[];
  party_size?: number;
  neighborhood?: string;
  near_location?: string;
}

export type DateNightStage =
  | "first_date"
  | "anniversary"
  | "steady_relationship"
  | "casual_date"
  | "surprise"
  | "unknown";

export type DateNightFollowUp =
  | "dessert"
  | "cocktail"
  | "walk"
  | "none"
  | "open";

export type DateNightDecisionStyle =
  | "safe"
  | "romantic"
  | "impressive"
  | "playful"
  | "relaxed";

export interface DateNightIntent extends RestaurantIntent {
  scenario: "date_night";
  scenario_goal: string;
  stage: DateNightStage;
  follow_up_preference: DateNightFollowUp;
  decision_style: DateNightDecisionStyle;
  time_hint?: string;
  detected_date_text?: string;
  wants_quiet_buffer: boolean;
}

export type WeekendTripPace = "easy" | "balanced" | "packed";
export type WeekendTripHotelStyle =
  | "value"
  | "comfortable"
  | "boutique"
  | "luxury"
  | "any";

export interface WeekendTripIntent extends BaseIntent {
  category: "trip";
  scenario: "weekend_trip";
  scenario_goal: string;
  departure_city?: string;
  destination_city?: string;
  start_date?: string;
  end_date?: string;
  nights?: number;
  travelers?: number;
  trip_pace: WeekendTripPace;
  hotel_style: WeekendTripHotelStyle;
  hotel_star_rating?: number;
  hotel_neighborhood?: string;
  cabin_class?: "economy" | "business" | "first";
  prefer_direct?: boolean | null;
  cuisine_preferences?: string[];
  planning_assumptions: string[];
  needs_clarification: boolean;
  missing_fields: string[];
}

export interface HotelIntent extends BaseIntent {
  category: "hotel";
  check_in?: string;
  check_out?: string;
  nights?: number;
  guests?: number;
  star_rating?: number;
  room_type?: string;
  amenities?: string[];
  neighborhood?: string;
  special_occasion?: "honeymoon" | "anniversary" | "birthday";
  has_children?: boolean;
  children_count?: number;
}

export interface FlightIntent extends BaseIntent {
  category: "flight";
  departure_city?: string;
  departure_airport?: string; // IATA code e.g. "JFK"
  arrival_city?: string;
  arrival_airport?: string; // IATA code e.g. "LAX"
  date?: string; // YYYY-MM-DD
  return_date?: string; // YYYY-MM-DD (round trip)
  is_round_trip?: boolean;
  passengers?: number;
  cabin_class?: "economy" | "business" | "first";
  prefer_direct?: boolean;
  max_stops?: number | null; // null = no preference, 0 = nonstop only, 1 = max 1 stop
  avoid_red_eye?: boolean;      // true = exclude departures 00:00–05:59
  earliest_departure?: string;  // "HH:MM" e.g. "07:00"
  latest_departure?: string;    // "HH:MM" e.g. "21:00"
}

import type { WatchCategory } from "./watchTypes";

export interface SubscriptionIntent extends BaseIntent {
  category: "subscription";
  action: "subscribe" | "unsubscribe" | "list";
  watch_category: WatchCategory | null;
  brands: string[];     // e.g. ["Apple", "NVIDIA"]
  keywords: string[];   // e.g. ["MacBook Pro", "RTX"]
  label: string;        // human-readable summary, e.g. "Apple MacBook releases"
}

export interface CityTripIntent extends BaseIntent {
  category: "trip";
  scenario: "city_trip";
  scenario_goal: string;
  destination_city: string;
  /** Origin city for flight leg. Required for trip packaging (Stage 1). */
  departure_city?: string;
  start_date?: string;
  end_date?: string;
  nights?: number;
  travelers?: number;
  hotel_star_rating?: number;
  hotel_neighborhood?: string;
  activities: string[];
  cuisine_preferences: string[];
  vibe: "trendy" | "upscale" | "local" | "mixed";
  planning_assumptions: string[];
  needs_clarification: boolean;
  missing_fields: string[];
}

// ─── Trip Packaging ──────────────────────────────────────────────────────
// A TripPackage is the cross-category aggregate produced by the trip
// planner: 4 parallel pipelines (hotel + flight + restaurant + activity)
// each return up to 5 option cards. The user picks:
//   - 1 hotel (or skip)
//   - 1 flight (or skip)
//   - 0-3 restaurants (or skip)
//   - 0-3 activities (or skip)
// Minimum 1 selected, else create-trip rejects. The selection payload goes
// to /api/booking-jobs/create-trip which maps each selected card to a
// BookingJobStep and kicks off an N-step (1-8) parallel autopilot job.

/** User's per-category selection. Pass to /api/booking-jobs/create-trip. */
export interface TripSelection {
  hotel_id: string | null;
  flight_id: string | null;
  restaurant_ids: string[];
  activity_ids: string[];
}

/** Per-category error info when a pipeline failed / returned nothing. */
export interface TripPackageErrors {
  hotel?: string | null;
  flight?: string | null;
  restaurant?: string | null;
  activity?: string | null;
}

export interface TripPackage {
  /** Stable id for this package (used to dedup on UI re-renders). */
  id: string;
  scenario: "trip";
  destination_city: string;
  departure_city: string;
  date_range: { from: string; to: string };
  traveler_count: number;
  /** Up to 5 candidate hotels — user picks exactly 1 (or skips). */
  hotel_options: HotelRecommendationCard[];
  /** Up to 5 candidate flights — user picks exactly 1 (or skips). */
  flight_options: FlightRecommendationCard[];
  /** Up to 5 candidate restaurants — user picks 0-3. */
  restaurant_options: RecommendationCard[];
  /** Up to 5 candidate activities — user picks 0-3. */
  activity_options: ActivityRecommendationCard[];
  /** Per-category error info so the UI can show "No hotels found" etc. */
  errors?: TripPackageErrors;
  /** Optional rationale lines the planner surfaces to the UI. */
  planning_assumptions?: string[];
}

export interface TicketmasterEvent {
  id: string;
  name: string;
  url: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
  venue_name: string;
  venue_address: string;
  city: string;
  genre?: string;
  price_min?: number;
  price_max?: number;
  image_url?: string;
  venue_lat?: number;
  venue_lng?: number;
}

export type ConcertEventType = "concert" | "festival" | "theater" | "sports" | "comedy" | "other";

export interface ConcertEventIntent extends BaseIntent {
  category: "trip";
  scenario: "concert_event";
  scenario_goal: string;
  event_city: string;
  keyword?: string;
  event_date?: string; // YYYY-MM-DD
  event_type: ConcertEventType;
  travelers: number;
  planning_assumptions: string[];
  needs_clarification: boolean;
  missing_fields: string[];
}

// ─── Gift types ───────────────────────────────────────────────────────────────

export type GiftOccasion =
  | "birthday"
  | "anniversary"
  | "christmas"
  | "valentines"
  | "mothers_day"
  | "fathers_day"
  | "graduation"
  | "wedding"
  | "housewarming"
  | "other";

export type GiftRelationship =
  | "partner"
  | "parent"
  | "friend"
  | "sibling"
  | "colleague"
  | "boss"
  | "child"
  | "other";

export interface GiftProduct {
  title: string;
  price?: number;
  price_raw?: string;
  source?: string;
  link?: string;
  image_url?: string;
  rating?: number;
  reviews?: number;
}

export interface GiftIntent extends BaseIntent {
  category: "gift";
  scenario: "gift";
  scenario_goal: string;
  recipient?: string; // e.g. "mom", "boyfriend"
  relationship?: GiftRelationship;
  occasion?: GiftOccasion;
  interests?: string[]; // e.g. ["cooking", "hiking"]
  budget_usd_max?: number;
  planning_assumptions: string[];
  needs_clarification: boolean;
  missing_fields: string[];
}

// ─── Fitness types ────────────────────────────────────────────────────────────

export type FitnessActivity =
  | "yoga"
  | "pilates"
  | "spin"
  | "hiit"
  | "crossfit"
  | "boxing"
  | "dance"
  | "meditation"
  | "barre"
  | "swimming"
  | "running"
  | "martial_arts"
  | "other";

export type FitnessTimePreference = "morning" | "afternoon" | "evening" | "any";
export type FitnessSkillLevel = "beginner" | "intermediate" | "advanced" | "any";

export interface FitnessStudio {
  id: string;
  name: string;
  address: string;
  rating: number;
  review_count: number;
  price_level?: string; // "$" | "$$" | "$$$"
  lat?: number;
  lng?: number;
  website?: string;
}

export interface FitnessIntent extends BaseIntent {
  category: "fitness";
  scenario: "fitness";
  scenario_goal: string;
  activity: FitnessActivity;
  activity_label: string; // human-readable e.g. "vinyasa yoga", "hot pilates"
  style?: string; // e.g. "vinyasa", "hot", "power"
  neighborhood?: string;
  city: string;
  day_preference?: string; // e.g. "saturday", "weekend", "weekday"
  time_preference: FitnessTimePreference;
  budget_per_class?: number;
  skill_level: FitnessSkillLevel;
  planning_assumptions: string[];
  needs_clarification: boolean;
  missing_fields: string[];
}

export type ScenarioIntent = DateNightIntent | WeekendTripIntent | CityTripIntent | BigPurchaseIntent | ConcertEventIntent | GiftIntent | FitnessIntent;

export type ScenarioTelemetryEventType =
  | "plan_viewed"
  | "plan_approved"
  | "backup_promoted"
  | "action_clicked"
  | "feedback_negative";

export interface ScenarioTelemetryEvent {
  type: ScenarioTelemetryEventType;
  scenario: ScenarioType;
  plan_id: string;
  session_id: string;
  option_id?: string;
  action_id?: string;
  request_id?: string;
  query?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export type ParsedIntent = RestaurantIntent | HotelIntent | FlightIntent | CreditCardIntent | LaptopIntent | SmartphoneIntent | HeadphoneIntent | SubscriptionIntent | ActivityIntent;

export interface Hotel {
  id: string;
  name: string;
  star_rating: number;
  price_per_night: number;
  total_price: number;
  rating: number;
  review_count: number;
  address: string;
  neighborhood?: string;
  distance_to_center?: string;
  amenities: string[];
  thumbnail?: string;
  images?: string[];
  booking_link: string;
  description?: string;
  lat?: number;
  lng?: number;
}

export interface FlightLeg {
  from_airport: string;   // IATA
  to_airport: string;     // IATA
  departure_time: string; // e.g. "08:30"
  arrival_time: string;   // e.g. "11:45"
  duration?: string;      // e.g. "2h 15m"
  from_lat?: number;
  from_lng?: number;
  to_lat?: number;
  to_lng?: number;
  layover_duration?: string; // wait at to_airport before next leg
}

export interface Flight {
  id: string;
  airline: string;
  airline_logo?: string;
  flight_number?: string;
  departure_airport: string; // IATA or city name
  arrival_airport: string;
  departure_city: string;
  arrival_city: string;
  departure_time: string; // e.g. "08:30"
  arrival_time: string; // e.g. "11:45"
  duration: string; // e.g. "3h 15m"
  stops: number; // 0 = direct
  layover_city?: string;
  layover_duration?: string; // e.g. "1h 20m"
  price: number; // USD
  booking_link: string;
  is_round_trip?: boolean;
  return_departure_time?: string;
  return_arrival_time?: string;
  return_duration?: string;
  // Per-leg detail for map rendering
  legs?: FlightLeg[];
  // For map arc (overall)
  departure_lat?: number;
  departure_lng?: number;
  arrival_lat?: number;
  arrival_lng?: number;
}

export interface FlightRecommendationCard {
  flight: Flight;
  rank: number;
  group: "direct" | "one_stop" | "two_stop" | "cheapest";
  why_recommended: string;
}

export interface HotelRecommendationCard {
  hotel: Hotel;
  rank: number;
  score: number;
  why_recommended: string;
  best_for: string;
  watch_out: string;
  not_great_if: string;
  price_summary: string;
  location_summary: string;
  scoring?: ScoringDimensions;
  suggested_refinements?: string[];
}

export type ActivityEventType =
  | "concert"
  | "theater"
  | "sports"
  | "exhibition"
  | "comedy"
  | "festival"
  | "other";

export type ActivityProvider = "seatgeek" | "ticketmaster";

/**
 * One ticket source for an Activity. An Activity aggregates events with the
 * same normalized title and date across providers — so a single Activity card
 * can carry both a SeatGeek and a Ticketmaster buy link.
 */
export interface ActivitySource {
  provider: ActivityProvider;
  /** Provider-specific event id (for debugging / dedup). */
  provider_event_id: string;
  /** Buy URL for this source. */
  booking_link: string;
  /** Lowest listed ticket price for this source, USD. */
  price_min: number;
  /** Highest listed ticket price for this source, USD. */
  price_max?: number;
  /** Median listing price for this source, USD. */
  price_avg?: number;
  /** Number of listings available from this source. */
  listing_count?: number;
}

export interface Activity {
  id: string;
  /** Human-readable title, e.g. "Taylor Swift — The Eras Tour". */
  title: string;
  /** Short title from SeatGeek (marketing-friendly), falls back to title. */
  short_title?: string;
  event_type: ActivityEventType;
  /** ISO-like local datetime, e.g. "2026-05-20T20:00:00". */
  datetime_local: string;
  /** Display-ready date/time, e.g. "Wed, May 20 · 8:00 PM". */
  datetime_display?: string;
  venue_name: string;
  venue_city: string;
  venue_state?: string;
  venue_address?: string;
  /** Aggregate lowest price across all sources, USD. (= min of sources.price_min) */
  price_min: number;
  /** Aggregate highest price across all sources, USD. (= max of sources.price_max) */
  price_max?: number;
  /** Median listing price (from primary source), USD. */
  price_avg?: number;
  /** Listing count from primary source. */
  listing_count?: number;
  /** Cover image URL. */
  image_url?: string;
  /**
   * Primary source buy URL. Kept for back-compat with any code that still
   * reads a single booking_link; new code should iterate `sources` instead.
   */
  booking_link: string;
  /** Performers / teams / cast (for sports = home/away team names). */
  performers?: string[];
  /**
   * All ticket sources for this event. Guaranteed non-empty. The first entry
   * is the primary (also mirrored in top-level booking_link / listing_count).
   */
  sources: ActivitySource[];
}

export interface ActivityRecommendationCard {
  activity: Activity;
  rank: number;
  /** "best_match" | "cheapest" | "premium_seats" — why this showed up. */
  group: "best_match" | "cheapest" | "premium_seats";
  why_recommended: string;
}

export interface ActivityIntent extends BaseIntent {
  category: "activity";
  event_type?: ActivityEventType;
  /** Free-form performer / team / show name from the user. */
  event_name?: string;
  /** Authoritative city for the search (mapped to SeatGeek venue.city). */
  city?: string;
  /** YYYY-MM-DD — earliest acceptable event date. */
  date_from?: string;
  /** YYYY-MM-DD — latest acceptable event date. */
  date_to?: string;
  num_tickets?: number;
  budget_max_per_ticket?: number;
  seat_type?: "premium" | "standard" | "economy";
  /** Soft bias — e.g. "orchestra", "lower bowl". */
  section_preferences?: string[];
  avoid_sections?: string[];
  /** any member requested accessibility. */
  wheelchair_required?: boolean;
}

// ─── Phase 9: Credit Card types ───────────────────────────────────────────────

export interface SpendingProfile {
  dining: number;        // monthly USD
  groceries: number;
  travel: number;
  gas: number;
  online_shopping: number;
  streaming: number;
  entertainment: number; // movies, concerts, sports, kids activities — SavorOne earns 3x here
  pharmacy: number;
  rent: number;          // monthly rent — only Bilt earns points on this
  other: number;
}

export interface CreditCardIntent extends BaseIntent {
  category: "credit_card";
  spending_profile?: SpendingProfile;
  existing_cards?: string[];           // card ids
  has_existing_cards?: boolean;        // true if user mentioned having cards but didn't name them
  reward_preference?: "cash" | "travel";
  credit_score?: number;               // 0 = no credit history
  prefer_no_annual_fee?: "hard" | "soft" | false; // hard=exclude, soft=show with note, false=no pref
  prefer_flat_rate?: boolean;          // "don't track categories, give me one card"
  needs_spending_info?: boolean;       // true = user didn't provide spending details, ask first
  optimization_mode?: "first_card" | "add_to_stack" | "portfolio_review" | "signup_bonus";
}

export interface CreditCard {
  id: string;
  name: string;
  issuer: string;
  annual_fee: number;
  rewards_currency: string;
  category_rates: {
    dining: number;
    groceries: number;
    travel: number;
    gas: number;
    online_shopping: number;
    streaming: number;
    entertainment: number;
    pharmacy: number;
    rent: number;
    other: number;
  };
  point_value_cash: number;
  point_value_travel: number;
  signup_bonus_points: number;
  signup_bonus_spend_requirement: number;
  signup_bonus_timeframe_months: number;
  foreign_transaction_fee: boolean;
  min_credit_score?: number;
  notes?: string[];
  eligibility_notes?: string[];         // hard prerequisites (Costco membership, Prime, etc.)
  mutually_exclusive_with?: string[];   // card ids that cannot be held simultaneously
  last_verified: string;
}

export interface CreditCardRecommendationCard {
  card: CreditCard;
  rank: number;
  annual_net_benefit: number;       // marginal value after adding this card (net of annual fee)
  marginal_value: number;           // vs current card portfolio
  category_breakdown: {
    category: string;
    old_rate: number;
    new_rate: number;
    monthly_spend: number;
    annual_gain: number;
  }[];
  signup_bonus_value: number;       // estimated dollar value of signup bonus
  reward_preference: "cash" | "travel";
  why_recommended: string;
  watch_out: string[];
  portfolio_gap_note?: string;      // e.g. "Fills your 1× gap on dining — earns 4× with this card"
}

// ─── Phase 10: Laptop Recommendation types ───────────────────────────────────

export type LaptopUseCase =
  | "light_productivity"
  | "software_dev"
  | "video_editing"
  | "3d_creative"
  | "gaming"
  | "data_science"
  | "business_travel";

export interface LaptopIntent extends BaseIntent {
  category: "laptop";
  use_cases: LaptopUseCase[];
  budget_usd_max: number | null;
  budget_usd_min: number | null;
  os_preference: "mac" | "windows" | "linux" | "any";
  portability_priority: "critical" | "preferred" | "flexible";
  gaming_required: boolean;
  display_size_preference: "<14" | "14-15" | "15+" | "any";
  avoid_brands: string[];
  needs_use_case_info: boolean;
  mentioned_models: string[]; // specific models/chips user named, e.g. ["M5", "MacBook Pro M4"]
}

export interface LaptopSKU {
  id: string;
  ram_gb: number;
  storage_gb: number;
  price_usd: number;
  notes?: string;
}

export interface LaptopSignalValue {
  value_raw: string | number;
  value_label: string;
  value_normalized: number; // 0-10
  raw_quote?: string;
  source: string;
  months_old: number;
}

export interface LaptopPortSelection {
  usb_c: number;
  usb_a: number;
  hdmi: boolean;
  sd_card: boolean;
  thunderbolt: boolean;
  value_normalized: number;
}

export interface LaptopDevice {
  id: string;
  name: string;
  brand: string;
  os: "mac" | "windows" | "linux";
  price_usd: number;         // base MSRP
  display_size: number;      // inches
  weight_kg: number;
  ram_gb: number;            // base config
  storage_gb: number;        // base config
  cpu: string;
  gpu: string;
  skus: LaptopSKU[];
  signals: {
    battery_life: LaptopSignalValue;
    display_quality: LaptopSignalValue;
    display_brightness: LaptopSignalValue;
    keyboard_feel: LaptopSignalValue;
    trackpad_feel: LaptopSignalValue;
    thermal_performance: LaptopSignalValue;
    fan_noise: LaptopSignalValue;
    build_quality: LaptopSignalValue;
    port_selection: LaptopPortSelection;
    weight_portability: LaptopSignalValue;
    value_for_money: LaptopSignalValue;
    cpu_benchmark: number;   // 0-10 log-scale
    gpu_benchmark: number;   // 0-10 log-scale
  };
  last_verified: string;
}

export interface LaptopSignalBreakdownItem {
  signal_type: string;
  label: string;
  score: number;       // 0-10
  weight: number;      // for primary use case
  raw_quote?: string;
  source?: string;
}

export interface LaptopRecommendationCard {
  device: LaptopDevice;
  rank: number;
  final_score: number;
  use_case_scores: Partial<Record<LaptopUseCase, number>>;
  signal_breakdown: LaptopSignalBreakdownItem[];
  recommended_sku: LaptopSKU | null;
  why_recommended: string;
  watch_out: string[];
  data_staleness_warning: boolean;
}

// ─── Shared signal value type (phone + headphone) ─────────────────────────────

export interface SignalValue {
  value_normalized: number; // 0-10
  raw_quote?: string;
  source: string;
  months_old?: number;
}

// ─── Smartphone types ─────────────────────────────────────────────────────────

export type SmartphoneUseCase =
  | "photography"
  | "gaming"
  | "business"
  | "everyday"
  | "budget_value";

export interface SmartphoneSKU {
  id: string;
  storage_gb: number;
  color?: string;
  price_usd: number;
}

export interface SmartphoneDevice {
  id: string;
  name: string;
  brand: string;
  os: "ios" | "android";
  price_usd: number;
  display_size: number;
  weight_g: number;
  cpu: string;
  skus: SmartphoneSKU[];
  signals: {
    camera_main: SignalValue;
    camera_video: SignalValue;
    battery_life: SignalValue;
    display_quality: SignalValue;
    performance: SignalValue;
    software_support: SignalValue;
    connectivity: SignalValue;
    build_quality: SignalValue;
    value_for_money: SignalValue;
  };
  last_verified: string;
}

export interface SmartphoneIntent extends BaseIntent {
  category: "smartphone";
  use_cases: SmartphoneUseCase[];
  budget_usd_max: number | null;
  budget_usd_min: number | null;
  os_preference: "ios" | "android" | "any";
  avoid_brands: string[];
  needs_use_case_info: boolean;
  mentioned_models: string[];
}

export interface SmartphoneSignalBreakdownItem {
  signal_type: string;
  label: string;
  score: number;
  weight: number;
  raw_quote?: string;
  source?: string;
}

export interface SmartphoneRecommendationCard {
  device: SmartphoneDevice;
  rank: number;
  final_score: number;
  use_case_scores: Partial<Record<SmartphoneUseCase, number>>;
  signal_breakdown: SmartphoneSignalBreakdownItem[];
  recommended_sku: SmartphoneSKU | null;
  why_recommended: string;
  watch_out: string[];
  data_staleness_warning: boolean;
}

// ─── Headphone types ──────────────────────────────────────────────────────────

export type HeadphoneUseCase =
  | "commute"
  | "work_from_home"
  | "audiophile"
  | "sport"
  | "casual";

export type HeadphoneFormFactor = "over_ear" | "in_ear" | "on_ear";

export interface HeadphoneSKU {
  id: string;
  color: string;
  price_usd: number;
}

export interface HeadphoneDevice {
  id: string;
  name: string;
  brand: string;
  form_factor: HeadphoneFormFactor;
  wireless: boolean;
  price_usd: number;
  weight_g: number;
  skus: HeadphoneSKU[];
  signals: {
    noise_cancellation: SignalValue;
    sound_quality: SignalValue;
    bass_response: SignalValue;
    soundstage: SignalValue;
    comfort_long_wear: SignalValue;
    call_quality: SignalValue;
    battery_life: SignalValue;
    codec_support: SignalValue;
    multipoint_connection: SignalValue;
    value_for_money: SignalValue;
  };
  last_verified: string;
}

export interface HeadphoneIntent extends BaseIntent {
  category: "headphone";
  use_cases: HeadphoneUseCase[];
  budget_usd_max: number | null;
  budget_usd_min: number | null;
  form_factor_preference: HeadphoneFormFactor | "any";
  wireless_required: boolean | null;
  avoid_brands: string[];
  needs_use_case_info: boolean;
  mentioned_models: string[];
}

export interface HeadphoneSignalBreakdownItem {
  signal_type: string;
  label: string;
  score: number;
  weight: number;
  raw_quote?: string;
  source?: string;
}

export interface HeadphoneRecommendationCard {
  device: HeadphoneDevice;
  rank: number;
  final_score: number;
  use_case_scores: Partial<Record<HeadphoneUseCase, number>>;
  signal_breakdown: HeadphoneSignalBreakdownItem[];
  why_recommended: string;
  watch_out: string[];
  data_staleness_warning: boolean;
}
