"use client";

/**
 * TaskTimelinePanel — slide-over panel showing a high-level Task Timeline
 * (left column) + Execution Snapshots (right column).
 *
 * Drives:
 *   - Demo mode (`demo="needs_otp"` etc.) → renders fixtures
 *   - Live mode (jobId set) → SSE-driven event stream + canonical
 *     snapshot endpoint, both from Track A's contracts (codex 8a2da14)
 *
 * Data flow:
 *   - useTimelineEvents(jobId) — SSE primary, polling fallback,
 *     legacy job snapshot as ultimate fallback
 *   - useSnapshots(jobId, {paused}) — canonical /snapshots endpoint
 *     with /browser-live compat fallback; pauses polling once timeline
 *     reports closed=true
 */

import { useEffect, useMemo, useState } from "react";
import { latestEventKind } from "./derive-events";
import { statusFromLatestEvent } from "./event-vocabulary";
import { FIXTURE_EVENTS, FIXTURE_PANEL_LABELS, FIXTURE_SNAPSHOTS } from "./__fixtures";
import { ConnectingState, IdleState } from "./EmptyStates";
import SnapshotStream from "./SnapshotStream";
import StatusBanner from "./StatusBanner";
import TimelineEventList from "./TimelineEventList";
import {
  TASK_TIMELINE_HEADER_GLYPH,
  normalizeTaskTimelineTitle,
} from "./title";
import { useTimelineEvents } from "./use-timeline-events";
import { describeSnapshotDiagnostics, useSnapshots } from "./use-snapshots";
import type {
  TaskTimelinePanelProps,
  TimelineEvent,
  TimelineStatus,
} from "./types";

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

  // ── Pick data source: demo fixture or live (SSE + snapshot endpoints) ──
  const liveTimeline = useTimelineEvents(demo ? null : jobId);
  // Pause snapshot polling once timeline says the run is closed — saves
  // requests when the user lingers on a finished job.
  const liveSnapshots = useSnapshots(demo ? null : jobId, {
    paused: liveTimeline.closed,
  });
  const { events, snapshots, status, loadState, errorMessage, emptyMessage } = useMemo(() => {
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
        errorMessage: undefined,
        emptyMessage: undefined,
      };
    }
    const snapshotDiagnosticMessage = describeSnapshotDiagnostics(
      jobId,
      liveSnapshots.diagnostics,
    );
    const combinedLoadState =
      liveTimeline.loadState === "empty" && liveSnapshots.snapshots.length > 0
        ? ("ready" as const)
        : liveTimeline.loadState === "empty" && liveSnapshots.loadState === "error"
          ? ("error" as const)
          : liveTimeline.loadState;
    return {
      events: liveTimeline.events,
      snapshots: liveSnapshots.snapshots,
      status: statusFromLatestEvent(latestEventKind(liveTimeline.events)) as TimelineStatus,
      loadState: combinedLoadState,
      errorMessage:
        liveTimeline.errorMessage ??
        liveSnapshots.errorMessage ??
        snapshotDiagnosticMessage,
      emptyMessage: snapshotDiagnosticMessage,
    };
  }, [demo, jobId, liveTimeline, liveSnapshots]);

  // Cross-column linking: clicking a timeline event scrolls the snapshot
  // panel to the matching snapshot, and vice versa.
  const [focusSnapshotId, setFocusSnapshotId] = useState<string | undefined>(
    undefined,
  );

  const headerTitle = title ?? FIXTURE_PANEL_LABELS.title;
  const displayTitle = normalizeTaskTimelineTitle(headerTitle);
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
            <span className="task-timeline__header-glyph" aria-hidden>
              {TASK_TIMELINE_HEADER_GLYPH}
            </span>
            {displayTitle}
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
          <IdleState message={errorMessage ?? "Could not load this run."} />
        )}
        {loadState === "empty" && <IdleState message={emptyMessage} />}
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
                emptyMessage={emptyMessage}
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
