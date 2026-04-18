import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  appendRoomMessage,
  getDecisionRoomById,
  updateDecisionRoomStatus,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/rooms/[id]/abandon
 *
 * Creator-only "cancel room" action. Flips status to 'abandoned' so the room
 * moves to the History tab. Blocked while booking is in progress — payer has
 * to clear the booking job first (matches existing clear-booking guard).
 */
export async function POST(_req: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  const room = await getDecisionRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.creator_id !== userId) {
    return NextResponse.json({ error: "Only the creator can cancel this room" }, { status: 403 });
  }
  if (room.status === "executing") {
    return NextResponse.json(
      { error: "Clear the in-progress booking first." },
      { status: 409 }
    );
  }
  if (room.status === "done" || room.status === "abandoned") {
    return NextResponse.json({ error: `Room is already ${room.status}` }, { status: 409 });
  }

  await updateDecisionRoomStatus(roomId, "abandoned");
  await appendRoomMessage({
    roomId,
    senderId: null,
    content: "The creator cancelled this room.",
    metaJson: { kind: "room_abandoned", user_id: userId },
  }).catch(() => { /* advisory */ });

  return NextResponse.json({ abandoned: true });
}
