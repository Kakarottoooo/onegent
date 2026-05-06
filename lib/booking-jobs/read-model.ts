import type { BookingJob, BookingJobStep } from "@/lib/db";
import { taskWorkspaceViewForStatus, type TaskWorkspaceView } from "@/lib/booking-jobs/workspace";

export type BookingJobCompactStatus = BookingJob["status"];

export interface BookingJobCompactRow {
  id: string;
  session_id: string;
  user_id: string | null;
  trip_label: string;
  status: BookingJobCompactStatus;
  plan_version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  step_count: number;
  ready_step_count: number;
  action_count: number;
  first_step_type: BookingJobStep["type"] | null;
  first_step_emoji: string | null;
  first_step_label: string | null;
  latest_step_status: BookingJobStep["status"] | null;
  has_handoff_url: boolean;
  has_session_url: boolean;
}

export interface BookingJobListItem extends BookingJobCompactRow {
  workspace: TaskWorkspaceView;
  latest_status_label: string;
}

export interface BookingJobSummary {
  total: number;
  queue: number;
  live: number;
  history: number;
  actions: number;
  ready: number;
}

const STATUS_LABELS: Record<BookingJobCompactStatus, string> = {
  pending: "Queued",
  pending_local: "Queued locally",
  running: "Agent working",
  done: "Ready to review",
  failed: "Needs review",
};

export function compactRowFromJob(job: BookingJob): BookingJobCompactRow {
  let latestStepStatus: BookingJobStep["status"] | null = null;
  for (let index = job.steps.length - 1; index >= 0; index -= 1) {
    const status = job.steps[index]?.status;
    if (status && status !== "pending") {
      latestStepStatus = status;
      break;
    }
  }

  return {
    id: job.id,
    session_id: job.session_id,
    user_id: job.user_id,
    trip_label: job.trip_label,
    status: job.status,
    plan_version: job.plan_version ?? 1,
    created_at: job.created_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at,
    step_count: job.steps.length,
    ready_step_count: job.steps.filter((step) => step.status === "done" || step.status === "awaiting_confirmation").length,
    action_count: job.steps.filter((step) => step.actionItem).length,
    first_step_type: job.steps[0]?.type ?? null,
    first_step_emoji: job.steps[0]?.emoji ?? null,
    first_step_label: job.steps[0]?.label ?? null,
    latest_step_status: latestStepStatus ?? job.steps[0]?.status ?? null,
    has_handoff_url: job.steps.some((step) => Boolean(step.handoff_url)),
    has_session_url: job.steps.some((step) => Boolean(step.session_url)),
  };
}

export function toBookingJobListItem(row: BookingJobCompactRow): BookingJobListItem {
  return {
    ...row,
    workspace: taskWorkspaceViewForStatus(row.status),
    latest_status_label: STATUS_LABELS[row.status] ?? String(row.status),
  };
}

export function summarizeBookingJobList(items: BookingJobListItem[]): BookingJobSummary {
  return items.reduce<BookingJobSummary>(
    (summary, item) => {
      summary.total += 1;
      summary[item.workspace] += 1;
      summary.actions += item.action_count;
      summary.ready += item.ready_step_count;
      return summary;
    },
    { total: 0, queue: 0, live: 0, history: 0, actions: 0, ready: 0 },
  );
}

export function mergeCompactRows(
  sessionRows: BookingJobCompactRow[],
  userRows: BookingJobCompactRow[],
  limit: number,
): BookingJobListItem[] {
  const byId = new Map<string, BookingJobCompactRow>();
  for (const row of sessionRows) byId.set(row.id, row);
  for (const row of userRows) if (!byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
    .map(toBookingJobListItem);
}
