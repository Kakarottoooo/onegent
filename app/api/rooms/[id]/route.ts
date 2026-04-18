import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDecisionRoomById, isRoomMember } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/** GET /api/rooms/[id] — room metadata (members-only). For full state + polling use /state. */
export async function GET(_req: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const room = await getDecisionRoomById(id);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  if (!(await isRoomMember(id, userId))) {
    return NextResponse.json({ error: "Not a member of this room" }, { status: 403 });
  }

  return NextResponse.json({ room });
}
