"use client";

/**
 * TaskTimelinePanel — slide-over panel showing a high-level Task Timeline
 * (left column) + Execution Snapshots (right column).
 *
 * Drives:
 *   - Demo mode (`demo="needs_otp"` etc.) → renders fixtures
 *   - Live mode (jobId set) → polls /api/booking-jobs/{id} and derives
 *     TimelineEvent[] via derive-events.ts
 *
 * Track A will eventually replace the polling adapter with structured SSE
 * events. When that lands, swap the data hook only — components below
 * stay the same.
 */

import { useEffect, useMemo, useState } from "react";
import { deriveEventsFromJob, latestEventKind } from "./derive-events";
import { statusFromLatestEvent } from "./event-vocabulary";
import { FIXTURE_EVENTS, FIXTURE_PANEL_LABELS, FIXTURE_SNAPSHOTS } from "./__fixtures";
import { ConnectingState, IdleState } from "./EmptyStates";
import SnapshotStream from "./SnapshotStream";
import StatusBanner from "./StatusBanner";
import TimelineEventList from "./TimelineEventList";
import type {
  ExecutionSnapshot,
  TaskTimelinePanelProps,
  TimelineEvent,
  TimelineStatus,
} from "./types";

/* ─── Hook: load + poll a real job (Stage 3 fallback) ───────────────────── */

interface JobData {
  events: TimelineEvent[];
  snapshots: ExecutionSnapshot[];
  /** Surface raw lifecycle so we can show ConnectingState vs IdleState. */
  loadState: "loading" | "ready" | "error" | "empty";
  errorMessage?: string;
}

const POLL_INTERVAL_MS = 2_500;

function useJobTimelineData(jobId: string | null): JobData {
  const [state, setState] = useState<JobData>({
    events: [],
    snapshots: [],
    loadState: jobId ? "loading" : "empty",
  });

  useEffect(() => {
    if (!jobId) {
      setState({ events: [], snapshots: [], loadState: "empty" });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function fetchOnce() {
      try {
        const res = await fetch(`/api/booking-jobs/${jobId}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const job = await res.json();
        if (cancelled) return;
        const events = deriveEventsFromJob(job);
        // No snapshot endpoint exists yet (Track A will add later). Use
        // an empty list — SnapshotStream renders the "no snapshots yet"
        // empty state, which is honest given the current data.
        setState({
          events,
          snapshots: [],
          loadState: events.length === 0 ? "empty" : "ready",
        });
      } catch (e) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loadState: "error",
          errorMessage: e instanceof Error ? e.message : "Could not load job",
        }));
      } finally {
        if (!cancelled) {
          timer = setTimeout(fetchOnce, POLL_INTERVAL_MS);
        }
      }
    }

    fetchOnce();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  return state;
}

/* ─── Main component ───────────────────────────────────────────────────── */

export default function TaskTimelinePanel({
  jobId,
  title,
  subtitle,
  demo,
  onClose,
}: TaskTimelinePanelProps) {
  // ── ESC closes the panel ──
  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // ── Pick data source: demo fixture or live polling ──
  const liveData = useJobTimelineData(demo ? null : jobId);
  const { events, snapshots, status, loadState } = useMemo(() => {
    if (demo) {
      const fxEvents = FIXTURE_EVENTS[demo];
      // Only attach snapshots when there are events to attach them to
      // — keeps the "empty" demo honest.
      const fxSnapshots = fxEvents.length > 0 ? FIXTURE_SNAPSHOTS : [];
      const latest = latestEventKind(fxEvents);
      const computed = statusFromLatestEvent(latest);
      return {
        events: fxEvents,
        snapshots: fxSnapshots,
        status: computed,
        loadState: fxEvents.length === 0 ? ("empty" as const) : ("ready" as const),
      };
    }
    return {
      events: liveData.events,
      snapshots: liveData.snapshots,
      status: statusFromLatestEvent(latestEventKind(liveData.events)) as TimelineStatus,
      loadState: liveData.loadState,
    };
  }, [demo, liveData]);

  // Cross-column linking: clicking a timeline event scrolls the snapshot
  // panel to the matching snapshot, and vice versa.
  const [focusSnapshotId, setFocusSnapshotId] = useState<string | undefined>(
    undefined,
  );

  const headerTitle = title ?? FIXTURE_PANEL_LABELS.title;
  const headerSubtitle = subtitle ?? (demo ? FIXTURE_PANEL_LABELS.subtitle : undefined);
  const bannerDetail = bannerDetailFor(events, status);

  return (
    <aside
      className="task-timeline"
      role="dialog"
      aria-label={headerTitle}
    >
      {/* Header */}
      <header className="task-timeline__header">
        <div className="task-timeline__header-text">
          <p className="task-timeline__header-title">
            <span className="task-timeline__header-glyph" aria-hidden>🖥️</span>
            {headerTitle}
          </p>
          {headerSubtitle && (
            <p className="task-timeline__header-subtitle">{headerSubtitle}</p>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            className="task-timeline__header-close"
            onClick={onClose}
            aria-label="Close timeline"
          >
            Close ✕
          </button>
        )}
      </header>

      {/* Banner — only shown in pause/terminal states */}
      <StatusBanner status={status} detail={bannerDetail} />

      {/* Body — two columns */}
      <div className="task-timeline__body">
        {loadState === "loading" && <ConnectingState />}
        {loadState === "error" && (
          <IdleState message={liveData.errorMessage ?? "Could not load this run."} />
        )}
        {loadState === "empty" && !demo && <IdleState />}
        {(loadState === "ready" || (demo && events.length > 0)) && (
          <div className="task-timeline__columns">
            <section className="task-timeline__column task-timeline__column--events">
              <p className="task-timeline__column-eyebrow">Timeline</p>
              <TimelineEventList
                events={events}
                activeSnapshotId={focusSnapshotId}
                onJumpToSnapshot={setFocusSnapshotId}
              />
            </section>
            <section className="task-timeline__column task-timeline__column--snapshots">
              <p className="task-timeline__column-eyebrow">Execution snapshots</p>
              <SnapshotStream
                snapshots={snapshots}
                focusId={focusSnapshotId}
              />
            </section>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="task-timeline__footer">
        <p className="task-timeline__footer-line">
          Read-only · Snapshots stream as the agent works · Press Esc to close
        </p>
      </footer>
    </aside>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

/** Pull a friendly detail string for the StatusBanner from the latest event. */
function bannerDetailFor(
  events: TimelineEvent[],
  status: TimelineStatus,
): string | undefined {
  const last = events.at(-1);
  if (!last) return undefined;
  if (status === "needs_otp") return last.data?.channel as string | undefined;
  if (status === "no_availability" || status === "failed") {
    return last.data?.reason as string | undefined;
  }
  return undefined;
}
