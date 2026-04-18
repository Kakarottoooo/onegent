import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getDecisionRoomById,
  isContact,
  isRoomMember,
  joinDecisionRoom,
  getUserProfile,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/rooms/[id]/members
 * Body: { contact_user_id: string }
 * Creator-only: directly add one of my contacts to the room (bypasses the
 * invite-link dance). The added user must exist in my user_contacts.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  const room = await getDecisionRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (userId !== room.creator_id) {
    return NextResponse.json({ error: "Only the creator can add members directly" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const contactUserId = typeof body?.contact_user_id === "string" ? body.contact_user_id : "";
  if (!contactUserId) return NextResponse.json({ error: "contact_user_id required" }, { status: 400 });

  // Gate on being an actual contact — prevents using this as an unsolicited-invite channel.
  if (!(await isContact(userId, contactUserId))) {
    return NextResponse.json({ error: "That user is not in your contacts" }, { status: 403 });
  }

  // If they're already a member, noop.
  if (await isRoomMember(roomId, contactUserId)) {
    const profile = await getUserProfile(contactUserId);
    return NextResponse.json({ already_member: true, profile });
  }

  const member = await joinDecisionRoom(roomId, contactUserId);
  const profile = await getUserProfile(contactUserId);
  return NextResponse.json({ member, profile });
}
