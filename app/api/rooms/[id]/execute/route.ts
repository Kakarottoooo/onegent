import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import {
  getDecisionRoomById,
  isRoomMember,
  listActiveProposals,
  listProposalVotes,
  listRoomMembers,
  getDefaultBookingProfile,
  createBookingJob,
  setDecisionRoomBookingJob,
  appendRoomMessage,
  type BookingJobStep,
} from "@/lib/db";
import {
  extractOptions,
  resolveAcceptedOption,
  tallyVotes,
} from "@/lib/rooms/proposal-shape";
import { buildExpediaFlightsUrl } from "@/lib/agent/planners/booking-links";
import type {
  RecommendationCard,
  HotelRecommendationCard,
  FlightRecommendationCard,
  ActivityRecommendationCard,
} from "@/lib/types";

const SUPPORTED_ROOM_TYPES = new Set(["restaurant", "hotel", "flight", "activity"]);

type Params = { params: Promise<{ id: string }> };

function normalizeFlightClockTime(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/);
  return match?.[1]?.trim() ?? trimmed;
}

/**
 * POST /api/rooms/[id]/execute
 * Kicks off a booking job from the room's accepted proposal.
 * Only the room's payer may trigger execution.
 * Body: { date: "YYYY-MM-DD", time: "HH:MM", covers: number, session_id: string }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  const room = await getDecisionRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }
  const payerId = room.payer_id ?? room.creator_id;
  if (userId !== payerId) {
    return NextResponse.json({ error: "Only the payer may execute this booking" }, { status: 403 });
  }

  if (!SUPPORTED_ROOM_TYPES.has(room.type)) {
    return NextResponse.json({ error: `Execution for ${room.type} not yet supported` }, { status: 400 });
  }

  // Must have at least one accepted proposal
  const activeProposals = await listActiveProposals(roomId);
  const accepted = activeProposals.find((p) => p.status === "accepted");
  if (!accepted) {
    return NextResponse.json({ error: "No accepted proposal to execute" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const sessionId = typeof body?.session_id === "string" && body.session_id.length > 0 ? body.session_id : null;
  if (!sessionId) {
    return NextResponse.json({ error: "session_id required" }, { status: 400 });
  }

  // Restaurant needs per-booking date/time/covers from the request; hotel reads
  // them from the Room's group context (all members share the same stay).
  const date = typeof body?.date === "string" ? body.date : null;
  const time = typeof body?.time === "string" ? body.time : null;
  const coversRaw = body?.covers;
  const covers = typeof coversRaw === "number" && coversRaw > 0 ? Math.floor(coversRaw) : null;
  if (room.type === "restaurant" && (!date || !time || !covers)) {
    return NextResponse.json(
      { error: "date, time, covers required for restaurant booking" },
      { status: 400 }
    );
  }

  // Load payer's default booking profile
  const profile = await getDefaultBookingProfile(payerId);
  if (!profile || !profile.email || !profile.first_name) {
    return NextResponse.json(
      { error: "Payer has no default booking profile — please complete it in Settings first" },
      { status: 412 }
    );
  }

  // Resolve the winning option (multi-option proposals). Falls back to the
  // first option for legacy proposals where content_json was a single card.
  const options = extractOptions(accepted);
  const [votes, members] = await Promise.all([
    listProposalVotes(accepted.id),
    listRoomMembers(roomId),
  ]);
  const joined = members.filter((m) => m.status === "joined");
  const tallies = tallyVotes(options, votes);
  const rule = room.approval_rule ?? "unanimous";
  const winnerId = resolveAcceptedOption(rule, joined.length, tallies) ?? options[0]?.id;
  const winningCard = options.find((o) => o.id === winnerId)?.card;
  const card = (winningCard ?? options[0]?.card) as
    | RecommendationCard
    | HotelRecommendationCard
    | FlightRecommendationCard
    | ActivityRecommendationCard
    | undefined;
  if (!card) {
    return NextResponse.json({ error: "Accepted proposal has no option card" }, { status: 500 });
  }

  const profilePayload = {
    first_name: profile.first_name,
    last_name: profile.last_name,
    email: profile.email,
    phone: profile.phone,
  };

  let step: BookingJobStep;
  let messageContent: string;

  if (room.type === "restaurant") {
    const rCard = card as RecommendationCard;
    const restaurantName = rCard?.restaurant?.name ?? room.title;
    const city = rCard?.restaurant?.address?.split(",").slice(-2).join(",").trim() ?? "";
    const fallbackUrl =
      rCard?.opentable_url ??
      `https://www.opentable.com/s?term=${encodeURIComponent(restaurantName)}&covers=${covers}&dateTime=${date}T${time}:00`;

    step = {
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
        profileId: profile.id,
        profile: profilePayload,
        roomId,
      },
      fallbackUrl,
      status: "pending",
    };
    messageContent = `Booking started: ${restaurantName} on ${date} at ${time} for ${covers}.`;
  } else if (room.type === "hotel") {
    // hotel — group-level defaults come from room.context_json, but the payer
    // may override check-in / check-out / guests at execute time (e.g. to fix
    // a date typo). Body values win when provided.
    const hCard = card as HotelRecommendationCard;
    const hotelName = hCard?.hotel?.name ?? room.title;
    const ctx = (room.context_json ?? {}) as {
      city?: string;
      destination?: string;
      check_in?: string;
      check_out?: string;
      guests?: number;
      date_window?: { from?: string | null; to?: string | null } | null;
    };
    const city =
      ctx.destination ??
      ctx.city ??
      hCard?.hotel?.neighborhood ??
      hCard?.hotel?.address?.split(",").slice(-2).join(",").trim() ??
      "";
    const bodyCheckin = typeof body?.check_in === "string" && body.check_in ? body.check_in : null;
    const bodyCheckout = typeof body?.check_out === "string" && body.check_out ? body.check_out : null;
    const bodyGuestsRaw = body?.guests;
    const bodyGuests = typeof bodyGuestsRaw === "number" && bodyGuestsRaw > 0 ? Math.floor(bodyGuestsRaw) : null;
    const checkin = bodyCheckin ?? ctx.check_in ?? ctx.date_window?.from ?? null;
    const checkout = bodyCheckout ?? ctx.check_out ?? ctx.date_window?.to ?? null;
    const adults = bodyGuests ?? ctx.guests ?? joined.length ?? 2;
    if (!checkin || !checkout) {
      return NextResponse.json(
        { error: "Hotel room is missing check_in / check_out — provide them or set them in the room context" },
        { status: 412 }
      );
    }
    if (checkin >= checkout) {
      return NextResponse.json(
        { error: "Check-out must be after check-in" },
        { status: 400 }
      );
    }
    const fallbackUrl =
      hCard?.hotel?.booking_link ??
      `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(`${hotelName} ${city}`.trim())}&checkin=${checkin}&checkout=${checkout}&group_adults=${adults}`;

    step = {
      type: "hotel",
      emoji: "🏨",
      label: hotelName,
      apiEndpoint: "/api/booking-jobs/start",
      body: {
        hotel_name: hotelName,
        city,
        checkin,
        checkout,
        adults,
        profileId: profile.id,
        profile: profilePayload,
        roomId,
      },
      fallbackUrl,
      status: "pending",
    };
    messageContent = `Booking started: ${hotelName} from ${checkin} to ${checkout} for ${adults} guest${adults === 1 ? "" : "s"}.`;
  } else if (room.type === "flight") {
    // flight — route is fixed on the accepted card, but the Payer may tweak
    // date / return_date / passengers / round-trip at execute time (mirrors the
    // hotel path). Body values win when provided.
    const fCard = card as FlightRecommendationCard;
    const flight = fCard?.flight;
    if (!flight) {
      return NextResponse.json({ error: "Accepted flight card is missing flight data" }, { status: 500 });
    }
    const ctx = (room.context_json ?? {}) as {
      departure_city?: string;
      arrival_city?: string;
      departure_date?: string;
      return_date?: string;
      is_round_trip?: boolean;
      passengers?: number;
      cabin_class?: string;
      date_window?: { from?: string | null; to?: string | null } | null;
    };

    const bodyDate = typeof body?.departure_date === "string" && body.departure_date ? body.departure_date : null;
    const bodyReturnDate = typeof body?.return_date === "string" && body.return_date ? body.return_date : null;
    const bodyIsRoundTrip = typeof body?.is_round_trip === "boolean" ? body.is_round_trip : null;
    const bodyPassengersRaw = body?.passengers;
    const bodyPassengers = typeof bodyPassengersRaw === "number" && bodyPassengersRaw > 0
      ? Math.floor(bodyPassengersRaw)
      : null;

    const depDate = bodyDate ?? ctx.departure_date ?? ctx.date_window?.from ?? null;
    const isRoundTrip = bodyIsRoundTrip ?? ctx.is_round_trip ?? false;
    const retDate = isRoundTrip
      ? (bodyReturnDate ?? ctx.return_date ?? ctx.date_window?.to ?? null)
      : null;
    const passengers = bodyPassengers ?? ctx.passengers ?? joined.length ?? 1;
    const cabinClass = ctx.cabin_class ?? "economy";

    if (!depDate) {
      return NextResponse.json(
        { error: "Flight room is missing departure_date — provide it or set it in the room context" },
        { status: 412 }
      );
    }
    if (isRoundTrip && !retDate) {
      return NextResponse.json(
        { error: "Round-trip flight requires return_date" },
        { status: 400 }
      );
    }
    if (isRoundTrip && retDate && retDate <= depDate) {
      return NextResponse.json(
        { error: "Return date must be after departure date" },
        { status: 400 }
      );
    }

    const origin = flight.departure_airport;
    const dest = flight.arrival_airport;
    const preferNonstop = flight.stops === 0;
    const fallbackUrl = buildExpediaFlightsUrl({
      origin,
      dest,
      date: depDate,
      returnDate: retDate ?? undefined,
      passengers,
      cabinClass: cabinClass as "economy" | "premium_economy" | "business" | "first",
    });
    const airlineLabel = flight.airline ?? "flight";
    const label = `${airlineLabel} ${origin}→${dest} ${depDate}`;

    step = {
      type: "flight",
      emoji: "✈️",
      label,
      apiEndpoint: "/api/booking-autopilot/universal",
      body: {
        origin,
        dest,
        date: depDate,
        returnDate: retDate ?? undefined,
        passengers,
        cabinClass,
        preferNonstop,
        targetAirline: flight.airline,
        targetPrice: flight.price,
        targetDepartureTime: normalizeFlightClockTime(flight.departure_time),
        targetFlightNumber: flight.flight_number,
        profileId: profile.id,
        profile: profilePayload,
        roomId,
      },
      fallbackUrl,
      status: "pending",
    };
    messageContent = isRoundTrip
      ? `Booking started: ${airlineLabel} ${origin}→${dest} ${depDate}, return ${retDate} for ${passengers} passenger${passengers === 1 ? "" : "s"}.`
      : `Booking started: ${airlineLabel} ${origin}→${dest} ${depDate} for ${passengers} passenger${passengers === 1 ? "" : "s"}.`;
  } else {
    // activity — event identity is fixed on the accepted card; the Payer may
    // override num_tickets at execute time.
    const aCard = card as ActivityRecommendationCard;
    const activity = aCard?.activity;
    if (!activity) {
      return NextResponse.json({ error: "Accepted activity card is missing activity data" }, { status: 500 });
    }
    const ctx = (room.context_json ?? {}) as {
      num_tickets?: number;
      event_name?: string;
    };
    const bodyTicketsRaw = body?.num_tickets;
    const bodyTickets = typeof bodyTicketsRaw === "number" && bodyTicketsRaw > 0
      ? Math.floor(bodyTicketsRaw)
      : null;
    const numTickets = bodyTickets ?? ctx.num_tickets ?? joined.length ?? 1;
    const eventLabel = activity.short_title ?? activity.title ?? ctx.event_name ?? room.title;
    const when = activity.datetime_display ?? activity.datetime_local ?? "";
    const fallbackUrl = activity.booking_link;

    // Standardized activity body shape — matches ActivityCard + create-trip
    // so cend-adapter's convertActivity can convert all three uniformly.
    const activityTask = `Buy ${numTickets} ticket${numTickets === 1 ? "" : "s"} for "${eventLabel}" at ${activity.venue_name} on ${when}. Navigate to the event page, pick the cheapest available seats together, fill in any required guest info, and stop before entering card number or CVV. Fallback URL: ${activity.booking_link}`;
    step = {
      type: "activity",
      emoji: "🎟️",
      label: eventLabel,
      apiEndpoint: "/api/booking-autopilot/universal",
      body: {
        activity_name: eventLabel,
        activity_id: activity.id,
        venue_name: activity.venue_name,
        city: activity.venue_city,
        event_date: activity.datetime_local,
        num_tickets: numTickets,
        provider: "seatgeek",
        startUrl: activity.booking_link,
        task: activityTask,
        profileId: profile.id,
        profile: profilePayload,
        roomId,
      },
      fallbackUrl,
      status: "pending",
    };
    messageContent = `Booking started: ${eventLabel}${when ? ` · ${when}` : ""} — ${numTickets} ticket${numTickets === 1 ? "" : "s"}.`;
  }

  const jobId = randomUUID();
  await createBookingJob({
    id: jobId,
    sessionId,
    userId: payerId,
    tripLabel: `Room: ${room.title}`,
    steps: [step],
  });
  await setDecisionRoomBookingJob(roomId, jobId);
  await appendRoomMessage({
    roomId,
    senderId: null,
    content: messageContent,
    metaJson: { kind: "booking_started", booking_job_id: jobId },
  });

  // Kick off the job runner. We call the existing /start route in-process.
  const origin = req.nextUrl.origin;
  fetch(`${origin}/api/booking-jobs/${jobId}/start`, {
    method: "POST",
    headers: { cookie: req.headers.get("cookie") ?? "" },
  }).catch(() => { /* fire and forget — job runner is asynchronous */ });

  return NextResponse.json({ job_id: jobId, room_id: roomId });
}
