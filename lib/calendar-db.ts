import { randomUUID } from "node:crypto";
import { decrypt, encrypt } from "@/lib/encryption";
import { sql } from "@/lib/db";

let calendarConnectionsTableReady: Promise<void> | null = null;
let calendarBusySlotsTableReady: Promise<void> | null = null;
let calendarEventsTableReady: Promise<void> | null = null;

export type CalendarProvider = "google";

export interface CalendarConnectionRow {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  external_account_id: string | null;
  external_account_email: string | null;
  calendar_timezone: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  scope: string | null;
  token_type: string | null;
  access_token_expires_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarBusySlotRow {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  connection_id: string;
  start_at: string;
  end_at: string;
  is_all_day: boolean;
  created_at: string;
}

export interface CalendarEventRow {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  connection_id: string;
  external_event_id: string;
  source_calendar_id: string;
  source_calendar_name: string | null;
  title: string;
  event_url: string | null;
  start_at: string;
  end_at: string;
  start_date: string | Date | null;
  end_date: string | Date | null;
  is_all_day: boolean;
  color_hex: string | null;
  status: string | null;
  created_at: string;
}

export interface CalendarConnectionSecret {
  accessToken: string | null;
  refreshToken: string | null;
}

export async function ensureCalendarConnectionsTable(): Promise<void> {
  if (!calendarConnectionsTableReady) {
    calendarConnectionsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS calendar_connections (
          id                       TEXT PRIMARY KEY,
          user_id                  TEXT NOT NULL,
          provider                 TEXT NOT NULL,
          external_account_id      TEXT,
          external_account_email   TEXT,
          calendar_timezone        TEXT,
          access_token_enc         TEXT,
          refresh_token_enc        TEXT,
          scope                    TEXT,
          token_type               TEXT,
          access_token_expires_at  TIMESTAMPTZ,
          last_synced_at           TIMESTAMPTZ,
          created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (user_id, provider)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS calendar_connections_user_idx ON calendar_connections (user_id)`;
    })().catch((err) => {
      calendarConnectionsTableReady = null;
      throw err;
    });
  }
  await calendarConnectionsTableReady;
}

export async function ensureCalendarBusySlotsTable(): Promise<void> {
  if (!calendarBusySlotsTableReady) {
    calendarBusySlotsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS calendar_busy_slots (
          id            TEXT PRIMARY KEY,
          user_id       TEXT NOT NULL,
          provider      TEXT NOT NULL,
          connection_id TEXT NOT NULL,
          start_at      TIMESTAMPTZ NOT NULL,
          end_at        TIMESTAMPTZ NOT NULL,
          is_all_day    BOOLEAN NOT NULL DEFAULT FALSE,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS calendar_busy_slots_user_provider_idx ON calendar_busy_slots (user_id, provider)`;
      await sql`CREATE INDEX IF NOT EXISTS calendar_busy_slots_range_idx ON calendar_busy_slots (start_at, end_at)`;
    })().catch((err) => {
      calendarBusySlotsTableReady = null;
      throw err;
    });
  }
  await calendarBusySlotsTableReady;
}

