/**
 * Timeline event taxonomy — kept in sync with codex's Track A
 * BookingExecutionEvent emitter.
 *
 * Adding a new kind is OK; renaming or removing one breaks the contract
 * with both Track A AND derive-events.ts. Coordinate before changing.
 *
 * Reserved/extension kinds (codex requested these slots stay open):
 *   - fallback_started
 *   - otp_submitted
 *   - manual_takeover
 *   - stopped_before_final_action
 */

export type TimelineEventKind =
  // ── Navigation / search ─────────────────────────────────────
  | "opened_site"
  | "searching"
  | "found_target"
  // ── Selection ───────────────────────────────────────────────
  | "selected_slot"
  | "selected_room"
  | "selected_fare"
  // ── Form filling ────────────────────────────────────────────
  | "filling_form"
  | "accepted_policy"
  // ── Pause / human handoff ───────────────────────────────────
  | "needs_otp"
  | "otp_submitted"                  // reserved
  | "needs_login"
  | "manual_takeover"                // reserved
  // ── Recovery ────────────────────────────────────────────────
  | "fallback_started"               // reserved
  // ── Terminal ────────────────────────────────────────────────
  | "ready_for_confirmation"
  | "stopped_before_final_action"    // reserved
  | "no_availability"
  | "failed";

/**
 * Visual + semantic descriptor for a timeline event kind.
 * Used by both <TimelineEvent /> rendering and <StatusBanner /> driving.
 */
export interface EventDescriptor {
  /** Single-emoji or short-glyph icon. */
  icon: string;
  /** Tone bucket — drives color (defined in tasks.css). */
  tone: "neutral" | "progress" | "pause" | "success" | "warning" | "error";
  /**
   * Should the panel surface a top-of-page banner when this is the LATEST
   * event? Most events: false. Pause / terminal events: true.
   */
  promote: boolean;
  /**
   * Build the human-readable label given an event's data payload.
   * Returns plain text, no HTML. Keep ≤ 64 chars when possible.
   */
  buildLabel: (data: Record<string, string | number | undefined> | undefined) => string;
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

const fallback = (val: string | number | undefined, alt: string) =>
  val == null || val === "" ? alt : String(val);

/* ─── Vocabulary registry ──────────────────────────────────────────────── */

export const EVENT_DESCRIPTORS: Record<TimelineEventKind, EventDescriptor> = {
  // ── Navigation / search ─────────────────────────────────────
  opened_site: {
    icon: "↗",
    tone: "progress",
    promote: false,
    buildLabel: (d) => `Opened ${fallback(d?.domain, "site")}`,
  },
  searching: {
    icon: "🔍",
    tone: "progress",
    promote: false,
    buildLabel: (d) => `Searching for ${fallback(d?.term, "target")}`,
  },
  found_target: {
    icon: "✓",
    tone: "success",
    promote: false,
    buildLabel: (d) => `Found ${fallback(d?.label, "target")}`,
  },
  // ── Selection ───────────────────────────────────────────────
  selected_slot: {
    icon: "✓",
    tone: "success",
    promote: false,
    buildLabel: (d) => `Selected ${fallback(d?.slot, "time slot")}`,
  },
  selected_room: {
    icon: "✓",
    tone: "success",
    promote: false,
    buildLabel: (d) => `Selected ${fallback(d?.room, "room")}`,
  },
  selected_fare: {
    icon: "✓",
    tone: "success",
    promote: false,
    buildLabel: (d) => `Selected ${fallback(d?.fare, "fare")}`,
  },
  // ── Form filling ────────────────────────────────────────────
  filling_form: {
    icon: "✏️",
    tone: "progress",
    promote: false,
    buildLabel: () => `Filling guest information`,
  },
  accepted_policy: {
    icon: "✓",
    tone: "success",
    promote: false,
    buildLabel: (d) => `Accepted ${fallback(d?.policy, "policy")}`,
  },
  // ── Pause / human handoff ───────────────────────────────────
  needs_otp: {
    icon: "⏸",
    tone: "pause",
    promote: true,
    buildLabel: (d) => `Waiting for OTP from ${fallback(d?.channel, "verification channel")}`,
  },
  otp_submitted: {
    icon: "✓",
    tone: "success",
    promote: false,
    buildLabel: () => `OTP submitted`,
  },
  needs_login: {
    icon: "⏸",
    tone: "pause",
    promote: true,
    buildLabel: () => `Login required`,
  },
  manual_takeover: {
    icon: "👤",
    tone: "pause",
    promote: true,
    buildLabel: () => `Switched to manual mode`,
  },
  // ── Recovery ────────────────────────────────────────────────
  fallback_started: {
    icon: "⟳",
    tone: "warning",
    promote: false,
    buildLabel: (d) => `Trying fallback: ${fallback(d?.reason, "alternative path")}`,
  },
  // ── Terminal ────────────────────────────────────────────────
  ready_for_confirmation: {
    icon: "🟢",
    tone: "success",
    promote: true,
    buildLabel: () => `Ready — review and confirm`,
  },
  stopped_before_final_action: {
    icon: "🔒",
    tone: "success",
    promote: true,
    buildLabel: () => `Stopped before final confirmation`,
  },
  no_availability: {
    icon: "✗",
    tone: "warning",
    promote: true,
    buildLabel: (d) => `No availability${d?.reason ? ` — ${d.reason}` : ""}`,
  },
  failed: {
    icon: "✗",
    tone: "error",
    promote: true,
    buildLabel: (d) => `Failed${d?.reason ? ` — ${d.reason}` : ""}`,
  },
};

/* ─── Status helpers ───────────────────────────────────────────────────── */

import type { TimelineStatus } from "./types";

/**
 * Given the latest event kind, derive the panel's overall status.
 * Returns "running" if no terminal/pause kind is reached.
 */
export function statusFromLatestEvent(
  latest: TimelineEventKind | undefined,
): TimelineStatus {
  if (!latest) return "running";
  switch (latest) {
    case "needs_otp":
      return "needs_otp";
    case "needs_login":
      return "needs_login";
    case "ready_for_confirmation":
    case "stopped_before_final_action":
      return "ready_for_confirmation";
    case "no_availability":
      return "no_availability";
    case "failed":
      return "failed";
    default:
      return "running";
  }
}
