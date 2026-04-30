/**
 * lib/core/execution/executor · runExecutionJob (single-attempt adapter)
 *
 * Bridges the declarative ExecutionJobRequest (B 端 channel-agnostic form)
 * to the imperative BrowserTaskInput that lib/booking-autopilot expects,
 * then calls runBrowserTask and maps the result back.
 *
 * THIS IS THE SINGLE-ATTEMPT LAYER.
 *   - retry / time fallback / venue switch live in lib/core/execution/recovery.ts (US-007)
 *   - provider fallback chain (OpenTable→Resy→Yelp→website) lives there too
 *
 * consent is accepted and forwarded but NOT decision-gated at this layer
 * — recovery.ts calls validateConsent() at each decision point. Keeping
 * consent in the signature now so recovery.ts doesn't require an executor
 * signature change.
 */

import type { BrowserTaskInput, BookingProfile, BrowserTaskStatus } from "@/lib/booking-autopilot/types";
import { runBrowserTask } from "@/lib/booking-autopilot/stagehand-executor";
import {
  buildRestaurantTask,
  buildHotelTask,
} from "@/lib/booking-autopilot/core/task-builders";
import { buildBookingComUrl } from "@/lib/agent/planners/booking-links";
import { getBookingProfileById, getDefaultBookingProfile } from "@/lib/db";
import type { DecisionLogEntry } from "@/lib/db";

import { writeAudit } from "@/lib/core/audit/audit-log";
import type { AuditEventType } from "@/lib/core/audit/types";
import { DEFAULT_CONSENT_POLICY } from "@/lib/core/consent/default-policy";
import type { ConsentPolicy } from "@/lib/core/consent/types";
import type {
  ExecutionJobRequest,
  ExecutionJobResult,
  ExecutionJobStatus,
  ExecutionParams,
  ActivityBookingParams,
  FlightBookingParams,
  HotelBookingParams,
  RestaurantBookingParams,
} from "./types";

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Context the caller provides in addition to the declarative request:
 *   - jobId: the BookingJob row this attempt belongs to (DB row id; caller
 *     creates the row via lib/core/execution/job-manager in US-006)
 *   - userId: Clerk user_id, used for DB profile lookup when profile isn't
 *     inlined in the request. null for B 端 callers without a Clerk session.
 *   - stepIndex: 0 for single-step jobs; multi-step trips pass 0..N-1
 */
export interface ExecutionContext {
  jobId: string;
  userId?: string | null;
  stepIndex?: number;
}

/**
 * Execute one attempt of a booking request through the Autopilot stack.
 * No retry / fallback — on failure returns an ExecutionJobResult with
 * status "error" / "no_availability" / etc. Caller (recovery.ts in US-007)
 * decides whether to retry.
 */
