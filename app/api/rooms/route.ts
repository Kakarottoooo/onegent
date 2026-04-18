import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import {
  createDecisionRoom,
  listMyDecisionRooms,
  type ApprovalRule,
  type DecisionRoomType,
} from "@/lib/db";

const ALLOWED_TYPES: DecisionRoomType[] = ["restaurant", "hotel", "flight", "activity"];
const ALLOWED_RULES: ApprovalRule[] = ["unanimous", "majority"];

/** POST /api/rooms — create a new Decision Room. */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const type = body.type as DecisionRoomType | undefined;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const payerId = typeof body.payer_id === "string" && body.payer_id.length > 0 ? body.payer_id : null;
  const contextJson = body.context && typeof body.context === "object" ? body.context as Record<string, unknown> : {};
  const deadline = typeof body.deadline === "string" ? body.deadline : null;
  const approvalRule =
    typeof body.approval_rule === "string" && ALLOWED_RULES.includes(body.approval_rule as ApprovalRule)
      ? (body.approval_rule as ApprovalRule)
      : undefined;

  if (!type || !ALLOWED_TYPES.includes(type)) {
    return NextResponse.json({ error: `type must be one of ${ALLOWED_TYPES.join(", ")}` }, { status: 400 });
  }
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const id = randomUUID();
  const room = await createDecisionRoom({
    id,
    type,
    title,
    creatorId: userId,
    payerId,
    contextJson,
    deadline,
    approvalRule,
  });

  return NextResponse.json({ room });
}

/** GET /api/rooms — list Rooms this user is a member of. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rooms = await listMyDecisionRooms(userId);
  return NextResponse.json({ rooms });
}
