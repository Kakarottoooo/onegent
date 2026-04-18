import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  addContact,
  getUserProfile,
  usersShareRoom,
} from "@/lib/db";

/**
 * POST /api/contacts/by-user
 * Body: { user_id: string, nickname?: string }
 *
 * Add a user to my contacts using their internal user_id (instead of the
 * profile code). Only permitted when we already share at least one room —
 * this prevents strangers from being bulk-added via scraped ids.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const targetId = typeof body?.user_id === "string" && body.user_id.length > 0 ? body.user_id : null;
  const nickname = typeof body?.nickname === "string" ? body.nickname.trim().slice(0, 60) || null : null;
  if (!targetId) return NextResponse.json({ error: "user_id required" }, { status: 400 });
  if (targetId === userId) {
    return NextResponse.json({ error: "That's you." }, { status: 400 });
  }

  const shares = await usersShareRoom(userId, targetId);
  if (!shares) {
    return NextResponse.json(
      { error: "You can only save someone you share a room with." },
      { status: 403 }
    );
  }

  const profile = await getUserProfile(targetId);
  if (!profile) {
    return NextResponse.json({ error: "That user has no profile yet." }, { status: 404 });
  }

  const row = await addContact(userId, targetId, nickname);
  return NextResponse.json({
    contact: {
      contact_user_id: targetId,
      nickname: row.nickname,
      profile_code: profile.profile_code,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      added_at: row.created_at,
    },
  });
}
