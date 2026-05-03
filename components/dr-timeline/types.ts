/**
 * DR Activity Timeline — types
 *
 * Renders a chronological feed of meaningful Decision-Room events:
 * who joined, who submitted preferences, when the agent generated a
 * proposal, who voted what, when booking kicked off / completed.
 *
 * This is the "what happened in this room" view that distinguishes a
 * DR from a regular group chat — the chat panel is for discussion,
 * the timeline is for state.
 *
 * Pure UI types — no imports from lib/db.ts to keep client-bundle small.
 * The shape mirrors task-timeline's TimelineEvent on purpose: same
 * mental model, different vocabulary.
 */

import type { DREventKind } from "./event-vocabulary";

/** A single event in the room's activity timeline. */
export interface DRTimelineEvent {
  /** Stable id — used for React keys and any later anchoring. */
  id: string;
  /** ISO8601 timestamp. */
  ts: string;
  /** Event kind — drives icon/color/copy via DR_EVENT_DESCRIPTORS. */
  kind: DREventKind;
  /**
   * Optional payload templated into the event copy. Each kind reads its
   * own slot names from this dict. Keys are documented in event-
   * vocabulary.ts buildLabel().
   */
  data?: {
    actor?: string;          // member display name
    actor_id?: string;       // user_id (for avatar lookup)
    target?: string;         // option label, member name, etc.
    venue?: string;          // proposal venue label
    rule?: "unanimous" | "majority";
    old_status?: string;
    new_status?: string;
    error?: string;
    [k: string]: string | number | undefined;
  };
}

/** Top-level snapshot shape consumed by deriveDREventsFromSnapshot. */
export interface DRTimelineInputs {
  room: {
    id: string;
    title?: string;
    status: string;
    creator_id: string;
    created_at: string;
    updated_at: string;
    booking_job_id?: string | null;
    approval_rule?: "unanimous" | "majority";
  };
  members: Array<{
    user_id: string;
    role: "creator" | "member";
    status: "joined" | "invited" | "left";
    joined_at: string;
  }>;
  constraints: Array<{
    user_id: string;
    submitted: boolean;
    updated_at: string;
  }>;
  proposals: Array<{
    id: string;
    status: "active" | "superseded" | "accepted" | "rejected";
    created_at: string;
    venue?: string;
    votes: Array<{
      user_id: string;
      vote: "approve" | "decline" | "request_changes";
      voted_at: string;
    }>;
  }>;
  /** Map of user_id → display name. Used for {actor} substitution. */
  member_names?: Record<string, string>;
}

/** Public props for the list component. */
export interface DRTimelineListProps {
  events: DRTimelineEvent[];
  /** Optional message under the eyebrow. */
  subtitle?: string;
  /** When set, ignores events and renders the empty/loading shape. */
  loading?: boolean;
  /** Empty-state copy override. */
  emptyMessage?: string;
}
