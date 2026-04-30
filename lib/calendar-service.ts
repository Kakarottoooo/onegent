import {
  listCalendarEvents,
  getCalendarConnectionWithSecrets,
  listCalendarBusySlots,
  markCalendarConnectionSynced,
  replaceCalendarEvents,
  replaceCalendarBusySlots,
  upsertCalendarConnection,
  type CalendarBusySlotRow,
  type CalendarEventRow,
} from "@/lib/calendar-db";
import {
  isGoogleCalendarTokenFresh,
  listGoogleCalendars,
  listGoogleCalendarEvents,
  queryGoogleFreeBusy,
  refreshGoogleCalendarAccessToken,
} from "@/lib/google-calendar";

async function resolveGoogleConnection(userId: string) {
  const connection = await getCalendarConnectionWithSecrets(userId, "google");
  if (!connection || !connection.refreshToken) {
    return null;
  }

  let accessToken = connection.accessToken;
  let expiresAt = connection.access_token_expires_at;
  if (!accessToken || !isGoogleCalendarTokenFresh(connection)) {
    const refreshed = await refreshGoogleCalendarAccessToken(connection.refreshToken);
    accessToken = refreshed.accessToken;
    expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
    await upsertCalendarConnection({
      userId,
      provider: "google",
      accessToken,
      refreshToken: connection.refreshToken,
      accessTokenExpiresAt: expiresAt,
      scope: refreshed.scope ?? connection.scope,
      tokenType: refreshed.tokenType ?? connection.token_type,
      externalAccountEmail: connection.external_account_email,
      externalAccountId: connection.external_account_id,
      calendarTimezone: connection.calendar_timezone,
    });
  }

  return {
    connection,
    accessToken,
  };
}

export async function syncGoogleBusySlots(params: {
  userId: string;
  rangeStart: string;
  rangeEnd: string;
}): Promise<{ slots: CalendarBusySlotRow[]; connected: boolean; syncedAt: string | null }> {
  const resolved = await resolveGoogleConnection(params.userId);
  if (!resolved) {
    return { slots: [], connected: false, syncedAt: null };
  }
  const { connection, accessToken } = resolved;

  const busy = await queryGoogleFreeBusy({
    accessToken: accessToken!,
    timeMin: new Date(`${params.rangeStart}T00:00:00Z`).toISOString(),
    timeMax: new Date(`${params.rangeEnd}T23:59:59Z`).toISOString(),
    timeZone: connection.calendar_timezone,
  });

  await replaceCalendarBusySlots({
    userId: params.userId,
    provider: "google",
    connectionId: connection.id,
    rangeStart: new Date(`${params.rangeStart}T00:00:00Z`).toISOString(),
    rangeEnd: new Date(`${params.rangeEnd}T23:59:59Z`).toISOString(),
    slots: busy.map((slot) => ({
      startAt: slot.startAt,
      endAt: slot.endAt,
    })),
  });
  await markCalendarConnectionSynced(params.userId, "google");

  const slots = await listCalendarBusySlots({
    userId: params.userId,
    provider: "google",
    rangeStart: new Date(`${params.rangeStart}T00:00:00Z`).toISOString(),
    rangeEnd: new Date(`${params.rangeEnd}T23:59:59Z`).toISOString(),
  });
  return { slots, connected: true, syncedAt: new Date().toISOString() };
}

export async function syncGoogleCalendarEvents(params: {
  userId: string;
  rangeStart: string;
  rangeEnd: string;
}): Promise<{
  events: CalendarEventRow[];
  connected: boolean;
  syncedAt: string | null;
  calendarTimeZone: string | null;
}> {
  const resolved = await resolveGoogleConnection(params.userId);
  if (!resolved) {
    return { events: [], connected: false, syncedAt: null, calendarTimeZone: null };
  }
  const { connection, accessToken } = resolved;

  const calendars = await listGoogleCalendars(accessToken!);
  const readableCalendars = calendars.filter(
    (calendar) =>
      calendar.selected &&
      calendar.accessRole !== "freeBusyReader",
  );

  const allEvents = (
    await Promise.all(
      readableCalendars.map(async (calendar) => {
        const events = await listGoogleCalendarEvents({
          accessToken: accessToken!,
          calendarId: calendar.id,
          timeMin: new Date(`${params.rangeStart}T00:00:00Z`).toISOString(),
          timeMax: new Date(`${params.rangeEnd}T23:59:59Z`).toISOString(),
          timeZone: connection.calendar_timezone,
        });
        return events.map((event) => ({
          externalEventId: event.id,
          sourceCalendarId: calendar.id,
          sourceCalendarName: calendar.summary,
          title: event.title,
          eventUrl: event.eventUrl,
          startAt: event.startAt,
          endAt: event.endAt,
          startDate: event.startDate,
          endDate: event.endDate,
          isAllDay: event.isAllDay,
          colorHex: calendar.backgroundColor,
          status: event.status,
        }));
      }),
    )
  ).flat();

  await replaceCalendarEvents({
    userId: params.userId,
    provider: "google",
    connectionId: connection.id,
    rangeStart: new Date(`${params.rangeStart}T00:00:00Z`).toISOString(),
    rangeEnd: new Date(`${params.rangeEnd}T23:59:59Z`).toISOString(),
    events: allEvents,
  });
  await markCalendarConnectionSynced(params.userId, "google");

  const events = await listCalendarEvents({
    userId: params.userId,
    provider: "google",
    rangeStart: new Date(`${params.rangeStart}T00:00:00Z`).toISOString(),
    rangeEnd: new Date(`${params.rangeEnd}T23:59:59Z`).toISOString(),
  });
  return {
    events,
    connected: true,
    syncedAt: new Date().toISOString(),
    calendarTimeZone: connection.calendar_timezone,
  };
}
