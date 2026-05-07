import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getCalendarConnection } from "@/lib/calendar-db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({
      connected: false,
      meta: {
        shape: "calendar-google-status",
        heavy_fields_excluded: ["busy_counts", "events_by_day", "event_details"],
      },
    });
  }

  const connection = await getCalendarConnection(userId, "google");
  return NextResponse.json({
    connected: !!connection,
    account_email: connection?.external_account_email ?? null,
    timezone: connection?.calendar_timezone ?? null,
    last_synced_at: connection?.last_synced_at ?? null,
    meta: {
      shape: "calendar-google-status",
      heavy_fields_excluded: ["busy_counts", "events_by_day", "event_details"],
    },
  });
}
