/**
 * Itinerary extraction — pure utilities for turning BookingJobStep[]s into a
 * day-grouped event list suitable for the TripItineraryCalendar view.
 *
 * Each step's "when" lives in its scenario-specific body (hotel checkin/out,
 * flight.date + targetDepartureTime, restaurant.date + time, activity.event_date).
 * The per-type logic here is the single source of truth — keep it aligned with
 * app/api/booking-jobs/create-trip/route.ts which constructs those bodies.
 */
import type { BookingJobStep } from "./db";

export interface ItineraryEvent {
  /** The source step — the caller uses this for status color + click targets. */
  step: BookingJobStep;
  /** Stable index (position in the job's step array) — used as React key when
   *  a step produces multiple events (e.g. round-trip flight). */
  stepIndex: number;
  /** Discriminates outbound vs return for flights, check-in for hotels, etc. */
  slot: "outbound" | "return" | "checkin" | "meal" | "show" | "other";
  /** ISO YYYY-MM-DD — for span events (hotel), this is the start day. */
  date: string;
  /** ISO YYYY-MM-DD — last day the event "occupies" (inclusive, for the
   *  month-view calendar to render a bar spanning cells). Only populated for
   *  hotel stays; single-day events leave this undefined. */
  endDate?: string;
  /** Clock label ("19:00" / "8:30 AM") or undefined if none known. */
  time?: string;
  /** For hotels: trailing "3 nights" badge. For round-trip flight: "return". */
  badge?: string;
  /** Label override for this event (defaults to step.label when absent). */
  label?: string;
}

export interface DayGroup {
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Human-readable header — "Friday, May 2". */
  header: string;
  /** Events sorted by time (undefined-time events at the bottom). */
  events: ItineraryEvent[];
}

// ─── Public API ──────────────────────────────────────────────────────────

export interface BuildItineraryOptions {
  /**
   * When true, days inside the trip's span with no events are still emitted
   * (with events=[]) so the calendar shows the full trip shape instead of
   * jumping from check-in day straight to departure day. Default: false.
   */
  fillEmptyDays?: boolean;
  /**
   * Upper bound on gap-filling — days that would extend the trip beyond this
   * many total days are dropped. Prevents a 30-night hotel stay from rendering
   * 30 empty rows. Default: 14.
   */
  maxSpanDays?: number;
}

/**
 * Turn a job's steps into day-grouped events.
 *
 * Events are sorted by time within each day; untimed events drop to the end.
 * By default, days with no events are skipped — pass `{ fillEmptyDays: true }`
 * to include them as empty groups (useful when rendering a calendar-style
 * view where gaps should be visible).
 */
export function buildItineraryDayGroups(
  steps: BookingJobStep[],
  opts: BuildItineraryOptions = {},
): DayGroup[] {
  const events: ItineraryEvent[] = [];
  steps.forEach((step, i) => {
    events.push(...extractStepEvents(step, i));
  });
  const byDate = new Map<string, ItineraryEvent[]>();
  for (const ev of events) {
    const bucket = byDate.get(ev.date) ?? [];
    bucket.push(ev);
    byDate.set(ev.date, bucket);
  }

  const activeDates = [...byDate.keys()].sort();
  if (activeDates.length === 0) return [];

  const datesToEmit: string[] = opts.fillEmptyDays
    ? expandDateRange(activeDates, opts.maxSpanDays ?? 14)
    : activeDates;

  return datesToEmit.map((date) => ({
    date,
    header: formatDayHeader(date),
    events: sortEventsByTime(byDate.get(date) ?? []),
  }));
}

/**
 * Return every YYYY-MM-DD between min(activeDates) and max(activeDates)
 * inclusive, capped at `maxSpan` total days (if the span exceeds that, we
 * fall back to just the active dates to avoid a huge empty calendar).
 */
function expandDateRange(activeDates: string[], maxSpan: number): string[] {
  if (activeDates.length < 2) return activeDates;
  const [first] = activeDates;
  const last = activeDates[activeDates.length - 1];
  const parseLocal = (iso: string) => {
    const [y, m, d] = iso.split("-").map((n) => Number(n));
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  };
  const start = parseLocal(first);
  const end = parseLocal(last);
  const span = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (span > maxSpan) return activeDates; // bail out on absurd stays

  const out: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let i = 0; i < span; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return out;
}

/**
 * Per-step event extraction. Public so tests can exercise each type in isolation.
 */
export function extractStepEvents(step: BookingJobStep, stepIndex: number): ItineraryEvent[] {
  switch (step.type) {
    case "hotel":
      return extractHotel(step, stepIndex);
    case "flight":
      return extractFlight(step, stepIndex);
    case "restaurant":
      return extractRestaurant(step, stepIndex);
    case "activity":
      return extractActivity(step, stepIndex);
    case "universal":
    default:
      return extractFallback(step, stepIndex);
  }
}

