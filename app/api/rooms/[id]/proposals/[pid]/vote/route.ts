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
  deleteProposalVote,
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
  if (proposal.status !== "active" && proposal.status !== "accepted") {
    return NextResponse.json({ error: `Proposal already ${proposal.status}` }, { status: 409 });
  }
  if (proposal.status === "accepted" && room.booking_job_id) {
    return NextResponse.json(
      { error: "Booking already started — payer must clear it first." },
      { status: 409 }
    );
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

  const previousVotes = await listProposalVotes(proposalId);
  const members = await listRoomMembers(roomId);
  const joined = members.filter((m) => m.status === "joined");
  const rawRule = room.approval_rule ?? "unanimous";
  const rule = joined.length < 3 ? "unanimous" : rawRule;
  const previousTallies = tallyVotes(options, previousVotes);
  const previousWinner =
    proposal.status === "accepted"
      ? resolveAcceptedOption(rule, joined.length, previousTallies)
      : null;

  await castRoomVote({
    proposalId,
    userId,
    vote,
    optionId: vote === "approve" ? optionId : null,
    comment,
  });

  const allVotes = await listProposalVotes(proposalId);
  const tallies = tallyVotes(options, allVotes);
  const voterCount = new Set(allVotes.map((v) => v.user_id)).size;
  const everyoneVoted = voterCount >= joined.length;
  const winner =
    proposal.status === "accepted"
      ? resolveAcceptedOption(rule, joined.length, tallies)
      : everyoneVoted
        ? resolveAcceptedOption(rule, joined.length, tallies)
        : null;

  // Once everyone has voted, the proposal either has a winner or it's done.
  // Splits (unanimous with different approvals, or majority with no option >50%)
  // used to leave the room stuck in Voting forever — now we close it out and
  // kick back to collecting so the group can tweak constraints and retry.
  const autoRejected = proposal.status === "active" && everyoneVoted && !winner;

  const optionLabel = (optionId: string | null) =>
    options.find((o) => o.id === optionId)?.card?.restaurant?.name ?? "another option";

  let reopened = false;
  let shifted = false;

  if (proposal.status === "accepted") {
    if (winner) {
      if (winner !== previousWinner && previousWinner) {
        shifted = true;
        await appendRoomMessage({
          roomId,
          senderId: null,
          content: `The group's pick shifted from ${optionLabel(previousWinner)} to ${optionLabel(winner)}.`,
          metaJson: {
            kind: "proposal_winner_shifted",
            proposal_id: proposalId,
            from_option_id: previousWinner,
            to_option_id: winner,
            rule,
          },
        });
        const constraints = await listRoomConstraints(roomId);
        recordRoomAcceptance({
          proposal,
          acceptedOptionId: winner,
          memberIds: joined.map((m) => m.user_id),
          constraints,
          roomTitle: room.title,
        }).catch((err) => console.error("recordRoomAcceptance failed:", err));
      }
    } else {
      reopened = true;
      await updateProposalStatus(proposalId, "active");
      await updateDecisionRoomStatus(roomId, "approving");
      await appendRoomMessage({
        roomId,
        senderId: null,
        content: "A vote change removed the majority — back to voting.",
        metaJson: { kind: "proposal_reopened", proposal_id: proposalId, user_id: userId },
      });
    }
  } else if (winner) {
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
    reopened,
    shifted,
    rule,
    total_members: joined.length,
    voted_count: voterCount,
    everyone_voted: everyoneVoted,
    tallies: counts,
    unanimous: Boolean(winner) && rule === "unanimous",
    proposal_status: reopened ? "active" : winner ? "accepted" : proposal.status,
  });
}

/**
 * DELETE /api/rooms/[id]/proposals/[pid]/vote
 *
 * Withdraw the caller's own vote. Allowed while the proposal is active OR
 * accepted (so a member can change their mind after the slate was accepted),
 * but refused once booking has started (room.booking_job_id is non-null) —
 * at that point the payer must clear the booking first.
 *
 * If withdrawing breaks the acceptance rule, reopen the proposal (status
 * active) and the room (status approving) so remaining members can revote.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
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
  if (room.booking_job_id) {
    return NextResponse.json(
      { error: "Booking already started — payer must clear it first." },
      { status: 409 }
    );
  }
  if (proposal.status !== "active" && proposal.status !== "accepted") {
    return NextResponse.json(
      { error: `Proposal already ${proposal.status}` },
      { status: 409 }
    );
  }

  await deleteProposalVote(proposalId, userId);

  const [members, allVotes] = await Promise.all([
    listRoomMembers(roomId),
    listProposalVotes(proposalId),
  ]);
  const joined = members.filter((m) => m.status === "joined");
  const rawRule = room.approval_rule ?? "unanimous";
  const rule = joined.length < 3 ? "unanimous" : rawRule;
  const options = extractOptions(proposal);
  const tallies = tallyVotes(options, allVotes);
  const stillWinner = resolveAcceptedOption(rule, joined.length, tallies);

  let reopened = false;
  if (proposal.status === "accepted" && !stillWinner) {
    await updateProposalStatus(proposalId, "active");
    await updateDecisionRoomStatus(roomId, "approving");
    await appendRoomMessage({
      roomId,
      senderId: null,
      content: "A vote change removed the majority — back to voting.",
      metaJson: { kind: "vote_withdrawn", proposal_id: proposalId, user_id: userId },
    });
    reopened = true;
  }

  const counts = tallies.map((t) => ({
    option_id: t.option_id,
    approved_count: t.approved_by.length,
    approved_by: t.approved_by,
  }));

  return NextResponse.json({
    withdrew: true,
    reopened,
    proposal_status: reopened ? "active" : proposal.status,
    tallies: counts,
  });
}
