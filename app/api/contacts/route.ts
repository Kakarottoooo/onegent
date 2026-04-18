import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  canSendContactRequest,
  createContactRequest,
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
 * Body: { code: string, note?: string }
 *
 * Send a *pending contact request* to the user behind `code`. The legacy
 * direct-add behavior was removed — adding someone now always requires their
 * consent so the target can decline and trigger the 7-day cooldown if they
 * don't want further requests.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const raw = typeof body.code === "string" ? body.code.trim().replace(/^@/, "") : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null;
  if (!raw) return NextResponse.json({ error: "code required" }, { status: 400 });

  let profile = await getUserProfileByCode(raw);
  if (!profile) profile = await getUserProfileByUsername(raw);
  if (!profile) return NextResponse.json({ error: "No user with that handle" }, { status: 404 });
  if (profile.user_id === userId) {
    return NextResponse.json({ error: "That's your own code" }, { status: 400 });
  }

  const check = await canSendContactRequest(userId, profile.user_id);
  if (!check.ok) {
    return NextResponse.json({ error: check.reason, code: check.code }, { status: 409 });
  }

  const row = await createContactRequest(userId, profile.user_id, note);
  return NextResponse.json({
    request: {
      id: row.id,
      from_user_id: row.from_user_id,
      to_user_id: row.to_user_id,
      status: row.status,
      created_at: row.created_at,
      peer_profile_code: profile.profile_code,
      peer_display_name: profile.display_name,
      peer_avatar_url: profile.avatar_url,
    },
  });
}
