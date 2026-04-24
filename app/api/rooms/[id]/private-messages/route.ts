/**
 * GET /api/rooms/[id]/private-messages
 *
 * Returns the caller's private chat history with the agent for this room
 * (rows from decision_room_private_messages where user_id = caller).
 * Used by the homepage when ?room_id is in the URL — restores chat
 * continuity across page reloads / new tabs / coming back later.
 *
 * Privacy: only the owning user_id sees their own private messages. Other
 * room members never have access to them.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isRoomMember, listPrivateMessages } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  if (!roomId) return NextResponse.json({ error: "room id required" }, { status: 400 });

  // Joined members only — invited-but-not-yet-accepted users have no chat
  // history yet anyway.
  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const messages = await listPrivateMessages(roomId, userId, 200);
  return NextResponse.json({ messages });
}
