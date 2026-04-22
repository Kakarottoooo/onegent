import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getDecisionRoomById,
  getDecisionRoomByShortCode,
  getUserProfile,
  joinDecisionRoom,
  upsertRoomConstraint,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/rooms/[id]/join
 * The [id] segment may be either the full UUID OR the 6-char short code.
 * Body may optionally include { short_code } to enforce out-of-band verification.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: identifier } = await params;
  const body = await req.json().catch(() => ({}));
  const expectedCode =
    typeof body?.short_code === "string" ? body.short_code.toUpperCase() : null;

  // Look up by UUID first; if not found, try as short code.
  let room = await getDecisionRoomById(identifier);
  if (!room && identifier.length === 6) {
    room = await getDecisionRoomByShortCode(identifier);
  }
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // If caller supplied a short_code, require it to match (belt-and-suspenders).
  if (expectedCode && expectedCode !== room.short_code) {
    return NextResponse.json({ error: "Short code mismatch" }, { status: 403 });
  }

  const member = await joinDecisionRoom(room.id, userId);

  // P1-10 Mode C: when the creator reported constraints on this member's
  // behalf in chat ("李明 不吃海鲜"), the room's context_json carries a
  // `_proxy_member_constraints` map keyed by display name. If the joining
  // user's display name matches, seed their personal constraint row (not
  // submitted — they still confirm on the room page).
  await trySeedProxyConstraints(room, userId).catch((err) => {
    console.warn("[rooms/join] proxy seed failed", err);
  });

  return NextResponse.json({ room, member });
}

async function trySeedProxyConstraints(
  room: { id: string; context_json: unknown },
  userId: string
): Promise<void> {
  const ctx = room.context_json;
  if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) return;
  const proxy = (ctx as Record<string, unknown>)._proxy_member_constraints;
  if (!proxy || typeof proxy !== "object" || Array.isArray(proxy)) return;

  const profile = await getUserProfile(userId).catch(() => null);
  const candidates: string[] = [];
  if (profile?.display_name) candidates.push(profile.display_name);
  if (profile?.username) candidates.push(profile.username);

  // Case-insensitive exact match against the stash keys.
  const stash = proxy as Record<string, unknown>;
  const stashKeys = Object.keys(stash);
  const match = stashKeys.find((k) =>
    candidates.some((c) => c.toLowerCase() === k.toLowerCase())
  );
  if (!match) return;

  const seed = stash[match];
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) return;
  if (Object.keys(seed).length === 0) return;

  await upsertRoomConstraint(room.id, userId, seed as Record<string, unknown>, false);
}
