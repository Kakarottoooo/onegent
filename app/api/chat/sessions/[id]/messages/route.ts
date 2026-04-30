/**
 * GET /api/chat/sessions/[id]/messages — chronological replay of a session's
 * user + assistant messages. Owner-only (listChatSessionMessages enforces).
 * Empty array when the session doesn't exist or belongs to someone else —
 * we don't 404 on mismatched owner to keep id enumeration harder.
 *
 * POST /api/chat/sessions/[id]/messages — persist a message into the
 * session thread. Used by the client to save search-card payloads so
 * recommendation results survive navigation. Body: { role, content,
 * meta_json? }.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getChatSession,
  insertChatSessionMessage,
  listChatSessionMessages,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "session id required" }, { status: 400 });

  // Fetch session metadata and messages in parallel. Session title is used
  // by the homepage ribbon so the user knows which thread they're in.
  const [session, messages] = await Promise.all([
    getChatSession(id, userId),
    listChatSessionMessages(id, userId, 200),
  ]);
  return NextResponse.json({ session, messages });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "session id required" }, { status: 400 });

  // Owner-only — getChatSession returns null when the session doesn't
  // belong to this user, so this also handles "session doesn't exist".
  const session = await getChatSession(id, userId);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as {
    role?: "user" | "assistant";
    content?: string;
    meta_json?: Record<string, unknown> | null;
  } | null;

  if (!body || typeof body.content !== "string" || body.content.length === 0) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  const role = body.role === "user" ? "user" : "assistant";

  await insertChatSessionMessage({
    sessionId: id,
    role,
    content: body.content,
    metaJson: body.meta_json ?? null,
  });

  return NextResponse.json({ ok: true });
}
