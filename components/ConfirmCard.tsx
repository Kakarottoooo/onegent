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

import { useState } from "react";
import type { ConversationalNLUResult } from "@/lib/agent/nlu-v2";
import type { TripIntentState } from "@/lib/agent/trip-intent-state";

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
  /** Called with the commit response (room_id + url, or plan hand-off payload). */
  onConfirmed: (payload: CommitResponse) => void;
  /** User clicked "edit" — put focus back on the input so they can keep chatting. */
  onEdit: () => void;
}

export interface CommitResponse {
  ok: boolean;
  /** "trip_clarify" surfaced only when the backend defensively rejects an
   *  incomplete trip commit; the chat handler treats it as a missing-field
   *  error and nudges the user back into the conversation. */
  kind: ConfirmCardKind | "trip_clarify";
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
}

const CARD_STYLE: React.CSSProperties = {
  border: "1px solid var(--border, #e5e7eb)",
  backgroundColor: "var(--card, #fff)",
  borderRadius: 14,
  padding: 14,
  marginTop: 8,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const PILL: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontFamily: "var(--font-dm-sans)",
  border: "1px solid var(--border, #e5e7eb)",
  color: "var(--text-secondary, #555)",
  backgroundColor: "var(--card-2, #f7f7f7)",
};

const PRIMARY_BTN: React.CSSProperties = {
  flex: 1,
  padding: "9px 12px",
  borderRadius: 10,
  border: "none",
  backgroundColor: "var(--gold, #c9a648)",
  color: "#fff",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const GHOST_BTN: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--border, #e5e7eb)",
  backgroundColor: "transparent",
  color: "var(--text-primary, #111)",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 13,
  cursor: "pointer",
};

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

  const summary = props.nlu.assistant_reply ?? "Ready to proceed.";
  const scenario = props.nlu.scenario ?? "";
  const memberNames = props.nlu.member_names;
  const rows = summarizeConstraints(props.nlu.collected_constraints);

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
    <div style={CARD_STYLE}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={PILL}>
          {props.kind === "room" ? "Decision Room" : props.kind === "trip" ? "Trip package" : "Plan"}
          {scenario ? ` · ${SCENARIO_EMOJI[scenario] ?? ""} ${scenario}`.trimEnd() : ""}
        </span>
        {memberNames.length > 0 ? (
          <span style={PILL}>with {memberNames.slice(0, 3).join(", ")}{memberNames.length > 3 ? " +" : ""}</span>
        ) : null}
      </div>

      <div
        style={{
          fontFamily: "var(--font-dm-sans)",
          fontSize: 14,
          color: "var(--text-primary, #111)",
          lineHeight: 1.5,
        }}
      >
        {summary}
      </div>

      {props.kind === "room" ? (
        <div
          style={{
            fontSize: 12,
            fontFamily: "var(--font-dm-sans)",
            color: "var(--text-muted, #888)",
            lineHeight: 1.5,
          }}
        >
          {memberNames.length > 0
            ? `创建后你将获得邀请链接，可分享给 ${memberNames.slice(0, 3).join("、")}${memberNames.length > 3 ? " 等人" : ""}。`
            : "创建后你将获得邀请链接，可分享给其他决策成员。"}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "max-content 1fr",
            columnGap: 12,
            rowGap: 4,
            fontSize: 12,
            fontFamily: "var(--font-dm-sans)",
          }}
        >
          {rows.map(({ k, v }) => (
            <div key={k} style={{ display: "contents" }}>
              <div style={{ color: "var(--text-muted, #888)" }}>{k}</div>
              <div style={{ color: "var(--text-primary, #111)" }}>{v}</div>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <div style={{ color: "#c0392b", fontSize: 12, fontFamily: "var(--font-dm-sans)" }}>{error}</div>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          disabled={submitting}
          onClick={handleConfirm}
          style={{ ...PRIMARY_BTN, opacity: submitting ? 0.7 : 1 }}
        >
          {submitting
            ? "Working..."
            : props.kind === "room"
              ? "Confirm & create Room"
              : props.kind === "trip"
                ? "Package my trip"
                : "Confirm & run search"}
        </button>
        <button type="button" onClick={props.onEdit} style={GHOST_BTN}>
          Edit
        </button>
      </div>
    </div>
  );
}
