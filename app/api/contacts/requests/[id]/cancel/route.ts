import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getContactRequestById, updateContactRequestStatus } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/contacts/requests/[id]/cancel
 *
 * Withdraw my own outgoing pending request. Does not trigger the decline
 * cooldown (the recipient never had a chance to act).
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const request = await getContactRequestById(id);
  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (request.from_user_id !== userId) {
    return NextResponse.json({ error: "Not your request to cancel" }, { status: 403 });
  }
  if (request.status !== "pending") {
    return NextResponse.json(
      { error: `Request already ${request.status}` },
      { status: 409 }
    );
  }

  const updated = await updateContactRequestStatus(id, "cancelled");
  if (!updated) {
    return NextResponse.json({ error: "Request already resolved" }, { status: 409 });
  }
  return NextResponse.json({ request: updated });
}
