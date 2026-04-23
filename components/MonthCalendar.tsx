"use client";

/**
 * MonthCalendar — full-month 7×N grid with:
 *   - Single-day events stacked per-cell (flight, restaurant, activity)
 *   - Multi-day span events (hotel stays) rendered as absolute-positioned
 *     bars that literally cross day cells within a week row — like Google
 *     Calendar. When a stay crosses the Sat→Sun boundary, it's drawn as two
 *     bars (one per week) with continuation chevrons.
 *
 * Read-only: click any bar to jump to /tasks?focus=<jobId>&view=live.
 */

import type { CalendarGrid, CalendarEvent, CalendarDay, WeekSpanSegment } from "@/lib/calendar-grid";
import type { BookingJobStep } from "@/lib/db";

export interface MonthCalendarProps {
  grid: CalendarGrid;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  onEventClick?: (jobId: string) => void;
}

// ─── Status color map (mirrors TripItineraryCalendar) ───────────────────

function statusColors(step: BookingJobStep): { bg: string; border: string; fg: string; pulse: boolean } {
  if (step.status === "done") return { bg: "#d1fae5", border: "#10b981", fg: "#065f46", pulse: false };
  if (step.status === "awaiting_confirmation") return { bg: "#fef3c7", border: "#eab308", fg: "#854d0e", pulse: false };
  if (step.status === "error" || step.status === "no_availability") return { bg: "#fee2e2", border: "#ef4444", fg: "#991b1b", pulse: false };
  if (step.status === "loading") return { bg: "#dbeafe", border: "#3b82f6", fg: "#1e3a8a", pulse: true };
  return { bg: "#f1f5f9", border: "#cbd5e1", fg: "#475569", pulse: false };
}

// ─── Layout constants ───────────────────────────────────────────────────

const DAY_NUMBER_HEIGHT = 26;  // vertical space reserved for the day number at top of cell
const LANE_HEIGHT = 22;        // per span lane
const LANE_GAP = 2;            // gap between span bars and single-day events
const MIN_CELL_HEIGHT = 104;   // floor so empty days still breathe

// ─── Styles ──────────────────────────────────────────────────────────────

const WRAPPER: React.CSSProperties = {
  backgroundColor: "var(--card, #fff)",
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 16,
  overflow: "hidden",
};

const HEADER: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "14px 18px",
  borderBottom: "1px solid var(--border, #e5e7eb)",
};

const NAV_BTN: React.CSSProperties = {
  fontFamily: "var(--font-dm-sans)",
  fontSize: 13,
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid var(--border, #e5e7eb)",
  background: "transparent",
  color: "var(--text-primary, #111)",
  cursor: "pointer",
};

const MONTH_TITLE: React.CSSProperties = {
  fontFamily: "var(--font-dm-sans)",
  fontSize: 20,
  fontWeight: 600,
  color: "var(--text-primary, #111)",
};

const WEEKDAY_ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(7, 1fr)",
  borderBottom: "1px solid var(--border, #e5e7eb)",
  backgroundColor: "var(--bg, #fafaf9)",
};

const WEEKDAY_CELL: React.CSSProperties = {
  padding: "8px 10px",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-muted, #888)",
  textAlign: "left",
};

const WEEK_ROW: React.CSSProperties = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: "repeat(7, 1fr)",
  borderBottom: "1px solid var(--border, #e5e7eb)",
};

const DAY_CELL: React.CSSProperties = {
  padding: "6px 6px 8px",
  borderRight: "1px solid var(--border, #e5e7eb)",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const DAY_NUMBER: React.CSSProperties = {
  fontFamily: "var(--font-dm-sans)",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-primary, #111)",
  width: 22,
  height: 22,
  borderRadius: 11,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  marginBottom: 2,
};

const SINGLE_EVENT_BAR: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 6px",
  borderRadius: 6,
  borderLeft: "3px solid",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 11,
  lineHeight: "14px",
  fontWeight: 500,
  cursor: "pointer",
  overflow: "hidden",
};

