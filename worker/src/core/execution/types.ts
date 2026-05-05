/**
 * lib/core/execution · public contract
 *
 * Channel-agnostic types for the Execution Engine. These are the types that
 * any caller (C 端 Next.js route, 未来的 /api/v1/ REST endpoint, MCP
 * connector, direct library consumer) hands to `runExecutionJob()`.
 *
 * DESIGN NOTE: these types are deliberately MORE ABSTRACT than
 * `BrowserTaskInput` in lib/booking-autopilot/types.ts. The booking-autopilot
 * layer expects a concrete `startUrl` + natural-language `task` — i.e.
 * imperative "here's where to go and what to do". External callers (B 端
 * agents) want declarative: "I want to book this restaurant, figure out
 * the URL and the provider yourself, and handle fallback chains for me".
 *
 * lib/core/execution/executor.ts bridges the two: it takes an
 * `ExecutionJobRequest`, runs provider selection, builds the `BrowserTaskInput`
 * for each attempt, and orchestrates the OpenTable → Resy → Yelp → website
 * fallback chain internally.
 *
 * NOT in this file:
 *   - Zod runtime schemas (added in Week 3 when /api/v1/ needs them — Week 2
 *     is pure refactor, callers are all internal TypeScript)
 *   - Multi-step trip orchestration (trip packages are N × ExecutionJob,
 *     composed by a higher layer; see Week 2.5 coordination work)
 *   - Decision Room private-message → IntentState aggregation (same — belongs
 *     to lib/core/coordination/ in Week 2.5)
 */

import type { BookingProfile } from "@/lib/booking-autopilot/types";
import type { DecisionLogEntry } from "@/lib/db";
import type { ConsentPolicy } from "../consent/types";

// ─── Scenario discriminator ──────────────────────────────────────────────────

/**
 * The 4 single-category execution scenarios Onegent currently supports.
 * Maps 1:1 to the `pipelines/` and `providers/` layers in lib/booking-autopilot.
 *
 * Intentionally excludes "trip" — a trip is a composition of N ExecutionJobs
 * (one per category), not a single job. See Week 2.5 coordination layer.
 */
export type ExecutionScenario = "restaurant" | "hotel" | "flight" | "activity";

// ─── Scenario-specific params ────────────────────────────────────────────────
// Each scenario has its own params object. Using discriminated union by
// `scenario` (rather than inheritance) keeps TS narrowing clean at call sites.

export interface RestaurantBookingParams {
  /** Venue name, as a user would say it — "Le Bernardin", "Nobu Manhattan". */
  restaurant_name: string;
  /** City the venue is in. Free text — "New York", "NYC", "纽约" all accepted. */
  city: string;
  /** YYYY-MM-DD. Must be already-resolved by caller ("Friday" → "2026-05-01"). */
  date: string;
  /** HH:MM in 24h format. */
  time: string;
  /** Number of guests. */
  covers: number;

  // ── Optional hints ──
  /** "Japanese", "Italian", etc. — helps disambiguate when restaurant_name is ambiguous. */
  cuisine?: string;
  /** Neighborhood / area — "Midtown", "SoHo". */
  neighborhood?: string;
  /** Upper budget bound per person, in USD. */
  budget_per_person?: number;

  // ── Advanced directives (benchmark + power-user paths) ──
  /**
   * Explicit booking-platform URL — canonical /r/<slug>, vanity URL, or
   * Resy /cities/.../venues/<slug>. When set, overrides the executor's
   * default OT-search-by-name URL (which can mis-disambiguate venues with
   * common names). Used heavily by the benchmark dataset to point each
   * case at a specific venue page.
   */
  startUrl?: string;
  /**
   * Per-case fallback policy. `time_window_minutes` controls the ±X-min
   * tolerance the time-slot picker accepts (0 = strict exact-time, 90 =
   * default loose). Set by benchmark cases to test specific tolerance
   * regimes; chat-commit jobs leave it undefined → default ±90.
   */
  fallback_policy?: {
    time_window_minutes?: number;
    allow_platform_switch?: boolean;
    allow_venue_switch?: boolean;
    require_user_approval_before_booking?: boolean;
  };
}

