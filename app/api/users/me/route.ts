import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ensureUserProfile, getUserProfile } from "@/lib/db";

/**
 * POST /api/users/me
 * Upsert my profile row with display_name / avatar_url from Clerk.
 * Safe to call repeatedly — called from ClerkSync on every sign-in.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const displayName = typeof body?.display_name === "string" ? body.display_name.slice(0, 120) : null;
  const avatarUrl = typeof body?.avatar_url === "string" ? body.avatar_url.slice(0, 500) : null;
  const rawUsername = typeof body?.username === "string" ? body.username.trim() : null;
  // Allow a-z/0-9/._- up to 32 chars (Clerk's typical constraints); coerce empty → null.
  const username =
    rawUsername && /^[A-Za-z0-9._-]{1,32}$/.test(rawUsername) ? rawUsername : null;

  const profile = await ensureUserProfile(userId, displayName, avatarUrl, username);
  return NextResponse.json({ profile });
}

/** GET /api/users/me — return my profile, lazily creating a row if none exists. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let profile = await getUserProfile(userId);
  if (!profile) {
    profile = await ensureUserProfile(userId, null, null);
  }
  return NextResponse.json({ profile });
}
