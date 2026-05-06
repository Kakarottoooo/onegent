import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUnreadNotificationCount } from "@/lib/db";

/**
 * GET /api/notifications/unread-count
 * Lightweight endpoint for the bell badge. Polls every ~30s — kept
 * separate from the main list so we don't blow cache on every poll.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ count: 0 });
  const count = await getUnreadNotificationCount(userId);
  return NextResponse.json(
    { count },
    { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=45" } },
  );
}
