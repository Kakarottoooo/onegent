"use client";

import type { AppBootstrapData } from "@/lib/app-bootstrap";

const BOOTSTRAP_TTL_MS = 12_000;

const EMPTY_BOOTSTRAP: AppBootstrapData = {
  sidebar: {
    rooms: [],
    sessions: [],
  },
  recent_jobs: [],
  booking_jobs_summary: {
    total: 0,
    action_count: 0,
    active_count: 0,
    completed_count: 0,
    failed_count: 0,
    latest_updated_at: null,
  },
  generated_at: "",
};

type CacheEntry = {
  expiresAt: number;
  data: AppBootstrapData;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<AppBootstrapData>>();

function cacheKey(sessionId?: string | null): string {
  return sessionId?.trim() || "no-session";
}

function bootstrapUrl(sessionId?: string | null): string {
  const sid = sessionId?.trim();
  if (!sid) return "/api/app/bootstrap";
  return `/api/app/bootstrap?session_id=${encodeURIComponent(sid)}`;
}

export async function fetchAppBootstrapCached(
  sessionId?: string | null,
  options: { force?: boolean } = {},
): Promise<AppBootstrapData> {
  const key = cacheKey(sessionId);
  const now = Date.now();
  if (!options.force) {
    const existing = cache.get(key);
    if (existing && existing.expiresAt > now) return existing.data;
    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const request = fetch(bootstrapUrl(sessionId), { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return EMPTY_BOOTSTRAP;
      return (await response.json()) as AppBootstrapData;
    })
    .catch(() => EMPTY_BOOTSTRAP)
    .then((data) => {
      cache.set(key, { data, expiresAt: Date.now() + BOOTSTRAP_TTL_MS });
      inflight.delete(key);
      return data;
    });

  inflight.set(key, request);
  return request;
}

export function clearAppBootstrapCache(): void {
  cache.clear();
  inflight.clear();
}
