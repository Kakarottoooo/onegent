"use client";

/**
 * Hook: fetch + poll the execution snapshots for a job.
 *
 * Backend contract owned by Track A (codex 8a2da14):
 *
 *   Canonical · GET /api/booking-jobs/:id/snapshots
 *   Compat    · GET /api/browser-live/:id/snapshots
 *
 * Both return the same payload shape — the canonical path is a thin
 * forward to the same store; the browser-live URL is preserved so
 * existing rails (the live agent canvas at /tasks) keep working without
 * a synchronized cutover.
 *
 * We try the canonical path first and fall back to compat on 404. Polls
 * every 3s while the run is open; the panel passes `closed=true` once
 * timeline says the run finished, at which point we stop polling.
 */

import { useEffect, useRef, useState } from "react";
import type { ExecutionSnapshot } from "./types";

const POLL_INTERVAL_MS = 3_000;
const SNAPSHOT_CACHE_MS = 2_000;

const snapshotCache = new Map<string, { data: SnapshotFetchResult; expiresAt: number }>();
const snapshotInflight = new Map<string, Promise<SnapshotFetchResult>>();

export interface SnapshotsState {
  snapshots: ExecutionSnapshot[];
  loadState: "idle" | "loading" | "ready" | "empty" | "error";
  errorMessage?: string;
  diagnostics?: SnapshotDiagnostics;
}

export interface UseSnapshotsOpts {
  /** When true, hook stops polling. Use after `timeline.closed === true`. */
  paused?: boolean;
}

export interface SnapshotDiagnostics {
  source: "canonical" | "compat" | "none";
  canonicalStatus?: number;
  compatStatus?: number;
  usedFallback: boolean;
}

export function useSnapshots(
  jobId: string | null,
  opts: UseSnapshotsOpts = {},
): SnapshotsState {
  const [state, setState] = useState<SnapshotsState>({
    snapshots: [],
    loadState: jobId ? "loading" : "idle",
  });
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!jobId) {
      setState({ snapshots: [], loadState: "idle" });
      return;
    }

    let cancelled = false;

    async function fetchOnce() {
      if (cancelled) return;
      try {
        const result = await fetchSnapshotsWithFallback(jobId!);
        if (cancelled) return;
        setState({
          snapshots: result.snapshots,
          loadState: result.snapshots.length === 0 ? "empty" : "ready",
          diagnostics: result.diagnostics,
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          // keep existing snapshots so a transient error doesn't blank
          // out the column the user is reading
          ...prev,
          loadState: "error",
          errorMessage: err instanceof Error ? err.message : "Could not load snapshots.",
          diagnostics: normalizeSnapshotError(err),
        }));
      } finally {
        if (!cancelled && !opts.paused) {
          pollTimerRef.current = setTimeout(fetchOnce, POLL_INTERVAL_MS);
        }
      }
    }

    fetchOnce();

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [jobId, opts.paused]);

  return state;
}

/* ─── Endpoint dance ───────────────────────────────────────────────── */

interface SnapshotFetchResult {
  snapshots: ExecutionSnapshot[];
  diagnostics: SnapshotDiagnostics;
}

