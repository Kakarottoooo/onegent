/**
 * Calendar grid builder — turns an array of BookingJobs into a 7-column
 * month-view grid (weeks × days) with events placed on each day. Hotel-stay
 * events carry spanDays + spanPosition so the calendar can render them as
 * a bar crossing day cells (or a continuation stub when the span wraps
 * across week rows).
 *
 * Kept separate from lib/itinerary.ts (which is per-job / compact-list
 * oriented) so the calendar-specific concepts (month padding, weekday
 * columns, continuation stubs) don't leak into the other view.
 */
import type { BookingJob } from "./db";
import { extractStepEvents, type ItineraryEvent } from "./itinerary";

/** Single-day event that lives inside one day cell (flight, restaurant, activity). */
export interface CalendarEvent {
  event: ItineraryEvent;
  jobId: string;
  tripLabel: string;
}

/**
 * A multi-day event segment clipped to a single week row. Hotels that span
 * multiple cells within a week get ONE segment here. Stays that cross the
 * Sat→Sun boundary are split into two segments (one per week), with
 * isStartWeek/isEndWeek flags so the renderer can draw continuation chevrons.
 */
export interface WeekSpanSegment {
  event: ItineraryEvent;
  jobId: string;
  tripLabel: string;
  /** 0-6 — day-of-week column index where this segment begins. */
  startCol: number;
  /** 0-6 — day-of-week column index where this segment ends (inclusive). */
  endCol: number;
  /** Vertical lane within the week (0-indexed). Allows multiple overlapping
   *  spans to stack without overlapping. */
  lane: number;
  /** True if this segment contains the event's start date (check-in). */
  isStartWeek: boolean;
  /** True if this segment contains the event's end date (night before check-out). */
  isEndWeek: boolean;
}

export interface CalendarDay {
  /** ISO YYYY-MM-DD. */
  date: string;
  /** 1..31 — the day number shown in the cell. */
  dayOfMonth: number;
  /** False for padding days from the previous/next month that fill the grid. */
  inMonth: boolean;
  /** True if this cell is today's date (server-local TZ). */
  isToday: boolean;
  /** Events landing on this day, sorted with multi-day bars first. */
  events: CalendarEvent[];
}

export interface CalendarGrid {
  /** Label for the month header ("April 2026"). */
  monthLabel: string;
  /** Numeric year + month (0-indexed) for navigation arithmetic. */
  year: number;
  month: number;
  /** 7 weekday names in display order, starting Sunday. */
  weekdays: string[];
  /** 5-6 rows × 7 days. Single-day events live in `day.events`. */
  weeks: CalendarDay[][];
  /**
   * Span-event segments per week, keyed by week row index (same length as
   * `weeks`). Multi-day events (hotel stays) live here instead of in
   * `day.events` so the renderer can draw them as a single bar crossing
   * multiple day cells (Google-Calendar-style).
   */
  weeklySpans: WeekSpanSegment[][];
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Build the full month-view grid. `year` + `month` (0-indexed) pick which
 * month to render; padding days from adjacent months fill the grid so every
 * row has exactly 7 cells.
 */
export function buildCalendarGrid(
  jobs: BookingJob[],
  year: number,
  month: number,
  today: Date = new Date(),
): CalendarGrid {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  // Pad left — go back to the prior Sunday. getDay() returns 0 for Sunday,
  // so firstOfMonth.getDay() itself is the count of padding days.
  const leadingPad = firstOfMonth.getDay();
  // Pad right so we land on Saturday. 6 - last.getDay() gives the count.
  const trailingPad = 6 - lastOfMonth.getDay();

  const gridStart = new Date(year, month, 1 - leadingPad);
  const totalCells = leadingPad + lastOfMonth.getDate() + trailingPad;

  const todayIso = toIsoLocal(today);
  const aggregated = aggregateEvents(jobs);
  const spanEvents = aggregated.filter((ae) => ae.event.endDate && ae.event.endDate !== ae.event.date);
  const singleEvents = aggregated.filter((ae) => !ae.event.endDate || ae.event.endDate === ae.event.date);

  const weeks: CalendarDay[][] = [];
  const weeklySpans: WeekSpanSegment[][] = [];

  // First pass: build the day grid (single-day events only).
  for (let cellIndex = 0; cellIndex < totalCells; cellIndex++) {
    const dt = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + cellIndex,
    );
    const iso = toIsoLocal(dt);
    const day: CalendarDay = {
      date: iso,
      dayOfMonth: dt.getDate(),
      inMonth: dt.getMonth() === month,
      isToday: iso === todayIso,
      events: pickSingleEventsForDay(singleEvents, iso),
    };
    const weekIndex = Math.floor(cellIndex / 7);
    if (!weeks[weekIndex]) {
      weeks[weekIndex] = [];
      weeklySpans[weekIndex] = [];
    }
    weeks[weekIndex].push(day);
  }

