/**
 * Stage 3 fallback adapter: existing job.decisionLog → TimelineEvent[]
 *
 * The current booking-job pipeline emits LOW-LEVEL `decisionLog` entries
 * (step_started, succeeded, failed, scene_replan, ...). The Track B UI
 * wants HIGH-LEVEL events (opened_site, selected_slot, needs_otp, ...).
 *
 * Until codex's Track A ExecutorV2 emits structured high-level events
 * directly, this adapter does best-effort mapping based on:
 *   - decisionLog entry type
 *   - message string heuristics
 *   - step.status + step.error
 *
 * Intentionally lossy. When Track A goes live we delete this and read the
 * structured events instead. Don't add business logic that depends on the
 * heuristic output being precise.
 */

import type { TimelineEventKind } from "./event-vocabulary";
import type { TimelineEvent } from "./types";

/** Shape of a decisionLog entry in the existing system. */
interface DecisionLogEntry {
  type: string;
  message: string;
  outcome?: string;
  ts?: string;
  details?: Record<string, unknown>;
}

/** Shape of a booking job step we care about (subset of BookingJobStep). */
interface JobStepShape {
  type?: string;
  status?: string;
  error?: string;
  decisionLog?: DecisionLogEntry[];
  handoff_url?: string;
  body?: Record<string, unknown>;
}

interface JobShape {
  status?: string;
  steps?: JobStepShape[];
}

/* ─── String detection helpers ─────────────────────────────────────────── */

const re = (pattern: RegExp) => (s: string) => pattern.test(s);

const looksLikeOpened = re(/navigat(ing|ed)\s+to\s+|opened\s+/i);
const looksLikeSearch = re(/search(ing)?\s+for|looking\s+up/i);
const looksLikeFound = re(/found|located|matched/i);
const looksLikeSlot = re(/selected\s+(\d{1,2}:\d{2}|time\s*slot)|clicked\s+\d{1,2}:\d{2}/i);
const looksLikeRoom = re(/selected\s+(room|king|queen|deluxe|standard|suite)/i);
const looksLikeFare = re(/selected\s+(fare|cabin|economy|business|first|premium)/i);
const looksLikeFilling = re(/fill(ing)?\s+(form|guest|passenger|info)/i);
const looksLikePolicy = re(/accept(ed)?\s+(terms|policy|cancellation)/i);
const looksLikeOtp = re(/otp|verification\s+code|2fa|two[\s-]?factor/i);
const looksLikeLogin = re(/login|sign[\s-]?in|authenticate/i);

/** Pull a hostname out of a URL-ish string in the message. */
function extractDomain(message: string): string | undefined {
  const m = message.match(/\bhttps?:\/\/(?:www\.)?([^\s/]+)/i);
  if (m) return m[1];
  const host = message.match(/\b(opentable|resy|booking|expedia|hotels|jetblue|kayak|tripadvisor|viator|getyourguide)\.com\b/i);
  return host?.[1] ? `${host[1].toLowerCase()}.com` : undefined;
}

/* ─── Per-entry mapping ────────────────────────────────────────────────── */

/**
 * Map ONE decisionLog entry to a TimelineEvent (or null if it doesn't
 * correspond to a customer-facing event).
 */
