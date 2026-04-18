import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserProfileByCode, getUserProfileByUsername } from "@/lib/db";

type Params = { params: Promise<{ code: string }> };

/**
 * GET /api/users/by-code/[code]
 * Resolve a handle → public profile. Accepts either:
 *   - a 6-char profile_code (e.g. "GF4GVE"), or
 *   - a Clerk username (e.g. "ziweib"), with or without leading "@".
 *
 * Tries profile_code first (uppercase exact match), then falls back to
 * username (case-insensitive). Used by the "Add contact" flow.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { code } = await params;
  const raw = code.trim().replace(/^@/, "");
  if (raw.length < 3 || raw.length > 32) {
    return NextResponse.json({ error: "Invalid handle" }, { status: 400 });
  }

  // Try profile_code first (canonical short code path).
  let profile = await getUserProfileByCode(raw);

  // Fall back to username lookup if no code match — lets users share @handle.
  if (!profile) {
    profile = await getUserProfileByUsername(raw);
  }

  if (!profile) return NextResponse.json({ error: "No user with that handle" }, { status: 404 });

  return NextResponse.json({
    user: {
      user_id: profile.user_id,
      profile_code: profile.profile_code,
      username: profile.username,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
    },
  });
}
