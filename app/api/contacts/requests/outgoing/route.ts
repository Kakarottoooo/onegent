import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listOutgoingContactRequests } from "@/lib/db";

/**
 * GET /api/contacts/requests/outgoing — pending requests I've sent.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requests = await listOutgoingContactRequests(userId);
  return NextResponse.json({ requests });
}
