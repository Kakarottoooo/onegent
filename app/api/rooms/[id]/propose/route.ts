import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import {
  getDecisionRoomById,
  isRoomMember,
  listRoomMembers,
  listRoomConstraints,
  createRoomProposal,
  updateDecisionRoomStatus,
  appendRoomMessage,
} from "@/lib/db";
import { generateRestaurantProposal } from "@/lib/rooms/propose";

type Params = { params: Promise<{ id: string }> };

// MiniMax + SerpAPI can take up to 55s — give the route room to breathe.
export const maxDuration = 60;

/**
 * POST /api/rooms/[id]/propose — triggers agent to produce a proposal.
 *
 * Default: requires every joined member to have submitted constraints.
 * `?force=1`: creator-only escape hatch — proceeds as long as ≥2 submitted,
 * and logs a system message so the skipped members see what happened.
 */
export async function POST(req: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  const room = await getDecisionRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  if (room.type !== "restaurant") {
    return NextResponse.json(
      { error: `Proposal generation for ${room.type} not supported in Phase 1` },
      { status: 400 }
    );
  }

  const force = new URL(req.url).searchParams.get("force") === "1";
  const [constraints, members] = await Promise.all([
    listRoomConstraints(roomId),
    listRoomMembers(roomId),
  ]);
  const joinedCount = members.length;
  const submittedCount = constraints.filter((c) => c.submitted).length;
  const missingCount = Math.max(0, joinedCount - submittedCount);

  if (force) {
    if (room.creator_id !== userId) {
      return NextResponse.json(
        { error: "Only the creator can force a proposal before everyone submits." },
        { status: 403 }
      );
    }
    if (submittedCount < 2) {
      return NextResponse.json(
        { error: `Need at least 2 submitted constraints (have ${submittedCount})` },
        { status: 409 }
      );
    }
  } else if (submittedCount < joinedCount) {
    return NextResponse.json(
      { error: `Waiting for all members to submit (${submittedCount}/${joinedCount}).` },
      { status: 409 }
    );
  }

  await updateDecisionRoomStatus(roomId, "proposing");

  if (force && missingCount > 0) {
    await appendRoomMessage({
      roomId,
      senderId: null,
      content: `The creator generated a proposal before everyone submitted (${missingCount} member${missingCount === 1 ? "" : "s"} skipped).`,
      metaJson: { kind: "proposal_forced", missing_count: missingCount, user_id: userId },
    }).catch(() => { /* advisory */ });
  }

  let generated;
  try {
    generated = await generateRestaurantProposal(room, constraints);
  } catch (err) {
    // Revert status so the UI reopens the constraint editor.
    await updateDecisionRoomStatus(roomId, "collecting");
    const msg = err instanceof Error ? err.message : "Proposal generation failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  if (!generated) {
    await updateDecisionRoomStatus(roomId, "collecting");
    return NextResponse.json({ error: "Could not generate a proposal" }, { status: 502 });
  }

  const proposal = await createRoomProposal({
    id: randomUUID(),
    roomId,
    contentJson: { options: generated.options } as unknown as Record<string, unknown>,
    rationale: generated.rationale,
    conflictsJson: generated.conflicts,
  });

  const namesSummary = generated.options
    .map((o) => o.card.restaurant?.name)
    .filter((n): n is string => Boolean(n))
    .join(" · ");
  // Log an agent system message so the chat reflects the event.
  await appendRoomMessage({
    roomId,
    senderId: null, // agent
    content: generated.options.length > 1
      ? `Proposed ${generated.options.length} options: ${namesSummary || "restaurants"}`
      : `Proposed: ${namesSummary || "restaurant"}`,
    metaJson: { kind: "proposal_created", proposal_id: proposal.id },
  });

  return NextResponse.json({ proposal });
}
