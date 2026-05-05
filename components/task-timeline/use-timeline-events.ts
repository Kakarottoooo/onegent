"use client";

/**
 * Hook: stream a job's timeline events via SSE with polling fallback.
 *
 * Backend contract owned by Track A (codex 8a2da14):
 *
 *   Primary  · GET /api/booking-jobs/:id/timeline-events  (text/event-stream)
 *              event: timeline
 *              data:  { events, summary, entries, closed, source, job }
 *
 *   Polled   · GET /api/booking-jobs/:id/timeline-events?format=json
 *              same payload shape, single response
 *
 *   Legacy   · GET /api/booking-jobs/:id  (full job snapshot)
 *              used as ultimate fallback when neither of the above works —
 *              we run derive-events.ts to recover a best-effort timeline
 *              from the existing decisionLog
 *
 * The hook never throws — every failure path lands on a less rich source
 * silently so the panel always renders something.
 */

import { useEffect, useRef, useState } from "react";
import { deriveEventsFromJob } from "./derive-events";
import type { TimelineEvent } from "./types";
import type { TimelineEventKind } from "./event-vocabulary";
import { EVENT_DESCRIPTORS } from "./event-vocabulary";

export type TimelineSource = "sse" | "polling" | "legacy" | "unknown";

export interface TimelineState {
  events: TimelineEvent[];
  /** Optional one-line agent-emitted summary (codex's payload.summary). */
  summary: string | null;
  /** Backend reports the run is finished — UI can stop the pulse animation. */
  closed: boolean;
  /** Which data source we're currently reading from. */
  source: TimelineSource;
  /** Raw lifecycle for empty / connecting / ready / error UI states. */
  loadState: "loading" | "ready" | "error" | "empty";
  errorMessage?: string;
}

const POLLING_INTERVAL_MS = 2_500;

const VALID_KINDS = new Set<TimelineEventKind>(
  Object.keys(EVENT_DESCRIPTORS) as TimelineEventKind[],
);

export function useTimelineEvents(jobId: string | null): TimelineState {
  const [state, setState] = useState<TimelineState>({
    events: [],
    summary: null,
    closed: false,
    source: "unknown",
    loadState: jobId ? "loading" : "empty",
  });
  // refs so cleanup can read the latest values without re-running the effect
  const esRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!jobId) {
      setState({
        events: [],
        summary: null,
        closed: false,
        source: "unknown",
        loadState: "empty",
      });
      return;
    }

    let cancelled = false;
    let useFallback = false;

    function applyPayload(payload: unknown, source: TimelineSource) {
      if (cancelled) return;
      const events = extractEvents(payload);
      const summary = extractSummary(payload);
      const closed = extractClosed(payload);
      setState({
        events,
        summary,
        closed,
        source,
        loadState: events.length === 0 && !closed ? "empty" : "ready",
      });
    }

    /* ── 1. SSE primary path ────────────────────────────────────── */
    function startSSE() {
      // Browser may not support EventSource — bail to polling.
      if (typeof EventSource === "undefined") {
        useFallback = true;
        startPolling();
        return;
      }
      try {
        const es = new EventSource(`/api/booking-jobs/${jobId}/timeline-events`);
        esRef.current = es;
        es.addEventListener("timeline", (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data);
            applyPayload(payload, "sse");
          } catch {
            // bad JSON; ignore — next tick should be cleaner
          }
        });
        es.addEventListener("error", () => {
          // EventSource auto-reconnects on transient errors; only fall
          // back when we've genuinely lost the connection (readyState
          // CLOSED). Otherwise let the browser retry.
          if (es.readyState === EventSource.CLOSED && !useFallback) {
            useFallback = true;
            es.close();
            esRef.current = null;
            startPolling();
          }
        });
      } catch {
        useFallback = true;
        startPolling();
      }
    }

    /* ── 2. Polling fallback (?format=json) ─────────────────────── */
    async function pollOnce() {
      if (cancelled) return;
      try {
        const res = await fetch(
          `/api/booking-jobs/${jobId}/timeline-events?format=json`,
          { headers: { Accept: "application/json" } },
        );
        if (res.ok) {
          const payload = await res.json();
          applyPayload(payload, "polling");
        } else if (res.status === 404 || res.status === 501) {
          // The new endpoint isn't deployed yet — fall through to legacy.
          await pollLegacy();
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        await pollLegacy(err);
      } finally {
        if (!cancelled) {
          pollTimerRef.current = setTimeout(pollOnce, POLLING_INTERVAL_MS);
        }
      }
    }

    function startPolling() {
      pollOnce();
    }

    /* ── 3. Legacy fallback (whole-job + derive-events) ─────────── */
    async function pollLegacy(prevErr?: unknown) {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/booking-jobs/${jobId}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const job = await res.json();
        const events = deriveEventsFromJob(job);
        if (cancelled) return;
        setState({
          events,
          summary: null,
          closed: false,
          source: "legacy",
          loadState: events.length === 0 ? "empty" : "ready",
        });
      } catch (err) {
        if (cancelled) return;
        const reason = err instanceof Error ? err.message :
          prevErr instanceof Error ? prevErr.message : "Could not load this run.";
        setState((prev) => ({ ...prev, loadState: "error", errorMessage: reason }));
      }
    }

    startSSE();

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [jobId]);

  return state;
}

/* ─── Payload normalizers ───────────────────────────────────────────── */

export function extractEvents(payload: unknown): TimelineEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;

  // Preferred: payload.events — already-derived high-level events from
  // executor-v2's native emission. Filter to known kinds so a future
  // backend-side new kind doesn't crash the UI.
  if (Array.isArray(obj.events) && obj.events.length > 0) {
    const normalized = obj.events
      .map(normalizeEvent)
      .filter((e): e is TimelineEvent => e !== null);
    if (normalized.length > 0) return normalized;
    // Current servers may return task-timeline kinds like `job_started` or
    // `payment_required`; this panel renders a different vocabulary. Fall
    // through to the full job/entries adapter instead of showing "waiting".
  }

  // Fallback: payload.entries (raw decisionLog) — run our local adapter.
  // Codex's payload also includes a `job` field — use it as the JobShape
  // for derive-events.ts when present, otherwise build a minimal shape
  // from `entries`.
  if (obj.job && typeof obj.job === "object") {
    return deriveEventsFromJob(obj.job);
  }
  if (Array.isArray(obj.entries) && obj.entries.length > 0) {
    return deriveEventsFromJob({
      steps: [{ decisionLog: obj.entries as Array<Record<string, unknown>> }],
    } as unknown as Parameters<typeof deriveEventsFromJob>[0]);
  }

  return [];
}

function normalizeEvent(raw: unknown): TimelineEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const ts = (r.ts ?? r.timestamp ?? r.created_at) as string | undefined;
  const kindRaw = (r.kind ?? r.type) as string | undefined;
  if (!ts || !kindRaw) return null;
  if (!VALID_KINDS.has(kindRaw as TimelineEventKind)) return null;

  const data = (r.data ?? r.payload) as TimelineEvent["data"];
  const snapshotId = (r.snapshot_id ?? r.snapshotId) as string | undefined;

  return {
    ts: String(ts),
    kind: kindRaw as TimelineEventKind,
    data,
    snapshotId,
  };
}

function extractSummary(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const s = (payload as Record<string, unknown>).summary;
  return typeof s === "string" && s.trim().length > 0 ? s : null;
}

function extractClosed(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  return Boolean((payload as Record<string, unknown>).closed);
}
