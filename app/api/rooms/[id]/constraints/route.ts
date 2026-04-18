import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getDecisionRoomById,
  isRoomMember,
  upsertRoomConstraint,
  listRoomConstraints,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/** POST /api/rooms/[id]/constraints — upsert my constraint row. */
export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  const room = await getDecisionRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }
  // Constraints are editable anytime before the booking is actually underway.
  // Allowed: collecting, proposing (if someone else just triggered propose),
  // approving (user wants to tweak while votes are open).
  // Blocked: executing, done, abandoned.
  const EDITABLE_STATUSES = new Set(["collecting", "proposing", "approving"]);
  if (!EDITABLE_STATUSES.has(room.status)) {
    return NextResponse.json({ error: `Cannot edit constraints after status=${room.status}` }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const data = (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>;
  const submitted = Boolean(body.submitted);

  const row = await upsertRoomConstraint(roomId, userId, data, submitted);
  return NextResponse.json({ constraint: row });
}

/** GET /api/rooms/[id]/constraints — list all members' constraints (members only). */
export async function GET(_req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  if (!(await isRoomMember(roomId, userId))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const constraints = await listRoomConstraints(roomId);
  return NextResponse.json({ constraints });
}
