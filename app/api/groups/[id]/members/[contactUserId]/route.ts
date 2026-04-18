import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { removeGroupMember } from "@/lib/db";

/** DELETE /api/groups/[id]/members/[contactUserId] */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; contactUserId: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, contactUserId } = await context.params;
  const removed = await removeGroupMember(userId, id, contactUserId);
  if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
