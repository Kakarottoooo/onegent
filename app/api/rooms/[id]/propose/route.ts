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
import { generateRoomProposal } from "@/lib/rooms/propose";

const SUPPORTED_ROOM_TYPES = new Set(["restaurant", "hotel", "flight", "activity"]);

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

  if (!SUPPORTED_ROOM_TYPES.has(room.type)) {
    return NextResponse.json(
      { error: `Proposal generation for ${room.type} not yet supported` },
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
    generated = await generateRoomProposal(room, constraints);
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
    .map((o) => {
      const c = o.card as {
        restaurant?: { name?: string };
        hotel?: { name?: string };
        flight?: { airline?: string; flight_number?: string; departure_airport?: string; arrival_airport?: string };
        activity?: { title?: string; short_title?: string; datetime_display?: string; venue_name?: string };
      };
      if (c.restaurant?.name) return c.restaurant.name;
      if (c.hotel?.name) return c.hotel.name;
      if (c.flight) {
        const num = c.flight.flight_number ? ` ${c.flight.flight_number}` : "";
        const route =
          c.flight.departure_airport && c.flight.arrival_airport
            ? ` ${c.flight.departure_airport}→${c.flight.arrival_airport}`
            : "";
        return `${c.flight.airline ?? "Flight"}${num}${route}`.trim();
      }
      if (c.activity) {
        const title = c.activity.short_title ?? c.activity.title ?? "Event";
        const when = c.activity.datetime_display ? ` · ${c.activity.datetime_display}` : "";
        return `${title}${when}`.trim();
      }
      return undefined;
    })
    .filter((n): n is string => Boolean(n))
    .join(" · ");
  const noun =
    room.type === "hotel" ? "hotels" :
    room.type === "flight" ? "flights" :
    room.type === "activity" ? "events" :
    "restaurants";
  const nounSingular =
    room.type === "hotel" ? "hotel" :
    room.type === "flight" ? "flight" :
    room.type === "activity" ? "event" :
    "restaurant";
  // Log an agent system message so the chat reflects the event.
  await appendRoomMessage({
    roomId,
    senderId: null, // agent
    content: generated.options.length > 1
      ? `Proposed ${generated.options.length} options: ${namesSummary || noun}`
      : `Proposed: ${namesSummary || nounSingular}`,
    metaJson: { kind: "proposal_created", proposal_id: proposal.id },
  });

  return NextResponse.json({ proposal });
}