const SPAN_BAR: React.CSSProperties = {
  position: "absolute",
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: 5,
  padding: "3px 8px",
  height: LANE_HEIGHT - 4,
  borderLeft: "3px solid",
  fontFamily: "var(--font-dm-sans)",
  fontSize: 11,
  lineHeight: "14px",
  fontWeight: 500,
  cursor: "pointer",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const EVENT_TIME: React.CSSProperties = {
  flexShrink: 0,
  fontVariantNumeric: "tabular-nums",
  opacity: 0.75,
};

const EVENT_LABEL: React.CSSProperties = {
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

// ─── Main component ──────────────────────────────────────────────────────

export default function MonthCalendar(props: MonthCalendarProps) {
  const { grid, onPrevMonth, onNextMonth, onToday, onEventClick } = props;

  return (
    <div style={WRAPPER}>
      <style>{`
        @keyframes mc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.65; } }
        .mc-nav-btn:hover { background: var(--hover, rgba(0,0,0,0.04)); }
        .mc-event-bar:hover { transform: translateX(1px); }
        .mc-span-bar:hover { filter: brightness(1.03); }
      `}</style>

      {/* Month header + nav */}
      <div style={HEADER}>
        <div style={MONTH_TITLE}>{grid.monthLabel}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="mc-nav-btn" style={NAV_BTN} onClick={onPrevMonth} aria-label="Previous month">←</button>
          <button className="mc-nav-btn" style={NAV_BTN} onClick={onToday}>Today</button>
          <button className="mc-nav-btn" style={NAV_BTN} onClick={onNextMonth} aria-label="Next month">→</button>
        </div>
      </div>

      {/* Weekday header row */}
      <div style={WEEKDAY_ROW}>
        {grid.weekdays.map((wd) => (
          <div key={wd} style={WEEKDAY_CELL}>{wd}</div>
        ))}
      </div>

      {/* Week rows */}
      {grid.weeks.map((week, wi) => {
        const spans = grid.weeklySpans[wi] ?? [];
        const maxLane = spans.reduce((m, s) => Math.max(m, s.lane), -1);
        // Top padding inside each day cell must clear the day number AND all
        // span lanes, so single-day events never collide with span bars.
        const cellTopPad = DAY_NUMBER_HEIGHT + (maxLane + 1) * LANE_HEIGHT + LANE_GAP;
        const isLastRow = wi === grid.weeks.length - 1;
        return (
          <div
            key={wi}
            style={{
              ...WEEK_ROW,
              borderBottom: isLastRow ? "none" : WEEK_ROW.borderBottom,
            }}
          >
            {week.map((day, di) => (
              <DayCell
                key={day.date}
                day={day}
                isLastCol={di === 6}
                contentTopPad={cellTopPad}
                onEventClick={onEventClick}
              />
            ))}
            {/* Span bars overlay — placed AFTER cells so they stack visually on top */}
            {spans.map((seg, si) => (
              <SpanBar
                key={`${seg.jobId}-${seg.event.stepIndex}-${si}`}
                segment={seg}
                onClick={onEventClick}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── Day cell ────────────────────────────────────────────────────────────

function DayCell({
  day,
  isLastCol,
  contentTopPad,
  onEventClick,
}: {
  day: CalendarDay;
  isLastCol: boolean;
  contentTopPad: number;
  onEventClick?: (jobId: string) => void;
}) {
  const dayNumberStyle: React.CSSProperties = {
    ...DAY_NUMBER,
    color: day.inMonth ? "var(--text-primary, #111)" : "var(--text-muted, #aaa)",
    ...(day.isToday
      ? {
          backgroundColor: "var(--gold, #d4a34b)",
          color: "#fff",
        }
      : {}),
  };
  return (
    <div
      style={{
        ...DAY_CELL,
        borderRight: isLastCol ? "none" : DAY_CELL.borderRight,
        backgroundColor: day.inMonth ? "var(--card, #fff)" : "var(--bg, #fafaf9)",
        minHeight: Math.max(MIN_CELL_HEIGHT, contentTopPad + 20),
      }}
    >
      <span style={dayNumberStyle}>{day.dayOfMonth}</span>
      {/* Reserve vertical space for span lanes sitting on top of this cell. */}
      <div style={{ height: contentTopPad - DAY_NUMBER_HEIGHT, flexShrink: 0 }} />
      {day.events.map((ce, idx) => (
        <SingleEventBar
          key={`${ce.jobId}-${ce.event.stepIndex}-${ce.event.slot}-${idx}`}
          calendarEvent={ce}
          onClick={onEventClick}
        />
      ))}
    </div>
  );
}

// ─── Span bar (hotel stay) ───────────────────────────────────────────────

function SpanBar({ segment, onClick }: { segment: WeekSpanSegment; onClick?: (jobId: string) => void }) {
  const { event, startCol, endCol, lane, isStartWeek, isEndWeek, jobId } = segment;
  const colors = statusColors(event.step);
  const label = event.label ?? event.step.label;
  const emoji = event.step.emoji || "🏨";

  const colWidthPct = 100 / 7;
  const leftPct = startCol * colWidthPct;
  const widthPct = (endCol - startCol + 1) * colWidthPct;

  // Vertical position: push below the day number, then offset per lane
  const top = DAY_NUMBER_HEIGHT + 4 + lane * LANE_HEIGHT;

  // Border radius: round outer edges only — corners that touch a week
  // boundary stay sharp so the bar visually "continues" on the other side.
  const radiusL = isStartWeek ? 6 : 0;
  const radiusR = isEndWeek ? 6 : 0;

  return (
    <div
      className="mc-span-bar"
      style={{
        ...SPAN_BAR,
        left: `calc(${leftPct}% + 4px)`,
        width: `calc(${widthPct}% - 8px)`,
        top,
        backgroundColor: colors.bg,
        borderLeftColor: colors.border,
        color: colors.fg,
        borderTopLeftRadius: radiusL,
        borderBottomLeftRadius: radiusL,
        borderTopRightRadius: radiusR,
        borderBottomRightRadius: radiusR,
        animation: colors.pulse ? "mc-pulse 1.6s ease-in-out infinite" : undefined,
      }}
      onClick={() => onClick?.(jobId)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick?.(jobId);
      }}
      title={`${label}${event.badge ? ` · ${event.badge}` : ""}`}
    >
      {!isStartWeek && <span style={{ opacity: 0.6 }}>←</span>}
      <span style={{ fontSize: 11 }}>{emoji}</span>
      <span style={{ ...EVENT_LABEL, fontWeight: 600 }}>{label}</span>
      {isStartWeek && event.badge ? (
        <span style={{ flexShrink: 0, opacity: 0.75, fontSize: 10 }}>· {event.badge}</span>
      ) : null}
      {!isEndWeek && <span style={{ opacity: 0.6 }}>→</span>}
    </div>
  );
}

// ─── Single-day event bar ────────────────────────────────────────────────

function SingleEventBar({
  calendarEvent,
  onClick,
}: {
  calendarEvent: CalendarEvent;
  onClick?: (jobId: string) => void;
}) {
  const { event, jobId } = calendarEvent;
  const colors = statusColors(event.step);
  const label = event.label ?? event.step.label;
  const emoji = event.step.emoji || defaultEmoji(event.slot);

  return (
    <div
      className="mc-event-bar"
      style={{
        ...SINGLE_EVENT_BAR,
        backgroundColor: colors.bg,
        borderLeftColor: colors.border,
        color: colors.fg,
        animation: colors.pulse ? "mc-pulse 1.6s ease-in-out infinite" : undefined,
      }}
      onClick={() => onClick?.(jobId)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick?.(jobId);
      }}
      title={`${label}${event.time ? ` · ${event.time}` : ""}${event.badge ? ` · ${event.badge}` : ""}`}
    >
      {event.time ? <span style={EVENT_TIME}>{event.time}</span> : null}
      <span style={{ fontSize: 10 }}>{emoji}</span>
      <span style={EVENT_LABEL}>{label}</span>
    </div>
  );
}

function defaultEmoji(slot: CalendarEvent["event"]["slot"]): string {
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
