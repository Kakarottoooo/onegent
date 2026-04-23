/**
 * POST /api/booking-jobs/create-trip
 *
 * Given a TripPackage + a selected tier, construct a multi-step BookingJob
 * where each non-null tier slot (hotel, flight, [restaurants], [activities])
 * becomes one BookingJobStep. Phase 1 ships with hotel + flight only;
 * restaurants + activities land in Phase 2.
 *
 * Body:
 *   {
 *     session_id: string,
 *     trip_package: TripPackage,
 *     selected_tier_id: TripTierId,
 *     profile_id?: number
 *   }
 *
 * Returns: { jobId, trip_label, step_count }
 *
 * Execution architecture: the created BookingJob gets picked up by
 * POST /api/booking-jobs/[id]/start, which currently runs steps sequentially.
 * T10 (parallel execution) is a Phase 2 follow-up.
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
  TripTier,
  TripTierId,
  HotelRecommendationCard,
  FlightRecommendationCard,
} from "@/lib/types";

export const maxDuration = 30;

interface CreateTripBody {
  session_id?: unknown;
  trip_package?: unknown;
  selected_tier_id?: unknown;
  profile_id?: unknown;
}

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

  const sessionId = typeof body.session_id === "string" && body.session_id.trim()
    ? body.session_id.trim()
    : null;
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  const pkg = coerceTripPackage(body.trip_package);
  if (!pkg) {
    return NextResponse.json({ error: "trip_package required (must match TripPackage shape)" }, { status: 400 });
  }

  const selectedTierId =
    typeof body.selected_tier_id === "string" ? (body.selected_tier_id as TripTierId) : null;
  const selectedTier = selectedTierId
    ? pkg.tiers.find((t) => t.tier_id === selectedTierId)
    : pkg.tiers[0];
  if (!selectedTier) {
    return NextResponse.json(
      { error: `selected_tier_id "${selectedTierId}" not found in trip_package` },
      { status: 400 }
    );
  }

  // Resolve booking profile: body.profile_id wins, else user's default.
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
  const profilePayload = {
    first_name: profile.first_name,
    last_name: profile.last_name,
    email: profile.email,
    phone: profile.phone,
  };

  const steps: BookingJobStep[] = [];

  const hotelStep = buildHotelStep(selectedTier, pkg, profile.id, profilePayload);
  if (hotelStep) steps.push(hotelStep);

  const flightStep = buildFlightStep(selectedTier, pkg, profile.id, profilePayload);
  if (flightStep) steps.push(flightStep);

  // Restaurants + activities: Phase 2 will expand here.

  if (steps.length === 0) {
    return NextResponse.json(
      { error: "Selected tier has no bookable hotel or flight — cannot build a trip job" },
      { status: 422 }
    );
  }

  const jobId = randomUUID();
  const tripLabel = buildTripLabel(pkg, selectedTier);

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
    selected_tier_id: selectedTier.tier_id,
  });
}

// ─── Step builders ────────────────────────────────────────────────────────

function buildHotelStep(
  tier: TripTier,
  pkg: TripPackage,
  profileId: number,
  profilePayload: { first_name: string; last_name: string | null; email: string; phone: string | null }
): BookingJobStep | null {
  const card = tier.hotel;
  if (!card) return null;

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
  tier: TripTier,
  pkg: TripPackage,
  profileId: number,
  profilePayload: { first_name: string; last_name: string | null; email: string; phone: string | null }
): BookingJobStep | null {
  const card = tier.flight;
  if (!card) return null;

  const flight = card.flight;
  const origin = flight.departure_airport;
  const dest = flight.arrival_airport;
  if (!origin || !dest) return null;

  const depDate = pkg.date_range.from;
  const retDate = pkg.date_range.to;
  const passengers = pkg.traveler_count;
  const cabinClass = tier.tier_id === "upscale" ? "business" : "economy";
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

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildTripLabel(pkg: TripPackage, tier: TripTier): string {
  const nights = daysBetween(pkg.date_range.from, pkg.date_range.to);
  const parts: string[] = [];
  parts.push(`${pkg.destination_city} trip`);
  if (nights > 0) parts.push(`${nights}n`);
  parts.push(`(${tier.tier_label})`);
  return parts.join(" ");
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

/**
 * Shape-check an incoming trip_package. Returns the object if it matches
 * TripPackage, null otherwise. Does not validate recommendation card shapes
 * deeply — downstream step builders surface missing fields with clear errors.
 */
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
  if (!Array.isArray(r.tiers) || r.tiers.length === 0) return null;
  // Trust the shape beyond this — the step builders handle per-card nulls.
  return r as unknown as TripPackage;
}

// Unused imports referenced via type-only casts above — keep linter happy.
export type { HotelRecommendationCard, FlightRecommendationCard };
