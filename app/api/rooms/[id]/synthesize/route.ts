/**
 * POST /api/rooms/[id]/synthesize
 *
 * Manual trigger for trip synthesis. Two modes:
 *   - Normal (body.force !== true): obeys the same gate as the auto-trigger
 *     (one-time lock via synthesis_json IS NOT NULL; all members must have
 *     contributed at least one intent). Useful when the auto-trigger was
 *     missed (e.g. a chat turn that failed to fire `after()`).
 *   - Force (body.force === true): bypass the lock and re-synthesize with
 *     the current state. Overwrites synthesis_json and posts a fresh public
 *     summary. Room status transitions back to "approving" if it was past.
 *
 * Auth: must be a joined member of the room.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isRoomMember } from "@/lib/db";
import { triggerSynthesis } from "@/lib/agent/trip-synthesis";

export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  if (!roomId) return NextResponse.json({ error: "room id required" }, { status: 400 });

  const member = await isRoomMember(roomId, userId);
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const force = body?.force === true;

  try {
    const outcome = await triggerSynthesis(roomId, { force });
    return NextResponse.json({
      ok: true,
      triggered: outcome.triggered,
      reason: outcome.reason,
      status: outcome.result?.status ?? null,
      member_count: outcome.result?.memberCount ?? null,
      contributor_count: outcome.result?.contributorCount ?? null,
      missing: outcome.result?.missing ?? [],
    });
  } catch (err) {
    console.error(`[rooms/${roomId}/synthesize] error:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "synthesis failed" },
      { status: 500 },
    );
  }
}
