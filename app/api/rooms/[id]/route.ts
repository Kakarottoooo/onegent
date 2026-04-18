import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  deleteDecisionRoom,
  getDecisionRoomById,
  isRoomMember,
} from "@/lib/db";

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

/**
 * DELETE /api/rooms/[id]
 *
 * Permanently remove a room and all its data. Creator-only; only allowed for
 * rooms that are already done or abandoned (i.e. in the History view). This
 * wipes constraints / proposals / votes / messages / members — irreversible.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const room = await getDecisionRoomById(id);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  if (room.creator_id !== userId) {
    return NextResponse.json({ error: "Only the creator can delete this room" }, { status: 403 });
  }
  if (room.status !== "done" && room.status !== "abandoned") {
    return NextResponse.json(
      { error: "Cancel or finish the room first." },
      { status: 409 }
    );
  }

  await deleteDecisionRoom(id);
  return NextResponse.json({ deleted: true });
}
