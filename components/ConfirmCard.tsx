"use client";

/**
 * Inline confirm card — rendered inside the conversational chat when the NLU
 * signals confirm_ready. Shows what the agent is about to do and lets the user
 * either (a) confirm and commit, (b) push back into the chat to edit.
 *
 * Two variants via `kind`:
 *   "room" — creates a Decision Room, redirects to /rooms/{id}
 *   "plan" — hands off to the existing homepage search pipeline
 */

import { useEffect, useState } from "react";
import type { ConversationalNLUResult } from "@/lib/agent/nlu-v2";
import type { TripIntentState } from "@/lib/agent/trip-intent-state";
import "./chat.css";

export type ConfirmCardKind = "room" | "plan" | "trip";

export interface ConfirmCardProps {
  kind: ConfirmCardKind;
  nlu: ConversationalNLUResult;
  /** Last user message — forwarded to /api/chat/commit for plan queries. */
  message: string;
  /**
   * Stage 2: full conversation history at the moment confirm is clicked. Sent
   * with the commit request so chat-flow rooms can seed their private channel
   * with the pre-creation conversation, and refresh / reopen restores it via
   * /api/rooms/[id]/private-messages → UX-4 replay.
   */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /**
   * Active solo session id, if any. Forwarded to /api/chat/commit so the
   * server can flag the session as upgraded (upgraded_room_id) once the
   * room is created — sidebar will then show only the room row, not both.
   */
  sessionId?: string | null;
  /**
   * Resolved @-mention user_ids captured at parse time (homepage MentionPicker).
   * Forwarded to /api/chat/commit so create_room skips the LLM-name-resolution
   * fallback and invites these users directly. Empty/undefined when the user
   * didn't tag anyone — commit then falls back to NLU member_names as before.
   */
  mentionedUserIds?: string[];
  /** Called with the commit response (room_id + url, or plan hand-off payload). */
  onConfirmed: (payload: CommitResponse) => void;
  /** User clicked "edit" — put focus back on the input so they can keep chatting. */
  onEdit: () => void;
}

export interface CommitResponse {
  ok: boolean;
  /** "trip_clarify" surfaced only when the backend defensively rejects an
   *  incomplete trip commit; the chat handler treats it as a missing-field
   *  error and nudges the user back into the conversation.
   *  "direct_booking" surfaced when the user named one specific venue (US-W5);
   *  the chat handler skips the recommendation render and POSTs the
   *  embedded `booking_step` to /api/booking-jobs immediately. */
  kind: ConfirmCardKind | "trip_clarify" | "direct_booking";
  id?: string;
  short_code?: string | null;
  url?: string;
  invite_url?: string | null;
  title?: string;
  scenario?: string;
  search_query?: string;
  constraints?: Record<string, unknown>;
  // Stage 2 trip-room fields — present when a multi-party trip room is created.
  room_type?: "trip" | string;
  flow?: "chat" | "classic";
  categories?: string[] | null;
  // Trip handoff fields:
  trip_state?: TripIntentState;
  // Trip clarify fields:
  missing_fields?: string[];
  message?: string;
  error?: string;
  // US-W5 direct-booking fields (kind="direct_booking"):
  venue_name?: string;
  booking_step?: {
    type: "restaurant" | "hotel";
    emoji: string;
    label: string;
    apiEndpoint: "/api/booking-jobs/start";
    body: Record<string, unknown>;
    status: "pending";
  };
}

function formatConstraintValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.join(", ");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _k = key; // key kept in signature for future per-key formatters
  return JSON.stringify(value);
}

function summarizeConstraints(constraints: Record<string, unknown>): Array<{ k: string; v: string }> {
  const out: Array<{ k: string; v: string }> = [];
  for (const [k, v] of Object.entries(constraints)) {
    if (k.startsWith("_")) continue;
    // Skip nested proxy blob — it's rendered as "with @name" pills above.
    if (k === "proxy_member_constraints") continue;
    const formatted = formatConstraintValue(k, v);
    if (!formatted) continue;
    out.push({ k: k.replace(/_/g, " "), v: formatted });
  }
  return out;
}

const SCENARIO_EMOJI: Record<string, string> = {
  restaurant: "🍽️",
  hotel: "🏨",
  flight: "✈️",
  activity: "🎟️",
  trip: "🧳",
};

