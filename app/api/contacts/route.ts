import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  addContact,
  getUserProfileByCode,
  getUserProfileByUsername,
  listContactsWithProfiles,
} from "@/lib/db";

/** GET /api/contacts — list my contacts joined with each peer's profile. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contacts = await listContactsWithProfiles(userId);
  return NextResponse.json({ contacts });
}

/**
 * POST /api/contacts
 * Body: { code: string, nickname?: string }
 * Resolves profile code → user_id and adds to my contacts.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  // Accept either a 6-char profile_code or an @username (case-insensitive).
  const raw = typeof body.code === "string" ? body.code.trim().replace(/^@/, "") : "";
  const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 60) || null : null;
  if (!raw) return NextResponse.json({ error: "code required" }, { status: 400 });

  let profile = await getUserProfileByCode(raw);
  if (!profile) profile = await getUserProfileByUsername(raw);
  if (!profile) return NextResponse.json({ error: "No user with that handle" }, { status: 404 });
  if (profile.user_id === userId) {
    return NextResponse.json({ error: "That's your own code" }, { status: 400 });
  }

  const row = await addContact(userId, profile.user_id, nickname);
  return NextResponse.json({
    contact: {
      contact_user_id: profile.user_id,
      nickname: row.nickname,
      profile_code: profile.profile_code,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      added_at: row.created_at,
    },
  });
}
