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
 * Used today by `app/api/booking-jobs/create-trip/route.ts` when
 * USE_CORE_EXECUTOR_FOR_CEND=true. Per-step (not per-trip): restaurant +
 * hotel + flight steps get marked; activity steps stay on the legacy path
 * because lib/core/execution doesn't support activity yet (it routes through
 * lib/agent-runtime/skills/find-activity, which has its own SkillContext
 * shape that ExecutionContext doesn't carry — see Week 6 backlog).
 *
 * What this file does NOT do:
 *   - Activity conversion — lib/core throws "not supported yet" (W6 backlog)
 *   - Payment profile mapping — inline profile is the contact layer only;
 *     card data still goes through lib/db profile lookup inside executor
 *   - Multi-step trip orchestration — caller (create-trip) keeps assembling
 *     steps[] and calls createBookingJob once; this file only re-shapes
 *     individual step bodies
 */

import type { BookingJobStep } from "@/lib/db";
import type {
  ExecutionParams,
  ExecutionScenario,
  RestaurantBookingParams,
  HotelBookingParams,
  FlightBookingParams,
} from "@/lib/core";

// ─── Public API ──────────────────────────────────────────────────────────────

/** Scenarios lib/core/execution can run today. Activity excluded — see file header. */
export const CORE_SUPPORTED_SCENARIOS: ReadonlyArray<ExecutionScenario> = [
  "restaurant",
  "hotel",
  "flight",
] as const;

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

  return {
    ...step,
    body: {
      scenario: step.type,
      params,
      ...(profileId !== undefined ? { profileId } : {}),
      ...(profile ? { profile } : {}),
      // Marker that runUniversalStep watches for dual-gate dispatch.
      __source: "lib/core/execution",
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
    default:
      throw new Error(`convertBodyToParams: unsupported scenario "${scenario}"`);
  }
}

function convertRestaurant(body: Record<string, unknown>): RestaurantBookingParams {
  return {
    restaurant_name: expectString(body, "restaurantName"),
    city: expectString(body, "city"),
    date: expectString(body, "date"),
    time: expectString(body, "time"),
    covers: expectNumber(body, "covers"),
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
