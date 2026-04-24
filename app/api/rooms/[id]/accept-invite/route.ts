/**
 * POST /api/rooms/[id]/accept-invite
 *
 * Caller must be in this room with status='invited' (pre-added by the
 * room creator via Stage 2 contact resolution). Flips status → 'joined'
 * and returns the room so the client can navigate based on flow:
 *   - flow="chat"    → /?room_id=<id>  (homepage)
 *   - flow="classic" → /rooms/<id>     (legacy form UI)
 *
 * No body required.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDecisionRoomById, joinDecisionRoom, listRoomMembers } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  if (!roomId) return NextResponse.json({ error: "room id required" }, { status: 400 });

  const room = await getDecisionRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Verify the caller is invited (or already joined — idempotent).
  const members = await listRoomMembers(roomId);
  const me = members.find((m) => m.user_id === userId);
  if (!me) {
    return NextResponse.json(
      { error: "You weren't invited to this room. Ask the creator for an invite link." },
      { status: 403 },
    );
  }
  if (me.status !== "invited" && me.status !== "joined") {
    return NextResponse.json({ error: `Cannot accept — current status: ${me.status}` }, { status: 409 });
  }

  // Flip to joined (joinDecisionRoom is upsert-on-conflict so re-accept is safe).
  await joinDecisionRoom(roomId, userId);

  return NextResponse.json({ ok: true, room });
}
