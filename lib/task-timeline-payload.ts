import {
  getAgentLogs,
  getBookingJob,
  type BookingJob,
} from "@/lib/db";
import {
  liveLogEpoch,
  liveLogGet,
  liveLogIsClosed,
  type LiveLogLineEntry,
} from "@/lib/live-log-store";
import {
  buildTaskTimelineEvents,
  buildTaskTimelineSummary,
  type TaskTimelineEvent,
  type TaskTimelineSummary,
} from "@/lib/task-timeline";

export const TERMINAL_JOB_STATUSES = new Set([
  "done",
  "failed",
  "cancelled",
  "succeeded",
]);

const MAX_TRACE_ENTRIES = 200;

export interface TraceSnapshot {
  entries: LiveLogLineEntry[];
  closed: boolean;
  epoch: number;
  source: "live" | "audit";
}

export interface JobTimelinePayload {
  jobId: string;
  job: BookingJob;
  events: TaskTimelineEvent[];
  summary: TaskTimelineSummary;
  entries: LiveLogLineEntry[];
  total: number;
  closed: boolean;
  epoch: number;
  source: "live" | "audit";
}

async function readTrace(jobId: string, job: BookingJob): Promise<TraceSnapshot> {
  const liveEntries = liveLogGet(jobId, 0).slice(-MAX_TRACE_ENTRIES);
  if (liveEntries.length > 0) {
    return {
      entries: liveEntries,
      closed: liveLogIsClosed(jobId),
      epoch: liveLogEpoch(jobId),
      source: "live",
    };
  }

  const auditRows = await getAgentLogs({
    jobId,
    source: "audit",
    limit: MAX_TRACE_ENTRIES,
  });

  const entries = [...auditRows].reverse().map((row) => {
    const details = (row.details ?? {}) as Record<string, unknown>;
    const eventType = typeof details.type === "string" ? details.type : "info";
    const rawTs = row.created_at as unknown;
    const ts = rawTs instanceof Date
      ? rawTs.toISOString()
      : new Date(rawTs as string | number).toISOString();

    return {
      line: `[${eventType}] ${row.message}`,
      ts,
    };
  });

  return {
    entries,
    closed: TERMINAL_JOB_STATUSES.has(job.status),
    epoch: 0,
    source: "audit",
  };
}

export async function buildJobTimelinePayload(
  jobId: string,
): Promise<JobTimelinePayload | null> {
  const job = await getBookingJob(jobId);
  if (!job) return null;

  const trace = await readTrace(jobId, job);
  const events = buildTaskTimelineEvents(job, trace.entries);
  const summary = buildTaskTimelineSummary(job);
  const closed = trace.closed || TERMINAL_JOB_STATUSES.has(job.status);

  return {
    jobId,
    job,
    events,
    summary,
    entries: trace.entries,
    total: trace.entries.length,
    closed,
    epoch: trace.epoch,
    source: trace.source,
  };
}
