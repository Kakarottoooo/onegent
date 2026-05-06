import {
  getBookingJobSummariesBySession,
  getBookingJobSummariesByUser,
  getBookingJobsBySession,
  getBookingJobsByUser,
  getSharedArtifactsByRefs,
  type BookingJob,
  type BookingJobSummary,
  type SharedArtifact,
} from "@/lib/db";

export type BookingJobOwnShare = Pick<SharedArtifact, "slug" | "view_count" | "visibility">;

export type VisibleBookingJob = BookingJob & {
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

export async function getVisibleBookingJobs(params: {
  sessionId: string;
  userId?: string | null;
  includeShares?: boolean;
  limit?: number;
}): Promise<VisibleBookingJob[]> {
  const limit = params.limit ?? 20;
  const [sessionJobs, userJobs] = await Promise.all([
    getBookingJobsBySession(params.sessionId, limit),
    params.userId ? getBookingJobsByUser(params.userId, limit) : Promise.resolve([] as BookingJob[]),
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
  limit?: number;
}): Promise<BookingJobSummary[]> {
  const limit = params.limit ?? 20;
  const [sessionJobs, userJobs] = await Promise.all([
    getBookingJobSummariesBySession(params.sessionId, limit),
    params.userId
      ? getBookingJobSummariesByUser(params.userId, limit)
      : Promise.resolve([] as BookingJobSummary[]),
  ]);
  return mergeRowsById([...sessionJobs, ...userJobs]);
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
