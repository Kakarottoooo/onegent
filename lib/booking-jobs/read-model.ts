import {
  getBookingJobListRowsBySession,
  getBookingJobListRowsByUser,
  getBookingJobSummariesBySession,
  getBookingJobSummariesByUser,
  getBookingJobsBySession,
  getBookingJobsByUser,
  getSharedArtifactsByRefs,
  type BookingJob,
  type BookingJobListRow,
  type BookingJobSummary,
  type SharedArtifact,
} from "@/lib/db";
import { taskWorkspaceViewForJob } from "./workspace";
import type { TaskWorkspaceBucket } from "./workspace";
export type { TaskWorkspaceBucket } from "./workspace";

export type BookingJobOwnShare = Pick<SharedArtifact, "slug" | "view_count" | "visibility">;

export type VisibleBookingJob = BookingJob & {
  own_share?: BookingJobOwnShare | null;
};

export type BookingJobListItem = {
  id: string;
  session_id: string;
  user_id: string | null;
  trip_label: string;
  status: BookingJob["status"];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  step_count: number;
  action_count: number;
  done_count: number;
  awaiting_confirmation_count: number;
  adjusted_count: number;
  replan_count: number;
  active: boolean;
  completed: boolean;
  failed: boolean;
  workspace: TaskWorkspaceBucket;
  latest_status_label: string;
  primary_step_type: string | null;
  primary_step_label: string | null;
  primary_step_status: string | null;
  provider: string | null;
  scenario: string | null;
  own_share?: BookingJobOwnShare | null;
};

export type BookingJobsSummary = {
  total: number;
  action_count: number;
  active_count: number;
  completed_count: number;
  failed_count: number;
  latest_updated_at: string | null;
};

