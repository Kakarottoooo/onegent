/**
 * POST /api/booking-jobs/create-trip
 *
 * Given a TripPackage + a user's per-category selection, construct a multi-
 * step BookingJob where each selected card (hotel, flight, restaurants[0..3],
 * activities[0..3]) becomes one BookingJobStep.
 *
 * Body:
 *   {
 *     session_id: string,
 *     trip_package: TripPackage,
 *     selection: {
 *       hotel_id: string | null,          // single-select; null = skip
 *       flight_id: string | null,
 *       restaurant_ids: string[],         // 0-3 multi-select
 *       activity_ids: string[],           // 0-3 multi-select
 *     },
 *     profile_id?: number
 *   }
 *
 * Validation:
 *   - At least 1 step must be built (else 422).
 *   - restaurant_ids + activity_ids capped at 3 each.
 *   - IDs that don't match any card in trip_package.*_options are ignored
 *     (logged, not fatal).
 *
 * Execution: the created job is picked up by /api/booking-jobs/[id]/start
 * which already parallelizes steps.length >= 2.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import {
  createBookingJob,
  getDefaultBookingProfile,
  getBookingProfileById,
  type BookingJobStep,
} from "@/lib/db";
import { buildExpediaFlightsUrl } from "@/lib/agent/planners/booking-links";
import type {
  TripPackage,
  TripSelection,
  HotelRecommendationCard,
  FlightRecommendationCard,
  RecommendationCard,
  ActivityRecommendationCard,
} from "@/lib/types";

export const maxDuration = 30;

const MAX_RESTAURANT_PICKS = 3;
const MAX_ACTIVITY_PICKS = 3;

interface CreateTripBody {
  session_id?: unknown;
  trip_package?: unknown;
  selection?: unknown;
  profile_id?: unknown;
}

type ProfilePayload = {
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
};

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: CreateTripBody | null = null;
  try {
    body = (await req.json()) as CreateTripBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body) return NextResponse.json({ error: "Empty body" }, { status: 400 });

  const sessionId =
    typeof body.session_id === "string" && body.session_id.trim() ? body.session_id.trim() : null;
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  const pkg = coerceTripPackage(body.trip_package);
  if (!pkg) {
    return NextResponse.json(
      { error: "trip_package required (must match TripPackage shape with *_options arrays)" },
      { status: 400 }
    );
  }

  const selection = coerceSelection(body.selection);
  if (!selection) {
    return NextResponse.json(
      {
        error:
          "selection required — { hotel_id, flight_id, restaurant_ids[], activity_ids[] } (hotel/flight ids nullable for skip)",
      },
      { status: 400 }
    );
  }

  // Resolve booking profile — body.profile_id wins, else user's default.
  const profileId =
    typeof body.profile_id === "number" && body.profile_id > 0 ? body.profile_id : null;
  const profile = profileId
    ? await getBookingProfileById(profileId, userId, false)
    : await getDefaultBookingProfile(userId);
  if (!profile || !profile.email || !profile.first_name) {
    return NextResponse.json(
      {
        error:
          "No complete booking profile — add your name, email, and phone in Settings → My Profile, then retry.",
      },
      { status: 412 }
    );
  }
  const profilePayload: ProfilePayload = {
    first_name: profile.first_name,
    last_name: profile.last_name,
    email: profile.email,
    phone: profile.phone,
  };

  // Build steps from selected cards. Unknown ids are silently skipped (logged).
  const steps: BookingJobStep[] = [];

  if (selection.hotel_id) {
    const card = pkg.hotel_options.find((c) => c.hotel.id === selection.hotel_id);
    if (card) {
      const step = buildHotelStep(card, pkg, profile.id, profilePayload);
      if (step) steps.push(step);
    } else {
      console.warn(`[create-trip] hotel_id=${selection.hotel_id} not in trip_package — skipping`);
    }
  }

  if (selection.flight_id) {
    const card = pkg.flight_options.find((c) => c.flight.id === selection.flight_id);
    if (card) {
      const step = buildFlightStep(card, pkg, profile.id, profilePayload);
      if (step) steps.push(step);
    } else {
      console.warn(`[create-trip] flight_id=${selection.flight_id} not in trip_package — skipping`);
    }
  }

  for (const id of selection.restaurant_ids.slice(0, MAX_RESTAURANT_PICKS)) {
    const card = pkg.restaurant_options.find((c) => c.restaurant.id === id);
    if (card) {
      const step = buildRestaurantStep(card, pkg, profile.id, profilePayload);
      if (step) steps.push(step);
    } else {
      console.warn(`[create-trip] restaurant_id=${id} not in trip_package — skipping`);
    }
  }

  for (const id of selection.activity_ids.slice(0, MAX_ACTIVITY_PICKS)) {
    const card = pkg.activity_options.find((c) => c.activity.id === id);
    if (card) {
      const step = buildActivityStep(card, pkg, profile.id, profilePayload);
      if (step) steps.push(step);
    } else {
      console.warn(`[create-trip] activity_id=${id} not in trip_package — skipping`);
    }
  }

  if (steps.length === 0) {
    return NextResponse.json(
      {
        error:
          "Selection is empty — pick at least one hotel, flight, restaurant, or activity before booking.",
      },
      { status: 422 }
    );
  }

  const jobId = randomUUID();
  const tripLabel = buildTripLabel(pkg, steps);

  console.log("[create-trip] built steps", {
    jobId,
    selection,
    step_types: steps.map((s) => s.type),
    step_count: steps.length,
  });

  const job = await createBookingJob({
    id: jobId,
    sessionId,
    userId,
    tripLabel,
    steps,
  });

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    trip_label: tripLabel,
    step_count: steps.length,
    breakdown: {
      hotel: !!selection.hotel_id,
      flight: !!selection.flight_id,
      restaurants: selection.restaurant_ids.length,
      activities: selection.activity_ids.length,
    },
  });
}

// ─── Step builders ────────────────────────────────────────────────────────

function buildHotelStep(
  card: HotelRecommendationCard,
  pkg: TripPackage,
  profileId: number,
  profilePayload: ProfilePayload
): BookingJobStep | null {
  const hotelName = card.hotel.name;
  const checkin = pkg.date_range.from;
  const checkout = pkg.date_range.to;
  const adults = pkg.traveler_count;

  const fallbackUrl =
    card.hotel.booking_link ||
    `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(
      `${hotelName} ${pkg.destination_city}`.trim()
    )}&checkin=${checkin}&checkout=${checkout}&group_adults=${adults}`;

  return {
    type: "hotel",
    emoji: "🏨",
    label: hotelName,
    apiEndpoint: "/api/booking-autopilot/universal",
    body: {
      hotel_name: hotelName,
      city: pkg.destination_city,
      checkin,
      checkout,
      adults,
      profileId,
      profile: profilePayload,
    },
    fallbackUrl,
    status: "pending",
  };
}

function buildFlightStep(
  card: FlightRecommendationCard,
  pkg: TripPackage,
  profileId: number,
  profilePayload: ProfilePayload
): BookingJobStep | null {
  const flight = card.flight;
  const origin = flight.departure_airport;
  const dest = flight.arrival_airport;
  if (!origin || !dest) return null;

  const depDate = pkg.date_range.from;
  const retDate = pkg.date_range.to;
  const passengers = pkg.traveler_count;
  const cabinClass = "economy"; // Phase 2: upscale tier dropped; UI could add a cabin picker later
  const preferNonstop = flight.stops === 0;

  const fallbackUrl = buildExpediaFlightsUrl({
    origin,
    dest,
    date: depDate,
    returnDate: retDate,
    passengers,
    cabinClass: cabinClass as "economy" | "premium_economy" | "business" | "first",
  });
  const airlineLabel = flight.airline ?? "Flight";

  return {
    type: "flight",
    emoji: "✈️",
    label: `${airlineLabel} ${origin}→${dest} ${depDate}`,
    apiEndpoint: "/api/booking-autopilot/universal",
    body: {
      origin,
      dest,
      date: depDate,
      returnDate: retDate,
      passengers,
      cabinClass,
      preferNonstop,
      targetAirline: flight.airline,
      targetPrice: flight.price,
      targetDepartureTime: normalizeFlightClockTime(flight.departure_time),
      targetFlightNumber: flight.flight_number,
      profileId,
      profile: profilePayload,
    },
    fallbackUrl,
    status: "pending",
  };
}

function buildRestaurantStep(
  card: RecommendationCard,
  pkg: TripPackage,
  profileId: number,
  profilePayload: ProfilePayload
): BookingJobStep | null {
  const restaurantName = card.restaurant.name;
  // Default restaurant time: dinner on the first trip day. Users can change
  // later from the Tasks page. Phase 2-C.2 (itinerary view) may let the user
  // tweak per-day/time before commit.
  const date = pkg.date_range.from;
  const time = "19:00";
  const covers = pkg.traveler_count;
  const city = pkg.destination_city;

  const fallbackUrl =
    card.opentable_url ||
    `https://www.opentable.com/s?term=${encodeURIComponent(restaurantName)}&covers=${covers}&dateTime=${date}T${time}:00`;

  return {
    type: "restaurant",
    emoji: "🍽️",
    label: restaurantName,
    apiEndpoint: "/api/booking-jobs/start",
    body: {
      restaurantName,
      city,
      date,
      time,
      covers,
      profileId,
      profile: profilePayload,
    },
    fallbackUrl,
    status: "pending",
  };
}

function buildActivityStep(
  card: ActivityRecommendationCard,
  pkg: TripPackage,
  profileId: number,
  profilePayload: ProfilePayload
): BookingJobStep | null {
  const activity = card.activity;
  const primarySource = activity.sources[0];
  if (!primarySource) return null;

  const label = activity.short_title ?? activity.title;
  const numTickets = pkg.traveler_count;
  const when = activity.datetime_display ?? activity.datetime_local;

  // Task string is REQUIRED: runUniversalStep calls input.task.match(...)
  // early to parse fallback URL hints, and a missing task throws
  // "Cannot read properties of undefined (reading 'match')" which kills the
  // step before the SeatGeek / Ticketmaster provider can even initialize.
  const task = `Buy ${numTickets} ticket${numTickets === 1 ? "" : "s"} for "${activity.title}" at ${activity.venue_name} on ${when} through ${primarySource.provider}. Navigate to the event page, pick the cheapest available seats together, fill in any required guest info, and stop before entering card number or CVV. Fallback URL: ${primarySource.booking_link}`;

  return {
    type: "activity",
    emoji: "🎟️",
    label,
    apiEndpoint: "/api/booking-autopilot/universal",
    body: {
      startUrl: primarySource.booking_link,
      task,
      activity_name: activity.title,
      activity_id: activity.id,
      venue_name: activity.venue_name,
      city: activity.venue_city,
      event_date: activity.datetime_local,
      num_tickets: numTickets,
      provider: primarySource.provider,
      profileId,
      profile: profilePayload,
    },
    fallbackUrl: primarySource.booking_link,
    status: "pending",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildTripLabel(pkg: TripPackage, steps: BookingJobStep[]): string {
  const nights = daysBetween(pkg.date_range.from, pkg.date_range.to);
  const counts = {
    hotel: steps.filter((s) => s.type === "hotel").length,
    flight: steps.filter((s) => s.type === "flight").length,
    restaurant: steps.filter((s) => s.type === "restaurant").length,
    activity: steps.filter((s) => s.type === "activity").length,
  };
  const composition: string[] = [];
  if (counts.hotel) composition.push(`${counts.hotel}🏨`);
  if (counts.flight) composition.push(`${counts.flight}✈`);
  if (counts.restaurant) composition.push(`${counts.restaurant}🍽`);
  if (counts.activity) composition.push(`${counts.activity}🎟`);
  return `${pkg.destination_city} trip ${nights}n (${composition.join(" + ")})`;
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

function normalizeFlightClockTime(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/);
  return match?.[1]?.trim() ?? trimmed;
}

// ─── Coercers ─────────────────────────────────────────────────────────────

function coerceTripPackage(raw: unknown): TripPackage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.scenario !== "trip") return null;
  if (typeof r.destination_city !== "string" || !r.destination_city.trim()) return null;
  if (typeof r.departure_city !== "string" || !r.departure_city.trim()) return null;
  const dates = r.date_range;
  if (!dates || typeof dates !== "object") return null;
  const d = dates as Record<string, unknown>;
  if (typeof d.from !== "string" || typeof d.to !== "string") return null;
  if (typeof r.traveler_count !== "number" || r.traveler_count < 1) return null;
  // At least one option category must be an array — even if empty (all 4 failed).
  // Step builders handle empty options via the selection lookup (unknown id skipped).
  if (!Array.isArray(r.hotel_options)) return null;
  if (!Array.isArray(r.flight_options)) return null;
  if (!Array.isArray(r.restaurant_options)) return null;
  if (!Array.isArray(r.activity_options)) return null;
  return r as unknown as TripPackage;
}

function coerceSelection(raw: unknown): TripSelection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const hotel_id =
    typeof r.hotel_id === "string" && r.hotel_id.trim() ? r.hotel_id.trim() : null;
  const flight_id =
    typeof r.flight_id === "string" && r.flight_id.trim() ? r.flight_id.trim() : null;
  const restaurant_ids = Array.isArray(r.restaurant_ids)
    ? r.restaurant_ids.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  const activity_ids = Array.isArray(r.activity_ids)
    ? r.activity_ids.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  return { hotel_id, flight_id, restaurant_ids, activity_ids };
}

// Re-export types to keep the linter quiet about the unused type-only imports.
export type {
  HotelRecommendationCard,
  FlightRecommendationCard,
  RecommendationCard,
  ActivityRecommendationCard,
};
