import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import {
  getDecisionSession,
  listDecisionSessionMembers,
  createBookingJob,
  type BookingJobStep,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/decision-session/[id]/book
 *
 * Turn a decided DR into a real booking job. Solves the "we agreed but
 * how do we actually book" gap — previously the user had to leave Onegent
 * and re-enter the search elsewhere, which made the share-link UX feel
 * like the only way to "do something" with the decision.
 *
 * Behavior:
 *   - Caller must be initiator OR a member of the session.
 *   - Session must be in `decided` state.
 *   - We create a single-step booking_job for the decided restaurant +
 *     return the jobId. The caller then navigates to /tasks?focus=<id>
 *     and clicks Confirm to actually launch the autopilot.
 *
 * Date/time aren't extracted from the freeform initiator_constraints —
 * the agent prompts for them during the booking flow instead. Covers
 * defaults to the group size (1 + 1 in 2-party, members.length in group).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await getDecisionSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status !== "decided") {
    return NextResponse.json(
      { error: "Decision must be agreed on before booking" },
      { status: 409 },
    );
  }

  // Authz: caller must be a participant — initiator, invitee, or a member
  // in the group_members table.
  const isInitiator = session.initiator_user_id === userId;
  const isInvitee = session.invitee_user_id === userId;
  let allowed = isInitiator || isInvitee;
  let memberCount = 2;
  if (!allowed) {
    const members = await listDecisionSessionMembers(id);
    allowed = members.some((m) => m.user_id === userId);
    if (allowed) memberCount = members.length;
  } else {
    const members = await listDecisionSessionMembers(id);
    if (members.length > 0) memberCount = members.length;
  }
  if (!allowed) {
    return NextResponse.json({ error: "You're not in this room" }, { status: 403 });
  }

  // Pull the decided card off merged_options.
  const cards = (session.merged_options ?? []) as Array<{
    restaurant?: { id?: string; name?: string; cuisine?: string; address?: string };
  }>;
  const decided = cards.find((c) => c.restaurant?.id === session.decided_card_id);
  if (!decided?.restaurant?.name) {
    return NextResponse.json(
      { error: "Couldn't read the decided restaurant — try sharing instead." },
      { status: 422 },
    );
  }

  // Body shape mirrors what /api/chat/commit's direct_booking flow emits
  // for a restaurant. /api/booking-jobs/[id]/start consumes this same
  // shape, so the autopilot path is identical.
  const restaurantName = decided.restaurant.name;
  const body: Record<string, unknown> = {
    restaurantName,
    city: session.city_id,
    covers: Math.max(2, memberCount),
  };

  const step: BookingJobStep = {
    type: "restaurant",
    emoji: "🍽️",
    label: restaurantName,
    apiEndpoint: "/api/booking-jobs/start",
    body,
    fallbackUrl: `https://www.opentable.com/s?term=${encodeURIComponent(restaurantName)}`,
    status: "pending",
  };

  const jobId = randomUUID();
  // Decision Rooms have no chat session_id of their own — reuse the DR
  // session id as the booking_job's session_id so the user's /tasks list
  // can pick it up via session matching OR via user_id.
  await createBookingJob({
    id: jobId,
    sessionId: session.id,
    userId,
    tripLabel: `${restaurantName} (Decision Room)`,
    steps: [step],
  });

  return NextResponse.json({ jobId, redirectTo: `/tasks?focus=${jobId}&view=live` });
}
