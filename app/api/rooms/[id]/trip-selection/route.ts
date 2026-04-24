/**
 * PUT /api/rooms/[id]/trip-selection
 *
 * Upsert the caller's trip-package selection for this room's active proposal.
 * Members-only; one row per (proposal, user) — re-calling replaces.
 *
 * Body:
 *   {
 *     hotel_id?: string | null,
 *     flight_id?: string | null,
 *     restaurant_ids?: string[],   // max 3
 *     activity_ids?: string[],     // max 3
 *   }
 *
 * Response:
 *   { ok: true, proposal_id: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getDecisionRoomById,
  isRoomMember,
  upsertTripSelection,
} from "@/lib/db";
import { getActiveTripProposal } from "@/lib/agent/trip-synthesis";

type Params = { params: Promise<{ id: string }> };

const MAX_RESTAURANT_PICKS = 3;
const MAX_ACTIVITY_PICKS = 3;

function sanitizeIds(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && v.trim().length > 0) out.push(v.trim());
    if (out.length >= cap) break;
  }
  return out;
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  if (!roomId) return NextResponse.json({ error: "room id required" }, { status: 400 });

  const room = await getDecisionRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.type !== "trip") {
    return NextResponse.json({ error: "Not a trip room" }, { status: 400 });
  }
  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Not a member of this room" }, { status: 403 });
  }

  const proposal = await getActiveTripProposal(roomId);
  if (!proposal) {
    return NextResponse.json(
      { error: "No active trip proposal to select against. Wait for synthesis." },
      { status: 409 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const hotel_id =
    typeof body.hotel_id === "string" && body.hotel_id.trim() ? body.hotel_id.trim() : null;
  const flight_id =
    typeof body.flight_id === "string" && body.flight_id.trim() ? body.flight_id.trim() : null;
  const restaurant_ids = sanitizeIds(body.restaurant_ids, MAX_RESTAURANT_PICKS);
  const activity_ids = sanitizeIds(body.activity_ids, MAX_ACTIVITY_PICKS);

  try {
    await upsertTripSelection({
      roomId,
      proposalId: proposal.id,
      userId,
      selection: { hotel_id, flight_id, restaurant_ids, activity_ids },
    });
  } catch (err) {
    console.error(`[rooms/${roomId}/trip-selection] upsert failed`, err);
    return NextResponse.json({ error: "Failed to save selection" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, proposal_id: proposal.id });
}
