import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listIncomingContactRequests } from "@/lib/db";

/**
 * GET /api/contacts/requests/incoming — pending requests awaiting my response.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requests = await listIncomingContactRequests(userId);
  return NextResponse.json({ requests });
}
