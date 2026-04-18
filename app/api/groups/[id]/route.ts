import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  deleteGroup,
  getGroup,
  listGroupMembersWithProfiles,
  renameGroup,
} from "@/lib/db";

/** GET /api/groups/[id] — group + members (owner-gated). */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const group = await getGroup(userId, id);
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  const members = await listGroupMembersWithProfiles(userId, id);
  return NextResponse.json({ group, members });
}

/** PATCH /api/groups/[id]  body: { name: string } */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const group = await renameGroup(userId, id, name);
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  return NextResponse.json({ group });
}

/** DELETE /api/groups/[id] */
export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const removed = await deleteGroup(userId, id);
  if (!removed) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
