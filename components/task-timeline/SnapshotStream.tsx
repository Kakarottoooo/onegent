"use client";

/**
 * Right column of the Task Timeline panel — vertical stream of execution
 * snapshots. Each snapshot shows large enough to read (no thumbnails),
 * click anywhere on the card to open the lightbox.
 *
 * Includes inline <SnapshotLightbox> as a sibling-controlled modal.
 */

import { useEffect, useState } from "react";
import type { ExecutionSnapshot } from "./types";

interface Props {
  snapshots: ExecutionSnapshot[];
  /** Optional id to scroll into view on mount/update. */
  focusId?: string;
  emptyMessage?: string;
}

export default function SnapshotStream({ snapshots, focusId, emptyMessage }: Props) {
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const zoomed = snapshots.find((s) => s.id === zoomedId) ?? null;

  // Scroll the focused snapshot into view when caller jumps via timeline click.
  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`snapshot-${focusId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId]);

  if (snapshots.length === 0) {
    return (
      <div className="task-timeline__snapshots-empty">
        <p className="task-timeline__snapshots-empty-line">No snapshots yet.</p>
        <p className="task-timeline__snapshots-empty-sub">
          {emptyMessage ?? "Screenshots will appear as the agent navigates."}
        </p>
      </div>
    );
  }

  return (
    <>
      <ol className="task-timeline__snapshots">
        {snapshots.map((snap, i) => (
          <SnapshotCard
            key={snap.id}
            snap={snap}
            index={i}
            highlighted={snap.id === focusId}
            onZoom={() => setZoomedId(snap.id)}
          />
        ))}
      </ol>
      {zoomed && (
        <SnapshotLightbox
          snap={zoomed}
          onClose={() => setZoomedId(null)}
        />
      )}
    </>
  );
}

/* ─── Snapshot card ────────────────────────────────────────────────────── */

interface CardProps {
  snap: ExecutionSnapshot;
  index: number;
  highlighted: boolean;
  onZoom: () => void;
}

function SnapshotCard({ snap, index, highlighted, onZoom }: CardProps) {
  return (
    <li
      id={`snapshot-${snap.id}`}
      className={[
        "task-timeline__snapshot",
        highlighted ? "task-timeline__snapshot--active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="task-timeline__snapshot-button"
        onClick={onZoom}
        aria-label={`Open snapshot ${index + 1}${snap.label ? `: ${snap.label}` : ""}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={snap.src}
          alt={snap.label ?? `Snapshot ${index + 1}`}
          className="task-timeline__snapshot-image"
          loading={index < 2 ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
        />
        <span className="task-timeline__snapshot-zoom-hint" aria-hidden>
          ⤢ click to enlarge
        </span>
      </button>
      <div className="task-timeline__snapshot-meta">
        <p className="task-timeline__snapshot-label">
          {snap.label ?? `Snapshot ${index + 1}`}
        </p>
        <time className="task-timeline__snapshot-time" dateTime={snap.ts}>
          {formatClock(snap.ts)}
        </time>
      </div>
    </li>
  );
}

/* ─── Lightbox (inline) ────────────────────────────────────────────────── */

interface LightboxProps {
  snap: ExecutionSnapshot;
  onClose: () => void;
}

function SnapshotLightbox({ snap, onClose }: LightboxProps) {
  // Close on ESC.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="task-timeline__lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={snap.label ?? "Snapshot"}
      onClick={onClose}
    >
      <div
        className="task-timeline__lightbox-frame"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={snap.src}
          alt={snap.label ?? "Snapshot"}
          className="task-timeline__lightbox-image"
          decoding="async"
          draggable={false}
        />
        <div className="task-timeline__lightbox-meta">
          <p className="task-timeline__lightbox-label">
            {snap.label ?? "Snapshot"}
          </p>
          <time className="task-timeline__lightbox-time" dateTime={snap.ts}>
            {formatClock(snap.ts)}
          </time>
        </div>
      </div>
      <button
        type="button"
        className="task-timeline__lightbox-close"
        onClick={onClose}
        aria-label="Close snapshot"
      >
        ✕
      </button>
      <p className="task-timeline__lightbox-hint">Press Esc or click outside to close</p>
    </div>
  );
}

/* ─── Internal ─────────────────────────────────────────────────────────── */

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
