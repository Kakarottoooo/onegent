import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { addGroupMembers, listGroupMembersWithProfiles } from "@/lib/db";

/** GET /api/groups/[id]/members — list members (owner-gated). */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const members = await listGroupMembersWithProfiles(userId, id);
  return NextResponse.json({ members });
}

/**
 * POST /api/groups/[id]/members
 * Body: { contact_user_ids: string[] }  — batch add.
 * Only actual contacts of the owner are accepted (db helper filters strangers).
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.contact_user_ids)
    ? body.contact_user_ids.filter((v: unknown): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "contact_user_ids required" }, { status: 400 });
  }

  try {
    const inserted = await addGroupMembers(userId, id, ids);
    const members = await listGroupMembersWithProfiles(userId, id);
    return NextResponse.json({ inserted, members });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add members";
    const status = msg === "Group not found" ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
