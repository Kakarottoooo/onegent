import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getItinerary,
  updateItinerary,
  softDeleteItinerary,
  listItineraryItems,
  getBookingJob,
  getDecisionSession,
  type ItineraryItem,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/itineraries/[id]
 * Returns the itinerary + its items, with each item's underlying ref
 * resolved into a display-safe preview. Owner-only read for now (we'll
 * relax for shared trips when /s/[slug] kind='trip' lands).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await auth();
  const itinerary = await getItinerary(id);
  if (!itinerary) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (itinerary.owner_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rawItems = await listItineraryItems(id);
  const items = await Promise.all(
    rawItems.map(async (it) => buildItemPreview(it)),
  );
  return NextResponse.json({ itinerary, items });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    title?: string;
    city?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    coverEmoji?: string | null;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const updated = await updateItinerary(id, userId, body);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ itinerary: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ok = await softDeleteItinerary(id, userId);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Resolve an itinerary item into the minimum needed for the manage UI. */
async function buildItemPreview(it: ItineraryItem) {
  const base = {
    item_kind: it.item_kind,
    item_id: it.item_id,
    position: it.position,
    added_at: it.added_at,
    title: it.snapshot_title ?? "Removed",
    subtitle: it.snapshot_subtitle ?? null as string | null,
    href: null as string | null,
  };
  try {
    if (it.item_kind === "booking_job") {
      const job = await getBookingJob(it.item_id);
      if (job) {
        return {
          ...base,
          title: job.trip_label,
          subtitle: job.steps?.[0]
            ? `${job.steps[0].emoji} ${job.steps[0].label}`
            : null,
          href: `/tasks?focus=${encodeURIComponent(job.id)}&view=live`,
        };
      }
    } else if (it.item_kind === "dr_outcome") {
      const session = await getDecisionSession(it.item_id);
      if (session) {
        const cards = (session.merged_options ?? []) as Array<{
          restaurant?: { id?: string; name?: string; cuisine?: string };
        }>;
        const decided = cards.find((c) => c.restaurant?.id === session.decided_card_id);
        return {
          ...base,
          title: decided?.restaurant?.name ?? "Decision Room",
          subtitle: decided?.restaurant?.cuisine ?? null,
          href: `/decide/${session.id}`,
        };
      }
    }
  } catch {
    /* fall through to base */
  }
  return base;
}
