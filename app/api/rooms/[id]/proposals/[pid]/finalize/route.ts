import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  appendRoomMessage,
  getDecisionRoomById,
  getRoomProposal,
  listProposalVotes,
  listRoomConstraints,
  listRoomMembers,
  updateDecisionRoomStatus,
  updateProposalStatus,
} from "@/lib/db";
import {
  extractOptions,
  resolveAcceptedOption,
  tallyVotes,
} from "@/lib/rooms/proposal-shape";
import { recordRoomAcceptance } from "@/lib/rooms/learn";
import { notifyDecisionRoomReachedDecision } from "@/lib/room-notifications";

type Params = { params: Promise<{ id: string; pid: string }> };

/**
 * POST /api/rooms/[id]/proposals/[pid]/finalize
 *
 * Creator-only escape hatch when voting is stuck on an AFK member. Resolves
 * the proposal with whatever votes are in: picks a winner if the rule is met,
 * otherwise marks the proposal rejected and reopens collecting. Always logs a
 * system message so skipped voters can see what happened.
 */
export async function POST(_req: Request, { params }: Params) {
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
  if (room.creator_id !== userId) {
    return NextResponse.json(
      { error: "Only the creator can finalize voting early." },
      { status: 403 }
    );
  }
  if (proposal.status !== "active") {
    return NextResponse.json({ error: `Proposal already ${proposal.status}` }, { status: 409 });
  }

  const [members, allVotes] = await Promise.all([
    listRoomMembers(roomId),
    listProposalVotes(proposalId),
  ]);
  const joined = members.filter((m) => m.status === "joined");
  const rawRule = room.approval_rule ?? "unanimous";
  const rule = joined.length < 3 ? "unanimous" : rawRule;
  const options = extractOptions(proposal);
  const tallies = tallyVotes(options, allVotes);
  const voterCount = new Set(allVotes.map((v) => v.user_id)).size;
  const missing = Math.max(0, joined.length - voterCount);

  if (missing === 0) {
    return NextResponse.json(
      { error: "Everyone has already voted — no need to finalize." },
      { status: 409 }
    );
  }

  const winner = resolveAcceptedOption(rule, joined.length, tallies);

  if (winner) {
    await updateProposalStatus(proposalId, "accepted");
    const winningCard = options.find((o) => o.id === winner)?.card;
    await appendRoomMessage({
      roomId,
      senderId: null,
      content: `The creator finalized voting (${missing} member${missing === 1 ? "" : "s"} skipped). ${winningCard?.restaurant?.name ?? "An option"} won — ready to book.`,
      metaJson: {
        kind: "proposal_accepted",
        proposal_id: proposalId,
        option_id: winner,
        rule,
        forced: true,
        missing_count: missing,
      },
    }).catch(() => { /* advisory */ });

    const constraints = await listRoomConstraints(roomId);
    recordRoomAcceptance({
      proposal,
      acceptedOptionId: winner,
      memberIds: joined.map((m) => m.user_id),
      constraints,
      roomTitle: room.title,
    }).catch((err) => console.error("recordRoomAcceptance failed:", err));

    notifyDecisionRoomReachedDecision({
      room,
      recipientUserIds: joined.filter((m) => m.user_id !== userId).map((m) => m.user_id),
      totalMembers: joined.length,
      winnerLabel: winningCard?.restaurant?.name ?? null,
      proposalId,
    }).catch(() => {
      /* non-fatal */
    });

    return NextResponse.json({ accepted: true, accepted_option_id: winner, rejected: false });
  }

  // No winner → reject and reopen collecting so they can tweak + re-propose.
  await updateProposalStatus(proposalId, "rejected");
  await updateDecisionRoomStatus(roomId, "collecting");
  await appendRoomMessage({
    roomId,
    senderId: null,
    content: `The creator finalized voting (${missing} member${missing === 1 ? "" : "s"} skipped). No option cleared the bar — tweak constraints and propose again.`,
    metaJson: {
      kind: "proposal_rejected",
      proposal_id: proposalId,
      forced: true,
      missing_count: missing,
    },
  }).catch(() => { /* advisory */ });

  return NextResponse.json({ accepted: false, rejected: true });
}
