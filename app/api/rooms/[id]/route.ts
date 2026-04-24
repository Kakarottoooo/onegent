import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  areContacts,
  deleteDecisionRoom,
  getDecisionRoomById,
  getUserProfile,
  isRoomMember,
  listRoomMembersWithInvited,
  sendDirectMessage,
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
 * Permanently remove a room and all its data. Creator-only; blocked only while
 * booking is actively executing so we don't strand an in-flight booking job. This
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
  if (room.status === "executing") {
    return NextResponse.json(
      { error: "Clear the in-progress booking first." },
      { status: 409 }
    );
  }

  // Before deleting, notify every non-creator member via DM so they know the
  // room was dismissed (otherwise the room silently disappears from their
  // sidebar on next poll). Each DM is best-effort — a failure doesn't block
  // the delete.
  try {
    // Include invited members too — they were expecting to join, so they
    // should also get the dismissal DM.
    const members = await listRoomMembersWithInvited(id);
    const creatorProfile = await getUserProfile(userId).catch(() => null);
    const creatorLabel =
      creatorProfile?.display_name ||
      creatorProfile?.username ||
      "The creator";
    for (const m of members) {
      if (m.user_id === userId) continue;
      if (m.status === "left") continue; // they already left; don't follow them
      // Only DM if they're still a contact (the DM API gates on this too).
      if (!(await areContacts(userId, m.user_id).catch(() => false))) continue;
      try {
        await sendDirectMessage({
          fromUserId: userId,
          toUserId: m.user_id,
          role: "agent",
          content: `${creatorLabel} dismissed the trip "${room.title}". The room is no longer available.`,
          metaJson: {
            kind: "trip_dismissed",
            room_id: id,
            room_title: room.title,
          },
        });
      } catch (err) {
        console.warn(`[rooms/delete] DM to ${m.user_id} failed`, err);
      }
    }
  } catch (err) {
    console.warn(`[rooms/delete] member-notify phase failed`, err);
  }

  await deleteDecisionRoom(id);
  return NextResponse.json({ deleted: true });
}
