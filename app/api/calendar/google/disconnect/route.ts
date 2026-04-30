import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { deleteCalendarConnection, getCalendarConnectionWithSecrets } from "@/lib/calendar-db";
import { revokeGoogleCalendarToken } from "@/lib/google-calendar";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const connection = await getCalendarConnectionWithSecrets(userId, "google");
  if (connection?.refreshToken) {
    await revokeGoogleCalendarToken(connection.refreshToken);
  } else if (connection?.accessToken) {
    await revokeGoogleCalendarToken(connection.accessToken);
  }
  await deleteCalendarConnection(userId, "google");
  return NextResponse.json({ ok: true });
}