export interface HotelBookingParams {
  /** Hotel brand/name — "Hilton Garden Inn Times Square". */
  hotel_name: string;
  city: string;
  /** YYYY-MM-DD. */
  checkin: string;
  /** YYYY-MM-DD. */
  checkout: string;
  adults: number;
  rooms?: number;

  // ── Optional hints ──
  star_rating?: number;
  neighborhood?: string;
  /** Upper budget bound per night, in USD. */
  budget_max_per_night?: number;
  /** Free-text room preference — "king bed, breakfast included". */
  room_preference?: string;
}

export interface FlightBookingParams {
  /** IATA code ("SFO") or city name ("San Francisco"). */
  origin: string;
  dest: string;
  /** YYYY-MM-DD outbound date. */
  date: string;
  /** YYYY-MM-DD return date; omit for one-way. */
  return_date?: string;
  passengers: number;
  cabin_class?: "economy" | "premium_economy" | "business" | "first";

  // ── Target flight hints ── (for when the caller has already picked a flight
  // from a search result and wants the executor to lock onto it)
  /** Carrier name — "American Airlines". Used to match on results list. */
  targetAirline?: string;
  /** Price in USD. Used for disambiguation. */
  targetPrice?: number;
  /** Departure time as shown on search UI — e.g. "2:54pm". */
  targetDepartureTime?: string;
  /** Flight number when available — "AA2341". */
  targetFlightNumber?: string;
}

export interface ActivityBookingParams {
  /** Event / show / team name — "Hamilton", "Taylor Swift", "Knicks". */
  event_name: string;
  city: string;
  /** YYYY-MM-DD specific performance date. */
  event_date: string;
  num_tickets: number;
  seat_type?: "premium" | "standard" | "economy";
  /** Upper budget per ticket, in USD. */
  budget_max_per_ticket?: number;

  /**
   * Direct booking URL for the event (SeatGeek / Ticketmaster / Vivid /
   * StubHub deep link). REQUIRED today — lib/core does not yet do its own
   * SeatGeek / Ticketmaster search (see Backlog: extend buildActivityContext
   * to search when omitted). C-end callers (ActivityCard, create-trip,
   * Decision Room execute) already have this URL from prior search APIs.
   */
  booking_link?: string;
  /**
   * Optional caller-built task prompt for the Stagehand agent. When omitted,
   * lib/core builds a generic "buy {num_tickets} tickets, fill guest info,
   * stop before CVV" task. Override when you need vendor-specific steps.
   */
  task?: string;
}

// ─── Discriminated union for params ──────────────────────────────────────────

export type ExecutionParams =
  | { scenario: "restaurant"; params: RestaurantBookingParams }
  | { scenario: "hotel"; params: HotelBookingParams }
  | { scenario: "flight"; params: FlightBookingParams }
  | { scenario: "activity"; params: ActivityBookingParams };

// ─── Request ─────────────────────────────────────────────────────────────────

/**
 * Hints for who / what is calling the executor. Persisted on the job record
 * and surfaced in audit logs. All fields optional — omit when unknown.
 *
 * Example B 端 values:
 *   agentId: "claude-mcp-connector" | "chatgpt-custom-gpt" | "acme-travel-app"
 *   sessionId: correlation ID to tie multiple calls to the same user session
 *   idempotencyKey: prevents double-booking when the caller retries a request
 */
export interface ClientMetadata {
  agentId?: string;
  /** End-user identifier on the caller's side — NOT our Clerk user_id. */
  userId?: string;
  sessionId?: string;
  idempotencyKey?: string;
  /**
   * Optional executor preference for benchmark / controlled rollout paths.
   * Environment overrides still win; this is only a per-request hint.
   */
  preferredExecutor?: "legacy_stagehand" | "computer_use";
}

