import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listNotifications } from "@/lib/db";

/**
 * GET /api/notifications?unread=true&limit=30
 * Returns the caller's notifications, newest first.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ notifications: [] });

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unread") === "true";
  const limitParam = parseInt(searchParams.get("limit") ?? "30", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 30;

  const notifications = await listNotifications(userId, { unreadOnly, limit });
  return NextResponse.json({ notifications });
}
