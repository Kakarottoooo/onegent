import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { appendRoomMessage, isRoomMember, listRoomMessages } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/** GET /api/rooms/[id]/messages — latest (up to 200) messages. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }
  const messages = await listRoomMessages(roomId, 200);
  return NextResponse.json({ messages });
}

/** POST /api/rooms/[id]/messages — send a message (human). */
export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim().slice(0, 2000) : "";
  if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });

  const message = await appendRoomMessage({ roomId, senderId: userId, content });
  return NextResponse.json({ message });
}