/**
 * The top-level request an external caller (B end agent OR internal C end
 * route) hands to runExecutionJob().
 *
 * Exactly ONE of `profileId` or `profile` must be provided:
 *   - profileId: preferred (server fetches + decrypts payment data)
 *   - profile: inline, used when the caller is bringing its own user data
 *     (e.g. a B 端 agent with its own user database)
 */
export interface ExecutionJobRequest {
  /** Which kind of booking + its concrete params. */
  request: ExecutionParams;

  /** Preferred: reference to a DB row in booking_profiles. */
  profileId?: number;
  /** Alternative: inline user profile. Caller-provided, not stored. */
  profile?: BookingProfile;

  /**
   * Consent policy controlling what autonomous decisions the executor may make
   * (time adjustment, venue switch, retry, payment stop). When omitted, the
   * executor uses DEFAULT_CONSENT_POLICY from lib/core/consent/ which matches
   * today's C 端 behavior (full autonomy up to the PCI iframe boundary).
   */
  consent?: ConsentPolicy;

  /** Who's calling + optional idempotency. */
  clientMetadata?: ClientMetadata;
}

// ─── Result ──────────────────────────────────────────────────────────────────

/**
 * Job-level status — a superset of the step-level BrowserTaskStatus.
 *
 * The important one for B 端 callers is `paused_payment`: Onegent has done
 * everything up to the PCI iframe boundary; the caller's user must complete
 * payment manually via the handoffUrl.
 */
export type ExecutionJobStatus =
  | "pending"            // Created, not yet started
  | "running"            // Executor is working on it
  | "paused_payment"     // Reached payment page — handoffUrl ready for user
  | "completed"          // Fully booked (rare — only sites without a card gate)
  | "needs_otp"          // Site sent a one-time code; user/connector must provide it
  | "needs_profile_data" // User must add required booking-profile fields
  | "ready_for_confirmation" // Final non-payment confirmation is ready for user review
  | "no_availability"    // Confirmed: nothing available matching params
  | "needs_login"        // Site requires login the executor can't bypass
  | "captcha"            // Hard-blocked by CAPTCHA
  | "error";             // Unexpected failure

export type ProfileFieldId =
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "address_line1"
  | "city"
  | "state"
  | "zip"
  | "country"
  | "date_of_birth"
  | "passport_number"
  | "passport_expiry"
  | "passport_country";

export interface NeedsProfileDataPayload {
  kind: "needs_profile_data";
  scenario: ExecutionScenario;
  missing: ProfileFieldId[];
  message: string;
}

export interface ExecutionJobResult {
  /** Internal job ID — also the row ID in the booking_jobs table. */
  jobId: string;
  status: ExecutionJobStatus;

  /** URL the end-user opens to continue (payment page / confirmation / etc). */
  handoffUrl?: string;
  /** Browserbase live-view URL for debugging (cloud mode only). */
  sessionUrl?: string;
  /** Human-readable summary of what the executor did. */
  summary: string;
  /** Base64 PNG of the final page state (payment gate / no-availability screen). */
  screenshotBase64?: string;

  /** Per-decision audit trail — e.g. "Tried 7pm → no slot → adjusted to 7:30pm". */
  decisionLog: DecisionLogEntry[];
  /** How many executor attempts were made. 1 = succeeded first try. */
  attemptCount?: number;
  /** True if a fallback provider/venue/time was used. */
  usedFallback?: boolean;

  /** Error detail when status === "error". */
  error?: string;

  /** Structured profile gap the UI can render inline in chat/tasks. */
  profileGap?: NeedsProfileDataPayload;

  /**
   * For restaurant `no_availability`: alternate time slots the executor found
   * on the page (e.g. ["7:15 PM", "7:30 PM"]). Caller surfaces these so the
   * end-user can pick a different time without starting over.
   */
  availableSlots?: string[];

  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
