import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getRecentCollaborators } from "@/lib/db";

/** GET /api/collaborators/recent — user IDs of people I've shared Rooms with. */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user_ids = await getRecentCollaborators(userId, 20);
  return NextResponse.json({ user_ids });
}