export async function ensureCalendarEventsTable(): Promise<void> {
  if (!calendarEventsTableReady) {
    calendarEventsTableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS calendar_events (
          id                  TEXT PRIMARY KEY,
          user_id             TEXT NOT NULL,
          provider            TEXT NOT NULL,
          connection_id       TEXT NOT NULL,
          external_event_id   TEXT NOT NULL,
          source_calendar_id  TEXT NOT NULL,
          source_calendar_name TEXT,
          title               TEXT NOT NULL,
          event_url           TEXT,
          start_at            TIMESTAMPTZ NOT NULL,
          end_at              TIMESTAMPTZ NOT NULL,
          start_date          DATE,
          end_date            DATE,
          is_all_day          BOOLEAN NOT NULL DEFAULT FALSE,
          color_hex           TEXT,
          status              TEXT,
          created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS calendar_events_user_provider_idx ON calendar_events (user_id, provider)`;
      await sql`CREATE INDEX IF NOT EXISTS calendar_events_range_idx ON calendar_events (start_at, end_at)`;
    })().catch((err) => {
      calendarEventsTableReady = null;
      throw err;
    });
  }
  await calendarEventsTableReady;
}

export async function getCalendarConnection(
  userId: string,
  provider: CalendarProvider,
): Promise<CalendarConnectionRow | null> {
  await ensureCalendarConnectionsTable();
  const result = await sql<CalendarConnectionRow>`
    SELECT * FROM calendar_connections
    WHERE user_id = ${userId} AND provider = ${provider}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

export async function getCalendarConnectionWithSecrets(
  userId: string,
  provider: CalendarProvider,
): Promise<(CalendarConnectionRow & CalendarConnectionSecret) | null> {
  const row = await getCalendarConnection(userId, provider);
  if (!row) return null;
  return {
    ...row,
    accessToken: row.access_token_enc ? decrypt(row.access_token_enc) || null : null,
    refreshToken: row.refresh_token_enc ? decrypt(row.refresh_token_enc) || null : null,
  };
}

export async function upsertCalendarConnection(params: {
  userId: string;
  provider: CalendarProvider;
  externalAccountId?: string | null;
  externalAccountEmail?: string | null;
  calendarTimezone?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  scope?: string | null;
  tokenType?: string | null;
  accessTokenExpiresAt?: string | null;
}): Promise<CalendarConnectionRow> {
  await ensureCalendarConnectionsTable();
  const existing = await getCalendarConnection(params.userId, params.provider);
  const id = existing?.id ?? randomUUID();
  const accessTokenEnc =
    params.accessToken !== undefined
      ? (params.accessToken ? encrypt(params.accessToken) : null)
      : existing?.access_token_enc ?? null;
  const refreshTokenEnc =
    params.refreshToken !== undefined
      ? (params.refreshToken ? encrypt(params.refreshToken) : null)
      : existing?.refresh_token_enc ?? null;
  const externalAccountId = params.externalAccountId ?? existing?.external_account_id ?? null;
  const externalAccountEmail = params.externalAccountEmail ?? existing?.external_account_email ?? null;
  const calendarTimezone = params.calendarTimezone ?? existing?.calendar_timezone ?? null;
  const scope = params.scope ?? existing?.scope ?? null;
  const tokenType = params.tokenType ?? existing?.token_type ?? null;
  const expiresAt = params.accessTokenExpiresAt ?? existing?.access_token_expires_at ?? null;

  const result = await sql<CalendarConnectionRow>`
    INSERT INTO calendar_connections (
      id, user_id, provider, external_account_id, external_account_email, calendar_timezone,
      access_token_enc, refresh_token_enc, scope, token_type, access_token_expires_at, updated_at
    )
    VALUES (
      ${id}, ${params.userId}, ${params.provider}, ${externalAccountId}, ${externalAccountEmail},
      ${calendarTimezone}, ${accessTokenEnc}, ${refreshTokenEnc}, ${scope}, ${tokenType},
      ${expiresAt}, NOW()
    )
    ON CONFLICT (user_id, provider) DO UPDATE SET
      external_account_id = EXCLUDED.external_account_id,
      external_account_email = EXCLUDED.external_account_email,
      calendar_timezone = EXCLUDED.calendar_timezone,
      access_token_enc = EXCLUDED.access_token_enc,
      refresh_token_enc = EXCLUDED.refresh_token_enc,
      scope = EXCLUDED.scope,
      token_type = EXCLUDED.token_type,
      access_token_expires_at = EXCLUDED.access_token_expires_at,
      updated_at = NOW()
    RETURNING *
  `;
  return result.rows[0];
}

export async function markCalendarConnectionSynced(
  userId: string,
  provider: CalendarProvider,
): Promise<void> {
  await ensureCalendarConnectionsTable();
  await sql`
    UPDATE calendar_connections
    SET last_synced_at = NOW(), updated_at = NOW()
    WHERE user_id = ${userId} AND provider = ${provider}
  `;
}

export async function deleteCalendarConnection(
  userId: string,
  provider: CalendarProvider,
): Promise<void> {
  await Promise.all([
    ensureCalendarConnectionsTable(),
    ensureCalendarBusySlotsTable(),
    ensureCalendarEventsTable(),
  ]);
  const existing = await getCalendarConnection(userId, provider);
  if (existing) {
    await sql`DELETE FROM calendar_busy_slots WHERE connection_id = ${existing.id}`;
    await sql`DELETE FROM calendar_events WHERE connection_id = ${existing.id}`;
  }
  await sql`DELETE FROM calendar_connections WHERE user_id = ${userId} AND provider = ${provider}`;
}

export async function replaceCalendarBusySlots(params: {
  userId: string;
  provider: CalendarProvider;
  connectionId: string;
  rangeStart: string;
  rangeEnd: string;
  slots: Array<{ startAt: string; endAt: string; isAllDay?: boolean }>;
}): Promise<void> {
  await ensureCalendarBusySlotsTable();
  await sql`
    DELETE FROM calendar_busy_slots
    WHERE user_id = ${params.userId}
      AND provider = ${params.provider}
      AND start_at < ${params.rangeEnd}::timestamptz
      AND end_at > ${params.rangeStart}::timestamptz
  `;
  for (const slot of params.slots) {
    await sql`
      INSERT INTO calendar_busy_slots (
        id, user_id, provider, connection_id, start_at, end_at, is_all_day
      )
      VALUES (
        ${randomUUID()}, ${params.userId}, ${params.provider}, ${params.connectionId},
        ${slot.startAt}::timestamptz, ${slot.endAt}::timestamptz, ${!!slot.isAllDay}
      )
    `;
  }
}

export async function listCalendarBusySlots(params: {
  userId: string;
  provider: CalendarProvider;
  rangeStart: string;
  rangeEnd: string;
}): Promise<CalendarBusySlotRow[]> {
  await ensureCalendarBusySlotsTable();
  const result = await sql<CalendarBusySlotRow>`
    SELECT * FROM calendar_busy_slots
    WHERE user_id = ${params.userId}
      AND provider = ${params.provider}
      AND start_at < ${params.rangeEnd}::timestamptz
      AND end_at > ${params.rangeStart}::timestamptz
    ORDER BY start_at ASC
  `;
  return result.rows;
}

export async function replaceCalendarEvents(params: {
  userId: string;
  provider: CalendarProvider;
  connectionId: string;
  rangeStart: string;
  rangeEnd: string;
  events: Array<{
    externalEventId: string;
    sourceCalendarId: string;
    sourceCalendarName?: string | null;
    title: string;
    eventUrl?: string | null;
    startAt: string;
    endAt: string;
    startDate?: string | null;
    endDate?: string | null;
    isAllDay?: boolean;
    colorHex?: string | null;
    status?: string | null;
  }>;
}): Promise<void> {
  await ensureCalendarEventsTable();
  await sql`
    DELETE FROM calendar_events
    WHERE user_id = ${params.userId}
      AND provider = ${params.provider}
      AND start_at < ${params.rangeEnd}::timestamptz
      AND end_at > ${params.rangeStart}::timestamptz
  `;
  for (const event of params.events) {
    await sql`
      INSERT INTO calendar_events (
        id, user_id, provider, connection_id, external_event_id, source_calendar_id,
        source_calendar_name, title, event_url, start_at, end_at, start_date, end_date,
        is_all_day, color_hex, status
      )
      VALUES (
        ${randomUUID()}, ${params.userId}, ${params.provider}, ${params.connectionId},
        ${event.externalEventId}, ${event.sourceCalendarId}, ${event.sourceCalendarName ?? null},
        ${event.title}, ${event.eventUrl ?? null}, ${event.startAt}::timestamptz,
        ${event.endAt}::timestamptz, ${event.startDate ?? null}::date, ${event.endDate ?? null}::date,
        ${!!event.isAllDay}, ${event.colorHex ?? null}, ${event.status ?? null}
      )
    `;
  }
}

export async function listCalendarEvents(params: {
  userId: string;
  provider: CalendarProvider;
  rangeStart: string;
  rangeEnd: string;
}): Promise<CalendarEventRow[]> {
  await ensureCalendarEventsTable();
  const result = await sql<CalendarEventRow>`
    SELECT * FROM calendar_events
    WHERE user_id = ${params.userId}
      AND provider = ${params.provider}
      AND start_at < ${params.rangeEnd}::timestamptz
      AND end_at > ${params.rangeStart}::timestamptz
    ORDER BY start_at ASC, title ASC
  `;
  return result.rows;
}