export async function runExecutionJob(
  request: ExecutionJobRequest,
  ctx: ExecutionContext,
): Promise<ExecutionJobResult> {
  const policy: ConsentPolicy = (request.consent as ConsentPolicy | undefined) ?? DEFAULT_CONSENT_POLICY;
  const stepIndex = ctx.stepIndex ?? 0;
  const createdAt = new Date().toISOString();

  await writeAudit({
    jobId: ctx.jobId,
    type: "job_started",
    stepIndex,
    message: `Starting ${request.request.scenario} booking attempt`,
    details: { scenario: request.request.scenario },
  });

  // ── Resolve profile (inline > DB profileId > default) ──
  let profile: BookingProfile;
  try {
    profile = await resolveProfile(request, ctx.userId ?? null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Profile resolution failed";
    await writeAudit({
      jobId: ctx.jobId,
      type: "job_failed",
      stepIndex,
      message: `Profile resolution failed: ${message}`,
    });
    return errorResult(ctx.jobId, message, createdAt);
  }

  // ── Flight-specific precondition: passport required ──
  // Mirrors route.ts:519-530. Without passport_number the Stagehand agent
  // will trundle through the search + fare + review pages only to fail at
  // the passenger-info form with a confusing error. Better to short-circuit
  // here with a clear actionable message the caller can surface to their user.
  if (request.request.scenario === "flight" && !profile.passport_number) {
    const missingDocs: string[] = [];
    if (!profile.passport_number) missingDocs.push("passport number");
    if (!profile.date_of_birth) missingDocs.push("date of birth");
    const missingMsg = `Missing travel documents: ${missingDocs.join(", ")} required for flight booking. Please add these in Settings → My Profile → Travel Documents, then try booking again.`;
    await writeAudit({
      jobId: ctx.jobId,
      type: "job_failed",
      stepIndex,
      message: `Flight booking blocked: missing ${missingDocs.join(", ")}`,
      details: { missingDocs },
    });
    return errorResult(ctx.jobId, missingMsg, createdAt);
  }

  // ── Build startUrl + task from declarative params ──
  let startUrl: string;
  let task: string;
  try {
    ({ startUrl, task } = buildStartUrlAndTask(request.request, profile));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not build task";
    await writeAudit({
      jobId: ctx.jobId,
      type: "job_failed",
      stepIndex,
      message: `Task construction failed: ${message}`,
    });
    return errorResult(ctx.jobId, message, createdAt);
  }

  const input: BrowserTaskInput = {
    startUrl,
    task,
    profile,
    jobId: ctx.jobId,
    stepIndex,
    profileId: request.profileId,
    // Forward flight-specific hints so the Stagehand executor can target
    // the right flight card on the Expedia search results page.
    ...(isFlight(request.request)
      ? {
          targetAirline: request.request.params.targetAirline,
          targetPrice: request.request.params.targetPrice,
          targetDepartureTime: request.request.params.targetDepartureTime,
          targetFlightNumber: request.request.params.targetFlightNumber,
        }
      : {}),
  };

  await writeAudit({
    jobId: ctx.jobId,
    type: "step_started",
    stepIndex,
    message: `Navigating to ${shortHost(startUrl)}`,
    details: { startUrl, scenario: request.request.scenario },
  });

  // ── Run the browser task ──
  const taskResult = await runBrowserTask(input);
  const jobStatus = mapTaskStatusToJobStatus(taskResult.status);

  const result: ExecutionJobResult = {
    jobId: ctx.jobId,
    status: jobStatus,
    handoffUrl: taskResult.handoffUrl,
    sessionUrl: taskResult.sessionUrl,
    summary: taskResult.summary,
    screenshotBase64: taskResult.screenshotBase64,
    decisionLog: buildSummaryLog(taskResult.debugTrace, createdAt),
    error: taskResult.error,
    availableSlots: taskResult.availableSlots,
    createdAt,
    updatedAt: new Date().toISOString(),
    completedAt: isTerminalStatus(jobStatus) ? new Date().toISOString() : undefined,
    // Single-attempt adapter — US-007 recovery.ts overrides these
    // when it wraps runExecutionJob in a retry/fallback loop.
    attemptCount: 1,
    usedFallback: false,
  };

  await writeAudit({
    jobId: ctx.jobId,
    type: mapJobStatusToAuditEvent(jobStatus),
    stepIndex,
    message: taskResult.summary,
    details: {
      status: jobStatus,
      ...(taskResult.error ? { error: taskResult.error } : {}),
      ...(taskResult.availableSlots?.length ? { availableSlots: taskResult.availableSlots } : {}),
    },
  });

  // policy is accepted for forward-compat but not gating any decision
  // in this single-attempt layer. Reference it so linters don't flag
  // the import as unused and readers understand its role.
  void policy;

  return result;
}

// ─── Exported helpers (reused by US-007 recovery.ts) ─────────────────────────

/**
 * Resolve the effective BookingProfile for a request, in precedence order:
 *   1. request.profile (inline) — used as-is when caller brings its own
 *   2. request.profileId — fetched from booking_profiles, decrypted card data merged
 *   3. userId default — lib/db.getDefaultBookingProfile(userId)
 *
 * Throws if none of the three resolve — caller maps to a job_failed audit.
 *
 * Note: when inline profile is provided AND profileId is also set, the
 * inline fields take precedence for contact info (first_name/last_name/
 * email/phone/address), but sensitive fields (card_*, travel docs) come
 * from the DB record. This mirrors route.ts:487-514 behavior exactly.
 */
export async function resolveProfile(
  request: ExecutionJobRequest,
  userId: string | null,
): Promise<BookingProfile> {
  // Path 1: inline profile + no DB merge (B 端 callers without profileId)
  if (request.profile && !request.profileId) {
    return request.profile;
  }

  // Path 2 / 3: need DB access; requires userId
  if (!userId && !request.profileId) {
    // No user context AND no inline profile AND no profileId → can't resolve.
    if (request.profile) return request.profile;
    throw new Error(
      "Cannot resolve profile: no inline profile, no profileId, no userId",
    );
  }

  const dbProfile = request.profileId
    ? await getBookingProfileById(request.profileId, userId ?? "", true)
    : await getDefaultBookingProfile(userId ?? "", true);

  if (!dbProfile && request.profile) {
    // DB lookup missed but caller did provide inline — use inline.
    return request.profile;
  }

  if (!dbProfile) {
    throw new Error(
      request.profileId
        ? `Profile ${request.profileId} not found`
        : "No default booking profile configured",
    );
  }

  // Merge inline (if present) with DB (mirrors route.ts:487-514).
  const inline = (request.profile ?? {}) as Partial<BookingProfile>;
  return {
    first_name: inline.first_name || dbProfile.first_name,
    last_name: inline.last_name || dbProfile.last_name,
    email: inline.email || dbProfile.email,
    phone: inline.phone || dbProfile.phone,
    address_line1: inline.address_line1 || dbProfile.address_line1,
    city: inline.city || dbProfile.city,
    state: inline.state || dbProfile.state,
    zip: inline.zip || dbProfile.zip,
    country: inline.country || dbProfile.country,
    card_name: dbProfile.card_name,
    card_number: dbProfile.card_number,
    card_expiry: dbProfile.card_expiry,
    // Hotel-preference fields (room_preference / breakfast_preference / bed_type)
    // are NOT stored in the DB booking profile — they come from the request
    // context (inline) or from the task-builder's own defaults. Pass through
    // inline values; no DB fallback exists. Mirrors route.ts:487-514 exactly.
    room_preference: inline.room_preference,
    breakfast_preference: inline.breakfast_preference,
    bed_type: inline.bed_type,
    date_of_birth: dbProfile.date_of_birth,
    nationality: dbProfile.nationality,
    passport_number: dbProfile.passport_number,
    passport_expiry: dbProfile.passport_expiry,
    passport_country: dbProfile.passport_country,
    known_traveler_number: dbProfile.known_traveler_number,
    driver_license_number: dbProfile.driver_license_number,
    driver_license_state: dbProfile.driver_license_state,
  };
}

/**
 * Map declarative ExecutionParams → imperative { startUrl, task } pair.
 * Scenario-specific URL construction and task prompts mirror the existing
 * route.ts logic exactly so behavior is preserved when US-009 swaps C 端.
 *
 * Activity differs from restaurant/hotel/flight: lib/core doesn't construct
 * the startUrl itself — caller passes booking_link (SeatGeek / Ticketmaster
 * deep link from prior search). Future enhancement: omit booking_link and
 * have buildActivityContext run its own SeatGeek search.
 */
export function buildStartUrlAndTask(
  params: ExecutionParams,
  profile: BookingProfile,
): { startUrl: string; task: string } {
  switch (params.scenario) {
    case "restaurant":
      return buildRestaurantContext(params.params, profile);
    case "hotel":
      return buildHotelContext(params.params, profile);
    case "flight":
      return buildFlightContext(params.params, profile);
    case "activity":
      return buildActivityContext(params.params, profile);
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

function buildRestaurantContext(
  p: RestaurantBookingParams,
  profile: BookingProfile,
): { startUrl: string; task: string } {
  // Yelp-first: Yelp has near-universal restaurant coverage (way better
  // than OpenTable's catalog) and its "Make a Reservation" button on the
  // biz page auto-redirects to whichever platform the venue actually
  // uses (OpenTable / Resy / Tock / SevenRooms / venue widget). Yelp
  // provider clicks the redirect; the destination provider takes over
  // form-fill from there.
  //
  // Falls back to OpenTable then Resy via tryProviderFallbackChain when
  // Yelp can't find the venue or its Reserve button doesn't appear.
  //
  // find_desc=name+city scopes search to the right metro and biases
  // toward the specific restaurant, not generic listings.
  const findDesc = p.city ? `${p.restaurant_name} ${p.city}` : p.restaurant_name;
  const findLoc = p.city || "";
  const startUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(findDesc)}${findLoc ? `&find_loc=${encodeURIComponent(findLoc)}` : ""}`;
  const { task } = buildRestaurantTask({
    restaurantName: p.restaurant_name,
    city: p.city,
    date: p.date,
    time: p.time,
    covers: p.covers,
    profile,
  });
  return { startUrl, task };
}

function buildHotelContext(
  p: HotelBookingParams,
  profile: BookingProfile,
): { startUrl: string; task: string } {
  // Mirrors route.ts:382-407. Canonical URL builder embeds checkin/checkout
  // as Booking.com-native params — a bare ?ss= search defaults to "tonight".
  const startUrl = buildBookingComUrl({
    hotelName: p.hotel_name,
    city: p.city,
    checkin: p.checkin,
    checkout: p.checkout,
    adults: p.adults,
    rooms: 1,
  });
  const { task } = buildHotelTask({
    hotelName: p.hotel_name,
    city: p.city,
    checkin: p.checkin,
    checkout: p.checkout,
    adults: p.adults,
    profile,
    roomPreference: p.room_preference,
  });
  return { startUrl, task };
}

function buildFlightContext(
  p: FlightBookingParams,
  _profile: BookingProfile,
): { startUrl: string; task: string } {
  // Mirrors route.ts:413-463. Uses Expedia (not Kayak) because Expedia
  // shares the guest/payment form logic with hotel booking.
  const tripType = p.return_date ? "roundtrip" : "oneway";
  const cabinMap: Record<string, string> = {
    economy: "coach",
    business: "business",
    first: "first",
    premium_economy: "premiumcoach",
  };
  const cabin = p.cabin_class ? cabinMap[p.cabin_class] ?? "coach" : "coach";
  const returnLeg = p.return_date
    ? `&leg2=from:${p.dest},to:${p.origin},departure:${p.return_date}TANYT`
    : "";
  const startUrl = `https://www.expedia.com/Flights-Search?trip=${tripType}&leg1=from:${p.origin},to:${p.dest},departure:${p.date}TANYT${returnLeg}&passengers=adults:${p.passengers}&options=cabinclass:${cabin}&mode=search`;

  // Flight uses a longer, step-by-step task prompt instead of the generic
  // buildFlightTask() because Expedia's UI is multi-modal (fare popup +
  // bundle dismiss + skip-to-checkout) and benefits from explicit steps.
  // Mirrors route.ts:447-461 verbatim.
  const returnStr = p.return_date ? ` Return on ${p.return_date}.` : "";
  const flightId = [
    p.targetAirline,
    p.targetDepartureTime ? `departing ${p.targetDepartureTime}` : "",
    p.targetPrice ? `priced at $${p.targetPrice}` : "",
    p.targetFlightNumber ? `flight number ${p.targetFlightNumber}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const flightDesc = flightId
    ? `the ${flightId}`
    : `a ${p.cabin_class ?? "economy"} class flight from ${p.origin} to ${p.dest}`;

  const task = [
    `This is a FLIGHT BOOKING task on Expedia. You are on the Expedia flight search results page.`,
    `EXACT STEPS — follow in order:`,
    `1. FIND FLIGHT: Locate ${flightDesc} departing ${p.date}${returnStr}. Scroll through the list to find a flight card that matches the airline name and price.`,
    `2. CLICK FLIGHT: Click that flight card to open the fare selection panel/popup.`,
    `3. SELECT FARE: In the fare popup that appears, choose the cheapest/first option (e.g. "Blue Basic", "Basic Economy", or the lowest-priced fare shown). Click the "Select" button on that fare.`,
    `4. DISMISS BUNDLE POPUP: If a "Bundle & Save" or car rental popup appears, click "No thanks" to dismiss it.`,
    `5. REVIEW PAGE: You will land on a "Review your trip" page. Click "Skip to Checkout" (NOT "Next: Seats"). If only "Next: Seats" is visible, click it — but then on the Seats page click "Next: Checkout" to proceed without selecting a seat.`,
    `6. FILL PASSENGER INFO: On the checkout/traveler info page, fill in all required fields (first name, last name, email, phone, date of birth, passport number if required).`,
    `7. STOP before entering the CVV or clicking the final "Complete booking" / "Purchase" button.`,
    `Do NOT navigate to hotels, do NOT use hotel booking steps.`,
  ].join(" ");

  return { startUrl, task };
}

function buildActivityContext(
  p: ActivityBookingParams,
  _profile: BookingProfile,
): { startUrl: string; task: string } {
  // Caller (ActivityCard / create-trip / rooms-execute) already resolved the
  // SeatGeek / Ticketmaster / Vivid deep link via search APIs upstream.
  // lib/core doesn't replicate that search today — see ActivityBookingParams
  // .booking_link doc for the future-search note.
  if (!p.booking_link) {
    throw new Error(
      `buildActivityContext: booking_link required for activity "${p.event_name}". ` +
        `lib/core does not yet run its own SeatGeek/Ticketmaster search — caller must pass a deep link.`,
    );
  }

  const startUrl = p.booking_link;

  // Caller can override the prompt for vendor-specific steps; otherwise
  // lib/core builds a generic ticket-buying task that stops before CVV.
  const task =
    p.task ??
    [
      `Book ${p.num_tickets} ticket${p.num_tickets === 1 ? "" : "s"} for "${p.event_name}" on ${p.event_date}.`,
      `You are starting on the event page — find the "Find Tickets" / "Buy" button, select seats (prefer cheapest available unless a premium tier was requested), and proceed to checkout.`,
      `Fill in all guest information (first/last name, email, phone, address, zip) and card details.`,
      `Stop before entering CVV or clicking the final payment confirmation button.`,
    ].join(" ");

  return { startUrl, task };
}

// ─── Status mapping ──────────────────────────────────────────────────────────

function mapTaskStatusToJobStatus(s: BrowserTaskStatus): ExecutionJobStatus {
  switch (s) {
    case "completed":
      return "completed";
    case "paused_payment":
      return "paused_payment";
    case "needs_login":
      return "needs_login";
    case "captcha":
      return "captcha";
    case "no_availability":
      return "no_availability";
    case "error":
      return "error";
  }
}

function mapJobStatusToAuditEvent(s: ExecutionJobStatus): AuditEventType {
  switch (s) {
    case "paused_payment":
      return "job_paused_payment";
    case "completed":
      return "job_completed";
    case "pending":
    case "running":
      return "job_started";
    case "no_availability":
    case "needs_login":
    case "captcha":
    case "error":
      return "job_failed";
  }
}

function isTerminalStatus(s: ExecutionJobStatus): boolean {
  return (
    s === "paused_payment" ||
    s === "completed" ||
    s === "no_availability" ||
    s === "error" ||
    s === "needs_login" ||
    s === "captcha"
  );
}

// ─── Small utilities ─────────────────────────────────────────────────────────

function isFlight(
  p: ExecutionParams,
): p is Extract<ExecutionParams, { scenario: "flight" }> {
  return p.scenario === "flight";
}

function shortHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url.slice(0, 60);
  }
}

function buildSummaryLog(trace: string[] | undefined, createdAt: string): DecisionLogEntry[] {
  if (!trace?.length) return [];
  return [
    {
      ts: createdAt,
      type: "info",
      message: `Executor trace (${trace.length} entries)`,
      outcome: trace[trace.length - 1]?.slice(0, 120),
    },
  ];
}

function errorResult(
  jobId: string,
  errorMessage: string,
  createdAt: string,
): ExecutionJobResult {
  return {
    jobId,
    status: "error",
    summary: errorMessage,
    decisionLog: [],
    error: errorMessage,
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
    attemptCount: 1,
    usedFallback: false,
  };
}
