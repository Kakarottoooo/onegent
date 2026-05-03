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

export interface SnapshotsState {
  snapshots: ExecutionSnapshot[];
  loadState: "idle" | "loading" | "ready" | "empty" | "error";
  errorMessage?: string;
}

export interface UseSnapshotsOpts {
  /** When true, hook stops polling. Use after `timeline.closed === true`. */
  paused?: boolean;
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
        const snapshots = await fetchSnapshotsWithFallback(jobId!);
        if (cancelled) return;
        setState({
          snapshots,
          loadState: snapshots.length === 0 ? "empty" : "ready",
        });
      } catch (err) {
        if (cancelled) return;
        setState((prev) => ({
          // keep existing snapshots so a transient error doesn't blank
          // out the column the user is reading
          ...prev,
          loadState: "error",
          errorMessage: err instanceof Error ? err.message : "Could not load snapshots.",
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

async function fetchSnapshotsWithFallback(jobId: string): Promise<ExecutionSnapshot[]> {
  // 1. Canonical path
  try {
    const res = await fetch(`/api/booking-jobs/${jobId}/snapshots`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      return parseSnapshotsResponse(await res.json());
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
  return parseSnapshotsResponse(await res.json());
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
  // Codex may use `url` (CDN/blob) or `src` (data URL) or `image_url`
  const src = r.src ?? r.url ?? r.image_url ?? r.dataUrl;
  if (typeof id !== "string" || typeof ts !== "string" || typeof src !== "string") {
    return null;
  }

  return {
    id,
    ts,
    src,
    label: typeof r.label === "string" ? r.label : undefined,
    naturalWidth: typeof r.width === "number" ? r.width : undefined,
    naturalHeight: typeof r.height === "number" ? r.height : undefined,
  };
}