export default function ConfirmCard(props: ConfirmCardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stage 2 contact check — for kind="room", we resolve member_names against
  // the user's contacts so they can see BEFORE committing which names will
  // actually receive the invite DM and which ones won't (typo, not a contact).
  const [unresolvedNames, setUnresolvedNames] = useState<string[] | null>(null);

  const summary = props.nlu.assistant_reply ?? "Ready to proceed.";
  const scenario = props.nlu.scenario ?? "";
  const memberNames = props.nlu.member_names;
  const rows = summarizeConstraints(props.nlu.collected_constraints);

  useEffect(() => {
    if (props.kind !== "room" || memberNames.length === 0) {
      setUnresolvedNames(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/contacts");
        if (!res.ok) return;
        const data = (await res.json()) as {
          contacts: Array<{
            contact_user_id: string;
            nickname: string | null;
            display_name: string | null;
            profile_code: string;
          }>;
        };
        const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
        const unresolved: string[] = [];
        for (const name of memberNames) {
          const target = norm(name);
          if (!target) continue;
          const hit = (data.contacts ?? []).find(
            (c) =>
              norm(c.nickname) === target ||
              norm(c.display_name) === target ||
              norm(c.profile_code) === target ||
              norm(c.profile_code).replace(/^@/, "") === target.replace(/^@/, ""),
          );
          if (!hit) unresolved.push(name);
        }
        if (!cancelled) setUnresolvedNames(unresolved);
      } catch {
        if (!cancelled) setUnresolvedNames(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.kind, memberNames]);

  async function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result: props.nlu,
          message: props.message,
          // Stage 2: send the chat conversation so the room can seed its
          // private channel with what got built up before commit.
          ...(props.history && props.history.length > 0 ? { history: props.history } : {}),
          // Sidebar "single-entry" rule: when an in-session commit creates a
          // room, markSessionUpgraded flags the session so it's hidden from
          // the Sessions list (the Room row above represents it instead).
          ...(props.sessionId ? { session_id: props.sessionId } : {}),
          // Resolved @-mentions from the homepage MentionPicker (P3). Server
          // uses these to skip resolveContactsByNames in create_room.
          ...(props.mentionedUserIds && props.mentionedUserIds.length > 0
            ? { mentioned_user_ids: props.mentionedUserIds }
            : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as CommitResponse;
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Couldn't commit.");
        return;
      }
      props.onConfirmed(data);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="confirm-card">
      <div className="confirm-card__pills">
        <span className="confirm-card__pill">
          {props.kind === "room" ? "Decision Room" : props.kind === "trip" ? "Trip package" : "Plan"}
          {scenario ? ` · ${SCENARIO_EMOJI[scenario] ?? ""} ${scenario}`.trimEnd() : ""}
        </span>
        {memberNames.length > 0 ? (
          <span className="confirm-card__pill">
            with {memberNames.slice(0, 3).join(", ")}{memberNames.length > 3 ? " +" : ""}
          </span>
        ) : null}
      </div>

      <div className="confirm-card__summary">{summary}</div>

      {props.kind === "room" ? (
        <div className="confirm-card__hint">
          {memberNames.length > 0
            ? `创建后你将获得邀请链接，可分享给 ${memberNames.slice(0, 3).join("、")}${memberNames.length > 3 ? " 等人" : ""}。`
            : "创建后你将获得邀请链接，可分享给其他决策成员。"}
        </div>
      ) : null}

      {/* Stage 2 warning: any member_names NOT in the user's contacts won't
          get the auto DM — surface it BEFORE commit so the user can back out
          and add them as contacts first. */}
      {props.kind === "room" && unresolvedNames && unresolvedNames.length > 0 ? (
        <div className="confirm-card__warn">
          ⚠️ {unresolvedNames.join("、")} 还不在你的联系人里 — 他们不会自动收到邀请 DM。先去{" "}
          <a href="/contacts">Contacts</a>{" "}
          加上这些人再回来，或者先建 room 后手动分享邀请链接。
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="confirm-card__rows">
          {rows.map(({ k, v }) => (
            <div key={k} style={{ display: "contents" }}>
              <div className="confirm-card__row-key">{k}</div>
              <div className="confirm-card__row-value">{v}</div>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <div className="confirm-card__error">{error}</div> : null}

      <div className="confirm-card__cta-row">
        <button
          type="button"
          disabled={submitting}
          onClick={handleConfirm}
          className="confirm-card__cta-primary"
        >
          {submitting
            ? "Working..."
            : props.kind === "room"
              ? "Confirm & create Room"
              : props.kind === "trip"
                ? "Package my trip"
                : "Confirm & run search"}
        </button>
        <button type="button" onClick={props.onEdit} className="confirm-card__cta-ghost">
          Edit
        </button>
      </div>
    </div>
  );
}
