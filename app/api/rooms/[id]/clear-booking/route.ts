import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDecisionRoomById, clearDecisionRoomBookingJob } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/rooms/[id]/clear-booking
 * Clears the room's booking_job_id so the AcceptedBlock returns to the
 * date-picker form. Called when:
 *   - The referenced booking_job has been deleted (404)
 *   - The payer wants to retry a failed booking
 * Only the room's payer may clear.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  const room = await getDecisionRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const payerId = room.payer_id ?? room.creator_id;
  if (userId !== payerId) {
    return NextResponse.json({ error: "Only the payer may clear the booking" }, { status: 403 });
  }

  await clearDecisionRoomBookingJob(roomId);
  return NextResponse.json({ cleared: true });
}
