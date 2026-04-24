/**
 * GET /api/chat/sessions/[id]/messages — chronological replay of a session's
 * user + assistant messages. Owner-only (listChatSessionMessages enforces).
 * Empty array when the session doesn't exist or belongs to someone else —
 * we don't 404 on mismatched owner to keep id enumeration harder.
 */
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listChatSessionMessages } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "session id required" }, { status: 400 });

  const messages = await listChatSessionMessages(id, userId, 200);
  return NextResponse.json({ messages });
}
