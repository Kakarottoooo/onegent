/**
 * DR Activity Timeline — event taxonomy.
 *
 * 18 kinds covering the full Decision-Room lifecycle. Mirrors the
 * structure of components/task-timeline/event-vocabulary.ts so the
 * mental model carries over for anyone who's seen Task Timeline first.
 *
 * Don't rename existing kinds without coordinating with derive-events.ts
 * AND any future server-side emitter.
 */

export type DREventKind =
  // ── Lifecycle ──────────────────────────────────────────
  | "room_created"
  | "room_status_changed"
  // ── Membership ────────────────────────────────────────
  | "member_joined"
  | "member_invited"
  | "member_left"
  // ── Constraints ───────────────────────────────────────
  | "constraint_submitted"
  | "constraint_updated"
  // ── Proposals ─────────────────────────────────────────
  | "proposal_generated"
  | "proposal_regenerated"
  | "proposal_accepted"
  | "proposal_rejected"
  | "proposal_superseded"
  // ── Voting ────────────────────────────────────────────
  | "vote_approve"
  | "vote_decline"
  | "vote_request_changes"
  // ── Booking ───────────────────────────────────────────
  | "booking_started"
  | "booking_completed"
  | "booking_failed"
  // ── Edge cases ────────────────────────────────────────
  | "deadline_passed";

export type DREventTone =
  | "neutral"
  | "progress"
  | "success"
  | "warning"
  | "error";

export interface DREventDescriptor {
  icon: string;
  tone: DREventTone;
  /** Build human-readable label given event.data. */
  buildLabel: (data: Record<string, string | number | undefined> | undefined) => string;
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

const fallback = (val: string | number | undefined, alt: string) =>
  val == null || val === "" ? alt : String(val);

/* ─── Registry ─────────────────────────────────────────────────────── */

export const DR_EVENT_DESCRIPTORS: Record<DREventKind, DREventDescriptor> = {
  // ── Lifecycle ─────────────────────────────────────────
  room_created: {
    icon: "🟢",
    tone: "success",
    buildLabel: (d) => `${fallback(d?.actor, "Someone")} created the room`,
  },
  room_status_changed: {
    icon: "⏭",
    tone: "neutral",
    buildLabel: (d) =>
      `Status changed: ${fallback(d?.old_status, "?")} → ${fallback(d?.new_status, "?")}`,
  },

  // ── Membership ────────────────────────────────────────
  member_joined: {
    icon: "👋",
    tone: "success",
    buildLabel: (d) => `${fallback(d?.actor, "A member")} joined`,
  },
  member_invited: {
    icon: "📨",
    tone: "neutral",
    buildLabel: (d) => `${fallback(d?.actor, "A member")} was invited`,
  },
  member_left: {
    icon: "🚪",
    tone: "warning",
    buildLabel: (d) => `${fallback(d?.actor, "A member")} left the room`,
  },

  // ── Constraints ───────────────────────────────────────
  constraint_submitted: {
    icon: "✏️",
    tone: "progress",
    buildLabel: (d) => `${fallback(d?.actor, "Someone")} submitted preferences`,
  },
  constraint_updated: {
    icon: "✏️",
    tone: "progress",
    buildLabel: (d) => `${fallback(d?.actor, "Someone")} updated preferences`,
  },

  // ── Proposals ─────────────────────────────────────────
  proposal_generated: {
    icon: "🤖",
    tone: "neutral",
    buildLabel: () => `Onegent generated a proposal`,
  },
  proposal_regenerated: {
    icon: "🔄",
    tone: "neutral",
    buildLabel: () => `Onegent generated a new proposal`,
  },
  proposal_accepted: {
    icon: "🟢",
    tone: "success",
    buildLabel: (d) =>
      d?.rule
        ? `Proposal accepted (${d.rule})${d.venue ? ` — ${d.venue}` : ""}`
        : `Proposal accepted${d?.venue ? ` — ${d.venue}` : ""}`,
  },
  proposal_rejected: {
    icon: "✗",
    tone: "warning",
    buildLabel: (d) =>
      `Proposal rejected${d?.venue ? ` — ${d.venue}` : ""}`,
  },
  proposal_superseded: {
    icon: "↻",
    tone: "neutral",
    buildLabel: () => `Proposal superseded`,
  },

  // ── Voting ────────────────────────────────────────────
  vote_approve: {
    icon: "👍",
    tone: "success",
    buildLabel: (d) =>
      `${fallback(d?.actor, "A member")} approved${d?.target ? ` ${d.target}` : ""}`,
  },
  vote_decline: {
    icon: "👎",
    tone: "warning",
    buildLabel: (d) =>
      `${fallback(d?.actor, "A member")} declined${d?.target ? ` ${d.target}` : ""}`,
  },
  vote_request_changes: {
    icon: "💬",
    tone: "neutral",
    buildLabel: (d) =>
      `${fallback(d?.actor, "A member")} requested changes`,
  },

  // ── Booking ───────────────────────────────────────────
  booking_started: {
    icon: "🚀",
    tone: "progress",
    buildLabel: () => `Booking started`,
  },
  booking_completed: {
    icon: "✅",
    tone: "success",
    buildLabel: () => `Booking complete`,
  },
  booking_failed: {
    icon: "✗",
    tone: "error",
    buildLabel: (d) =>
      d?.error ? `Booking failed — ${d.error}` : `Booking failed`,
  },

  // ── Edge cases ────────────────────────────────────────
  deadline_passed: {
    icon: "⏰",
    tone: "warning",
    buildLabel: () => `Deadline passed`,
  },
};
