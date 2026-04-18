import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { removeBlock } from "@/lib/db";

type Params = { params: Promise<{ userId: string }> };

/**
 * DELETE /api/contacts/blocks/[userId]
 *
 * Unblock a user. They can then send a new contact request, subject to the
 * normal guards (cooldown is not reset — but cancelled-by-block rows aren't
 * 'declined' so there's no cooldown to hit).
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { userId: me } = await auth();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId: target } = await params;
  if (!target) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const removed = await removeBlock(me, target);
  return NextResponse.json({ unblocked: removed });
}