  // Second pass: for each span event, split it into per-week segments clipped
  // to the visible grid, then assign lanes within each week.
  for (const ae of spanEvents) {
    const segments = splitSpanIntoWeekSegments(ae, weeks);
    for (const seg of segments) {
      weeklySpans[seg.weekIndex].push(seg.segment);
    }
  }
  for (let w = 0; w < weeklySpans.length; w++) {
    weeklySpans[w] = assignLanes(weeklySpans[w]);
  }

  return {
    monthLabel: firstOfMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    year,
    month,
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    weeks,
    weeklySpans,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

interface AggregatedEvent {
  event: ItineraryEvent;
  jobId: string;
  tripLabel: string;
}

function aggregateEvents(jobs: BookingJob[]): AggregatedEvent[] {
  const out: AggregatedEvent[] = [];
  for (const job of jobs) {
    job.steps.forEach((step, i) => {
      for (const event of extractStepEvents(step, i)) {
        out.push({ event, jobId: job.id, tripLabel: job.trip_label });
      }
    });
  }
  return out;
}

function pickSingleEventsForDay(events: AggregatedEvent[], iso: string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const ae of events) {
    if (ae.event.date === iso) {
      out.push({ event: ae.event, jobId: ae.jobId, tripLabel: ae.tripLabel });
    }
  }
  return out.sort((a, b) => {
    const ta = timeMinutes(a.event.time);
    const tb = timeMinutes(b.event.time);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  });
}

/**
 * For a single span event, emit one WeekSpanSegment per week it intersects
 * within the visible grid. Each segment is clipped to the week's [Sun..Sat]
 * range so a stay that crosses Sat→Sun produces two separate bars.
 * Returns segments paired with their week indices; lane=0 everywhere (lanes
 * are assigned in a second pass once all week members are known).
 */
function splitSpanIntoWeekSegments(
  ae: AggregatedEvent,
  weeks: CalendarDay[][],
): { weekIndex: number; segment: WeekSpanSegment }[] {
  const { event } = ae;
  if (!event.endDate) return [];
  const out: { weekIndex: number; segment: WeekSpanSegment }[] = [];
  for (let w = 0; w < weeks.length; w++) {
    const week = weeks[w];
    const weekStart = week[0].date;
    const weekEnd = week[6].date;
    // No overlap with this week?
    if (event.endDate < weekStart || event.date > weekEnd) continue;
    // Clip to [weekStart, weekEnd]
    const segStart = event.date >= weekStart ? event.date : weekStart;
    const segEnd = event.endDate <= weekEnd ? event.endDate : weekEnd;
    // Compute col indices within the week
    const startCol = week.findIndex((d) => d.date === segStart);
    const endCol = week.findIndex((d) => d.date === segEnd);
    if (startCol === -1 || endCol === -1) continue;
    out.push({
      weekIndex: w,
      segment: {
        event,
        jobId: ae.jobId,
        tripLabel: ae.tripLabel,
        startCol,
        endCol,
        lane: 0,
        isStartWeek: segStart === event.date,
        isEndWeek: segEnd === event.endDate,
      },
    });
  }
  return out;
}

/**
 * Assign a lane (0, 1, 2, ...) to each segment so overlapping segments stack
 * instead of overlapping. Greedy: sort by startCol, drop each into the first
 * lane whose last endCol has been cleared. Common case (one hotel per month):
 * everyone gets lane 0.
 */
function assignLanes(segments: WeekSpanSegment[]): WeekSpanSegment[] {
  if (segments.length === 0) return segments;
  const sorted = [...segments].sort((a, b) => a.startCol - b.startCol);
  const laneLastEnd: number[] = []; // laneLastEnd[i] = endCol of last segment in lane i, or -1
  for (const seg of sorted) {
    let lane = 0;
    while (lane < laneLastEnd.length && laneLastEnd[lane] >= seg.startCol) lane++;
    seg.lane = lane;
    laneLastEnd[lane] = seg.endCol;
  }
  return sorted;
}

function toIsoLocal(dt: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const parse = (iso: string) => {
    const [y, m, d] = iso.split("-").map((n) => Number(n));
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  };
  const a = parse(fromIso).getTime();
  const b = parse(toIso).getTime();
  return Math.round((b - a) / 86_400_000);
}

function timeMinutes(time: string | undefined): number | null {
  if (!time) return null;
  const m = time.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = Number(m[2]);
  const mer = m[3]?.toLowerCase();
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (mer === "pm" && hh !== 12) hh += 12;
  if (mer === "am" && hh === 12) hh = 0;
  return hh * 60 + mm;
}
