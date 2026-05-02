/**
 * Barrel for the Task Timeline component package.
 *
 * Public surface (consumed by app/tasks/page.tsx during the Stage 5 cutover):
 *   - <TaskTimelinePanel />        — the slide-over panel
 *
 * Subcomponents and helpers are exported for ad-hoc reuse / testing but
 * aren't part of the stable contract. The barrel intentionally avoids
 * re-exporting fixtures (`__fixtures.ts`) so demo data can never leak
 * into production by accident — the panel reaches for it itself when
 * `demo` prop is set.
 */

export { default as TaskTimelinePanel } from "./TaskTimelinePanel";
export { default as TimelineEventList } from "./TimelineEventList";
export { default as SnapshotStream } from "./SnapshotStream";
export { default as StatusBanner } from "./StatusBanner";
export { ConnectingState, IdleState } from "./EmptyStates";

export { EVENT_DESCRIPTORS, statusFromLatestEvent } from "./event-vocabulary";
export type { TimelineEventKind, EventDescriptor } from "./event-vocabulary";
export { deriveEventsFromJob, latestEventKind } from "./derive-events";
export type {
  TimelineEvent,
  ExecutionSnapshot,
  TimelineStatus,
  TaskTimelinePanelProps,
} from "./types";
