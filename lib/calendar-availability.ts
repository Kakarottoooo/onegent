import type { CalendarBusySlotRow, CalendarEventRow } from "@/lib/calendar-db";

export interface BusyCountMap {
  [isoDate: string]: number;
}

export interface ExternalCalendarEvent {
  id: string;
  title: string;
  timeLabel: string;
  isAllDay: boolean;
  calendarName: string | null;
  colorHex: string | null;
  eventUrl: string | null;
}

export interface ExternalCalendarEventsByDay {
  [isoDate: string]: ExternalCalendarEvent[];
}

export function buildBusyCountsByDay(
  slots: Array<Pick<CalendarBusySlotRow, "start_at" | "end_at">>,
  rangeStart: string,
  rangeEnd: string,
): BusyCountMap {
  const counts: BusyCountMap = {};
  const start = new Date(`${rangeStart}T00:00:00Z`);
  const end = new Date(`${rangeEnd}T00:00:00Z`);
  for (const slot of slots) {
    const slotStart = new Date(slot.start_at);
    const slotEnd = new Date(slot.end_at);
    for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const dayStart = new Date(cursor);
      const dayEnd = new Date(cursor);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      if (slotStart < dayEnd && slotEnd > dayStart) {
        const iso = dayStart.toISOString().slice(0, 10);
        counts[iso] = (counts[iso] ?? 0) + 1;
      }
    }
  }
  return counts;
}

export function summarizeTripConflicts(
  slots: Array<Pick<CalendarBusySlotRow, "start_at" | "end_at">>,
  fromDate: string,
  toDate: string,
): { conflictCount: number; busyDays: number } {
  const counts = buildBusyCountsByDay(slots, fromDate, toDate);
  return {
    conflictCount: Object.values(counts).reduce((sum, value) => sum + value, 0),
    busyDays: Object.keys(counts).length,
  };
}

export function suggestNextFreeWindow(params: {
  slots: Array<Pick<CalendarBusySlotRow, "start_at" | "end_at">>;
  startDate: string;
  nights: number;
  searchDays?: number;
}): { from: string; to: string } | null {
  const searchDays = params.searchDays ?? 45;
  const requiredSpanDays = Math.max(1, params.nights);
  const searchStart = new Date(`${params.startDate}T00:00:00Z`);
  const searchEnd = new Date(searchStart);
  searchEnd.setUTCDate(searchEnd.getUTCDate() + searchDays);
  const busyCounts = buildBusyCountsByDay(
    params.slots,
    searchStart.toISOString().slice(0, 10),
    searchEnd.toISOString().slice(0, 10),
  );

  for (let cursor = new Date(searchStart); cursor <= searchEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    let ok = true;
    for (let offset = 0; offset <= requiredSpanDays; offset++) {
      const probe = new Date(cursor);
      probe.setUTCDate(probe.getUTCDate() + offset);
      const iso = probe.toISOString().slice(0, 10);
      if ((busyCounts[iso] ?? 0) > 0) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const from = cursor.toISOString().slice(0, 10);
      const to = new Date(cursor);
      to.setUTCDate(to.getUTCDate() + requiredSpanDays);
      return { from, to: to.toISOString().slice(0, 10) };
    }
  }
  return null;
}

export function buildExternalEventsByDay(
  events: CalendarEventRow[],
  rangeStart: string,
  rangeEnd: string,
  timeZone?: string | null,
): ExternalCalendarEventsByDay {
  const byDay: ExternalCalendarEventsByDay = {};

  for (const event of events) {
    const normalizedStartDate = normalizeIsoDate(event.start_date);
    const normalizedEndDate = normalizeIsoDate(event.end_date);
    const dayStartIso = event.is_all_day && normalizedStartDate
      ? normalizedStartDate
      : formatIsoDateInTimeZone(event.start_at, timeZone);
    const dayEndExclusiveIso = event.is_all_day && normalizedEndDate
      ? normalizedEndDate
      : formatIsoDateInTimeZone(event.end_at, timeZone);

    const overlapStart = event.is_all_day
      ? maxIsoDate(dayStartIso, rangeStart)
      : maxIsoDate(dayStartIso, rangeStart);
    const overlapEndExclusive = event.is_all_day
      ? minIsoDate(dayEndExclusiveIso, addDaysIso(rangeEnd, 1))
      : minIsoDate(addDaysIso(dayEndExclusiveIso, 1), addDaysIso(rangeEnd, 1));

    for (
      let cursor = overlapStart;
      cursor < overlapEndExclusive;
      cursor = addDaysIso(cursor, 1)
    ) {
      if (!byDay[cursor]) byDay[cursor] = [];
      const isStartDay = cursor === dayStartIso;
      byDay[cursor].push({
        id: `${event.id}:${cursor}`,
        title: event.title,
        timeLabel: event.is_all_day
          ? "All day"
          : isStartDay
          ? formatClockInTimeZone(event.start_at, timeZone)
          : "Continues",
        isAllDay: event.is_all_day,
        calendarName: event.source_calendar_name,
        colorHex: event.color_hex,
        eventUrl: event.event_url,
      });
    }
  }

  for (const day of Object.keys(byDay)) {
    byDay[day].sort((a, b) => {
      if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
      return a.timeLabel.localeCompare(b.timeLabel);
    });
  }

  return byDay;
}

function formatIsoDateInTimeZone(input: string, timeZone?: string | null): string {
  const date = new Date(input);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function formatClockInTimeZone(input: string, timeZone?: string | null): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone ?? "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(input));
}

function addDaysIso(input: string, days: number): string {
  const date = new Date(`${input}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function maxIsoDate(a: string, b: string): string {
  return a > b ? a : b;
}

function minIsoDate(a: string, b: string): string {
  return a < b ? a : b;
}

function normalizeIsoDate(input: string | Date | null | undefined): string | null {
  if (!input) return null;
  if (typeof input === "string") return input.slice(0, 10);
  if (input instanceof Date && Number.isFinite(input.getTime())) {
    return input.toISOString().slice(0, 10);
  }
  return null;
}
