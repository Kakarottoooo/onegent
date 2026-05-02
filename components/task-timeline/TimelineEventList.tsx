"use client";

/**
 * Left column of the Task Timeline panel — a vertical list of high-level
 * events with icon, label, and time.
 *
 * Pure presentational. Receives events + optional snapshot lookup so each
 * row can show a tiny "📷 view" affordance pointing the right column at
 * the matching screenshot.
 */

import type { TimelineEvent } from "./types";
import { EVENT_DESCRIPTORS } from "./event-vocabulary";

interface Props {
  events: TimelineEvent[];
  /** Currently focused snapshot id — drives the "active row" treatment. */
  activeSnapshotId?: string;
  /** Click handler when the row's snapshot button is pressed. */
  onJumpToSnapshot?: (snapshotId: string) => void;
}

export default function TimelineEventList({
  events,
  activeSnapshotId,
  onJumpToSnapshot,
}: Props) {
  if (events.length === 0) {
    return (
      <div className="task-timeline__events-empty">
        <p className="task-timeline__events-empty-line">Waiting for the agent to begin…</p>
      </div>
    );
  }

  return (
    <ol className="task-timeline__events">
      {events.map((event, i) => {
        const descriptor = EVENT_DESCRIPTORS[event.kind];
        if (!descriptor) return null;
        const label = descriptor.buildLabel(event.data);
        const isLast = i === events.length - 1;
        const isActive = !!event.snapshotId && event.snapshotId === activeSnapshotId;

        return (
          <li
            key={`${event.ts}-${i}`}
            className={[
              "task-timeline__event",
              `task-timeline__event--${descriptor.tone}`,
              isLast ? "task-timeline__event--last" : "",
              isActive ? "task-timeline__event--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="task-timeline__event-rail">
              <span className="task-timeline__event-glyph" aria-hidden>
                {descriptor.icon}
              </span>
              {!isLast && <span className="task-timeline__event-line" aria-hidden />}
            </span>

            <div className="task-timeline__event-body">
              <p className="task-timeline__event-label">{label}</p>
              <p className="task-timeline__event-meta">
                <time dateTime={event.ts}>{formatClock(event.ts)}</time>
                {event.snapshotId && onJumpToSnapshot && (
                  <button
                    type="button"
                    className="task-timeline__event-snapshot-link"
                    onClick={() => onJumpToSnapshot(event.snapshotId!)}
                  >
                    view snapshot
                  </button>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function formatClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}
