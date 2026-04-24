/**
 * PATCH  /api/chat/sessions/[id] — rename (title only for now).
 * DELETE /api/chat/sessions/[id] — permanently delete the session + its messages.
 *
 * Both auth to the owner (user_id match).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  deleteChatSession,
  getChatSession,
  updateChatSessionTitle,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

const MAX_TITLE_LEN = 120;

export async function PATCH(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "session id required" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { title?: unknown };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const session = await getChatSession(id, userId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  await updateChatSessionTitle(id, userId, title.slice(0, MAX_TITLE_LEN));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "session id required" }, { status: 400 });

  const session = await getChatSession(id, userId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  await deleteChatSession(id, userId);
  return NextResponse.json({ ok: true });
}
