import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createItinerary, listItinerariesByOwner } from "@/lib/db";

/**
 * GET /api/itineraries — list mine.
 * POST /api/itineraries — create. Body: { title, city?, startDate?, endDate?, coverEmoji? }
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ itineraries: [] });
  const itineraries = await listItinerariesByOwner(userId);
  return NextResponse.json({ itineraries });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    title?: string;
    city?: string;
    startDate?: string;
    endDate?: string;
    coverEmoji?: string;
  } | null;

  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (title.length > 200) {
    return NextResponse.json({ error: "title too long (max 200)" }, { status: 400 });
  }

  // Date format defense: accept YYYY-MM-DD only. Anything else clears it
  // rather than blowing up.
  const dateOk = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

  const itinerary = await createItinerary({
    ownerId: userId,
    title,
    city: body?.city?.trim() || null,
    startDate: dateOk(body?.startDate),
    endDate: dateOk(body?.endDate),
    coverEmoji: body?.coverEmoji?.trim().slice(0, 8) || null,
  });
  return NextResponse.json({ itinerary });
}
