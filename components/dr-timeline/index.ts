/**
 * Public surface for the DR Activity Timeline package.
 *
 * Consumed by:
 *   - app/rooms/[id]/page.tsx (when wired into the room detail layout)
 *   - /dev/dr-timeline-demo (preview route)
 *
 * `__fixtures.ts` is intentionally NOT re-exported. The demo route
 * imports it directly so production code paths stay fixture-free.
 */

export { default as DRTimelineList } from "./DRTimelineList";
export { deriveDREventsFromSnapshot } from "./derive-events";
export { DR_EVENT_DESCRIPTORS } from "./event-vocabulary";
export type {
  DREventKind,
  DREventTone,
  DREventDescriptor,
} from "./event-vocabulary";
export type {
  DRTimelineEvent,
  DRTimelineInputs,
  DRTimelineListProps,
} from "./types";
