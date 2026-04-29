import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getItinerary, removeItineraryItem } from "@/lib/db";

type Params = { params: Promise<{ id: string; kind: string; itemId: string }> };

/**
 * DELETE /api/itineraries/[id]/items/[kind]/[itemId]
 * Owner-only removal of a single item from an itinerary. The booking/DR
 * itself is untouched.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, kind, itemId } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const itinerary = await getItinerary(id);
  if (!itinerary || itinerary.owner_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (kind !== "booking_job" && kind !== "dr_outcome") {
    return NextResponse.json({ error: "Invalid item kind" }, { status: 400 });
  }
  await removeItineraryItem(id, kind, itemId);
  return NextResponse.json({ ok: true });
}
