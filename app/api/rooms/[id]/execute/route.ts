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
import type { RecommendationCard, HotelRecommendationCard } from "@/lib/types";

const SUPPORTED_ROOM_TYPES = new Set(["restaurant", "hotel"]);

type Params = { params: Promise<{ id: string }> };

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
  } else {
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
