/**
 * lib/core/cend-adapter · C-end → lib/core bridge
 *
 * The C-end UI builds BookingJobStep[] with legacy camelCase body fields
 * (`restaurantName`, `cabinClass`, `returnDate`, inline `profile`). lib/core
 * speaks the declarative ExecutionJobRequest shape with snake_case fields.
 * This adapter re-shapes a step's body so that runUniversalStep's dual-gate
 * (in /api/booking-jobs/[id]/start) routes it through lib/core's
 * runExecutionJobWithRecovery instead of the legacy recovery loop.
 *
 * Used today by `app/api/booking-jobs/create-trip/route.ts` and
 * `app/api/booking-jobs/route.ts` (POST direct-booking) when
 * USE_CORE_EXECUTOR_FOR_CEND=true. Per-step (not per-trip): every supported
 * scenario in a multi-step trip gets independently re-shaped + marked.
 *
 * All four current scenarios (restaurant / hotel / flight / activity) are
 * supported. Activity expects the C-end caller (ActivityCard, create-trip,
 * rooms-execute) to have already resolved a SeatGeek / Ticketmaster deep
 * link — it gets passed through as ActivityBookingParams.booking_link.
 *
 * What this file does NOT do:
 *   - Payment profile mapping — inline profile is the contact layer only;
 *     card data still goes through lib/db profile lookup inside executor
 *   - Multi-step trip orchestration — caller (create-trip) keeps assembling
 *     steps[] and calls createBookingJob once; this file only re-shapes
 *     individual step bodies
 */

import type { BookingJobStep } from "@/lib/db";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import type {
  ExecutionParams,
  ExecutionScenario,
  RestaurantBookingParams,
  HotelBookingParams,
  FlightBookingParams,
  ActivityBookingParams,
} from "@/lib/core";

// ─── Public API ──────────────────────────────────────────────────────────────

/** Scenarios lib/core/execution can run today. */
export const CORE_SUPPORTED_SCENARIOS: ReadonlyArray<ExecutionScenario> = [
  "restaurant",
  "hotel",
  "flight",
  "activity",
] as const;

// 2026-05-02: re-introducing the dual-marker isolation that commit 4d0496f
// had ripped out. The justification for the rip-out was "no phantom worker
// exists" — but the next round of audit_logs showed a /app/src/... stack
// trace with `usingCloud:true` and Browserbase 401 errors after the user
// rotated the Browserbase key. That stack trace cannot come from this
// machine (Windows path is C:\\Users\\Gzw19\\..., no BROWSERBASE_API_KEY in
// .env.local). It is a real Linux Docker container we have not located,
// running an older build of this repo, racing the local worker via
// `FOR UPDATE SKIP LOCKED` against the same Neon DB.
//
// 2026-05-02 (round 2): Job 811819ae proved phantom could STILL claim
// "lib/core/execution-local" rows AND reject them with the legacy-shape
// validator error in 1.8s — meaning phantom's deployment has the post-
// 43fba56 CORE_EXECUTION_SOURCE export but an INCONSISTENT or older
// isCoreExecutionSource. To lock phantom out completely we now suffix
// the dev marker with the local machine's hostname. Phantom (running on
// a Linux Docker container with a different hostname) computes a
// different marker and filters the queue with that — its SQL `=` test
// against my rows cannot match.
//
// Production path is unchanged: NODE_ENV === "production" → plain
// "lib/core/execution". Railway worker (when shipped) and Vercel route
// both observe "production" so the production queue stays single-marker.
//
// Removal trigger: when the phantom container is found and stopped, flip
// this back to a single constant `"lib/core/execution"` everywhere.
function deriveDevMarker(): string {
  // Static imports are intentional. The worker runs under ESM/tsx where
  // `require` is undefined; a dynamic-require fallback silently produced the
  // legacy marker and let phantom workers keep stealing local jobs.
  const hash = createHash("sha256").update(hostname()).digest("hex").slice(0, 10);
  return `lib/core/execution-local-${hash}`;
}

export const CORE_EXECUTION_SOURCE =
  process.env.NODE_ENV === "production"
    ? "lib/core/execution"
    : deriveDevMarker();

// Accept any of:
//   - "lib/core/execution"           — production marker
//   - "lib/core/execution-local"     — legacy dev marker (in-flight rows from before this commit)
//   - "lib/core/execution-local-*"   — hostname-scoped dev marker (new)
export function isCoreExecutionSource(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return (
    value === "lib/core/execution" ||
    value === "lib/core/execution-local" ||
    value.startsWith("lib/core/execution-local-")
  );
}

