"use client";

/**
 * TripItineraryCalendar — D1 (Phase 2-C.2).
 *
 * Renders a read-only, day-grouped view of a multi-step BookingJob so the
 * user gets a "mental picture" of their trip while the parallel booking
 * tasks run. Status color on each block updates as the job progresses
 * (driven by the parent's polling — we don't fetch here).
 *
 * Layout: one section per day with events stacked top-to-bottom sorted by
 * time. Hotel check-in carries an "N nights" badge (stay isn't re-shown on
 * middle days). Flight round-trip emits two events (outbound + return).
 *
 * Scope:
 *   - Only rendered when job.steps.length >= 2
 *   - Read-only (no drag / swap / delete — that's D3, intentionally deferred)
 *   - Click an event → scroll to the matching step card below (D2 will link
 *     to a dedicated detail page)
 */

import { useMemo } from "react";
import type { BookingJob, BookingJobStep } from "@/lib/db";
import { buildItineraryDayGroups, type ItineraryEvent } from "@/lib/itinerary";

export interface TripItineraryCalendarProps {
  job: BookingJob;
  /** Called when user clicks a block. Caller can scroll to step / open detail. */
  onEventClick?: (stepIndex: number) => void;
}

// ─── Status → color mapping ─────────────────────────────────────────────
// Kept close to the existing stepStatusColor() in app/tasks/page.tsx so the
// calendar and the step cards below it use the same visual vocabulary.

function statusColors(step: BookingJobStep): { bg: string; border: string; fg: string; pulse: boolean } {
  if (step.status === "done") {
    return { bg: "#d1fae5", border: "#10b981", fg: "#065f46", pulse: false };
  }
  if (step.status === "awaiting_confirmation") {
    return { bg: "#fef3c7", border: "#eab308", fg: "#854d0e", pulse: false };
  }
  if (step.status === "error" || step.status === "no_availability") {
    return { bg: "#fee2e2", border: "#ef4444", fg: "#991b1b", pulse: false };
  }
  if (step.status === "loading") {
    return { bg: "#dbeafe", border: "#3b82f6", fg: "#1e3a8a", pulse: true };
  }
  // pending / unknown
  return { bg: "#f1f5f9", border: "#cbd5e1", fg: "#475569", pulse: false };
}

function statusLabel(step: BookingJobStep): string {
  switch (step.status) {
    case "done":
      return "Booked";
    case "loading":
      return "Booking…";
    case "awaiting_confirmation":
      return "Needs you";
    case "error":
      return "Error";
    case "no_availability":
      return "No avail.";
    case "pending":
    default:
      return "Pending";
  }
}

// ─── Styles ──────────────────────────────────────────────────────────────

const WRAPPER: React.CSSProperties = {
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 14,
  backgroundColor: "var(--card, #fff)",
  padding: 14,
  marginBottom: 12,
};

const HEADER: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  marginBottom: 10,
  fontFamily: "var(--font-dm-sans)",
};

const TITLE: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-primary, #111)",
  letterSpacing: "0.02em",
  textTransform: "uppercase",
};

const COUNTER: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted, #888)",
};

const DAY_SECTION: React.CSSProperties = {
  borderTop: "1px solid var(--border, #e5e7eb)",
  paddingTop: 10,
  marginTop: 10,
};

const DAY_HEADER: React.CSSProperties = {
  fontFamily: "var(--font-dm-sans)",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-secondary, #666)",
  marginBottom: 8,
};

const EVENT_ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  borderRadius: 10,
  marginBottom: 6,
  border: "1px solid",
  cursor: "pointer",
  transition: "transform 0.12s ease",
  fontFamily: "var(--font-dm-sans)",
};

const EVENT_TIME: React.CSSProperties = {
  flexShrink: 0,
  width: 56,
  fontSize: 12,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
};

const EVENT_EMOJI: React.CSSProperties = {
  flexShrink: 0,
  fontSize: 16,
  width: 20,
  textAlign: "center",
};

