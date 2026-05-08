import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { deleteGmailConnection, getGmailConnectionWithSecrets } from "@/lib/gmail-db";
import { revokeGoogleGmailToken } from "@/lib/google-gmail";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const connection = await getGmailConnectionWithSecrets(userId, "google");
  if (connection?.refreshToken) {
    await revokeGoogleGmailToken(connection.refreshToken);
  } else if (connection?.accessToken) {
    await revokeGoogleGmailToken(connection.accessToken);
  }
  await deleteGmailConnection(userId, "google");
  return NextResponse.json({ ok: true });
}
