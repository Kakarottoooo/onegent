import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  appendRoomMessage,
  getDecisionRoomById,
  getUserProfile,
  isRoomMember,
  transferRoomCreator,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/rooms/[id]/transfer-creator
 * Body: { to_user_id: string }
 *
 * Current creator hands ownership to another joined member. If the current
 * creator was also the payer, payer moves with them (inside the DB helper).
 * Creator is NOT auto-removed from the room afterwards — a common next step
 * is to then call /leave, but that's the caller's choice.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  const room = await getDecisionRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.creator_id !== userId) {
    return NextResponse.json({ error: "Only the current creator can transfer" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const toUserId = typeof body?.to_user_id === "string" ? body.to_user_id : null;
  if (!toUserId) return NextResponse.json({ error: "to_user_id required" }, { status: 400 });
  if (toUserId === userId) {
    return NextResponse.json({ error: "That's you." }, { status: 400 });
  }
  if (!(await isRoomMember(roomId, toUserId))) {
    return NextResponse.json(
      { error: "Target user is not a joined member of this room." },
      { status: 400 }
    );
  }

  await transferRoomCreator(roomId, toUserId);

  const [oldProfile, newProfile] = await Promise.all([
    getUserProfile(userId).catch(() => null),
    getUserProfile(toUserId).catch(() => null),
  ]);
  const oldName = oldProfile?.display_name ?? (oldProfile?.username ? `@${oldProfile.username}` : "The previous creator");
  const newName = newProfile?.display_name ?? (newProfile?.username ? `@${newProfile.username}` : "a new creator");
  await appendRoomMessage({
    roomId,
    senderId: null,
    content: `${oldName} handed the room to ${newName}.`,
    metaJson: { kind: "creator_transferred", from_user_id: userId, to_user_id: toUserId },
  }).catch(() => { /* advisory */ });

  return NextResponse.json({ transferred: true, new_creator_id: toUserId });
}
