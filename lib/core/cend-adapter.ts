/**
 * lib/core/cend-adapter · C-end → lib/core bridge
 *
 * The C-end UI builds BookingJobStep[] with legacy camelCase body fields
 * (`restaurantName`, `covers`, inline `profile`). lib/core/execution speaks
 * the declarative ExecutionJobRequest shape. This adapter bridges them.
 *
 * Used today by `app/api/booking-jobs/create-trip/route.ts` under the
 * USE_CORE_EXECUTOR_FOR_CEND env flag — only for single-restaurant trips
 * (the smallest possible dogfood surface). When the flag is on AND the
 * trip has exactly one restaurant step AND nothing else, create-trip
 * takes this adapter path; otherwise falls back to legacy createBookingJob.
 *
 * What this file does NOT do:
 *   - Multi-step / multi-scenario trips (Week 4 scope)
 *   - Hotel / flight / activity conversion (restaurant first; extend later)
 *   - Payment profile mapping (inline profile is the contact layer only —
 *     card data still goes through lib/db profile lookup inside executor)
 */

import type { BookingJobStep, BookingJob } from "@/lib/db";
import type { BookingProfile } from "@/lib/booking-autopilot/types";
import { createJob, type ExecutionJobRequest } from "@/lib/core";

// C-end profile payload shape (from create-trip route). Wider than
// BookingProfile (nulls allowed) — we coerce below.
interface CendProfilePayload {
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
}

interface CendRestaurantBody {
  restaurantName: string;
  city: string;
  date: string;  // YYYY-MM-DD
  time: string;  // HH:MM
  covers: number;
  profileId?: number;
  profile?: CendProfilePayload;
}

export interface CreateJobViaCoreMeta {
  userId: string;
  sessionId: string;
  tripLabel: string;
  jobId: string;
}

/**
 * Convert a restaurant-type BookingJobStep from create-trip into an
 * ExecutionJobRequest and hand off to lib/core.createJob. The resulting
 * BookingJob row will carry `__source="lib/core/execution"` in step.body,
 * which is the marker the dual-gate in `[id]/start/route.ts` watches for
 * to dispatch to `runUniversalStepViaCore` (Week 2).
 *
 * Throws if the step isn't a restaurant step or fields are missing. The
 * caller (create-trip) should guard on step.type first.
 */
export async function createJobViaCore(
  step: BookingJobStep,
  meta: CreateJobViaCoreMeta,
): Promise<BookingJob> {
  if (step.type !== "restaurant") {
    throw new Error(
      `createJobViaCore currently only supports restaurant steps (got ${step.type}). ` +
      `Extend this adapter when you're ready to dogfood hotel/flight/activity.`,
    );
  }

  const body = step.body as Partial<CendRestaurantBody>;
  const { restaurantName, city, date, time, covers, profileId, profile } = body;

  if (!restaurantName || !city || !date || !time || typeof covers !== "number") {
    throw new Error(
      `createJobViaCore: step.body missing required restaurant fields. Got: ${JSON.stringify({
        restaurantName: !!restaurantName,
        city: !!city,
        date: !!date,
        time: !!time,
        covers: typeof covers,
      })}`,
    );
  }

  const request: ExecutionJobRequest = {
    request: {
      scenario: "restaurant",
      params: {
        restaurant_name: restaurantName,
        city,
        date,
        time,
        covers,
      },
    },
    ...(profileId ? { profileId } : {}),
    ...(profile ? { profile: coerceProfile(profile) } : {}),
    clientMetadata: {
      agentId: "onegent-cend",
      userId: meta.userId,
      sessionId: meta.sessionId,
    },
  };

  return createJob(request, {
    jobId: meta.jobId,
    userId: meta.userId,
    sessionId: meta.sessionId,
    tripLabel: meta.tripLabel,
  });
}

/**
 * Narrow C-end's nullable phone/last_name back to required strings. Empty
 * string is the safe default — downstream BookingProfile consumers already
 * handle empty phone for venues that don't need it.
 */
function coerceProfile(p: CendProfilePayload): BookingProfile {
  return {
    first_name: p.first_name,
    last_name: p.last_name ?? "",
    email: p.email,
    phone: p.phone ?? "",
  };
}
