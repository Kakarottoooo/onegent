"use client";

/**
 * /calendar — D2 aggregate month-view across every BookingJob the user has.
 *
 * The page owns month navigation + data fetching. The actual grid math + UI
 * split lives in lib/calendar-grid.ts and components/MonthCalendar.tsx so
 * this file is small.
 *
 * Navigation: clicking an event bar jumps to /tasks?focus=<jobId>&view=live,
 * same landing as "Book this trip" — consistent mental model.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import GlobalNav from "@/components/GlobalNav";
import MonthCalendar from "@/components/MonthCalendar";
import { buildCalendarGrid } from "@/lib/calendar-grid";
import { getTaskWorkspaceHref } from "@/lib/booking-jobs/workspace";
import { isActiveJobStatus } from "@/lib/status";
import type { ExternalCalendarEventsByDay } from "@/lib/calendar-availability";
import type { CalendarJobItem } from "@/lib/calendar-read-model";

type GoogleMonthResponse = {
  connected?: boolean;
  busy_counts?: Record<string, number>;
  events_by_day?: ExternalCalendarEventsByDay;
  event_count?: number;
  account_email?: string | null;
  last_synced_at?: string | null;
  error?: string;
};

type GoogleStatusResponse = {
  connected?: boolean;
  account_email?: string | null;
  timezone?: string | null;
  last_synced_at?: string | null;
  error?: string;
};

type GoogleMonthPayload = GoogleMonthResponse & {
  ok: boolean;
  status: number;
};

type GoogleStatusPayload = GoogleStatusResponse & {
  ok: boolean;
  status: number;
};

const BOOKING_JOBS_CACHE_MS = 5000;
const GOOGLE_STATUS_CACHE_MS = 30000;
const GOOGLE_MONTH_CACHE_MS = 60000;
// The base calendar grid should render immediately; keep the old blocking
// loader branch disabled so month navigation never waits on optional data.
const SHOW_BLOCKING_CALENDAR_LOADER = false;

const bookingJobsCache = new Map<string, { data: CalendarJobItem[]; expiresAt: number }>();
const bookingJobsInflight = new Map<string, Promise<CalendarJobItem[]>>();
const googleStatusCache = new Map<string, { data: GoogleStatusPayload; expiresAt: number }>();
const googleStatusInflight = new Map<string, Promise<GoogleStatusPayload>>();
const googleMonthCache = new Map<string, { data: GoogleMonthPayload; expiresAt: number }>();
const googleMonthInflight = new Map<string, Promise<GoogleMonthPayload>>();

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let sid = localStorage.getItem("session_id");
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem("session_id", sid);
  }
  return sid;
}

async function fetchBookingJobsCached(sessionId: string): Promise<CalendarJobItem[]> {
  const now = Date.now();
  const cached = bookingJobsCache.get(sessionId);
  if (cached && cached.expiresAt > now) return cached.data;

  const existing = bookingJobsInflight.get(sessionId);
  if (existing) return existing;

  const request = fetch(`/api/calendar/jobs?session_id=${encodeURIComponent(sessionId)}`)
    .then(async (res) => {
      if (!res.ok) return [];
      const data = (await res.json()) as { jobs?: CalendarJobItem[] };
      const jobs = data.jobs ?? [];
      bookingJobsCache.set(sessionId, {
        data: jobs,
        expiresAt: Date.now() + BOOKING_JOBS_CACHE_MS,
      });
      return jobs;
    })
    .finally(() => {
      bookingJobsInflight.delete(sessionId);
    });

  bookingJobsInflight.set(sessionId, request);
  return request;
}

async function fetchGoogleStatusCached(force: boolean): Promise<GoogleStatusPayload> {
  const key = "google";
  const now = Date.now();

  if (!force) {
    const cached = googleStatusCache.get(key);
    if (cached && cached.expiresAt > now) return cached.data;
  }

  const existing = !force ? googleStatusInflight.get(key) : null;
  if (existing) return existing;

  const request = fetch("/api/calendar/google/status", { cache: "no-store" })
    .then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as GoogleStatusResponse;
      const payload: GoogleStatusPayload = {
        ...data,
        ok: res.ok,
        status: res.status,
      };
      if (res.ok) {
        googleStatusCache.set(key, {
          data: payload,
          expiresAt: Date.now() + GOOGLE_STATUS_CACHE_MS,
        });
      }
      return payload;
    })
    .finally(() => {
      googleStatusInflight.delete(key);
    });

  googleStatusInflight.set(key, request);
  return request;
}

async function fetchGoogleMonthCached(
  year: number,
  month: number,
  force: boolean,
): Promise<GoogleMonthPayload> {
  const monthKey = `${year}-${month}`;
  const inflightKey = `${force ? "force" : "read"}:${monthKey}`;
  const now = Date.now();

  if (!force) {
    const cached = googleMonthCache.get(monthKey);
    if (cached && cached.expiresAt > now) return cached.data;
  }

  const existing = googleMonthInflight.get(inflightKey);
  if (existing) return existing;

  const url = `/api/calendar/google/month?year=${year}&month=${month}${force ? "&force=1" : ""}`;
  const request = fetch(url, { cache: "no-store" })
    .then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as GoogleMonthResponse;
      const payload: GoogleMonthPayload = {
        ...data,
        ok: res.ok,
        status: res.status,
      };
      if (res.ok) {
        googleMonthCache.set(monthKey, {
          data: payload,
          expiresAt: Date.now() + GOOGLE_MONTH_CACHE_MS,
        });
      }
      return payload;
    })
    .finally(() => {
      googleMonthInflight.delete(inflightKey);
    });

  googleMonthInflight.set(inflightKey, request);
  return request;
}

export default function CalendarPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const auth = useAuth();
  const [jobs, setJobs] = useState<CalendarJobItem[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [googleStatusLoading, setGoogleStatusLoading] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleBusyCounts, setGoogleBusyCounts] = useState<Record<string, number>>({});
  const [googleEventsByDay, setGoogleEventsByDay] = useState<ExternalCalendarEventsByDay>({});
  const [googleEventCount, setGoogleEventCount] = useState(0);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const latestGoogleMonthKeyRef = useRef<string>("");

  // Anchor = first day of the viewed month. Use local-TZ constructor so the
  // grid matches the user's wall clock rather than UTC.
  const [anchor, setAnchor] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const loadJobs = useCallback(async () => {
    const sid = getSessionId();
    if (!sid) return;
    setJobsLoading(true);
    try {
      setJobs(await fetchBookingJobsCached(sid));
    } catch {
      setJobs([]);
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  // Light polling while anything is live — mirrors /tasks behavior so the
  // calendar colors update as bookings progress.
  useEffect(() => {
    const hasRunning = jobs.some((j) => isActiveJobStatus(j.status));
    if (!hasRunning) return;
    const timer = setInterval(() => void loadJobs(), 8000);
    return () => clearInterval(timer);
  }, [jobs, loadJobs]);

  const loadGoogleStatus = useCallback(
    async (opts: { force?: boolean } = {}): Promise<{ connected: boolean; lastSyncedAt: string | null }> => {
      if (!auth.isLoaded) return { connected: false, lastSyncedAt: null };
      if (!auth.isSignedIn) {
        setGoogleConnected(false);
        setGoogleEmail(null);
        setGoogleBusyCounts({});
        setGoogleEventsByDay({});
        setGoogleEventCount(0);
        setGoogleError(null);
        return { connected: false, lastSyncedAt: null };
      }

      setGoogleStatusLoading(true);
      setGoogleError(null);
      try {
        const data = await fetchGoogleStatusCached(!!opts.force);
        if (!data.ok) {
          throw new Error(data.error ?? "Couldn't load Google Calendar status.");
        }
        setGoogleConnected(!!data.connected);
        setGoogleEmail(data.account_email ?? null);
        if (!data.connected) {
          setGoogleBusyCounts({});
          setGoogleEventsByDay({});
          setGoogleEventCount(0);
        }
        return { connected: !!data.connected, lastSyncedAt: data.last_synced_at ?? null };
      } catch (error) {
        setGoogleError(error instanceof Error ? error.message : "Couldn't load Google Calendar status.");
        return { connected: false, lastSyncedAt: null };
      } finally {
        setGoogleStatusLoading(false);
      }
    },
    [auth.isLoaded, auth.isSignedIn],
  );

  // Fast path = read DB only (no Google API). Force = re-sync from Google first.
  // The "Syncing..." spinner only shows during force calls (user clicks Sync now,
  // or background revalidate on stale data) — initial reads should feel instant.
  const loadGoogleMonth = useCallback(
    async (opts: { force?: boolean } = {}): Promise<string | null> => {
      if (!auth.isLoaded) return null;
      if (!auth.isSignedIn) {
        setGoogleConnected(false);
        setGoogleEmail(null);
        setGoogleBusyCounts({});
        setGoogleEventsByDay({});
        setGoogleEventCount(0);
        setGoogleError(null);
        return null;
      }

      if (opts.force) setGoogleSyncing(true);
      setGoogleError(null);
      const year = anchor.getFullYear();
      const month = anchor.getMonth();
      const monthKey = `${year}-${month}`;
      latestGoogleMonthKeyRef.current = monthKey;
      try {
        const data = await fetchGoogleMonthCached(year, month, !!opts.force);
        if (latestGoogleMonthKeyRef.current !== monthKey) {
          return data.last_synced_at ?? null;
        }
        if (!data.ok) {
          throw new Error(data.error ?? "Couldn't sync Google Calendar.");
        }

        setGoogleConnected(!!data.connected);
        setGoogleEmail(data.account_email ?? null);
        setGoogleBusyCounts(data.busy_counts ?? {});
        setGoogleEventsByDay(data.events_by_day ?? {});
        setGoogleEventCount(data.event_count ?? 0);
        return data.last_synced_at ?? null;
      } catch (error) {
        setGoogleError(error instanceof Error ? error.message : "Couldn't sync Google Calendar.");
        return null;
      } finally {
        if (opts.force) setGoogleSyncing(false);
      }
    },
    [anchor, auth.isLoaded, auth.isSignedIn],
  );

  // Render cached DB calendar data only on page load. A Google network sync is
  // explicit via "Sync now" so route entry never waits on Google.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const status = await loadGoogleStatus();
      if (cancelled || !status.connected) return;
      await loadGoogleMonth();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadGoogleMonth, loadGoogleStatus]);

  const grid = useMemo(
    () => buildCalendarGrid(jobs, anchor.getFullYear(), anchor.getMonth()),
    [jobs, anchor],
  );

  const hasAnyEvent = useMemo(
    () =>
      grid.weeks.some((w) => w.some((d) => d.events.length > 0)) ||
      googleEventCount > 0,
    [googleEventCount, grid],
  );
  const googleBusyDayCount = useMemo(
    () => Object.keys(googleBusyCounts).filter((date) => googleBusyCounts[date] > 0).length,
    [googleBusyCounts],
  );
  const googleCalendarStatus = searchParams.get("google_calendar");
  const googleCalendarErrorDetail = searchParams.get("google_calendar_error_detail");

  function prevMonth() {
    setAnchor((a) => new Date(a.getFullYear(), a.getMonth() - 1, 1));
  }
  function nextMonth() {
    setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + 1, 1));
  }
  function today() {
    const n = new Date();
    setAnchor(new Date(n.getFullYear(), n.getMonth(), 1));
  }

  function handleEventClick(jobId: string) {
    const job = jobs.find((candidate) => candidate.id === jobId);
    router.push(
      job
        ? getTaskWorkspaceHref(job)
        : getTaskWorkspaceHref({ id: jobId, status: "pending", sourceSessionId: getSessionId() }),
    );
  }

  async function disconnectGoogleCalendar() {
    setGoogleSyncing(true);
    setGoogleError(null);
    try {
      const res = await fetch("/api/calendar/google/disconnect", { method: "POST" });
      if (!res.ok) {
        throw new Error("Couldn't disconnect Google Calendar.");
      }
      setGoogleConnected(false);
      setGoogleEmail(null);
      setGoogleBusyCounts({});
      setGoogleEventsByDay({});
      setGoogleEventCount(0);
    } catch (error) {
      setGoogleError(error instanceof Error ? error.message : "Couldn't disconnect Google Calendar.");
    } finally {
      setGoogleSyncing(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
      <GlobalNav active="calendar" />
      <main
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: "var(--space-16) var(--space-6) var(--space-24)",
        }}
      >
        <section
          style={{
            marginBottom: 18,
            padding: 18,
            borderRadius: 16,
            border: "1px solid var(--border, #e5e7eb)",
            background: "var(--card, #fff)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-primary, #111)",
              }}
            >
              Google Calendar
            </div>
            <div
              style={{
                fontFamily: "var(--font-dm-sans)",
                fontSize: 12,
                color: "var(--text-secondary, #555)",
              }}
            >
              {googleCalendarStatus === "error"
                ? "Google Calendar connect failed on the callback step. Check the dev server log for the exact error."
                : googleCalendarStatus === "invalid_state"
                ? "Google Calendar connect failed because the OAuth state did not match. Try again in the same browser tab."
                : googleCalendarStatus === "signin"
                ? "Sign in first, then connect Google Calendar."
                : googleCalendarStatus === "denied"
                ? "Google Calendar access was denied."
                : googleStatusLoading
                ? "Checking Google Calendar connection..."
                : googleConnected
                ? `${googleCalendarStatus === "connected" ? "Google Calendar connected successfully. " : ""}Connected${googleEmail ? ` as ${googleEmail}` : ""}. ${googleEventCount} synced event${googleEventCount === 1 ? "" : "s"} and ${googleBusyDayCount} busy day${googleBusyDayCount === 1 ? "" : "s"} in ${grid.monthLabel}.`
                : "Connect Google Calendar so trip planning can avoid your existing schedule."}
            </div>
            {googleError ? (
              <div
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 12,
                  color: "#b42318",
                }}
              >
                {googleError}
              </div>
            ) : null}
            {!googleError && googleCalendarStatus === "error" && googleCalendarErrorDetail ? (
              <div
                style={{
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 12,
                  color: "#b42318",
                }}
              >
                {googleCalendarErrorDetail}
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {googleStatusLoading ? (
              <button
                type="button"
                disabled
                style={{
                  padding: "10px 14px",
                  borderRadius: 999,
                  border: "1px solid var(--border, #e5e7eb)",
                  background: "transparent",
                  color: "var(--text-secondary, #555)",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "wait",
                  opacity: 0.7,
                }}
              >
                Checking...
              </button>
            ) : !googleConnected ? (
              <a
                href="/api/calendar/google/connect"
                style={{
                  padding: "10px 14px",
                  borderRadius: 999,
                  background: "var(--gold, #C9A84C)",
                  color: "#fff",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                Connect Google Calendar
              </a>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void loadGoogleMonth({ force: true })}
                  disabled={googleSyncing}
                  style={{
                    padding: "9px 14px",
                    borderRadius: 999,
                    border: "1px solid var(--border, #e5e7eb)",
                    background: "transparent",
                    color: "var(--text-primary, #111)",
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: googleSyncing ? "not-allowed" : "pointer",
                    opacity: googleSyncing ? 0.6 : 1,
                  }}
                >
                  {googleSyncing ? "Syncing..." : "Sync now"}
                </button>
                <button
                  type="button"
                  onClick={() => void disconnectGoogleCalendar()}
                  disabled={googleSyncing}
                  style={{
                    padding: "9px 14px",
                    borderRadius: 999,
                    border: "1px solid rgba(180, 35, 24, 0.24)",
                    background: "transparent",
                    color: "#b42318",
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: googleSyncing ? "not-allowed" : "pointer",
                    opacity: googleSyncing ? 0.6 : 1,
                  }}
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </section>

        {SHOW_BLOCKING_CALENDAR_LOADER ? (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              fontFamily: "var(--font-dm-sans)",
              fontSize: 13,
              color: "var(--text-muted, #888)",
            }}
          >
            Loading your calendar…
          </div>
        ) : (
          <>
            <MonthCalendar
              grid={grid}
              onPrevMonth={prevMonth}
              onNextMonth={nextMonth}
              onToday={today}
              onEventClick={handleEventClick}
              externalBusyCounts={googleBusyCounts}
              externalEventsByDay={googleEventsByDay}
            />
            {!hasAnyEvent && (
              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  borderRadius: 12,
                  border: "1px dashed var(--border, #e5e7eb)",
                  textAlign: "center",
                  fontFamily: "var(--font-dm-sans)",
                  fontSize: 13,
                  color: "var(--text-muted, #888)",
                }}
              >
                No events in {grid.monthLabel}.{" "}
                <a href="/" style={{ color: "var(--gold, #C9A84C)", fontWeight: 600 }}>
                  Plan a trip →
                </a>
              </div>
            )}
          </>
        )}
        {(jobsLoading || googleStatusLoading) && (
          <div
            style={{
              marginTop: 10,
              fontFamily: "var(--font-dm-sans)",
              fontSize: 12,
              color: "var(--text-muted, #888)",
            }}
          >
            Refreshing calendar data...
          </div>
        )}
      </main>
    </div>
  );
}
