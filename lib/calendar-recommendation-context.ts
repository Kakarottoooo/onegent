import { resolveDateHint } from "@/lib/agent/trip-intent-state";
import type { CalendarEventRow } from "@/lib/calendar-db";
import { syncGoogleCalendarEvents } from "@/lib/calendar-service";

export interface CalendarRecommendationContext {
  noteForAgent: string;
  noteForUser: string;
}

export async function loadCalendarRecommendationContext(params: {
  userId?: string;
  dateText?: string | null;
  timeHint?: string | null;
  durationMinutes?: number;
}): Promise<CalendarRecommendationContext | null> {
  if (!params.userId || !params.dateText) return null;
  const resolvedDate = resolveDateHint(params.dateText);
  if (!resolvedDate) return null;

  const synced = await syncGoogleCalendarEvents({
    userId: params.userId,
    rangeStart: addDaysIso(resolvedDate, -1),
    rangeEnd: addDaysIso(resolvedDate, 1),
  }).catch((error) => {
    console.warn("[calendar-recommendation-context] optional calendar sync failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  if (!synced) return null;
  if (!synced.connected || synced.events.length === 0) return null;

  const durationMinutes = Math.max(30, params.durationMinutes ?? 120);
  const targetStartMinutes = parseTimeHintToMinutes(params.timeHint);
  const targetEndMinutes =
    targetStartMinutes == null ? null : Math.min(24 * 60, targetStartMinutes + durationMinutes);

  const conflicts = synced.events.filter((event) =>
    targetStartMinutes == null || targetEndMinutes == null
      ? eventTouchesDate(event, resolvedDate)
      : eventOverlapsLocalWindow(
          event,
          resolvedDate,
          targetStartMinutes,
          targetEndMinutes,
          synced.calendarTimeZone,
        ),
  );

  if (conflicts.length === 0) return null;

  const labels = conflicts.slice(0, 3).map((event) => describeEvent(event, resolvedDate, synced.calendarTimeZone));
  const suffix = conflicts.length > 3 ? ` (+${conflicts.length - 3} more)` : "";
  const timeLabel =
    targetStartMinutes == null
      ? `on ${resolvedDate}`
      : `around ${formatMinutes(targetStartMinutes)} on ${resolvedDate}`;

  let recommendation = "prefer a different time or date";
  if (targetStartMinutes != null && targetEndMinutes != null) {
    const suggestedStart = suggestLaterStart(conflicts, resolvedDate, targetEndMinutes, synced.calendarTimeZone);
    if (suggestedStart != null) {
      recommendation = `prefer after ${formatMinutes(suggestedStart)} on the same day`;
    }
  }

  return {
    noteForAgent:
      `Google Calendar conflict note: the user already has ${labels.join("; ")}${suffix} ${timeLabel}. ` +
      `Avoid proposing options that depend on that slot; ${recommendation}.`,
    noteForUser:
      `Google Calendar already has ${labels.join("; ")}${suffix} ${timeLabel}, so the recommendations should avoid that slot.`,
  };
}

function parseTimeHintToMinutes(input: string | null | undefined): number | null {
  if (!input) return null;
  const normalized = input.trim().toLowerCase();
  const twelveHour = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (twelveHour) {
    let hour = Number(twelveHour[1]) % 12;
    const minute = Number(twelveHour[2] ?? "0");
    if (twelveHour[3] === "pm") hour += 12;
    return hour * 60 + minute;
  }
  const twentyFourHour = normalized.match(/^(\d{1,2})(?::(\d{2}))$/);
  if (twentyFourHour) {
    const hour = Number(twentyFourHour[1]);
    const minute = Number(twentyFourHour[2] ?? "0");
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
      return hour * 60 + minute;
    }
  }
  return null;
}

function eventTouchesDate(event: CalendarEventRow, targetDate: string): boolean {
  if (event.is_all_day) {
    const startDate = normalizeIsoDate(event.start_date);
    const endDate = normalizeIsoDate(event.end_date);
    return !!startDate && !!endDate && targetDate >= startDate && targetDate < endDate;
  }

  const start = normalizeLocalParts(event.start_at);
  const end = normalizeLocalParts(event.end_at);
  return targetDate >= start.date && targetDate <= end.date;
}

function eventOverlapsLocalWindow(
  event: CalendarEventRow,
  targetDate: string,
  startMinutes: number,
  endMinutes: number,
  timeZone?: string | null,
): boolean {
  if (event.is_all_day) return eventTouchesDate(event, targetDate);

  const start = normalizeLocalParts(event.start_at, timeZone);
  const end = normalizeLocalParts(event.end_at, timeZone);
  if (targetDate < start.date || targetDate > end.date) return false;

  const eventStartMinutes = targetDate === start.date ? start.minutes : 0;
  const eventEndMinutes = targetDate === end.date ? end.minutes : 24 * 60;
  return eventEndMinutes > startMinutes && eventStartMinutes < endMinutes;
}

function suggestLaterStart(
  conflicts: CalendarEventRow[],
  targetDate: string,
  currentEndMinutes: number,
  timeZone?: string | null,
): number | null {
  let latestEnd = currentEndMinutes;
  for (const event of conflicts) {
    if (event.is_all_day) return null;
    const end = normalizeLocalParts(event.end_at, timeZone);
    if (targetDate === end.date) {
      latestEnd = Math.max(latestEnd, end.minutes);
    } else {
      latestEnd = 24 * 60;
    }
  }
  const suggested = latestEnd + 30;
  return suggested < 23 * 60 ? suggested : null;
}

function describeEvent(
  event: CalendarEventRow,
  targetDate: string,
  timeZone?: string | null,
): string {
  if (event.is_all_day) return `"${event.title}" (all day)`;

  const start = normalizeLocalParts(event.start_at, timeZone);
  const end = normalizeLocalParts(event.end_at, timeZone);
  const startLabel = targetDate === start.date ? formatMinutes(start.minutes) : "00:00";
  const endLabel = targetDate === end.date ? formatMinutes(end.minutes) : "24:00";
  return `"${event.title}" (${startLabel}-${endLabel})`;
}

function normalizeLocalParts(input: string, timeZone?: string | null): { date: string; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(input));
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return {
    date: `${year}-${month}-${day}`,
    minutes: hour * 60 + minute,
  };
}

function normalizeIsoDate(input: string | Date | null | undefined): string | null {
  if (!input) return null;
  if (typeof input === "string") return input.slice(0, 10);
  if (input instanceof Date && Number.isFinite(input.getTime())) {
    return input.toISOString().slice(0, 10);
  }
  return null;
}

function addDaysIso(input: string, days: number): string {
  const date = new Date(`${input}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatMinutes(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}
