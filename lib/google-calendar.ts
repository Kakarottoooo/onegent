import type { CalendarConnectionRow } from "@/lib/calendar-db";

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
];

function getGoogleCalendarClientId(): string {
  const value = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  if (!value) throw new Error("GOOGLE_CALENDAR_CLIENT_ID is not configured.");
  return value;
}

function getGoogleCalendarClientSecret(): string {
  const value = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!value) throw new Error("GOOGLE_CALENDAR_CLIENT_SECRET is not configured.");
  return value;
}

export function buildGoogleCalendarAuthUrl(params: {
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTH_BASE);
  url.searchParams.set("client_id", getGoogleCalendarClientId());
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  return url.toString();
}

export async function exchangeGoogleCalendarCode(params: {
  code: string;
  redirectUri: string;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  tokenType: string | null;
  scope: string | null;
}> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: getGoogleCalendarClientId(),
    client_secret: getGoogleCalendarClientSecret(),
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== "string") {
    throw new Error(typeof data.error_description === "string" ? data.error_description : "Google token exchange failed.");
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : 3600,
    tokenType: typeof data.token_type === "string" ? data.token_type : null,
    scope: typeof data.scope === "string" ? data.scope : null,
  };
}

export async function refreshGoogleCalendarAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
  tokenType: string | null;
  scope: string | null;
}> {
  const body = new URLSearchParams({
    client_id: getGoogleCalendarClientId(),
    client_secret: getGoogleCalendarClientSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== "string") {
    throw new Error(typeof data.error_description === "string" ? data.error_description : "Google token refresh failed.");
  }
  return {
    accessToken: data.access_token,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : 3600,
    tokenType: typeof data.token_type === "string" ? data.token_type : null,
    scope: typeof data.scope === "string" ? data.scope : null,
  };
}

export async function fetchGooglePrimaryCalendar(accessToken: string): Promise<{
  id: string | null;
  summary: string | null;
  timeZone: string | null;
}> {
  const res = await fetch(`${GOOGLE_CALENDAR_BASE}/users/me/calendarList/primary`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.error === "object" && data.error && "message" in data.error ? String((data.error as Record<string, unknown>).message) : "Failed to fetch Google primary calendar.");
  }
  return {
    id: typeof data.id === "string" ? data.id : null,
    summary: typeof data.summary === "string" ? data.summary : null,
    timeZone: typeof data.timeZone === "string" ? data.timeZone : null,
  };
}

export async function queryGoogleFreeBusy(params: {
  accessToken: string;
  timeMin: string;
  timeMax: string;
  timeZone?: string | null;
}): Promise<Array<{ startAt: string; endAt: string }>> {
  const res = await fetch(`${GOOGLE_CALENDAR_BASE}/freeBusy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      timeZone: params.timeZone ?? "UTC",
      items: [{ id: "primary" }],
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error("Failed to query Google Calendar busy times.");
  }
  const calendars = (data.calendars ?? {}) as Record<string, { busy?: Array<{ start?: string; end?: string }> }>;
  const primary = calendars.primary ?? Object.values(calendars)[0];
  const busy = Array.isArray(primary?.busy) ? primary.busy : [];
  return busy
    .filter((slot) => typeof slot.start === "string" && typeof slot.end === "string")
    .map((slot) => ({ startAt: slot.start!, endAt: slot.end! }));
}

export async function listGoogleCalendars(accessToken: string): Promise<Array<{
  id: string;
  summary: string | null;
  primary: boolean;
  selected: boolean;
  accessRole: string | null;
  backgroundColor: string | null;
}>> {
  const url = new URL(`${GOOGLE_CALENDAR_BASE}/users/me/calendarList`);
  url.searchParams.set("showHidden", "false");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error("Failed to list Google calendars.");
  }
  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .map((item) => {
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : null;
      if (!id) return null;
      return {
        id,
        summary: typeof row.summary === "string" ? row.summary : null,
        primary: row.primary === true,
        selected: row.selected !== false,
        accessRole: typeof row.accessRole === "string" ? row.accessRole : null,
        backgroundColor: typeof row.backgroundColor === "string" ? row.backgroundColor : null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => !!item);
}

export async function listGoogleCalendarEvents(params: {
  accessToken: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  timeZone?: string | null;
}): Promise<Array<{
  id: string;
  title: string;
  eventUrl: string | null;
  startAt: string;
  endAt: string;
  startDate: string | null;
  endDate: string | null;
  isAllDay: boolean;
  status: string | null;
  colorHex: string | null;
}>> {
  const items: Array<{
    id: string;
    title: string;
    eventUrl: string | null;
    startAt: string;
    endAt: string;
    startDate: string | null;
    endDate: string | null;
    isAllDay: boolean;
    status: string | null;
    colorHex: string | null;
  }> = [];
  let pageToken: string | null = null;

  do {
    const url = new URL(`${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(params.calendarId)}/events`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("timeMin", params.timeMin);
    url.searchParams.set("timeMax", params.timeMax);
    url.searchParams.set("maxResults", "2500");
    if (params.timeZone) url.searchParams.set("timeZone", params.timeZone);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error("Failed to list Google Calendar events.");
    }

    const pageItems = Array.isArray(data.items) ? data.items : [];
    for (const item of pageItems) {
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : null;
      if (!id) continue;
      const summary =
        typeof row.summary === "string" && row.summary.trim()
          ? row.summary.trim()
          : "(No title)";
      const start = row.start as Record<string, unknown> | undefined;
      const end = row.end as Record<string, unknown> | undefined;
      const startDateTime = typeof start?.dateTime === "string" ? start.dateTime : null;
      const endDateTime = typeof end?.dateTime === "string" ? end.dateTime : null;
      const startDate = typeof start?.date === "string" ? start.date : null;
      const endDate = typeof end?.date === "string" ? end.date : null;
      const isAllDay = !!startDate && !!endDate && !startDateTime;
      const startAt = startDateTime ?? (startDate ? `${startDate}T00:00:00Z` : null);
      const endAt = endDateTime ?? (endDate ? `${endDate}T00:00:00Z` : null);
      if (!startAt || !endAt) continue;

      items.push({
        id,
        title: summary,
        eventUrl: typeof row.htmlLink === "string" ? row.htmlLink : null,
        startAt,
        endAt,
        startDate,
        endDate,
        isAllDay,
        status: typeof row.status === "string" ? row.status : null,
        colorHex: null,
      });
    }

    pageToken = typeof data.nextPageToken === "string" ? data.nextPageToken : null;
  } while (pageToken);

  return items;
}

export async function revokeGoogleCalendarToken(token: string): Promise<void> {
  await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }).catch(() => {});
}

export function isGoogleCalendarTokenFresh(connection: CalendarConnectionRow): boolean {
  if (!connection.access_token_expires_at) return false;
  const expiresAt = Date.parse(connection.access_token_expires_at);
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt - Date.now() > 60_000;
}
