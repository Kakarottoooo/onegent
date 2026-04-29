import { NextRequest, NextResponse } from "next/server";

/**
 * @deprecated as of Plan A — multi-decider intent now flows through the
 * homepage chat (NLU detects "我和X一起..." → /api/chat/commit's
 * create_room → chat-flow Decision Room at /?room_id=<id>). This POST
 * endpoint returns 410 Gone to prevent any leftover UI from creating
 * fresh legacy decision_sessions rows.
 *
 * Sister endpoints (GET / PATCH at /api/decision-session/[id], plus
 * POST /api/decision-session/[id]/book) are intentionally NOT
 * deprecated — they keep working for sessions that already exist so
 * historical /decide/[sessionId] links / share links don't 404.
 */
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      error: "Decision Sessions are deprecated.",
      message:
        "Decision Rooms now live in the homepage chat. Open / and say '我和 X 一起...' to start one.",
    },
    { status: 410 },
  );
}
