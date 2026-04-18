import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  appendRoomMessage,
  getDecisionRoomById,
  listRoomMembers,
  updateDecisionRoomApprovalRule,
  type ApprovalRule,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

const ALLOWED: ApprovalRule[] = ["unanimous", "majority"];

/**
 * POST /api/rooms/[id]/approval-rule
 * Body: { approval_rule: "unanimous" | "majority" }
 *
 * Creator-only. Only allowed while status='collecting' (no proposal yet) so a
 * rule change never invalidates in-flight votes. With <3 joined members the
 * vote logic coerces to unanimous anyway, so we refuse the change there to
 * avoid a misleading UI state.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: roomId } = await params;
  const room = await getDecisionRoomById(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.creator_id !== userId) {
    return NextResponse.json({ error: "Only the creator can change the rule." }, { status: 403 });
  }
  if (room.status !== "collecting") {
    return NextResponse.json(
      { error: "Rule can only be changed before a proposal is generated." },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => null);
  const rule = body?.approval_rule as ApprovalRule | undefined;
  if (!rule || !ALLOWED.includes(rule)) {
    return NextResponse.json({ error: `approval_rule must be one of ${ALLOWED.join(", ")}` }, { status: 400 });
  }

  const members = await listRoomMembers(roomId);
  if (members.length < 3 && rule === "majority") {
    return NextResponse.json(
      { error: "Majority voting needs at least 3 members." },
      { status: 409 }
    );
  }

  if (room.approval_rule === rule) {
    return NextResponse.json({ rule, unchanged: true });
  }

  await updateDecisionRoomApprovalRule(roomId, rule);
  await appendRoomMessage({
    roomId,
    senderId: null,
    content: `The creator changed the approval rule to ${rule === "unanimous" ? "Unanimous" : "Majority"}.`,
    metaJson: {
      kind: "approval_rule_changed",
      from: room.approval_rule ?? null,
      to: rule,
      user_id: userId,
    },
  }).catch(() => { /* advisory */ });

  return NextResponse.json({ rule });
}
