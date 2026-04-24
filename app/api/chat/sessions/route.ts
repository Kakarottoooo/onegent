/**
 * GET  /api/chat/sessions — list caller's sessions, newest active first.
 * POST /api/chat/sessions — explicit create (optional; chat/parse usually
 *                           auto-creates on first user message).
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import { createChatSession, listMyChatSessions } from "@/lib/db";

const MAX_TITLE_LEN = 120;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessions = await listMyChatSessions(userId);
  return NextResponse.json({ sessions });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { title?: unknown };
  const rawTitle = typeof body.title === "string" ? body.title.trim() : "";
  const title = (rawTitle || "New chat").slice(0, MAX_TITLE_LEN);

  const id = randomUUID();
  const session = await createChatSession({ id, userId, title });
  return NextResponse.json({ session });
}
