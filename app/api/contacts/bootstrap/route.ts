import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getContactWorkspaceCounts,
  getUserProfile,
  listContactsWithProfiles,
} from "@/lib/db";
import { buildContactsWorkspaceBootstrap } from "@/lib/app-shell-read-model";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [profile, contacts, counts] = await Promise.all([
    getUserProfile(userId),
    listContactsWithProfiles(userId),
    getContactWorkspaceCounts(userId),
  ]);

  return NextResponse.json(buildContactsWorkspaceBootstrap({ profile, contacts, counts }));
}
