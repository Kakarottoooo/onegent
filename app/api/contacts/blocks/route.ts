import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createBlock, listMyBlocks } from "@/lib/db";

/**
 * GET /api/contacts/blocks — list users I've blocked.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocks = await listMyBlocks(userId);
  return NextResponse.json({ blocks });
}

/**
 * POST /api/contacts/blocks
 * Body: { user_id: string }
 *
 * Block a user. Cancels any pending request in either direction and wipes the
 * contact relationship on both sides. Blocks persist until DELETEd.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const targetId =
    typeof body?.user_id === "string" && body.user_id.length > 0 ? body.user_id : null;
  if (!targetId) return NextResponse.json({ error: "user_id required" }, { status: 400 });
  if (targetId === userId) {
    return NextResponse.json({ error: "You can't block yourself." }, { status: 400 });
  }

  await createBlock(userId, targetId);
  return NextResponse.json({ blocked: true });
}
