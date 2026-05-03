/**
 * derive-events.ts
 *
 * Adapter: room snapshot → DRTimelineEvent[].
 *
 * Reads only what's already in the existing DecisionRoomSnapshot — no new
 * API surface required. When a future schema adds richer columns (e.g. a
 * dedicated room_events table), this module is the single replacement
 * point; downstream UI components keep working unchanged.
 */

import type { DRTimelineEvent, DRTimelineInputs } from "./types";

export function deriveDREventsFromSnapshot(input: DRTimelineInputs): DRTimelineEvent[] {
  const events: DRTimelineEvent[] = [];
  const nameOf = (uid: string | null | undefined): string => {
    if (!uid) return "Someone";
    return input.member_names?.[uid] ?? shortId(uid);
  };

  /* ── Room created ─────────────────────────────────────────────── */
  events.push({
    id: `room-created`,
    ts: input.room.created_at,
    kind: "room_created",
    data: { actor: nameOf(input.room.creator_id), actor_id: input.room.creator_id },
  });

  /* ── Member joins / invites ──────────────────────────────────── */
  for (const m of input.members) {
    if (m.user_id === input.room.creator_id) continue; // creator already covered
    if (m.status === "invited") {
      events.push({
        id: `member-invited-${m.user_id}`,
        ts: m.joined_at,
        kind: "member_invited",
        data: { actor: nameOf(m.user_id), actor_id: m.user_id },
      });
    } else if (m.status === "joined") {
      events.push({
        id: `member-joined-${m.user_id}`,
        ts: m.joined_at,
        kind: "member_joined",
        data: { actor: nameOf(m.user_id), actor_id: m.user_id },
      });
    } else if (m.status === "left") {
      events.push({
        id: `member-left-${m.user_id}`,
        ts: m.joined_at,
        kind: "member_left",
        data: { actor: nameOf(m.user_id), actor_id: m.user_id },
      });
    }
  }

  /* ── Constraint submissions ──────────────────────────────────── */
  for (const c of input.constraints) {
    if (!c.submitted) continue;
    events.push({
      id: `constraint-${c.user_id}`,
      ts: c.updated_at,
      kind: "constraint_submitted",
      data: { actor: nameOf(c.user_id), actor_id: c.user_id },
    });
  }

  /* ── Proposals + votes + terminal states ─────────────────────── */
  // Sort proposals chronologically so "regenerated" wording fires after the first
  const proposalsAsc = [...input.proposals].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  for (let i = 0; i < proposalsAsc.length; i++) {
    const p = proposalsAsc[i];
    events.push({
      id: `proposal-gen-${p.id}`,
      ts: p.created_at,
      kind: i === 0 ? "proposal_generated" : "proposal_regenerated",
    });

    /* Votes — emit one event per cast */
    for (const v of p.votes) {
      const kind =
        v.vote === "approve"
          ? "vote_approve"
          : v.vote === "decline"
          ? "vote_decline"
          : "vote_request_changes";
      events.push({
        id: `vote-${p.id}-${v.user_id}`,
        ts: v.voted_at,
        kind,
        data: {
          actor: nameOf(v.user_id),
          actor_id: v.user_id,
          target: p.venue,
        },
      });
    }

    /* Terminal proposal state. Use the latest vote as the timestamp
     * approximation since the schema lacks a status_changed_at column. */
    if (p.status !== "active") {
      const latestVoteTs =
        p.votes.length > 0
          ? p.votes
              .map((v) => v.voted_at)
              .sort((a, b) => b.localeCompare(a))[0]
          : p.created_at;

      const terminalKind =
        p.status === "accepted"
          ? "proposal_accepted"
          : p.status === "rejected"
          ? "proposal_rejected"
          : "proposal_superseded";

      events.push({
        id: `proposal-${p.status}-${p.id}`,
        ts: latestVoteTs,
        kind: terminalKind,
        data: {
          venue: p.venue,
          rule: input.room.approval_rule,
        },
      });
    }
  }

  /* ── Booking lifecycle (room.status-derived, best-effort timestamps) ─ */
  if (input.room.status === "executing") {
    events.push({
      id: "booking-started",
      ts: input.room.updated_at,
      kind: "booking_started",
    });
  } else if (input.room.status === "done") {
    events.push({
      id: "booking-completed",
      ts: input.room.updated_at,
      kind: "booking_completed",
    });
  } else if (input.room.status === "abandoned") {
    events.push({
      id: "booking-failed",
      ts: input.room.updated_at,
      kind: "booking_failed",
      data: { error: "Room abandoned" },
    });
  }

  /* ── Stable chronological sort ───────────────────────────────── */
  return events.sort((a, b) => a.ts.localeCompare(b.ts));
}

/* ─── Internal ─────────────────────────────────────────────────────── */

function shortId(uid: string): string {
  // Trim long uuids to a "user_xxxx" friendly form.
  if (uid.length <= 8) return uid;
  return `user_${uid.slice(0, 6)}`;
}
