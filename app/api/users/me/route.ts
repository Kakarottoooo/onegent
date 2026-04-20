import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ensureUserProfile, getUserProfile } from "@/lib/db";

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

function normalizeAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 500_000);
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[A-Za-z0-9._-]{3,32}$/.test(trimmed) ? trimmed : null;
}

function isUsernameConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("username");
}

/**
 * POST /api/users/me
 * Upsert my profile row from Clerk sync on sign-in.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const displayName = normalizeDisplayName(body?.display_name);
  const avatarUrl = normalizeAvatarUrl(body?.avatar_url);
  const username = normalizeUsername(body?.username);

  try {
    const profile = await ensureUserProfile(userId, displayName, avatarUrl, username);
    return NextResponse.json({ profile });
  } catch (error) {
    if (isUsernameConflict(error)) {
      return NextResponse.json({ error: "That handle is already taken." }, { status: 409 });
    }
    throw error;
  }
}

/**
 * GET /api/users/me
 * Return my profile, lazily creating a row if none exists.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let profile = await getUserProfile(userId);
  if (!profile) {
    profile = await ensureUserProfile(userId, null, null);
  }
  return NextResponse.json({ profile });
}

/**
 * PATCH /api/users/me
 * Editable account identity surface used by /account.
 */
export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  let current = await getUserProfile(userId);
  if (!current) {
    current = await ensureUserProfile(userId, null, null, null);
  }

  const hasDisplayName = Object.prototype.hasOwnProperty.call(body, "display_name");
  const hasAvatarUrl = Object.prototype.hasOwnProperty.call(body, "avatar_url");
  const hasUsername = Object.prototype.hasOwnProperty.call(body, "username");

  const nextDisplayName = hasDisplayName
    ? normalizeDisplayName(body?.display_name)
    : current.display_name;
  const nextAvatarUrl = hasAvatarUrl
    ? normalizeAvatarUrl(body?.avatar_url)
    : current.avatar_url;
  const nextUsername = hasUsername
    ? normalizeUsername(body?.username)
    : current.username;

  if (hasUsername && body?.username && !nextUsername) {
    return NextResponse.json(
      {
        error:
          "Handle must be 3-32 characters using letters, numbers, dots, underscores, or hyphens.",
      },
      { status: 400 },
    );
  }

  try {
    const profile = await ensureUserProfile(
      userId,
      nextDisplayName,
      nextAvatarUrl,
      nextUsername,
    );
    return NextResponse.json({ profile });
  } catch (error) {
    if (isUsernameConflict(error)) {
      return NextResponse.json({ error: "That handle is already taken." }, { status: 409 });
    }
    throw error;
  }
}