// 2026-05-02 (round 3): Job e6543ee3 proved phantom doesn't filter
// __source at all — phantom's claimOne does plain `WHERE status='pending'`
// and grabs anything that's pending, regardless of marker. Round-2's
// hostname-scoped __source is therefore not enough.
//
// Round-3 partition: change the STATUS STRING in dev so phantom's
// hardcoded `WHERE status='pending'` literal cannot match. Phantom's
// code is fixed; we control which strings the local route writes. By
// writing `pending_local` in dev (instead of `pending`), phantom's
// SELECT cannot match the row at all — it remains queue-invisible.
//
// Production stays on `pending` so the Railway worker (when it ships
// hotel/flight/activity) and the existing prod queue keep working
// unchanged.
//
// Worker's claimOne SQL must use this same constant so dev rows are
// claimed by local. The route's auto-stamp + retry paths must also
// write this value for new rows.
export const PENDING_QUEUE_STATUS =
  process.env.NODE_ENV === "production" ? "pending" : "pending_local";

// Backward-compat: a worker should ALSO drain rows that are stuck in
// plain "pending" (e.g. legacy in-flight rows, or a dev shell that
// briefly ran without the env). The list is ordered by preference —
// local worker prefers PENDING_QUEUE_STATUS, then falls back. In dev
// mode we deliberately do NOT fall back to "pending" because phantom
// will already have claimed those — we leave them alone.
export const CLAIMABLE_PENDING_STATUSES: readonly string[] =
  PENDING_QUEUE_STATUS === "pending" ? ["pending"] : ["pending_local"];

export function isCoreSupported(stepType: BookingJobStep["type"]): boolean {
  return (CORE_SUPPORTED_SCENARIOS as readonly string[]).includes(stepType);
}

/**
 * Re-shape a C-end BookingJobStep so the dual-gate in
 * runUniversalStep (start route) detects __source="lib/core/execution"
 * and dispatches through runExecutionJobWithRecovery.
 *
 * Original camelCase fields are converted to ExecutionParams shape; profile
 * + profileId are preserved on the body so the executor can still resolve
 * card data / billing / passport from DB.
 *
 * Throws if step.type isn't core-supported (caller should guard via
 * isCoreSupported), or if a required field is missing — caller should
 * have validated upstream when building the step.
 */
export function markStepForCore(step: BookingJobStep): BookingJobStep {
  if (!isCoreSupported(step.type)) {
    throw new Error(
      `markStepForCore: step type "${step.type}" not supported by lib/core. ` +
        `Use isCoreSupported() to gate.`,
    );
  }

  const body = step.body as Record<string, unknown>;
  const params = convertBodyToParams(step.type, body);
  const profileId = typeof body.profileId === "number" ? body.profileId : undefined;
  const profile = body.profile;

  // Preserve out-of-band fields that the executor still needs to honor:
  //   - fallback_policy: per-case ±X-min time tolerance + platform-switch
  //     intent; benchmark cases set this and stagehand-executor reads it
  //     as `input.fallbackPolicy` (line 3962). Without this passthrough,
  //     ±0 strict cases like Don Angie 006 would fall back to default
  //     ±90 and lose signal.
  //   - startUrl: explicit booking-platform URL (canonical /r/<slug> or
  //     vanity URL for OT, /cities/.../venues/<slug> for Resy). Without
  //     this passthrough, the executor would always rebuild a generic OT
  //     search URL via buildRestaurantContext, defeating the per-case
  //     URL choice (run 13 case 022-025 hit this — Tock URLs got
  //     overwritten to OT search).
  const fallbackPolicy = body.fallback_policy as unknown;
  const startUrl = typeof body.startUrl === "string" ? body.startUrl : undefined;
  const consent = body.consent as unknown;

  return {
    ...step,
    body: {
      scenario: step.type,
      params,
      ...(profileId !== undefined ? { profileId } : {}),
      ...(profile ? { profile } : {}),
      ...(fallbackPolicy !== undefined ? { fallback_policy: fallbackPolicy } : {}),
      ...(startUrl !== undefined ? { startUrl } : {}),
      ...(consent !== undefined ? { consent } : {}),
      // Marker that runUniversalStep watches for dual-gate dispatch.
      __source: CORE_EXECUTION_SOURCE,
    },
  };
}

// ─── Internals: per-scenario shape conversion ────────────────────────────────

