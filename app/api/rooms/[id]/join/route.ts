import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getDecisionRoomById,
  getDecisionRoomByShortCode,
  joinDecisionRoom,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/rooms/[id]/join
 * The [id] segment may be either the full UUID OR the 6-char short code.
 * Body may optionally include { short_code } to enforce out-of-band verification.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: identifier } = await params;
  const body = await req.json().catch(() => ({}));
  const expectedCode =
    typeof body?.short_code === "string" ? body.short_code.toUpperCase() : null;

  // Look up by UUID first; if not found, try as short code.
  let room = await getDecisionRoomById(identifier);
  if (!room && identifier.length === 6) {
    room = await getDecisionRoomByShortCode(identifier);
  }
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // If caller supplied a short_code, require it to match (belt-and-suspenders).
  if (expectedCode && expectedCode !== room.short_code) {
    return NextResponse.json({ error: "Short code mismatch" }, { status: 403 });
  }

  const member = await joinDecisionRoom(room.id, userId);
  return NextResponse.json({ room, member });
}
