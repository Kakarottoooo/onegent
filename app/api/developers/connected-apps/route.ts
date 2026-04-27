import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { findConnectedAppsByUserId } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/developers/connected-apps
 *
 * List the current Clerk user's OAuth grants — one row per client that has
 * at least one live access_token OR refresh_token. Powers the
 * /developers/connected-apps dashboard (Stripe-style "Apps with access").
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await findConnectedAppsByUserId(userId);
  return NextResponse.json({
    apps: rows.map((r) => ({
      clientId: r.client_id,
      name: r.name,
      clientUri: r.client_uri,
      dynamicallyRegistered: r.dynamically_registered,
      scopes: r.scopes,
      firstAuthorizedAt: r.first_authorized_at,
      lastTokenAt: r.last_token_at,
    })),
  });
}
