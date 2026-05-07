import {
  getBookingJobCalendarRowsBySession,
  getBookingJobCalendarRowsByUser,
  type BookingJob,
  type BookingJobCalendarRow,
  type BookingJobStep,
} from "@/lib/db";

export type CalendarJobStep = BookingJobStep;

export type CalendarJobItem = Pick<
  BookingJob,
  "id" | "session_id" | "user_id" | "trip_label" | "status" | "created_at" | "updated_at"
> & {
  steps: CalendarJobStep[];
};

export const CALENDAR_JOBS_HEAVY_FIELDS_EXCLUDED = [
  "autonomy_settings",
  "constraints",
  "policy",
  "decisionLog",
  "actionItem",
  "error",
  "fallbackCandidates",
  "screenshots",
  "logs",
];

function normalizeSteps(steps: BookingJobStep[]): CalendarJobStep[] {
  return steps.map((step) => ({
    type: step.type,
    emoji: step.emoji,
    label: step.label,
    apiEndpoint: step.apiEndpoint,
    body: step.body,
    fallbackUrl: step.fallbackUrl,
    status: step.status,
    handoff_url: step.handoff_url,
    session_url: step.session_url,
    selected_time: step.selected_time,
  }));
}

export function buildCalendarJobItem(row: BookingJobCalendarRow): CalendarJobItem {
  return {
    id: row.id,
    session_id: row.session_id,
    user_id: row.user_id,
    trip_label: row.trip_label,
    status: row.status,
    steps: normalizeSteps(row.steps),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mergeRowsById(rows: BookingJobCalendarRow[]): BookingJobCalendarRow[] {
  const byId = new Map<string, BookingJobCalendarRow>();
  for (const row of rows) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export async function getVisibleCalendarJobItems(params: {
  sessionId: string;
  userId?: string | null;
  limit?: number;
}): Promise<CalendarJobItem[]> {
  const limit = params.limit ?? 100;
  const [sessionJobs, userJobs] = await Promise.all([
    getBookingJobCalendarRowsBySession(params.sessionId, limit),
    params.userId
      ? getBookingJobCalendarRowsByUser(params.userId, limit)
      : Promise.resolve([] as BookingJobCalendarRow[]),
  ]);
  return mergeRowsById([...sessionJobs, ...userJobs]).map(buildCalendarJobItem);
}
