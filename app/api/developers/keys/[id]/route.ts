import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { deactivateApiKey, findApiKeyById } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/developers/keys/[id]
 *
 * Soft-revoke a key. Authorizes by matching key.user_id against the
 * current Clerk user — anyone else gets 404 (not 403) so we don't leak
 * the existence of a key id by status code.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  const row = await findApiKeyById(id);
  if (!row || row.user_id !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!row.is_active) {
    return NextResponse.json({ error: "already_revoked" }, { status: 409 });
  }

  await deactivateApiKey(id);
  return NextResponse.json({ id, revoked: true });
}
