import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  appendRoomMessage,
  declineRoomInvite,
  getDecisionRoomById,
  getUserProfile,
  isRoomMember,
  leaveDecisionRoom,
  listRoomMembersWithInvited,
  sql,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/rooms/[id]/leave
 *
 * Any joined non-creator can leave a room except during 'executing' (booking
 * is live — bail would be confusing). Creator must use /abandon or
 * /transfer-creator instead. Payer≠creator may leave; payer automatically
 * reverts to creator via a follow-up update here.
 *
 * Soft-delete only: member row stays with status='left' so their earlier
 * messages still render for remaining members.
 */
export async function POST(_req: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  const room = await getDecisionRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Stage 2: the caller might be a pending-invite (status='invited') member
  // in which case isRoomMember returns false but they should still be able
  // to decline. Use the with-invited variant — listRoomMembers alone drops
  // invited rows.
  const members = await listRoomMembersWithInvited(roomId);
  const me = members.find((m) => m.user_id === userId);
  if (me?.status === "invited") {
    await declineRoomInvite(roomId, userId);
    return NextResponse.json({ left: true, declined: true });
  }

  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }
  if (room.creator_id === userId) {
    return NextResponse.json(
      { error: "Creator can't leave directly — cancel the room or transfer ownership first." },
      { status: 409 }
    );
  }
  if (room.status === "executing") {
    return NextResponse.json(
      { error: "Can't leave while booking is in progress." },
      { status: 409 }
    );
  }

  // Payer revert: if leaving user was the payer, hand payer back to creator.
  if (room.payer_id === userId) {
    await sql`
      UPDATE decision_rooms
      SET payer_id = ${room.creator_id}, updated_at = NOW()
      WHERE id = ${roomId}
    `;
  }

  const left = await leaveDecisionRoom(roomId, userId);
  if (!left) {
    return NextResponse.json({ error: "Already left" }, { status: 409 });
  }

  const profile = await getUserProfile(userId).catch(() => null);
  const name = profile?.display_name ?? (profile?.username ? `@${profile.username}` : "A member");
  await appendRoomMessage({
    roomId,
    senderId: null,
    content: `${name} left the room.`,
    metaJson: { kind: "member_left", user_id: userId },
  }).catch(() => { /* message is advisory — don't fail the leave if it errors */ });

  return NextResponse.json({ left: true });
}
