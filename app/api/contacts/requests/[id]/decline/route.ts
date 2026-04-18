import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getContactRequestById, updateContactRequestStatus } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/contacts/requests/[id]/decline
 *
 * Decline an incoming pending request. Starts the 7-day cooldown enforced by
 * canSendContactRequest — the sender can't retry until then unless the
 * decliner unblocks or the cooldown expires.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const request = await getContactRequestById(id);
  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (request.to_user_id !== userId) {
    return NextResponse.json({ error: "Not your request to decline" }, { status: 403 });
  }
  if (request.status !== "pending") {
    return NextResponse.json(
      { error: `Request already ${request.status}` },
      { status: 409 }
    );
  }

  const updated = await updateContactRequestStatus(id, "declined");
  if (!updated) {
    return NextResponse.json({ error: "Request already resolved" }, { status: 409 });
  }
  return NextResponse.json({ request: updated });
}
