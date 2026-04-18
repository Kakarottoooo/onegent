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
import type { RecommendationCard } from "@/lib/types";

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

  // Phase 1: restaurant only
  if (room.type !== "restaurant") {
    return NextResponse.json({ error: `Execution for ${room.type} not supported in Phase 1` }, { status: 400 });
  }

  // Must have at least one accepted proposal
  const activeProposals = await listActiveProposals(roomId);
  const accepted = activeProposals.find((p) => p.status === "accepted");
  if (!accepted) {
    return NextResponse.json({ error: "No accepted proposal to execute" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const date = typeof body?.date === "string" ? body.date : null;
  const time = typeof body?.time === "string" ? body.time : null;
  const coversRaw = body?.covers;
  const covers = typeof coversRaw === "number" && coversRaw > 0 ? Math.floor(coversRaw) : null;
  const sessionId = typeof body?.session_id === "string" && body.session_id.length > 0 ? body.session_id : null;
  if (!date || !time || !covers || !sessionId) {
    return NextResponse.json(
      { error: "date, time, covers, session_id required" },
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
  const winningCard = options.find((o) => o.id === winnerId)?.card as
    | RecommendationCard
    | undefined;
  const card = winningCard ?? (options[0]?.card as RecommendationCard | undefined);
  if (!card) {
    return NextResponse.json({ error: "Accepted proposal has no option card" }, { status: 500 });
  }
  const restaurantName = card?.restaurant?.name ?? room.title;
  const city = card?.restaurant?.address?.split(",").slice(-2).join(",").trim() ?? "";
  const fallbackUrl =
    card?.opentable_url ??
    `https://www.opentable.com/s?term=${encodeURIComponent(restaurantName)}&covers=${covers}&dateTime=${date}T${time}:00`;

  const step: BookingJobStep = {
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
      profile: {
        first_name: profile.first_name,
        last_name: profile.last_name,
        email: profile.email,
        phone: profile.phone,
      },
      roomId,
    },
    fallbackUrl,
    status: "pending",
  };

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
    content: `Booking started: ${restaurantName} on ${date} at ${time} for ${covers}.`,
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