const EVENT_LABEL: React.CSSProperties = {
  flex: 1,
  fontSize: 13,
  fontWeight: 500,
  // Color is applied inline via `colors.fg` below — each status pairs a light
  // bg with a matching dark foreground so text stays readable in any theme.
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const EVENT_BADGE: React.CSSProperties = {
  flexShrink: 0,
  fontSize: 10,
  padding: "2px 6px",
  borderRadius: 999,
  backgroundColor: "rgba(0,0,0,0.06)",
  color: "var(--text-muted, #555)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const EMPTY_DAY: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px dashed var(--border, #e5e7eb)",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 12,
  color: "var(--text-muted, #888)",
  fontStyle: "italic",
};

const STATUS_PILL: React.CSSProperties = {
  flexShrink: 0,
  fontSize: 10,
  padding: "3px 8px",
  borderRadius: 999,
  fontWeight: 600,
};

// ─── Component ───────────────────────────────────────────────────────────

export default function TripItineraryCalendar(props: TripItineraryCalendarProps) {
  const { job, onEventClick } = props;

  // fillEmptyDays: show "nothing scheduled" rows for days inside the trip span
  // with no events (e.g. middle nights of a 3-night hotel stay). Communicates
  // the trip's shape — without this the calendar jumps from check-in day
  // straight to departure day and looks like a list, not a calendar.
  const dayGroups = useMemo(
    () => buildItineraryDayGroups(job.steps, { fillEmptyDays: true }),
    [job.steps],
  );

  // No useful calendar if every step lacked date info (which would make all
  // of them fall back to nothing). Don't render an empty shell.
  if (dayGroups.length === 0) return null;

  const totalEvents = dayGroups.reduce((n, g) => n + g.events.length, 0);

  return (
    <div style={WRAPPER}>
      <style>{`
        @keyframes itinerary-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        .itinerary-event:hover { transform: translateX(2px); }
      `}</style>

      <div style={HEADER}>
        <span style={TITLE}>Itinerary</span>
        <span style={COUNTER}>{totalEvents} item{totalEvents === 1 ? "" : "s"} · {dayGroups.length} day{dayGroups.length === 1 ? "" : "s"}</span>
      </div>

      {dayGroups.map((group, gi) => (
        <div key={group.date} style={gi === 0 ? { ...DAY_SECTION, borderTop: "none", paddingTop: 0, marginTop: 0 } : DAY_SECTION}>
          <div style={DAY_HEADER}>{group.header}</div>
          {group.events.length === 0 ? (
            <div style={EMPTY_DAY}>Nothing scheduled — free day.</div>
          ) : (
            group.events.map((ev) => (
              <EventBlock key={`${ev.stepIndex}-${ev.slot}`} event={ev} onClick={onEventClick} />
            ))
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Event block ─────────────────────────────────────────────────────────

function EventBlock({ event, onClick }: { event: ItineraryEvent; onClick?: (stepIndex: number) => void }) {
  const colors = statusColors(event.step);
  const label = event.label ?? event.step.label;
  const emoji = event.step.emoji || defaultEmoji(event.slot);
  const timeDisplay = event.time ?? "—";
  return (
    <div
      className="itinerary-event"
      style={{
        ...EVENT_ROW,
        backgroundColor: colors.bg,
        borderColor: colors.border,
        color: colors.fg,
        animation: colors.pulse ? "itinerary-pulse 1.6s ease-in-out infinite" : undefined,
      }}
      onClick={() => onClick?.(event.stepIndex)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick?.(event.stepIndex);
      }}
    >
      <span style={{ ...EVENT_TIME, color: colors.fg }}>{timeDisplay}</span>
      <span style={EVENT_EMOJI}>{emoji}</span>
      <span style={{ ...EVENT_LABEL, color: colors.fg }}>{label}</span>
      {event.badge ? <span style={EVENT_BADGE}>{event.badge}</span> : null}
      <span
        style={{
          ...STATUS_PILL,
          backgroundColor: colors.border,
          color: "#fff",
        }}
      >
        {statusLabel(event.step)}
      </span>
    </div>
  );
}

function defaultEmoji(slot: ItineraryEvent["slot"]): string {
  switch (slot) {
    case "outbound":
    case "return":
      return "✈️";
    case "checkin":
      return "🏨";
    case "meal":
      return "🍽️";
    case "show":
      return "🎟️";
    default:
      return "📍";
  }
}
