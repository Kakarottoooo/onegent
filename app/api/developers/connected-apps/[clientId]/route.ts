import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { revokeUserAppGrants } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/developers/connected-apps/[clientId]
 *
 * Disconnect (soft-revoke) all of the current user's tokens for this OAuth
 * client. Equivalent to clicking "Disconnect" in Stripe / GitHub. The
 * oauth_clients row stays (other users may have authorized the same client;
 * re-authorization later will reuse the same client_id).
 *
 * Returns 200 even if zero rows were updated — the user's intent is "I want
 * this app gone", and a no-op result still satisfies that.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ clientId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { clientId } = await ctx.params;
  if (!clientId || typeof clientId !== "string") {
    return NextResponse.json({ error: "invalid_client_id" }, { status: 400 });
  }

  const result = await revokeUserAppGrants(userId, clientId);
  return NextResponse.json({
    clientId,
    revoked: true,
    accessTokensRevoked: result.accessRevoked,
    refreshTokensRevoked: result.refreshRevoked,
  });
}
