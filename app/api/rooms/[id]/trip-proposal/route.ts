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
  listActiveProposals,
  listRoomMembers,
  listTripSelections,
  getMyTripSelection,
  listProposalVotes,
  listMemberIntentStates,
  type VoteKind,
} from "@/lib/db";
import { getLatestTripProposal } from "@/lib/agent/trip-synthesis";

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

  // Non-trip DRs use scenario_search_cards proposals rendered via
  // <ScenarioProposalChatCard />. We still want this endpoint to surface
  // their proposal id so member B's poller (who didn't fire synthesize)
  // sees the new proposal land without a page refresh — same UX as the
  // trip-room poller. The trip-shaped fields stay null/empty so the trip
  // card UI never mounts for non-trip rooms.
  if (room.type !== "trip") {
    const proposals = await listActiveProposals(roomId).catch(() => []);
    const scenarioProposal = proposals.find(
      (p) =>
        (p.status === "active" || p.status === "accepted") &&
        typeof p.content_json === "object" &&
        p.content_json !== null &&
        (p.content_json as Record<string, unknown>).kind === "scenario_search_cards",
    );

    // is_synthesizing for non-trip rooms: same heuristic as the trip
    // branch below, mirrored so member B (who didn't fire synthesize)
    // sees a progress indicator during the ~10s server-side LLM window
    // instead of staring at the "等其他成员聊完" message — which is
    // misleading because the OTHER member already finished and
    // synthesis is actively running.
    let nonTripSynthesizing = false;
    if (!scenarioProposal) {
      const members = await listRoomMembers(roomId);
      const intents = await listMemberIntentStates(roomId).catch(() => []);
      const contributorIds = new Set(intents.map((i) => i.user_id));
      const joinedIds = members
        .filter((m) => m.status === "joined")
        .map((m) => m.user_id);
      const pendingInviteCount = members.filter((m) => m.status === "invited").length;
      nonTripSynthesizing =
        pendingInviteCount === 0 &&
        joinedIds.length >= 2 &&
        joinedIds.every((id) => contributorIds.has(id));
    }

    return NextResponse.json({
      ok: true,
      proposal: null,
      scenario_proposal_id: scenarioProposal?.id ?? null,
      scenario_category: room.type,
      my_selection: null,
      my_vote: null,
      vote_tally: { approve: 0, decline: 0, request_changes: 0, voters: [] },
      aggregate: emptyAggregate(0),
      is_synthesizing: nonTripSynthesizing,
      room: {
        creator_id: room.creator_id,
        payer_id: room.payer_id ?? room.creator_id,
        approval_rule: room.approval_rule ?? "unanimous",
        status: room.status,
        booking_job_id: room.booking_job_id ?? null,
      },
    });
  }

  // Use the latest variant so accepted proposals (post full-approval but
  // pre-book) still surface — otherwise the card flashes "No proposal
  // available yet" the instant the threshold is met.
  const proposal = await getLatestTripProposal(roomId);
  const members = await listRoomMembers(roomId);
  const joinedCount = members.filter((m) => m.status === "joined").length;

  if (!proposal) {
    // is_synthesizing heuristic: no proposal exists yet, but every joined
    // member has already contributed an intent state — the synthesis pipeline
    // is either running right now or about to. Lets clients that DIDN'T
    // trigger the synthesize call themselves (the other members) still render
    // a progress indicator while they wait for the plan to land.
    //
    // Trip-only guard: single-category rooms (restaurant/hotel/flight/activity)
    // never produce a TripPackage proposal — their synthesis path returns a
    // merged search query that the client posts to /api/chat inline. Setting
    // is_synthesizing=true for those rooms strands the 4-pipeline trip
    // spinner forever. Only flag synthesis-in-progress when the room is
    // actually building a trip package.
    //
    // Pending-invite guard: same fix as trip-synthesis.ts — never report
    // is_synthesizing while invitees haven't joined yet, otherwise the
    // spinner shows during the period when synthesis SHOULDN'T fire (and
    // the gate doesn't fire it). Without this, clients see a permanent
    // spinner that never resolves.
    const pendingInviteCount = members.filter((m) => m.status === "invited").length;
    const intents = await listMemberIntentStates(roomId).catch(() => []);
    const contributorIds = new Set(intents.map((i) => i.user_id));
    const joinedIds = members.filter((m) => m.status === "joined").map((m) => m.user_id);
    const isSynthesizing =
      room.type === "trip" &&
      pendingInviteCount === 0 &&
      joinedIds.length > 0 &&
      joinedIds.every((id) => contributorIds.has(id));
    return NextResponse.json({
      ok: true,
      proposal: null,
      my_selection: null,
      my_vote: null,
      vote_tally: { approve: 0, decline: 0, request_changes: 0, voters: [] },
      aggregate: emptyAggregate(joinedCount),
      is_synthesizing: isSynthesizing,
      room: {
        creator_id: room.creator_id,
        payer_id: room.payer_id ?? room.creator_id,
        approval_rule: room.approval_rule ?? "unanimous",
        status: room.status,
        booking_job_id: room.booking_job_id ?? null,
      },
    });
  }

  const [selections, mySelection, votes] = await Promise.all([
    listTripSelections(proposal.id),
    getMyTripSelection(proposal.id, userId),
    listProposalVotes(proposal.id),
  ]);

  // Only one "option" exists for trip proposals (content_json is a flat
  // TripPackage, not wrapped as {options:[{id,card}]}). extractOptions()
  // falls back to id="legacy" — we tally all approves against that single
  // bucket. This keeps the reused machinery backward-compatible.
  const tally = { approve: 0, decline: 0, request_changes: 0 };
  let myVote: VoteKind | null = null;
  const voters: Array<{ user_id: string; vote: VoteKind; option_id: string | null }> = [];
  for (const v of votes) {
    if (v.vote === "approve") tally.approve += 1;
    else if (v.vote === "decline") tally.decline += 1;
    else if (v.vote === "request_changes") tally.request_changes += 1;
    voters.push({ user_id: v.user_id, vote: v.vote, option_id: v.option_id });
    if (v.user_id === userId) myVote = v.vote;
  }

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
    my_vote: myVote,
    vote_tally: { ...tally, voters },
    aggregate,
    is_synthesizing: false,
    room: {
      creator_id: room.creator_id,
      payer_id: room.payer_id ?? room.creator_id,
      approval_rule: room.approval_rule ?? "unanimous",
      status: room.status,
      booking_job_id: room.booking_job_id ?? null,
    },
  });
}
