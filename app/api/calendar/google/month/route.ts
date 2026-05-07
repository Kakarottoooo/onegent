import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { buildBusyCountsByDay, buildExternalEventsByDay } from "@/lib/calendar-availability";
import {
  type CalendarBusySlotRow,
  type CalendarEventRow,
  getCalendarConnection,
  listCalendarBusySlots,
  listCalendarEvents,
} from "@/lib/calendar-db";
import { syncGoogleBusySlots, syncGoogleCalendarEvents } from "@/lib/calendar-service";

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ connected: false, busy_counts: {} });

  const year = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  const force = req.nextUrl.searchParams.get("force") === "1";
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

  const syncStartIso = new Date(`${syncStart.toISOString().slice(0, 10)}T00:00:00Z`).toISOString();
  const syncEndIso = new Date(`${syncEnd.toISOString().slice(0, 10)}T23:59:59Z`).toISOString();

  let calendarTimeZone: string | null = connection.calendar_timezone;
  let lastSyncedAt: string | null = connection.last_synced_at;
  let syncedBusySlots: CalendarBusySlotRow[] | null = null;
  let syncedEvents: CalendarEventRow[] | null = null;

  // Fast path (default): read whatever is already in DB. No Google API.
  // Force path: re-sync from Google first, then read.
  if (force) {
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
    calendarTimeZone = detailed.calendarTimeZone ?? calendarTimeZone;
    lastSyncedAt = detailed.syncedAt ?? synced.syncedAt ?? lastSyncedAt;
    syncedBusySlots = synced.slots;
    syncedEvents = detailed.events;
  }

  const [busySlots, events] = await Promise.all([
    syncedBusySlots ??
      listCalendarBusySlots({
        userId,
        provider: "google",
        rangeStart: syncStartIso,
        rangeEnd: syncEndIso,
      }),
    syncedEvents ??
      listCalendarEvents({
        userId,
        provider: "google",
        rangeStart: syncStartIso,
        rangeEnd: syncEndIso,
      }),
  ]);

  const busyCounts = buildBusyCountsByDay(
    busySlots,
    rangeStart.toISOString().slice(0, 10),
    rangeEnd.toISOString().slice(0, 10),
  );
  const eventsByDay = buildExternalEventsByDay(
    events,
    rangeStart.toISOString().slice(0, 10),
    rangeEnd.toISOString().slice(0, 10),
    calendarTimeZone,
  );
  const visibleEventCount = events.filter((event) => {
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
    last_synced_at: lastSyncedAt,
  });
}