async function fetchSnapshotsWithFallback(jobId: string): Promise<SnapshotFetchResult> {
  const cached = snapshotCache.get(jobId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const existing = snapshotInflight.get(jobId);
  if (existing) return existing;

  const request = fetchSnapshotsUncached(jobId)
    .then((result) => {
      snapshotCache.set(jobId, {
        data: result,
        expiresAt: Date.now() + SNAPSHOT_CACHE_MS,
      });
      return result;
    })
    .finally(() => {
      snapshotInflight.delete(jobId);
    });

  snapshotInflight.set(jobId, request);
  return request;
}

async function fetchSnapshotsUncached(jobId: string): Promise<SnapshotFetchResult> {
  let canonicalStatus: number | undefined;
  // 1. Canonical path
  try {
    const res = await fetch(`/api/booking-jobs/${jobId}/snapshots`, {
      headers: { Accept: "application/json" },
    });
    canonicalStatus = res.status;
    if (res.ok) {
      return {
        snapshots: parseSnapshotsResponse(await res.json()),
        diagnostics: {
          source: "canonical",
          canonicalStatus,
          usedFallback: false,
        },
      };
    }
    // 404 / 501 — fall through. Other errors: throw.
    if (res.status !== 404 && res.status !== 501) {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    // Network errors fall through to compat too — give it a chance.
    if (!(err instanceof TypeError)) throw err;
  }

  // 2. Compat path
  const res = await fetch(`/api/browser-live/${jobId}/snapshots`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return {
    snapshots: parseSnapshotsResponse(await res.json()),
    diagnostics: {
      source: "compat",
      canonicalStatus,
      compatStatus: res.status,
      usedFallback: true,
    },
  };
}

export function describeSnapshotDiagnostics(
  jobId: string | null,
  diagnostics?: SnapshotDiagnostics,
): string | undefined {
  if (!jobId || !diagnostics) return undefined;
  if (diagnostics.source === "canonical" && diagnostics.canonicalStatus === 200) {
    return "The job is attached, but no browser screenshots have been saved yet. If the provider page is already open, check whether the executor reached the snapshot capture step.";
  }
  if (
    diagnostics.source === "compat" &&
    diagnostics.canonicalStatus === 404 &&
    diagnostics.compatStatus === 200
  ) {
    return `This page cannot find job ${jobId} in the current booking-jobs API, and the fallback live snapshot store is empty. You may be viewing a task created by a different local port, worktree, or database environment.`;
  }
  if (
    diagnostics.source === "compat" &&
    diagnostics.canonicalStatus === 501 &&
    diagnostics.compatStatus === 200
  ) {
    return "The canonical snapshot endpoint is not available on this server yet, and the fallback live snapshot store is empty.";
  }
  if (diagnostics.source === "compat" && diagnostics.compatStatus === 200) {
    return "The fallback live snapshot store is attached, but it has no screenshots for this job yet.";
  }
  if (diagnostics.source === "none") {
    return "Could not attach to the browser snapshot stream for this task.";
  }
  return undefined;
}

function normalizeSnapshotError(err: unknown): SnapshotDiagnostics {
  const message = err instanceof Error ? err.message : "";
  const statusMatch = message.match(/^HTTP (\d{3})$/);
  return {
    source: "none",
    compatStatus: statusMatch ? Number(statusMatch[1]) : undefined,
    usedFallback: true,
  };
}

/* ─── Response shape normalizer ────────────────────────────────────── */

function parseSnapshotsResponse(payload: unknown): ExecutionSnapshot[] {
  if (!payload) return [];
  // Accept either {snapshots: [...]} or [...] or {items: [...]}
  let raw: unknown[] = [];
  if (Array.isArray(payload)) {
    raw = payload;
  } else if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.snapshots)) raw = obj.snapshots;
    else if (Array.isArray(obj.items)) raw = obj.items;
    else if (Array.isArray(obj.frames)) raw = obj.frames;
  }
  return raw.map(normalizeSnapshot).filter((s): s is ExecutionSnapshot => s !== null);
}

function normalizeSnapshot(raw: unknown): ExecutionSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const id = r.id ?? r.snapshot_id ?? r.snapshotId;
  const ts = r.ts ?? r.created_at ?? r.timestamp;
  // Local worker snapshots include both `url` (the browser page URL) and
  // `imageBase64` (the screenshot). Prefer image payloads; treating the page
  // URL as <img src> renders a broken image.
  const imageBase64 = r.imageBase64;
  const src =
    r.src ??
    r.image_url ??
    r.dataUrl ??
    (typeof imageBase64 === "string" ? `data:image/jpeg;base64,${imageBase64}` : undefined) ??
    r.url;
  if (typeof id !== "string" || typeof ts !== "string" || typeof src !== "string") {
    return null;
  }

  return {
    id,
    ts,
    src,
    label:
      typeof r.label === "string" ? r.label :
      typeof r.title === "string" ? r.title :
      undefined,
    naturalWidth: typeof r.width === "number" ? r.width : undefined,
    naturalHeight: typeof r.height === "number" ? r.height : undefined,
  };
}
