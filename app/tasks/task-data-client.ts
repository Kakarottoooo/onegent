import type { BookingJob } from "@/lib/db";
import type { BookingJobListItem, BookingJobSummary } from "@/lib/booking-jobs/read-model";

const COMPACT_TTL_MS = 2500;
const DETAIL_TTL_MS = 1500;

type CacheEntry<T> = { expiresAt: number; promise: Promise<T> };

const compactCache = new Map<string, CacheEntry<{ jobs: BookingJobListItem[]; summary: BookingJobSummary }>>();
const detailCache = new Map<string, CacheEntry<BookingJob>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): Promise<T> | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.promise;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, ttlMs: number, promise: Promise<T>): Promise<T> {
  cache.set(key, { expiresAt: Date.now() + ttlMs, promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

export function invalidateTaskData(jobId?: string) {
  compactCache.clear();
  if (jobId) detailCache.delete(jobId);
  else detailCache.clear();
}

export function fetchTaskCompactList(
  sessionId: string,
  signal?: AbortSignal,
): Promise<{ jobs: BookingJobListItem[]; summary: BookingJobSummary }> {
  const key = sessionId;
  const cached = signal ? null : getCached(compactCache, key);
  if (cached) return cached;

  const request = fetch(`/api/booking-jobs/compact-list?session_id=${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
    signal,
  })
    .then((res) => {
      if (!res.ok) throw new Error(`compact-list failed: ${res.status}`);
      return res.json();
    })
    .then((data) => ({
      jobs: (data.jobs ?? []) as BookingJobListItem[],
      summary: (data.summary ?? { total: 0, queue: 0, live: 0, history: 0, actions: 0, ready: 0 }) as BookingJobSummary,
    }));

  return signal ? request : setCached(compactCache, key, COMPACT_TTL_MS, request);
}

export function fetchTaskDetail(jobId: string, signal?: AbortSignal): Promise<BookingJob> {
  const cached = signal ? null : getCached(detailCache, jobId);
  if (cached) return cached;

  const request = fetch(`/api/booking-jobs/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
    signal,
  })
    .then((res) => {
      if (!res.ok) throw new Error(`task detail failed: ${res.status}`);
      return res.json();
    })
    .then((data) => data.job as BookingJob);

  return signal ? request : setCached(detailCache, jobId, DETAIL_TTL_MS, request);
}
