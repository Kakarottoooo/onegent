import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { markAllNotificationsRead } from "@/lib/db";

/**
 * POST /api/notifications/read-all
 * Mark every unread notification as read for the calling user.
 */
export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await markAllNotificationsRead(userId);
  return NextResponse.json({ ok: true });
}
