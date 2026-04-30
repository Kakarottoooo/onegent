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
 *
 * POST /api/rooms/[id]/private-messages
 *
 * Persists a message into the caller's private channel — used by the
 * client to save search-card results so cards survive page navigation
 * (the /api/chat recommendation pipeline doesn't write to DB itself).
 * Body: { role: "user" | "assistant", content, meta_json? }.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  isRoomMember,
  listPrivateMessages,
  insertPrivateMessage,
} from "@/lib/db";

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

export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  if (!roomId) return NextResponse.json({ error: "room id required" }, { status: 400 });

  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    role?: "user" | "assistant" | "system";
    content?: string;
    meta_json?: Record<string, unknown> | null;
  } | null;

  if (!body || typeof body.content !== "string" || body.content.length === 0) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  // Caller persistence path is for assistant-side replay payloads (search
  // results). User messages go through /api/chat/parse, which already
  // writes them to the private channel — accepting them here too would
  // double-insert.
  const role = body.role === "system" || body.role === "user" ? body.role : "assistant";

  await insertPrivateMessage({
    roomId,
    userId,
    role,
    content: body.content,
    metaJson: body.meta_json ?? null,
  });

  return NextResponse.json({ ok: true });
}
