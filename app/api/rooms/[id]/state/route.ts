import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getRoomSnapshot, isRoomMember } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/rooms/[id]/state?since=<version>
 * Returns full snapshot + a numeric `version` that bumps on any write.
 * Clients should cache the version and re-fetch only when they want fresh data.
 * If `since` is provided and equals the current version, returns 304.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const snapshot = await getRoomSnapshot(roomId);
  if (!snapshot) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const sinceParam = req.nextUrl.searchParams.get("since");
  if (sinceParam) {
    const since = parseInt(sinceParam, 10);
    if (Number.isFinite(since) && since === snapshot.version) {
      return new NextResponse(null, { status: 304 });
    }
  }

  return NextResponse.json(snapshot);
}
