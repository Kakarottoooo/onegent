"use client";

/**
 * DR Activity Timeline — vertical event list.
 *
 * One-component-per-file kept for readability; the inner row is
 * an inline functional component to avoid prop-drilling.
 */

import { DR_EVENT_DESCRIPTORS } from "./event-vocabulary";
import type { DRTimelineEvent, DRTimelineListProps } from "./types";
import "./dr-timeline.css";

export default function DRTimelineList({
  events,
  subtitle,
  loading,
  emptyMessage,
}: DRTimelineListProps) {
  if (loading) {
    return (
      <div className="dr-timeline">
        <Header subtitle={subtitle} />
        <div className="dr-timeline__skeleton" aria-busy="true">
          <div className="dr-timeline__skeleton-row" />
          <div className="dr-timeline__skeleton-row" />
          <div className="dr-timeline__skeleton-row" />
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="dr-timeline">
        <Header subtitle={subtitle} />
        <div className="dr-timeline__empty">
          <p className="dr-timeline__empty-glyph" aria-hidden>
            📜
          </p>
          <p className="dr-timeline__empty-title">
            {emptyMessage ?? "No activity yet"}
          </p>
          <p className="dr-timeline__empty-body">
            Once members join, submit preferences, or vote, the events will
            appear here in chronological order.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="dr-timeline">
      <Header subtitle={subtitle} />
      <ol className="dr-timeline__list">
        {events.map((event, i) => (
          <Row
            key={event.id}
            event={event}
            isLast={i === events.length - 1}
          />
        ))}
      </ol>
    </div>
  );
}

/* ─── Header ──────────────────────────────────────────────────────────── */

function Header({ subtitle }: { subtitle?: string }) {
  return (
    <header className="dr-timeline__header">
      <p className="dr-timeline__eyebrow">Activity</p>
      {subtitle && <p className="dr-timeline__subtitle">{subtitle}</p>}
    </header>
  );
}

/* ─── Row ─────────────────────────────────────────────────────────────── */

function Row({ event, isLast }: { event: DRTimelineEvent; isLast: boolean }) {
  const descriptor = DR_EVENT_DESCRIPTORS[event.kind];
  if (!descriptor) return null;
  const label = descriptor.buildLabel(event.data);

  return (
    <li
      className={[
        "dr-timeline__row",
        `dr-timeline__row--${descriptor.tone}`,
        isLast ? "dr-timeline__row--last" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="dr-timeline__rail">
        <div className="dr-timeline__glyph" aria-hidden>
          <span>{descriptor.icon}</span>
        </div>
        {!isLast && <div className="dr-timeline__line" aria-hidden />}
      </div>
      <div className="dr-timeline__body">
        <p className="dr-timeline__label">{label}</p>
        <time className="dr-timeline__ts" dateTime={event.ts}>
          {formatRelative(event.ts)}
        </time>
      </div>
    </li>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function formatRelative(iso: string): string {
  if (!iso) return "";
  try {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "";
    const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
