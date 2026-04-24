/**
 * GET /api/dm/[userId] — list the DM thread between the caller and [userId].
 * POST /api/dm/[userId] — send a DM to [userId] from the caller.
 *
 * Both require the caller and [userId] to be mutual contacts — non-contacts
 * can't DM each other. Agent-role messages (auto-invites, etc.) are inserted
 * server-side by other routes (e.g. chat/commit for trip invites); this
 * endpoint only accepts role='user' from the client.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  areContacts,
  sendDirectMessage,
  listDirectMessagesBetween,
} from "@/lib/db";

type Params = { params: Promise<{ userId: string }> };

const MAX_CONTENT_LEN = 2000;

export async function GET(_req: NextRequest, { params }: Params) {
  const { userId: me } = await auth();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId: peer } = await params;
  if (!peer) return NextResponse.json({ error: "userId required" }, { status: 400 });
  if (peer === me) return NextResponse.json({ error: "Cannot DM yourself" }, { status: 400 });

  if (!(await areContacts(me, peer))) {
    return NextResponse.json({ error: "Not in your contacts" }, { status: 403 });
  }

  const messages = await listDirectMessagesBetween(me, peer, 200);
  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { userId: me } = await auth();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId: peer } = await params;
  if (!peer) return NextResponse.json({ error: "userId required" }, { status: 400 });
  if (peer === me) return NextResponse.json({ error: "Cannot DM yourself" }, { status: 400 });

  if (!(await areContacts(me, peer))) {
    return NextResponse.json({ error: "Not in your contacts" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { content?: unknown };
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });
  if (content.length > MAX_CONTENT_LEN) {
    return NextResponse.json({ error: `content too long (max ${MAX_CONTENT_LEN})` }, { status: 400 });
  }

  const row = await sendDirectMessage({
    fromUserId: me,
    toUserId: peer,
    role: "user",
    content,
  });

  return NextResponse.json({ ok: true, message: row });
}
