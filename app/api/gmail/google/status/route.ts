import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getGmailConnection } from "@/lib/gmail-db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({
      connected: false,
      meta: {
        shape: "gmail-google-status",
        scope: "gmail.readonly",
        heavy_fields_excluded: ["message_bodies", "message_snippets", "otp_codes"],
      },
    });
  }

  const connection = await getGmailConnection(userId, "google");
  return NextResponse.json({
    connected: !!connection,
    account_email: connection?.external_account_email ?? null,
    last_used_at: connection?.last_used_at ?? null,
    meta: {
      shape: "gmail-google-status",
      scope: "gmail.readonly",
      heavy_fields_excluded: ["message_bodies", "message_snippets", "otp_codes"],
    },
  });
}