function mergeRowsById<T extends { id: string; created_at: string }>(rows: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

function numberField(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function inferProvider(row: BookingJobListRow): string | null {
  const scenario = row.scenario?.toLowerCase() ?? "";
  const stepType = row.primary_step_type?.toLowerCase() ?? "";
  const url = row.primary_start_url?.toLowerCase() ?? "";
  if (url.includes("opentable.com")) return "opentable";
  if (url.includes("resy.com")) return "resy";
  if (url.includes("booking.com")) return "booking_com";
  if (url.includes("hotels.com")) return "hotels_com";
  if (url.includes("expedia.com")) return stepType === "flight" ? "expedia_flight" : "expedia";
  if (url.includes("kayak.com")) return "kayak";
  if (scenario.includes("restaurant") || stepType === "restaurant") return "restaurant";
  if (scenario.includes("hotel") || stepType === "hotel") return "hotel";
  if (scenario.includes("flight") || stepType === "flight") return "flight";
  return stepType || null;
}

export function classifyBookingJobListItem(row: Pick<
  BookingJobListRow,
  "status" | "action_count" | "done_count" | "awaiting_confirmation_count" | "step_count" | "primary_step_status"
>): TaskWorkspaceBucket {
  return taskWorkspaceViewForJob(row);
}

export function latestBookingJobStatusLabel(row: Pick<
  BookingJobListRow,
  "status" | "action_count" | "done_count" | "awaiting_confirmation_count" | "step_count" | "primary_step_status"
>): string {
  if (row.status === "pending" || row.status === "pending_local") return "Queued";
  if (row.status === "running") return "Agent working...";
  if (numberField(row.action_count) > 0) return "Needs your input";
  if (numberField(row.awaiting_confirmation_count) > 0) return "Ready to review - confirm on site";
  if (row.primary_step_status === "no_availability") return "Not available for these dates";
  const stepCount = numberField(row.step_count);
  if (row.status === "done" && stepCount > 0 && numberField(row.done_count) >= stepCount) {
    return "All done";
  }
  if (row.status === "failed") return "Failed - tap to retry";
  return "Task recorded";
}

export function buildBookingJobListItem(
  row: BookingJobListRow,
  ownShare: BookingJobOwnShare | null = null,
): BookingJobListItem {
  const actionCount = numberField(row.action_count);
  const doneCount = numberField(row.done_count);
  const awaitingConfirmationCount = numberField(row.awaiting_confirmation_count);
  const item: BookingJobListItem = {
    id: row.id,
    session_id: row.session_id,
    user_id: row.user_id,
    trip_label: row.trip_label,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    step_count: numberField(row.step_count),
    action_count: actionCount,
    done_count: doneCount,
    awaiting_confirmation_count: awaitingConfirmationCount,
    adjusted_count: numberField(row.adjusted_count),
    replan_count: numberField(row.replan_count),
    active: row.status === "pending" || row.status === "pending_local" || row.status === "running",
    completed: row.status === "done",
    failed: row.status === "failed",
    workspace: classifyBookingJobListItem(row),
    latest_status_label: latestBookingJobStatusLabel(row),
    primary_step_type: row.primary_step_type,
    primary_step_label: row.primary_step_label,
    primary_step_status: row.primary_step_status,
    provider: inferProvider(row),
    scenario: row.scenario,
    own_share: ownShare,
  };
  return item;
}

export async function getVisibleBookingJobs(params: {
  sessionId: string;
  userId?: string | null;
  includeUserJobs?: boolean;
  includeShares?: boolean;
  limit?: number;
}): Promise<VisibleBookingJob[]> {
  const limit = params.limit ?? 20;
  const includeUserJobs = params.includeUserJobs ?? true;
  const [sessionJobs, userJobs] = await Promise.all([
    getBookingJobsBySession(params.sessionId, limit),
    includeUserJobs && params.userId
      ? getBookingJobsByUser(params.userId, limit)
      : Promise.resolve([] as BookingJob[]),
  ]);
  const jobs = mergeRowsById([...sessionJobs, ...userJobs]) as VisibleBookingJob[];

  if (!params.includeShares || !params.userId || jobs.length === 0) {
    return jobs.map((job) => ({ ...job, own_share: null }));
  }

  const ownedJobIds = jobs.filter((job) => job.user_id === params.userId).map((job) => job.id);
  const shareMap =
    ownedJobIds.length > 0
      ? await getSharedArtifactsByRefs(params.userId, "booking", ownedJobIds)
      : {};

  return jobs.map((job) => {
    const share = shareMap[job.id];
    return {
      ...job,
      own_share: share
        ? {
            slug: share.slug,
            view_count: share.view_count,
            visibility: share.visibility,
          }
        : null,
    };
  });
}

export async function getVisibleBookingJobSummaries(params: {
  sessionId: string;
  userId?: string | null;
  includeUserJobs?: boolean;
  limit?: number;
}): Promise<BookingJobSummary[]> {
  const limit = params.limit ?? 20;
  const includeUserJobs = params.includeUserJobs ?? true;
  const [sessionJobs, userJobs] = await Promise.all([
    getBookingJobSummariesBySession(params.sessionId, limit),
    includeUserJobs && params.userId
      ? getBookingJobSummariesByUser(params.userId, limit)
      : Promise.resolve([] as BookingJobSummary[]),
  ]);
  return mergeRowsById([...sessionJobs, ...userJobs]);
}

export async function getVisibleBookingJobListItems(params: {
  sessionId: string;
  userId?: string | null;
  includeShares?: boolean;
  limit?: number;
}): Promise<BookingJobListItem[]> {
  const limit = params.limit ?? 50;
  const [sessionJobs, userJobs] = await Promise.all([
    getBookingJobListRowsBySession(params.sessionId, limit),
    params.userId
      ? getBookingJobListRowsByUser(params.userId, limit)
      : Promise.resolve([] as BookingJobListRow[]),
  ]);
  const rows = mergeRowsById([...sessionJobs, ...userJobs]);

  if (!params.includeShares || !params.userId || rows.length === 0) {
    return rows.map((row) => buildBookingJobListItem(row));
  }

  const ownedJobIds = rows.filter((row) => row.user_id === params.userId).map((row) => row.id);
  const shareMap =
    ownedJobIds.length > 0
      ? await getSharedArtifactsByRefs(params.userId, "booking", ownedJobIds)
      : {};

  return rows.map((row) => {
    const share = shareMap[row.id];
    return buildBookingJobListItem(
      row,
      share
        ? {
            slug: share.slug,
            view_count: share.view_count,
            visibility: share.visibility,
          }
        : null,
    );
  });
}

export function summarizeBookingJobs(jobs: BookingJobSummary[]): BookingJobsSummary {
  let actionCount = 0;
  let activeCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  let latestUpdatedAt: string | null = null;

  for (const job of jobs) {
    actionCount += Number(job.action_count) || 0;
    if (job.status === "pending" || job.status === "pending_local" || job.status === "running") {
      activeCount += 1;
    } else if (job.status === "done") {
      completedCount += 1;
    } else if (job.status === "failed") {
      failedCount += 1;
    }
    if (!latestUpdatedAt || new Date(job.updated_at).getTime() > new Date(latestUpdatedAt).getTime()) {
      latestUpdatedAt = job.updated_at;
    }
  }

  return {
    total: jobs.length,
    action_count: actionCount,
    active_count: activeCount,
    completed_count: completedCount,
    failed_count: failedCount,
    latest_updated_at: latestUpdatedAt,
  };
}
