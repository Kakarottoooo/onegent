import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { buildBusyCountsByDay, buildExternalEventsByDay } from "@/lib/calendar-availability";
import { getCalendarConnection } from "@/lib/calendar-db";
import { syncGoogleBusySlots, syncGoogleCalendarEvents } from "@/lib/calendar-service";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ connected: false, busy_counts: {} });

  const year = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return NextResponse.json({ error: "year and month required" }, { status: 400 });
  }

  const connection = await getCalendarConnection(userId, "google");
  if (!connection) {
    return NextResponse.json({ connected: false, busy_counts: {} });
  }

  const rangeStart = new Date(Date.UTC(year, month, 1));
  const rangeEnd = new Date(Date.UTC(year, month + 1, 0));
  const syncStart = new Date(rangeStart);
  syncStart.setUTCDate(syncStart.getUTCDate() - 7);
  const syncEnd = new Date(rangeEnd);
  syncEnd.setUTCDate(syncEnd.getUTCDate() + 7);

  const synced = await syncGoogleBusySlots({
    userId,
    rangeStart: syncStart.toISOString().slice(0, 10),
    rangeEnd: syncEnd.toISOString().slice(0, 10),
  });
  const detailed = await syncGoogleCalendarEvents({
    userId,
    rangeStart: syncStart.toISOString().slice(0, 10),
    rangeEnd: syncEnd.toISOString().slice(0, 10),
  });
  const busyCounts = buildBusyCountsByDay(
    synced.slots,
    rangeStart.toISOString().slice(0, 10),
    rangeEnd.toISOString().slice(0, 10),
  );
  const eventsByDay = buildExternalEventsByDay(
    detailed.events,
    rangeStart.toISOString().slice(0, 10),
    rangeEnd.toISOString().slice(0, 10),
    detailed.calendarTimeZone ?? connection.calendar_timezone,
  );
  const visibleEventCount = detailed.events.filter((event) => {
    const startsBeforeMonthEnd = event.start_at < new Date(Date.UTC(year, month + 1, 1)).toISOString();
    const endsAfterMonthStart = event.end_at > rangeStart.toISOString();
    return startsBeforeMonthEnd && endsAfterMonthStart;
  }).length;

  return NextResponse.json({
    connected: true,
    busy_counts: busyCounts,
    events_by_day: eventsByDay,
    event_count: visibleEventCount,
    account_email: connection.external_account_email,
    last_synced_at: detailed.syncedAt ?? synced.syncedAt ?? connection.last_synced_at,
  });
}
