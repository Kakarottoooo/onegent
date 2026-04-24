/**
 * GET /api/rooms/[id]/trip-proposal
 *
 * Returns the active trip proposal (TripPackage) plus aggregate selection
 * data for inline rendering in <TripProposalChatCard>. Members-only.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     proposal: { id, content_json: TripPackage, rationale, status, ... } | null,
 *     my_selection: { hotel_id, flight_id, restaurant_ids, activity_ids } | null,
 *     aggregate: {
 *       hotel_counts:      { [hotel_id]:      count },
 *       flight_counts:     { [flight_id]:     count },
 *       restaurant_counts: { [restaurant_id]: count },
 *       activity_counts:   { [activity_id]:   count },
 *       total_voters: number,
 *       joined_members: number,
 *     },
 *     room: { creator_id, payer_id, approval_rule, status }
 *   }
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getDecisionRoomById,
  isRoomMember,
  listRoomMembers,
  listTripSelections,
  getMyTripSelection,
} from "@/lib/db";
import { getActiveTripProposal } from "@/lib/agent/trip-synthesis";

type Params = { params: Promise<{ id: string }> };

interface AggregateCounts {
  hotel_counts: Record<string, number>;
  flight_counts: Record<string, number>;
  restaurant_counts: Record<string, number>;
  activity_counts: Record<string, number>;
  total_voters: number;
  joined_members: number;
}

function emptyAggregate(joinedMembers: number): AggregateCounts {
  return {
    hotel_counts: {},
    flight_counts: {},
    restaurant_counts: {},
    activity_counts: {},
    total_voters: 0,
    joined_members: joinedMembers,
  };
}

export async function GET(_req: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  if (!roomId) return NextResponse.json({ error: "room id required" }, { status: 400 });

  const room = await getDecisionRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Not a member of this room" }, { status: 403 });
  }

  const proposal = await getActiveTripProposal(roomId);
  const members = await listRoomMembers(roomId);
  const joinedCount = members.filter((m) => m.status === "joined").length;

  if (!proposal) {
    return NextResponse.json({
      ok: true,
      proposal: null,
      my_selection: null,
      aggregate: emptyAggregate(joinedCount),
      room: {
        creator_id: room.creator_id,
        payer_id: room.payer_id ?? room.creator_id,
        approval_rule: room.approval_rule ?? "unanimous",
        status: room.status,
      },
    });
  }

  const [selections, mySelection] = await Promise.all([
    listTripSelections(proposal.id),
    getMyTripSelection(proposal.id, userId),
  ]);

  const aggregate = emptyAggregate(joinedCount);
  for (const row of selections) {
    aggregate.total_voters += 1;
    const s = row.selection_json;
    if (s.hotel_id) {
      aggregate.hotel_counts[s.hotel_id] = (aggregate.hotel_counts[s.hotel_id] ?? 0) + 1;
    }
    if (s.flight_id) {
      aggregate.flight_counts[s.flight_id] = (aggregate.flight_counts[s.flight_id] ?? 0) + 1;
    }
    for (const rid of s.restaurant_ids ?? []) {
      aggregate.restaurant_counts[rid] = (aggregate.restaurant_counts[rid] ?? 0) + 1;
    }
    for (const aid of s.activity_ids ?? []) {
      aggregate.activity_counts[aid] = (aggregate.activity_counts[aid] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    ok: true,
    proposal: {
      id: proposal.id,
      content_json: proposal.content_json,
      rationale: proposal.rationale,
      status: proposal.status,
    },
    my_selection: mySelection?.selection_json ?? null,
    aggregate,
    room: {
      creator_id: room.creator_id,
      payer_id: room.payer_id ?? room.creator_id,
      approval_rule: room.approval_rule ?? "unanimous",
      status: room.status,
    },
  });
}
