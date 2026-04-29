import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listSuggestedContacts } from "@/lib/db";

/**
 * GET /api/contacts/suggestions
 *
 * "People you've decided with but haven't saved." Powers the suggestion row
 * on /contacts so DR partners surface as add-able once a relationship has
 * proven itself (rather than waiting for the user to remember a handle).
 *
 * Returns an empty array when signed out — the UI hides the row in that
 * case, no special status is needed.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ suggestions: [] });
  const suggestions = await listSuggestedContacts(userId, 5);
  return NextResponse.json({ suggestions });
}
