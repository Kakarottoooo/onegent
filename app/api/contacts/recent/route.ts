import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listRecentContacts } from "@/lib/db";

/**
 * GET /api/contacts/recent
 *
 * Returns the user's contacts ranked by most-recent shared Decision Room
 * (falling back to most-recently-added). Powers the homepage "Recent" chip
 * row so frequent partners are one tap away from a new DR.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ contacts: [] });
  const contacts = await listRecentContacts(userId, 5);
  return NextResponse.json({ contacts });
}
