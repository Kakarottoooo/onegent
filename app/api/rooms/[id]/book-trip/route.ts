/**
 * POST /api/rooms/[id]/book-trip
 *
 * Payer-only endpoint. Triggers the booking job for a trip room once voting
 * has reached the approval threshold. Flow:
 *
 *   1. Auth: caller must be the room's payer (defaults to creator).
 *   2. Find the active trip proposal in this room.
 *   3. Tally votes; check rule (unanimous / majority). For MVP the whole
 *      TripPackage is a single option — approval = N/N (unanimous) or
 *      > N/2 (majority) of joined members voted "approve".
 *   4. Build a default selection (first of each category, skip empty lists).
 *   5. Internal fetch to /api/booking-jobs/create-trip to build the multi-step
 *      BookingJob. Forwards the user's auth cookies so create-trip sees the
 *      same user.
 *   6. Link the resulting booking_job_id to the room + mark proposal accepted.
 *
 * Body:
 *   { selection?: { hotel_id?, flight_id?, restaurant_ids?, activity_ids? } }
 *   — if omitted, defaults are auto-picked (first option per category).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getDecisionRoomById,
  isRoomMember,
  listProposalVotes,
  listRoomMembers,
  setDecisionRoomBookingJob,
  updateDecisionRoomStatus,
  updateProposalStatus,
} from "@/lib/db";
import { getActiveTripProposal } from "@/lib/agent/trip-synthesis";
import { resolveAcceptedOption, tallyVotes, extractOptions } from "@/lib/rooms/proposal-shape";
import type { TripPackage } from "@/lib/types";

export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  if (!roomId) return NextResponse.json({ error: "room id required" }, { status: 400 });

  const room = await getDecisionRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.type !== "trip") {
    return NextResponse.json({ error: "Not a trip room" }, { status: 400 });
  }

  // Only the payer (default = creator) can kick off the booking job.
  const payerId = room.payer_id ?? room.creator_id;
  if (userId !== payerId) {
    return NextResponse.json(
      { error: "Only the payer can trigger the trip booking." },
      { status: 403 },
    );
  }

  // Caller must be a joined member (belt + suspenders).
  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const proposal = await getActiveTripProposal(roomId);
  if (!proposal) {
    return NextResponse.json(
      { error: "No active trip proposal yet — wait for synthesis to complete." },
      { status: 409 },
    );
  }

  // Approval check. For trip MVP the TripPackage is stored raw (not wrapped
  // as {options:[{id,card}]}), so extractOptions falls back to the legacy
  // single-option path → exactly one option_id ("legacy"), which is what
  // we vote against.
  const [members, votes] = await Promise.all([
    listRoomMembers(roomId),
    listProposalVotes(proposal.id),
  ]);
  const joined = members.filter((m) => m.status === "joined");
  const rawRule = room.approval_rule ?? "unanimous";
  const rule = joined.length < 3 ? "unanimous" : rawRule;
  const options = extractOptions(proposal);
  const tallies = tallyVotes(options, votes);
  const winner = resolveAcceptedOption(rule, joined.length, tallies);
  if (!winner) {
    const approvedCount = tallies[0]?.approved_by.length ?? 0;
    return NextResponse.json(
      {
        error: "Approval threshold not met yet.",
        rule,
        approved_count: approvedCount,
        needed: rule === "unanimous" ? joined.length : Math.floor(joined.length / 2) + 1,
        joined_count: joined.length,
      },
      { status: 409 },
    );
  }

  // Coerce proposal.content_json to a TripPackage.
  const pkg = proposal.content_json as unknown as TripPackage;
  if (!pkg || pkg.scenario !== "trip") {
    return NextResponse.json(
      { error: "Proposal content is not a TripPackage." },
      { status: 500 },
    );
  }

  // Build the selection — body override wins, else auto-pick first of each.
  const body = (await req.json().catch(() => ({}))) as {
    selection?: {
      hotel_id?: string | null;
      flight_id?: string | null;
      restaurant_ids?: string[];
      activity_ids?: string[];
    };
  };
  // Cards in TripPackage wrap their ids under a nested field:
  //   hotel_options[i].hotel.id · flight_options[i].flight.id
  //   restaurant_options[i].restaurant.id · activity_options[i].activity.id
  // create-trip validates against these so we must surface them the same way.
  const selection = {
    hotel_id: body.selection?.hotel_id ?? pkg.hotel_options[0]?.hotel?.id ?? null,
    flight_id: body.selection?.flight_id ?? pkg.flight_options[0]?.flight?.id ?? null,
    restaurant_ids:
      body.selection?.restaurant_ids ??
      pkg.restaurant_options
        .slice(0, 3)
        .map((c) => c.restaurant?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    activity_ids:
      body.selection?.activity_ids ??
      pkg.activity_options
        .slice(0, 3)
        .map((c) => c.activity?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
  };

  // Internal call to the Stage 1 create-trip endpoint. Forward auth cookies
  // so create-trip sees the same userId.
  const origin = req.nextUrl.origin;
  const sessionId = `room-${roomId}`;
  const cookieHeader = req.headers.get("cookie") ?? "";
  const tripRes = await fetch(`${origin}/api/booking-jobs/create-trip`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      session_id: sessionId,
      trip_package: pkg,
      selection,
    }),
  });
  const tripBody = await tripRes.json().catch(() => ({}));
  if (!tripRes.ok) {
    return NextResponse.json(
      { error: tripBody.error ?? "Failed to create trip booking job.", detail: tripBody },
      { status: tripRes.status },
    );
  }

  const bookingJobId = tripBody.job_id ?? tripBody.booking_job_id ?? tripBody.id;
  if (!bookingJobId || typeof bookingJobId !== "string") {
    return NextResponse.json(
      { error: "create-trip didn't return a booking_job_id.", detail: tripBody },
      { status: 500 },
    );
  }

  // Link booking to the room + lock in the proposal + transition room state.
  await setDecisionRoomBookingJob(roomId, bookingJobId);
  await updateProposalStatus(proposal.id, "accepted");
  await updateDecisionRoomStatus(roomId, "executing");

  return NextResponse.json({
    ok: true,
    booking_job_id: bookingJobId,
    url: `/tasks/${bookingJobId}`,
    selection,
    approval: {
      rule,
      approved_count: tallies[0]?.approved_by.length ?? 0,
      joined_count: joined.length,
    },
  });
}

