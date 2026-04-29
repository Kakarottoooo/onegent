import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { markNotificationRead } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/notifications/[id]/read
 * Mark a single notification as read. Returns 200 even if the row was
 * already read or didn't exist — keeps the UI idempotent.
 */
export async function PATCH(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await markNotificationRead(id, userId);
  return NextResponse.json({ ok: true });
}
