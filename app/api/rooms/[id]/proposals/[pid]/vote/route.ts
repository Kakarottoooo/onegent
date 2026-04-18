import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getDecisionRoomById,
  getRoomProposal,
  isRoomMember,
  listRoomMembers,
  listRoomConstraints,
  listProposalVotes,
  castRoomVote,
  updateProposalStatus,
  updateDecisionRoomStatus,
  appendRoomMessage,
  type VoteKind,
} from "@/lib/db";
import {
  extractOptions,
  resolveAcceptedOption,
  tallyVotes,
} from "@/lib/rooms/proposal-shape";
import { recordRoomAcceptance } from "@/lib/rooms/learn";

type Params = { params: Promise<{ id: string; pid: string }> };

const ALLOWED_VOTES: VoteKind[] = ["approve", "decline", "request_changes"];

/**
 * POST /api/rooms/[id]/proposals/[pid]/vote
 * Body: { vote: VoteKind, option_id?: string, comment?: string }
 *
 * For `vote=approve`, an option_id identifies which proposal option the member
 * supports. For decline / request_changes, option_id is optional (defaults to
 * the first option for backwards compatibility).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId, pid: proposalId } = await params;

  const [room, proposal] = await Promise.all([
    getDecisionRoomById(roomId),
    getRoomProposal(proposalId),
  ]);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!proposal || proposal.room_id !== roomId) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }
  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }
  if (proposal.status !== "active") {
    return NextResponse.json({ error: `Proposal already ${proposal.status}` }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const vote = body?.vote as VoteKind | undefined;
  const optionId = typeof body?.option_id === "string" ? body.option_id : null;
  const comment = typeof body?.comment === "string" ? body.comment.slice(0, 500) : null;
  if (!vote || !ALLOWED_VOTES.includes(vote)) {
    return NextResponse.json(
      { error: `vote must be one of ${ALLOWED_VOTES.join(", ")}` },
      { status: 400 }
    );
  }

  // Validate option_id against the proposal when vote=approve.
  const options = extractOptions(proposal);
  const validOptionIds = new Set(options.map((o) => o.id));
  if (vote === "approve") {
    if (!optionId) {
      return NextResponse.json({ error: "option_id required for approve" }, { status: 400 });
    }
    if (!validOptionIds.has(optionId)) {
      return NextResponse.json({ error: "Unknown option_id" }, { status: 400 });
    }
  }

  await castRoomVote({
    proposalId,
    userId,
    vote,
    optionId: vote === "approve" ? optionId : null,
    comment,
  });

  const [members, allVotes] = await Promise.all([
    listRoomMembers(roomId),
    listProposalVotes(proposalId),
  ]);
  const joined = members.filter((m) => m.status === "joined");
  // N<3 collapses "majority" to unilateral; coerce to unanimous regardless of
  // what the room was configured with. The /rooms/new UI enforces this too,
  // but old rooms or direct API calls could bypass the guard.
  const rawRule = room.approval_rule ?? "unanimous";
  const rule = joined.length < 3 ? "unanimous" : rawRule;
  const tallies = tallyVotes(options, allVotes);
  const winner = resolveAcceptedOption(rule, joined.length, tallies);

  // Count "negative" votes (decline + request_changes). If these exceed half
  // the joined members, the proposal can no longer pass even if everyone else
  // approves the same option — mark it rejected and reopen collecting.
  const negativeCount = allVotes.filter(
    (v) => v.vote === "decline" || v.vote === "request_changes"
  ).length;
  const autoRejected = !winner && negativeCount * 2 > joined.length;

  if (winner) {
    // Persist the chosen option onto the proposal so downstream execution
    // (e.g. booking) knows which card won.
    await updateProposalStatus(proposalId, "accepted");
    const winningCard = options.find((o) => o.id === winner)?.card;
    await appendRoomMessage({
      roomId,
      senderId: null,
      content:
        rule === "unanimous"
          ? `All members approved ${winningCard?.restaurant?.name ?? "the pick"} — ready to book.`
          : `Majority picked ${winningCard?.restaurant?.name ?? "an option"} — ready to book.`,
      metaJson: {
        kind: "proposal_accepted",
        proposal_id: proposalId,
        option_id: winner,
        rule,
      },
    });

    // Fire-and-forget: fold everyone's constraints into their preference
    // profiles. Never blocks the HTTP response.
    const constraints = await listRoomConstraints(roomId);
    recordRoomAcceptance({
      proposal,
      acceptedOptionId: winner,
      memberIds: joined.map((m) => m.user_id),
      constraints,
      roomTitle: room.title,
    }).catch((err) => console.error("recordRoomAcceptance failed:", err));
  } else if (autoRejected) {
    await updateProposalStatus(proposalId, "rejected");
    await updateDecisionRoomStatus(roomId, "collecting");
    await appendRoomMessage({
      roomId,
      senderId: null,
      content:
        "The group didn't approve this slate. Tweak your constraints and propose again.",
      metaJson: { kind: "proposal_rejected", proposal_id: proposalId },
    });
  }

  const counts = tallies.map((t) => ({
    option_id: t.option_id,
    approved_count: t.approved_by.length,
    approved_by: t.approved_by,
  }));

  return NextResponse.json({
    vote: { proposal_id: proposalId, user_id: userId, vote, option_id: optionId, comment },
    accepted: Boolean(winner),
    accepted_option_id: winner,
    rejected: autoRejected,
    rule,
    total_members: joined.length,
    tallies: counts,
    unanimous: Boolean(winner) && rule === "unanimous",
  });
}
