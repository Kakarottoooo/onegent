/**
 * Task Timeline — shared types
 *
 * The Task Timeline shows users a high-level, human-readable view of what
 * the booking agent is doing. These types are the contract between:
 *
 *   - Track A (codex) — emits structured events via ExecutorV2
 *   - Track B (this) — renders them in components/task-timeline/**
 *
 * For now Track A's SSE isn't live, so derive-events.ts produces these
 * types from the existing job.decisionLog as a fallback.
 *
 * Don't import anything from lib/ or worker/ here — keep this client-safe
 * and free of the executor implementation.
 */

import type { TimelineEventKind } from "./event-vocabulary";

/** A single high-level event on the agent timeline. */
export interface TimelineEvent {
  /** ISO8601 timestamp. */
  ts: string;
  /** Event kind. Renders icon + color + copy via event-vocabulary descriptor. */
  kind: TimelineEventKind;
  /**
   * Optional payload that templates the event copy. Each kind defines its
   * own slot names (e.g. `opened_site` reads `domain`, `selected_slot`
   * reads `slot`). See event-vocabulary.ts buildLabel() for the mapping.
   */
  data?: {
    domain?: string;
    term?: string;
    label?: string;
    slot?: string;
    room?: string;
    fare?: string;
    policy?: string;
    channel?: string;     // OTP channel: gmail | sms | app
    reason?: string;
    [k: string]: string | number | undefined;
  };
  /** Optional reference to a snapshot taken at this event. */
  snapshotId?: string;
}

/** A captured browser screenshot at a point in time. */
export interface ExecutionSnapshot {
  /** Stable id used to cross-reference a TimelineEvent.snapshotId. */
  id: string;
  /** ISO8601 timestamp. */
  ts: string;
  /**
   * Either a fully qualified URL (CDN, blob storage) or a `data:image/...`
   * inline. The component treats both the same — uses as `<img src>`.
   */
  src: string;
  /** Optional human label, e.g. "Search results page". */
  label?: string;
  /** Natural width/height in CSS pixels (helps with lightbox sizing). */
  naturalWidth?: number;
  naturalHeight?: number;
}

/**
 * High-level status the panel is in. Matches Track A's BookingExecutionResult
 * status field plus a transient "running" / "idle" pair the UI cares about.
 */
export type TimelineStatus =
  | "idle"                        // job hasn't started yet
  | "connecting"                  // attaching to live stream
  | "running"                     // events arriving, no terminal state yet
  | "needs_otp"                   // paused — waiting for OTP
  | "needs_login"                 // paused — login required
  | "ready_for_confirmation"      // green light: user reviews + confirms
  | "no_availability"             // could not find target
  | "failed";                     // hard error

/** Props for the main slide-over panel. */
export interface TaskTimelinePanelProps {
  /** Job id to bind to. When null/undefined the panel renders an empty state. */
  jobId: string | null;
  /** Title shown in the panel header. Falls back to "Agent" if absent. */
  title?: string;
  /** Subtitle (e.g. trip label or restaurant name). */
  subtitle?: string;
  /**
   * When set, ignores live polling and renders fixture data instead. Used
   * by the demo/preview surface during stage-2 development.
   */
  demo?: "running" | "needs_otp" | "ready_for_confirmation" | "failed" | "no_availability" | "empty";
  /** Called when user clicks Close or hits Escape. */
  onClose?: () => void;
}
