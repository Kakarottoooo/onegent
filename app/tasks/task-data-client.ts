"use client";

import type { BookingJob } from "@/lib/db";
import type { BookingJobListItem, BookingJobsSummary } from "@/lib/booking-jobs/read-model";

const LIST_TTL_MS = 3_000;
const DETAIL_TTL_MS = 4_000;
const SUMMARY_TTL_MS = 3_000;

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

type FetchOpts = {
  force?: boolean;
};

const listCache = new Map<string, CacheEntry<BookingJobListItem[]>>();
const listInflight = new Map<string, Promise<BookingJobListItem[]>>();
const detailCache = new Map<string, CacheEntry<BookingJob>>();
const detailInflight = new Map<string, Promise<BookingJob>>();
const summaryCache = new Map<string, CacheEntry<BookingJobsSummary>>();
const summaryInflight = new Map<string, Promise<BookingJobsSummary>>();

function cacheKey(parts: Record<string, string | number | boolean | undefined | null>): string {
  return Object.entries(parts)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("&");
}

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string, force?: boolean): T | null {
  if (force) return null;
  const cached = cache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached.data;
}

export async function fetchTaskList(
  sessionId: string,
  opts: FetchOpts & { includeShare?: boolean; limit?: number } = {},
): Promise<BookingJobListItem[]> {
  const key = cacheKey({
    sessionId,
    includeShare: opts.includeShare ? 1 : 0,
    limit: opts.limit ?? 60,
  });
  const cached = readCache(listCache, key, opts.force);
  if (cached) return cached;

  const existing = opts.force ? null : listInflight.get(key);
  if (existing) return existing;

  const url =
    `/api/booking-jobs/compact-list?session_id=${encodeURIComponent(sessionId)}` +
    `&limit=${encodeURIComponent(String(opts.limit ?? 60))}` +
    `${opts.includeShare ? "&include_share=1" : ""}`;
  const request = fetch(url, { cache: "no-store", headers: { Accept: "application/json" } })
    .then(async (res) => {
      if (!res.ok) return [];
      const data = (await res.json()) as { jobs?: BookingJobListItem[] };
      const jobs = data.jobs ?? [];
      listCache.set(key, { data: jobs, expiresAt: Date.now() + LIST_TTL_MS });
      return jobs;
    })
    .finally(() => {
      listInflight.delete(key);
    });

  listInflight.set(key, request);
  return request;
}

export async function fetchTaskSummary(
  sessionId: string,
  opts: FetchOpts = {},
): Promise<BookingJobsSummary> {
  const key = cacheKey({ sessionId });
  const cached = readCache(summaryCache, key, opts.force);
  if (cached) return cached;

  const existing = opts.force ? null : summaryInflight.get(key);
  if (existing) return existing;

  const request = fetch(
    `/api/booking-jobs/summary?session_id=${encodeURIComponent(sessionId)}`,
    { cache: "no-store", headers: { Accept: "application/json" } },
  )
    .then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as { summary?: BookingJobsSummary };
      const summary = data.summary ?? {
        total: 0,
        action_count: 0,
        active_count: 0,
        completed_count: 0,
        failed_count: 0,
        latest_updated_at: null,
      };
      if (res.ok) {
        summaryCache.set(key, { data: summary, expiresAt: Date.now() + SUMMARY_TTL_MS });
      }
      return summary;
    })
    .finally(() => {
      summaryInflight.delete(key);
    });

  summaryInflight.set(key, request);
  return request;
}

export async function fetchTaskDetail(jobId: string, opts: FetchOpts = {}): Promise<BookingJob> {
  const cached = readCache(detailCache, jobId, opts.force);
  if (cached) return cached;

  const existing = opts.force ? null : detailInflight.get(jobId);
  if (existing) return existing;

  const request = fetch(`/api/booking-jobs/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`Task detail ${jobId} failed with HTTP ${res.status}`);
      const data = (await res.json()) as { job?: BookingJob };
      if (!data.job) throw new Error(`Task detail ${jobId} response did not include a job`);
      detailCache.set(jobId, { data: data.job, expiresAt: Date.now() + DETAIL_TTL_MS });
      return data.job;
    })
    .finally(() => {
      detailInflight.delete(jobId);
    });

  detailInflight.set(jobId, request);
  return request;
}

export function invalidateTaskList(sessionId?: string): void {
  if (!sessionId) {
    listCache.clear();
    summaryCache.clear();
    return;
  }
  for (const key of [...listCache.keys()]) {
    if (key.includes(`sessionId=${sessionId}`)) listCache.delete(key);
  }
  summaryCache.delete(cacheKey({ sessionId }));
}

export function invalidateTaskDetail(jobId?: string): void {
  if (!jobId) {
    detailCache.clear();
    return;
  }
  detailCache.delete(jobId);
}

export function __resetTaskDataClientCachesForTests(): void {
  listCache.clear();
  listInflight.clear();
  detailCache.clear();
  detailInflight.clear();
  summaryCache.clear();
  summaryInflight.clear();
}