function convertBodyToParams(
  scenario: BookingJobStep["type"],
  body: Record<string, unknown>,
): ExecutionParams["params"] {
  switch (scenario) {
    case "restaurant":
      return convertRestaurant(body);
    case "hotel":
      return convertHotel(body);
    case "flight":
      return convertFlight(body);
    case "activity":
      return convertActivity(body);
    default:
      throw new Error(`convertBodyToParams: unsupported scenario "${scenario}"`);
  }
}

function convertRestaurant(body: Record<string, unknown>): RestaurantBookingParams {
  const startUrl = typeof body.startUrl === "string" ? body.startUrl : undefined;
  const fallbackPolicyRaw = body.fallback_policy;
  const fallbackPolicy = (fallbackPolicyRaw && typeof fallbackPolicyRaw === "object")
    ? (fallbackPolicyRaw as RestaurantBookingParams["fallback_policy"])
    : undefined;
  return {
    restaurant_name: expectString(body, "restaurantName"),
    city: expectString(body, "city"),
    date: expectString(body, "date"),
    time: expectString(body, "time"),
    covers: expectNumber(body, "covers"),
    ...(startUrl !== undefined ? { startUrl } : {}),
    ...(fallbackPolicy !== undefined ? { fallback_policy: fallbackPolicy } : {}),
  };
}

function convertHotel(body: Record<string, unknown>): HotelBookingParams {
  return {
    hotel_name: expectString(body, "hotel_name"),
    city: expectString(body, "city"),
    checkin: expectString(body, "checkin"),
    checkout: expectString(body, "checkout"),
    adults: expectNumber(body, "adults"),
  };
}

function convertFlight(body: Record<string, unknown>): FlightBookingParams {
  const return_date = optionalString(body, "returnDate");
  const cabin_class = normalizeCabin(optionalString(body, "cabinClass"));
  const targetAirline = optionalString(body, "targetAirline");
  const targetPrice =
    typeof body.targetPrice === "number" && Number.isFinite(body.targetPrice)
      ? body.targetPrice
      : undefined;
  const targetDepartureTime = optionalString(body, "targetDepartureTime");
  const targetFlightNumber = optionalString(body, "targetFlightNumber");

  return {
    origin: expectString(body, "origin"),
    dest: expectString(body, "dest"),
    date: expectString(body, "date"),
    passengers: expectNumber(body, "passengers"),
    ...(return_date ? { return_date } : {}),
    ...(cabin_class ? { cabin_class } : {}),
    ...(targetAirline ? { targetAirline } : {}),
    ...(targetPrice !== undefined ? { targetPrice } : {}),
    ...(targetDepartureTime ? { targetDepartureTime } : {}),
    ...(targetFlightNumber ? { targetFlightNumber } : {}),
  };
}

function convertActivity(body: Record<string, unknown>): ActivityBookingParams {
  // C-end activity steps (ActivityCard / create-trip buildActivityStep /
  // rooms-execute) put the SeatGeek/Ticketmaster deep link in `startUrl`
  // and the agent prompt in `task`. lib/core's ActivityBookingParams
  // takes them as `booking_link` + `task` so the executor can stage them.
  // Other body keys (activity_name / venue_name / event_date / num_tickets /
  // city) line up with our scenario contract.
  return {
    event_name: expectString(body, "activity_name"),
    city: expectString(body, "city"),
    event_date: expectString(body, "event_date"),
    num_tickets: expectNumber(body, "num_tickets"),
    booking_link: expectString(body, "startUrl"),
    ...(typeof body.task === "string" && body.task.trim() ? { task: body.task } : {}),
  };
}

// Map historical Expedia-style cabin aliases ("coach", "premiumcoach") that
// the legacy create-trip path emitted, plus the canonical lib/core values.
function normalizeCabin(
  raw: string | undefined,
): FlightBookingParams["cabin_class"] {
  if (!raw) return undefined;
  const c = raw.toLowerCase();
  if (c === "economy" || c === "premium_economy" || c === "business" || c === "first") return c;
  if (c === "coach") return "economy";
  if (c === "premiumcoach") return "premium_economy";
  return undefined;
}

function expectString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`markStepForCore: missing required string field "${key}"`);
  }
  return v;
}

function expectNumber(body: Record<string, unknown>, key: string): number {
  const v = body[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`markStepForCore: missing required number field "${key}"`);
  }
  return v;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  return typeof v === "string" && v.trim() ? v : undefined;
}
