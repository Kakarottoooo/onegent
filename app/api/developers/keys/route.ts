import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import {
  createApiKey,
  findApiKeysByUserId,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/developers/keys
 *
 * List the current user's API keys (active + revoked) for the dashboard.
 * key_hash is intentionally stripped from the response — only the prefix
 * is safe to surface in the UI.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await findApiKeysByUserId(userId);
  return NextResponse.json({
    keys: rows.map((r) => ({
      id: r.id,
      name: r.organization_name,
      keyPrefix: r.key_prefix,
      isActive: r.is_active,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      revokedAt: r.revoked_at,
      env: r.key_prefix.endsWith("test") ? "test" : "live",
    })),
  });
}

/**
 * POST /api/developers/keys
 *
 * Mint a new key bound to the current Clerk user. Returns plaintext ONCE
 * — the dashboard surfaces it in a one-time reveal sheet, then it's gone
 * (we only persist sha256(plaintext)).
 *
 * Body:
 *   { name: string  — user-chosen label, e.g. "Production"
 *     env?: "live" | "test"  — default "test" so first-time users
 *                              can't accidentally rack up production charges }
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const env: "live" | "test" = body?.env === "live" ? "live" : "test";

  if (!name) {
    return NextResponse.json(
      { error: "name_required", message: "Provide a label for the key (e.g. 'Production')." },
      { status: 400 },
    );
  }
  if (name.length > 80) {
    return NextResponse.json(
      { error: "name_too_long", message: "Label must be 80 chars or fewer." },
      { status: 400 },
    );
  }

  // Soft cap: prevent runaway key creation per user (bot guard).
  const existing = await findApiKeysByUserId(userId);
  const activeCount = existing.filter((k) => k.is_active).length;
  if (activeCount >= 10) {
    return NextResponse.json(
      {
        error: "key_limit_reached",
        message:
          "Active key limit reached (10 per user). Revoke an unused key in the dashboard before creating a new one.",
      },
      { status: 429 },
    );
  }

  const result = await createApiKey({
    organizationName: name,
    userId,
    env,
  });

  return NextResponse.json({
    id: result.id,
    name: result.row.organization_name,
    keyPrefix: result.row.key_prefix,
    plaintextKey: result.plaintextKey, // only time we ever ship this
    env,
    createdAt: result.row.created_at,
  });
}