// ─── Per-type extractors ─────────────────────────────────────────────────

function extractHotel(step: BookingJobStep, stepIndex: number): ItineraryEvent[] {
  const checkin = readString(step.body.checkin, step.body.check_in);
  const checkout = readString(step.body.checkout, step.body.check_out);
  if (!checkin) return [];
  const nights = computeNights(checkin, checkout);
  // endDate is (checkout - 1) — on checkout day itself the guest has already
  // left, so the bar on the calendar shouldn't extend into that cell. If we
  // can't compute it (no checkout), leave undefined and the calendar draws a
  // single-day bar.
  const endDate = nights && nights > 1 ? shiftDate(checkout!, -1) : undefined;
  return [
    {
      step,
      stepIndex,
      slot: "checkin",
      date: checkin,
      endDate,
      time: undefined,
      badge: nights ? `${nights} night${nights === 1 ? "" : "s"}` : undefined,
    },
  ];
}

function extractFlight(step: BookingJobStep, stepIndex: number): ItineraryEvent[] {
  const outbound = readString(step.body.date, step.body.departure_date);
  const ret = readString(step.body.returnDate, step.body.return_date);
  const time = readString(step.body.targetDepartureTime, step.body.time);
  const out: ItineraryEvent[] = [];
  if (outbound) {
    out.push({
      step,
      stepIndex,
      slot: "outbound",
      date: outbound,
      time,
      badge: ret ? "outbound" : undefined,
    });
  }
  if (ret) {
    out.push({
      step,
      stepIndex,
      slot: "return",
      date: ret,
      // Return flight time isn't captured in the step body today; leave blank.
      time: undefined,
      badge: "return",
    });
  }
  return out;
}

function extractRestaurant(step: BookingJobStep, stepIndex: number): ItineraryEvent[] {
  const date = readString(step.body.date);
  if (!date) return [];
  const time = readString(
    step.selected_time,      // runtime: if a time fallback succeeded, this wins
    step.body.time,
  );
  return [{ step, stepIndex, slot: "meal", date, time }];
}

function extractActivity(step: BookingJobStep, stepIndex: number): ItineraryEvent[] {
  const raw = readString(step.body.event_date, step.body.date);
  if (!raw) return [];
  // activity.datetime_local can be either YYYY-MM-DD or full ISO; splitting
  // on "T" gets us the date cheaply and the time if present.
  const [datePart, rest] = raw.split("T");
  const date = datePart ?? raw;
  let time: string | undefined;
  if (rest) {
    const hhmm = rest.match(/^(\d{1,2}:\d{2})/)?.[1];
    if (hhmm) time = hhmm;
  }
  return [{ step, stepIndex, slot: "show", date, time }];
}

function extractFallback(step: BookingJobStep, stepIndex: number): ItineraryEvent[] {
  // "universal" or unknown type — best-effort date pull. Drop the event if
  // we can't place it on a day; the task card below the calendar still shows it.
  const date = readString(step.body.date, step.body.event_date, step.body.checkin);
  if (!date) return [];
  return [{ step, stepIndex, slot: "other", date, time: undefined }];
}

// ─── Utilities ───────────────────────────────────────────────────────────

function readString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/**
 * Shift a YYYY-MM-DD string by N days (negative for backward). Uses local-TZ
 * Date constructors so month/year boundaries are handled correctly.
 */
function shiftDate(iso: string, offsetDays: number): string {
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function computeNights(checkin: string, checkout: string | undefined): number | null {
  if (!checkout) return null;
  const a = Date.parse(`${checkin}T00:00:00`);
  const b = Date.parse(`${checkout}T00:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.round((b - a) / 86_400_000);
}

function formatDayHeader(iso: string): string {
  // Use local parsing so "2026-04-24" renders as Friday in the server/user's TZ,
  // not shifted by UTC. new Date("2026-04-24") is parsed as UTC midnight and can
  // display as the previous day in negative offsets.
  const [y, m, d] = iso.split("-").map((n) => Number(n));
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function sortEventsByTime(events: ItineraryEvent[]): ItineraryEvent[] {
  return [...events].sort((a, b) => {
    const ta = toMinutes(a.time);
    const tb = toMinutes(b.time);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;  // untimed events drop to bottom
    if (tb === null) return -1;
    return ta - tb;
  });
}

/**
 * Parse "HH:MM" or "H:MM AM/PM" into minutes-since-midnight. Returns null
 * for anything we can't parse so the caller drops it to the bottom.
 */
function toMinutes(time: string | undefined): number | null {
  if (!time) return null;
  const trimmed = time.trim();
  const ampm = trimmed.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!ampm) return null;
  let hh = Number(ampm[1]);
  const mm = Number(ampm[2]);
  const mer = ampm[3]?.toLowerCase();
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (mer === "pm" && hh !== 12) hh += 12;
  if (mer === "am" && hh === 12) hh = 0;
  return hh * 60 + mm;
}
