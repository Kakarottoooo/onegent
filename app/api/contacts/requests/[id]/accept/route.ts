import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  addBidirectionalContact,
  getContactRequestById,
  updateContactRequestStatus,
} from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/contacts/requests/[id]/accept
 *
 * Mark my incoming pending request accepted and write bidirectional contacts.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const request = await getContactRequestById(id);
  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (request.to_user_id !== userId) {
    return NextResponse.json({ error: "Not your request to accept" }, { status: 403 });
  }
  if (request.status !== "pending") {
    return NextResponse.json(
      { error: `Request already ${request.status}` },
      { status: 409 }
    );
  }

  const updated = await updateContactRequestStatus(id, "accepted");
  if (!updated) {
    // Lost the race — someone resolved it concurrently.
    return NextResponse.json({ error: "Request already resolved" }, { status: 409 });
  }
  await addBidirectionalContact(request.from_user_id, request.to_user_id);

  return NextResponse.json({ request: updated });
}
