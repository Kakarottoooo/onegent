/**
 * POST /api/rooms/[id]/synthesize
 *
 * Manual synthesis trigger. Dispatches by room.type:
 *
 *   trip                                → trip-synthesis (buildTripPackage)
 *                                          creates a TripPackage proposal
 *                                          row + transitions room status
 *                                          to "approving"
 *
 *   restaurant / hotel / flight /       → scenario-synthesis: merges
 *   activity                              members' IntentStates into a
 *                                          single search query string the
 *                                          client passes to /api/chat with
 *                                          categoryHint=room.type
 *
 * Two modes for trip rooms:
 *   - Normal (body.force !== true): obeys the same gate as auto-trigger
 *     (one-time lock via synthesis_json IS NOT NULL; all members must
 *     have contributed at least one intent).
 *   - Force (body.force === true): bypass the lock and re-synthesize.
 *
 * For non-trip rooms `force=true` ALSO bypasses the all-members-contributed
 * gate — the merge just uses what's available so a single user can preview
 * options before partners chat.
 *
 * Auth: must be a joined member of the room.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDecisionRoomById, isRoomMember } from "@/lib/db";
import { triggerSynthesis } from "@/lib/agent/trip-synthesis";
import { synthesizeScenarioRoom } from "@/lib/agent/scenario-synthesis";

export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  if (!roomId) return NextResponse.json({ error: "room id required" }, { status: 400 });

  const member = await isRoomMember(roomId, userId);
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const room = await getDecisionRoomById(roomId).catch(() => null);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const force = body?.force === true;

  try {
    if (room.type === "trip") {
      const outcome = await triggerSynthesis(roomId, { force });
      return NextResponse.json({
        ok: true,
        room_type: "trip",
        triggered: outcome.triggered,
        reason: outcome.reason,
        status: outcome.result?.status ?? null,
        member_count: outcome.result?.memberCount ?? null,
        contributor_count: outcome.result?.contributorCount ?? null,
        missing: outcome.result?.missing ?? [],
      });
    }

    // restaurant / hotel / flight / activity — light-weight merge that
    // returns a search query the client posts to /api/chat. No room.status
    // transition, no proposal row, no synthesis_json lock — those stay
    // trip-only for now (Plan A's MVP scope).
    const outcome = await synthesizeScenarioRoom(roomId, { force });
    return NextResponse.json({
      ok: true,
      room_type: room.type,
      triggered: outcome.status === "ok",
      reason: outcome.status,
      status: outcome.status,
      member_count: outcome.result?.memberCount ?? null,
      contributor_count: outcome.result?.contributorCount ?? null,
      query: outcome.result?.query ?? null,
      merged: outcome.result?.merged ?? null,
    });
  } catch (err) {
    console.error(`[rooms/${roomId}/synthesize] error:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "synthesis failed" },
      { status: 500 },
    );
  }
}