function mapEntry(entry: DecisionLogEntry, step: JobStepShape): TimelineEvent | null {
  const ts = entry.ts ?? new Date().toISOString();
  const message = entry.message ?? "";

  // ── Hard signals from entry.type ──
  if (entry.type === "step_started") {
    const domain = extractDomain(message);
    return { ts, kind: "opened_site", data: domain ? { domain } : undefined };
  }
  if (entry.type === "scene_replan") {
    return {
      ts,
      kind: "fallback_started",
      data: { reason: shorten(message, 50) },
    };
  }
  if (entry.type === "job_failed" || entry.type === "failed") {
    return {
      ts,
      kind: "failed",
      data: { reason: shorten(entry.outcome ?? message, 80) },
    };
  }

  // ── Heuristic mapping on succeeded/skipped messages ──
  if (entry.type === "succeeded" || entry.type === "skipped") {
    if (looksLikeOtp(message)) return { ts, kind: "otp_submitted" };
    if (looksLikeFound(message)) {
      return { ts, kind: "found_target", data: { label: extractAfter(message, /found|located|matched/i) } };
    }
    if (looksLikeSlot(message)) {
      return { ts, kind: "selected_slot", data: { slot: extractTimeOrLabel(message) } };
    }
    if (looksLikeRoom(message)) {
      return { ts, kind: "selected_room", data: { room: extractAfter(message, /selected/i) } };
    }
    if (looksLikeFare(message)) {
      return { ts, kind: "selected_fare", data: { fare: extractAfter(message, /selected/i) } };
    }
    if (looksLikePolicy(message)) {
      return { ts, kind: "accepted_policy", data: { policy: extractAfter(message, /accept(ed)?/i) } };
    }
    if (looksLikeFilling(message)) {
      return { ts, kind: "filling_form" };
    }
    if (looksLikeSearch(message)) {
      return { ts, kind: "searching", data: { term: extractAfter(message, /search(ing)?\s+for/i) } };
    }
    if (looksLikeOpened(message)) {
      const domain = extractDomain(message);
      return { ts, kind: "opened_site", data: domain ? { domain } : undefined };
    }
    // No specific match — drop on the floor (don't pollute the timeline
    // with low-information "succeeded" entries).
    return null;
  }

  // ── error type — surfaces via step.error pass below; skip here ──
  if (entry.type === "error") return null;

  // Unknown entry types — drop silently rather than guess.
  void step;
  return null;
}

/* ─── Step-level finalizer ─────────────────────────────────────────────── */

/**
 * After mapping all decisionLog entries, append a terminal event derived
 * from step.status / step.error if appropriate.
 */
function appendStepTerminal(
  events: TimelineEvent[],
  step: JobStepShape,
  defaultTs: string,
): TimelineEvent[] {
  const status = step.status;
  const error = step.error ?? "";
  const lastTs = events.at(-1)?.ts ?? defaultTs;

  if (status === "no_availability") {
    return [...events, { ts: lastTs, kind: "no_availability", data: { reason: shorten(error, 80) } }];
  }
  if (status === "awaiting_confirmation") {
    return [...events, { ts: lastTs, kind: "ready_for_confirmation" }];
  }
  if (status === "done") {
    return [...events, { ts: lastTs, kind: "ready_for_confirmation" }];
  }
  if (status === "error") {
    if (looksLikeOtp(error)) {
      return [...events, { ts: lastTs, kind: "needs_otp", data: { channel: "verification" } }];
    }
    if (looksLikeLogin(error)) {
      return [...events, { ts: lastTs, kind: "needs_login" }];
    }
    return [...events, { ts: lastTs, kind: "failed", data: { reason: shorten(error, 80) } }];
  }
  return events;
}

/* ─── Public API ───────────────────────────────────────────────────────── */

/** Transform a booking job's data into a flat TimelineEvent[]. */
export function deriveEventsFromJob(job: JobShape): TimelineEvent[] {
  if (!job?.steps?.length) return [];
  const out: TimelineEvent[] = [];
  for (const step of job.steps) {
    let stepEvents: TimelineEvent[] = [];
    for (const entry of step.decisionLog ?? []) {
      const mapped = mapEntry(entry, step);
      if (mapped) stepEvents.push(mapped);
    }
    stepEvents = appendStepTerminal(stepEvents, step, new Date().toISOString());
    out.push(...stepEvents);
  }
  // Stable sort by ts (ISO strings sort lexicographically).
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

/**
 * Get the latest event kind. Used by StatusBanner / status derivation.
 * Returns undefined for an empty list.
 */
export function latestEventKind(events: TimelineEvent[]): TimelineEventKind | undefined {
  return events.at(-1)?.kind;
}

/* ─── Internal string utilities ────────────────────────────────────────── */

function shorten(s: string | undefined, max: number): string | undefined {
  if (!s) return undefined;
  const trimmed = s.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max - 1) + "…";
}

function extractAfter(message: string, leadIn: RegExp): string | undefined {
  const m = message.match(leadIn);
  if (!m) return undefined;
  const tail = message.slice((m.index ?? 0) + m[0].length).trim();
  // Stop at a punctuation boundary so we don't drag the whole sentence in.
  const cut = tail.match(/^[^.,;:!?\n]{1,60}/)?.[0]?.trim();
  return cut || undefined;
}

function extractTimeOrLabel(message: string): string | undefined {
  const t = message.match(/\b\d{1,2}:\d{2}\s*(AM|PM|am|pm)?\b/);
  if (t?.[0]) return t[0];
  return extractAfter(message, /selected/i);
}
