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
  setDecisionRoomBookingJob,
  updateDecisionRoomStatus,
  updateProposalStatus,
  getMyTripSelection,
  listTripSelections,
  listProposalVotes,
  listRoomMembers,
} from "@/lib/db";
import { getActiveTripProposal } from "@/lib/agent/trip-synthesis";
import { extractOptions, tallyVotes, resolveAcceptedOption } from "@/lib/rooms/proposal-shape";
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

  // Approval-rule gate (reused from classic DR). Trip rooms have a single
  // "option" (extractOptions falls back to id="legacy" since the TripPackage
  // is stored raw). We tally approves against that bucket and require
  // unanimous for N<3, otherwise the room's configured rule. Payer cannot
  // book until the threshold is met — gives every member a real veto.
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
    const needed = rule === "unanimous" ? joined.length : Math.floor(joined.length / 2) + 1;
    return NextResponse.json(
      {
        error: "Approval threshold not met yet.",
        rule,
        approved_count: approvedCount,
        needed,
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

  // α voting semantics: each member picks items via /trip-selection. The
  // payer can book any time they want. Three sources, in priority order:
  //   1. Explicit body.selection override (payer edited on the way)
  //   2. Consensus (most-voted item per category, aggregated across all
  //      members' saved selections)
  //   3. First-of-each auto-pick (pre-α fallback)
  const body = (await req.json().catch(() => ({}))) as {
    selection?: {
      hotel_id?: string | null;
      flight_id?: string | null;
      restaurant_ids?: string[];
      activity_ids?: string[];
    };
  };
  const allSelections = await listTripSelections(proposal.id);
  const consensus = computeConsensus(allSelections, pkg);
  const myOwn = await getMyTripSelection(proposal.id, userId);
  // Pick order per category:
  //   body override > my saved > consensus > first-of-each
  const selection = {
    hotel_id:
      body.selection?.hotel_id ??
      myOwn?.selection_json.hotel_id ??
      consensus.hotel_id ??
      pkg.hotel_options[0]?.hotel?.id ??
      null,
    flight_id:
      body.selection?.flight_id ??
      myOwn?.selection_json.flight_id ??
      consensus.flight_id ??
      pkg.flight_options[0]?.flight?.id ??
      null,
    restaurant_ids:
      body.selection?.restaurant_ids ??
      (myOwn?.selection_json.restaurant_ids?.length
        ? myOwn.selection_json.restaurant_ids
        : consensus.restaurant_ids.length > 0
          ? consensus.restaurant_ids
          : pkg.restaurant_options
              .slice(0, 3)
              .map((c) => c.restaurant?.id)
              .filter((id): id is string => typeof id === "string" && id.length > 0)),
    activity_ids:
      body.selection?.activity_ids ??
      (myOwn?.selection_json.activity_ids?.length
        ? myOwn.selection_json.activity_ids
        : consensus.activity_ids.length > 0
          ? consensus.activity_ids
          : pkg.activity_options
              .slice(0, 3)
              .map((c) => c.activity?.id)
              .filter((id): id is string => typeof id === "string" && id.length > 0)),
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

  // create-trip returns { jobId } (camelCase). Fall through to other aliases
  // defensively in case the shape ever changes, but jobId is the current
  // source of truth.
  const bookingJobId =
    tripBody.jobId ?? tripBody.job_id ?? tripBody.booking_job_id ?? tripBody.id;
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
    // /tasks has no dynamic segment; it reads ?focus=<id>&view=live to zoom
    // into a specific job + land on the live-activity tab. Matches the URL
    // shape TripPackageCard (Solo flow) uses after its own booking click.
    url: `/tasks?focus=${encodeURIComponent(bookingJobId)}&view=live`,
    selection,
    contributors: allSelections.length,
  });
}

/**
 * Build a consensus selection from per-user selections by taking the
 * most-voted item in each category. Ties are broken by the order items
 * appear in the TripPackage (first to reach the top count wins). Returns
 * empty/null fields when nobody voted on that category.
 */
function computeConsensus(
  selections: Awaited<ReturnType<typeof listTripSelections>>,
  pkg: TripPackage,
): {
  hotel_id: string | null;
  flight_id: string | null;
  restaurant_ids: string[];
  activity_ids: string[];
} {
  const hotelCounts = new Map<string, number>();
  const flightCounts = new Map<string, number>();
  const restaurantCounts = new Map<string, number>();
  const activityCounts = new Map<string, number>();

  for (const row of selections) {
    const s = row.selection_json;
    if (s.hotel_id) hotelCounts.set(s.hotel_id, (hotelCounts.get(s.hotel_id) ?? 0) + 1);
    if (s.flight_id) flightCounts.set(s.flight_id, (flightCounts.get(s.flight_id) ?? 0) + 1);
    for (const rid of s.restaurant_ids ?? []) {
      restaurantCounts.set(rid, (restaurantCounts.get(rid) ?? 0) + 1);
    }
    for (const aid of s.activity_ids ?? []) {
      activityCounts.set(aid, (activityCounts.get(aid) ?? 0) + 1);
    }
  }

  // Pick the first item in the package's option order that has the top count.
  const pickTop = <T extends { id: string }>(
    items: { [k: string]: unknown; id?: string }[],
    counts: Map<string, number>,
    idExtract: (item: unknown) => string | undefined,
  ): string | null => {
    let topCount = 0;
    for (const c of counts.values()) if (c > topCount) topCount = c;
    if (topCount === 0) return null;
    for (const it of items) {
      const id = idExtract(it);
      if (id && counts.get(id) === topCount) return id;
    }
    return null;
  };

  const hotelId = pickTop<{ id: string }>(
    pkg.hotel_options as unknown[] as { id: string }[],
    hotelCounts,
    (it) => (it as { hotel?: { id?: string } }).hotel?.id,
  );
  const flightId = pickTop<{ id: string }>(
    pkg.flight_options as unknown[] as { id: string }[],
    flightCounts,
    (it) => (it as { flight?: { id?: string } }).flight?.id,
  );

  // Restaurants / activities allow up to 3 picks: take all ids that received
  // votes, sorted by count desc then by package order, capped at 3.
  const orderedPickMulti = (
    items: unknown[],
    counts: Map<string, number>,
    idExtract: (item: unknown) => string | undefined,
    cap: number,
  ): string[] => {
    const out: string[] = [];
    const indexed: Array<{ id: string; count: number; order: number }> = [];
    for (let i = 0; i < items.length; i++) {
      const id = idExtract(items[i]);
      if (!id) continue;
      const c = counts.get(id) ?? 0;
      if (c > 0) indexed.push({ id, count: c, order: i });
    }
    indexed.sort((a, b) => (b.count - a.count) || (a.order - b.order));
    for (const x of indexed) {
      out.push(x.id);
      if (out.length >= cap) break;
    }
    return out;
  };

  const restaurantIds = orderedPickMulti(
    pkg.restaurant_options,
    restaurantCounts,
    (it) => (it as { restaurant?: { id?: string } }).restaurant?.id,
    3,
  );
  const activityIds = orderedPickMulti(
    pkg.activity_options,
    activityCounts,
    (it) => (it as { activity?: { id?: string } }).activity?.id,
    3,
  );

  return {
    hotel_id: hotelId,
    flight_id: flightId,
    restaurant_ids: restaurantIds,
    activity_ids: activityIds,
  };
}
