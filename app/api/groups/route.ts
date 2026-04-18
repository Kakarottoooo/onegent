import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createGroup, listMyGroups } from "@/lib/db";

/** GET /api/groups — list my groups with member counts. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groups = await listMyGroups(userId);
  return NextResponse.json({ groups });
}

/** POST /api/groups  body: { name: string } */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const group = await createGroup(userId, name);
  return NextResponse.json({ group: { ...group, member_count: 0 } });
}
