import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getItinerary,
  addItineraryItem,
  getBookingJob,
  getDecisionSession,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/itineraries/[id]/items
 * Body: { item_kind: 'booking_job' | 'dr_outcome', item_id: string, position?: number }
 *
 * Idempotent — if (kind, item_id) is already in the itinerary it returns
 * the existing row unchanged. We also verify the underlying ref exists
 * AND the caller owns it (no slipping someone else's booking into your
 * trip).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const itinerary = await getItinerary(id);
  if (!itinerary || itinerary.owner_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    item_kind?: string;
    item_id?: string;
    position?: number;
  } | null;

  const itemKind = body?.item_kind;
  const itemId = typeof body?.item_id === "string" ? body.item_id.trim() : "";
  if (!itemId || (itemKind !== "booking_job" && itemKind !== "dr_outcome")) {
    return NextResponse.json({ error: "item_kind and item_id required" }, { status: 400 });
  }

  // Verify ref ownership.
  if (itemKind === "booking_job") {
    const job = await getBookingJob(itemId);
    if (!job) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    if (job.user_id !== userId) {
      return NextResponse.json({ error: "Not your booking" }, { status: 403 });
    }
  } else {
    const session = await getDecisionSession(itemId);
    if (!session) return NextResponse.json({ error: "DR not found" }, { status: 404 });
    const isInitiator = session.initiator_user_id === userId;
    const isInvitee = session.invitee_user_id === userId;
    if (!isInitiator && !isInvitee) {
      return NextResponse.json({ error: "Not your DR" }, { status: 403 });
    }
  }

  const item = await addItineraryItem({
    itineraryId: id,
    itemKind: itemKind as "booking_job" | "dr_outcome",
    itemId,
    position: typeof body?.position === "number" ? body.position : 0,
  });
  return NextResponse.json({ item });
}
