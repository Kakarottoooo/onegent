import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  canSendContactRequest,
  createContactRequest,
  getUserProfile,
  getUserProfileByCode,
  usersShareRoom,
} from "@/lib/db";

/**
 * POST /api/contacts/requests
 * Body: { user_id?: string, profile_code?: string, note?: string }
 *
 * Create a pending contact request. Exactly one of user_id / profile_code must
 * be supplied. If user_id, the caller must already share a room with them —
 * prevents strangers from bulk-probing via scraped ids. profile_code has no
 * room guard since codes are only shared out-of-band (already an affirmative
 * invitation path).
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const targetUserId =
    typeof body?.user_id === "string" && body.user_id.length > 0 ? body.user_id : null;
  const profileCode =
    typeof body?.profile_code === "string" && body.profile_code.length > 0
      ? body.profile_code.trim().toUpperCase()
      : null;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 200) || null : null;

  if (!targetUserId && !profileCode) {
    return NextResponse.json(
      { error: "user_id or profile_code required" },
      { status: 400 }
    );
  }

  let toUserId: string;
  if (targetUserId) {
    const shares = await usersShareRoom(userId, targetUserId);
    if (!shares) {
      return NextResponse.json(
        { error: "You can only add someone you share a room with." },
        { status: 403 }
      );
    }
    const profile = await getUserProfile(targetUserId);
    if (!profile) {
      return NextResponse.json({ error: "That user has no profile yet." }, { status: 404 });
    }
    toUserId = targetUserId;
  } else {
    const profile = await getUserProfileByCode(profileCode!);
    if (!profile) {
      return NextResponse.json({ error: "No user with that code." }, { status: 404 });
    }
    toUserId = profile.user_id;
  }

  const check = await canSendContactRequest(userId, toUserId);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason, code: check.code }, { status: 409 });
  }

  const row = await createContactRequest(userId, toUserId, note);
  return NextResponse.json({ request: row });
}
