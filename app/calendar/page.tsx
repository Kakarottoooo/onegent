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

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import GlobalNav from "@/components/GlobalNav";
import MonthCalendar from "@/components/MonthCalendar";
import { buildCalendarGrid } from "@/lib/calendar-grid";
import type { BookingJob } from "@/lib/db";

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let sid = localStorage.getItem("session_id");
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem("session_id", sid);
  }
  return sid;
}

export default function CalendarPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<BookingJob[]>([]);
  const [loading, setLoading] = useState(true);

  // Anchor = first day of the viewed month. Use local-TZ constructor so the
  // grid matches the user's wall clock rather than UTC.
  const [anchor, setAnchor] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const loadJobs = useCallback(async () => {
    const sid = getSessionId();
    if (!sid) return;
    try {
      const res = await fetch(`/api/booking-jobs?session_id=${encodeURIComponent(sid)}`);
      if (!res.ok) {
        setJobs([]);
        return;
      }
      const data = (await res.json()) as { jobs?: BookingJob[] };
      setJobs(data.jobs ?? []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  // Light polling while anything is live — mirrors /tasks behavior so the
  // calendar colors update as bookings progress.
  useEffect(() => {
    const hasRunning = jobs.some((j) => j.status === "running" || j.status === "pending");
    if (!hasRunning) return;
    const timer = setInterval(() => void loadJobs(), 8000);
    return () => clearInterval(timer);
  }, [jobs, loadJobs]);

  const grid = useMemo(
    () => buildCalendarGrid(jobs, anchor.getFullYear(), anchor.getMonth()),
    [jobs, anchor],
  );

  const hasAnyEvent = useMemo(() => grid.weeks.some((w) => w.some((d) => d.events.length > 0)), [grid]);

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
    router.push(`/tasks?focus=${encodeURIComponent(jobId)}&view=live`);
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg, #fafaf9)" }}>
      <GlobalNav active="calendar" />
      <main
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: "28px 20px 80px",
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--text-muted, #888)",
              marginBottom: 6,
            }}
          >
            Calendar
          </div>
          <div
            style={{
              fontFamily: "var(--font-playfair, serif)",
              fontSize: 32,
              fontWeight: 700,
              color: "var(--text-primary, #111)",
              lineHeight: 1.15,
              marginBottom: 6,
            }}
          >
            Your trips, on one page
          </div>
          <div
            style={{
              fontFamily: "var(--font-dm-sans)",
              fontSize: 13,
              color: "var(--text-secondary, #666)",
            }}
          >
            Every booking — flights, hotels, restaurants, tickets — placed on the day it happens. Click any block to jump to its task.
          </div>
        </div>

        {loading ? (
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
      </main>
    </div>
  );
}
