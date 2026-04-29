import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { updateUserBio } from "@/lib/db";

/**
 * PATCH /api/users/me/bio
 *
 * Updates the authenticated user's profile bio (a short tagline shown on
 * /u/[username]). Sends back the freshened profile so the client can
 * re-render without a separate fetch.
 */
export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { bio?: unknown } | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Accept null/empty as a clear signal; anything else must be a string.
  let bio: string | null = null;
  if (body.bio === null) {
    bio = null;
  } else if (typeof body.bio === "string") {
    bio = body.bio;
  } else {
    return NextResponse.json({ error: "bio must be string or null" }, { status: 400 });
  }

  // Hard cap matches the DB-side cap inside updateUserBio. We trim + slice
  // there too — duplicating the bound here just gives a clean 400 instead
  // of silently truncating.
  if (bio && bio.length > 500) {
    return NextResponse.json({ error: "bio too long (max 500)" }, { status: 400 });
  }

  const profile = await updateUserBio(userId, bio);
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }
  return NextResponse.json({ profile });
}
