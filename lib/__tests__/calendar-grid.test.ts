/**
 * Tests for calendar-grid — verifies month grid shape, padding, span handling,
 * and today detection.
 */

import { describe, it, expect } from "vitest";
import { buildCalendarGrid } from "../calendar-grid";
import type { BookingJob, BookingJobStep } from "../db";

function makeStep(overrides: Partial<BookingJobStep> & { type: BookingJobStep["type"]; body?: Record<string, unknown> }): BookingJobStep {
  return {
    emoji: "",
    label: "test",
    apiEndpoint: "/api/test",
    body: {},
    fallbackUrl: "",
    status: "pending",
    ...overrides,
  } as BookingJobStep;
}

function makeJob(overrides: Partial<BookingJob> & { id: string; steps: BookingJobStep[] }): BookingJob {
  return {
    session_id: "sess-test",
    user_id: null,
    trip_label: "Test trip",
    status: "pending",
    autonomy_settings: null,
    created_at: "2026-04-22T00:00:00Z",
    updated_at: "2026-04-22T00:00:00Z",
    completed_at: null,
    ...overrides,
  } as BookingJob;
}

// April 2026 (month=3) — starts on a Wednesday, has 30 days.
// Leading pad = 3 (Sun/Mon/Tue of prev month), trailing pad = 2 (Fri/Sat of next month)
// Total = 3 + 30 + 2 = 35 = exactly 5 weeks.

describe("buildCalendarGrid — month shape", () => {
  it("April 2026 produces exactly 5 weeks × 7 days", () => {
    const grid = buildCalendarGrid([], 2026, 3);
    expect(grid.weeks).toHaveLength(5);
    for (const week of grid.weeks) {
      expect(week).toHaveLength(7);
    }
  });

  it("pads leading days from March and trailing days from May", () => {
    const grid = buildCalendarGrid([], 2026, 3);
    // First 3 cells should be March 29, 30, 31
    expect(grid.weeks[0][0]).toMatchObject({ dayOfMonth: 29, inMonth: false });
    expect(grid.weeks[0][1]).toMatchObject({ dayOfMonth: 30, inMonth: false });
    expect(grid.weeks[0][2]).toMatchObject({ dayOfMonth: 31, inMonth: false });
    // April 1 (Wed)
    expect(grid.weeks[0][3]).toMatchObject({ dayOfMonth: 1, inMonth: true });
    // Last cell should be May 2
    expect(grid.weeks[4][6]).toMatchObject({ dayOfMonth: 2, inMonth: false });
  });

  it("month label and weekday header are correct", () => {
    const grid = buildCalendarGrid([], 2026, 3);
    expect(grid.monthLabel).toBe("April 2026");
    expect(grid.weekdays).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });

  it("today flag is set when today falls inside the viewed month", () => {
    const today = new Date(2026, 3, 22, 12, 0, 0); // Wed Apr 22
    const grid = buildCalendarGrid([], 2026, 3, today);
    // Apr 22 is the 4th Wed — week index 3, day index 3
    const cell = grid.weeks[3][3];
    expect(cell).toMatchObject({ dayOfMonth: 22, inMonth: true, isToday: true });
  });

  it("today flag is false for all cells when viewing a different month", () => {
    const today = new Date(2026, 3, 22, 12, 0, 0);
    const grid = buildCalendarGrid([], 2026, 4, today); // May view
    const allToday = grid.weeks.flat().filter((d) => d.isToday);
    expect(allToday).toHaveLength(0);
  });
});

// ─── Event placement ─────────────────────────────────────────────────────

describe("buildCalendarGrid — event placement", () => {
  it("places a restaurant event on its date only", () => {
    const job = makeJob({
      id: "j1",
      steps: [makeStep({ type: "restaurant", body: { date: "2026-04-24", time: "19:00" } })],
    });
    const grid = buildCalendarGrid([job], 2026, 3);
    const cell = grid.weeks.flat().find((d) => d.date === "2026-04-24");
    expect(cell?.events).toHaveLength(1);
    expect(cell?.events[0]).toMatchObject({
      jobId: "j1",
      tripLabel: "Test trip",
    });
    expect(cell?.events[0].event.time).toBe("19:00");
  });

  it("hotel stay becomes a week-span segment (not per-day events)", () => {
    const job = makeJob({
      id: "j1",
      steps: [makeStep({ type: "hotel", body: { checkin: "2026-04-24", checkout: "2026-04-27" } })],
    });
    const grid = buildCalendarGrid([job], 2026, 3);
    // Apr 24 = Fri, Apr 26 = Sun. Stay = Apr 24/25/26 (checkout=Apr27 excluded)
    // So span crosses week boundary: week of Apr19-25 has [Fri, Sat]; week of Apr26-May2 has [Sun].
    // Fri Apr 24 is column 5, Sat Apr 25 is column 6 in the Apr19-25 week.
    // Find the week indices
    const weekOfApr24 = grid.weeks.findIndex((w) => w.some((d) => d.date === "2026-04-24"));
    const weekOfApr26 = grid.weeks.findIndex((w) => w.some((d) => d.date === "2026-04-26"));
    expect(grid.weeklySpans[weekOfApr24]).toHaveLength(1);
    expect(grid.weeklySpans[weekOfApr24][0]).toMatchObject({
      jobId: "j1",
      startCol: 5, // Fri
      endCol: 6,   // Sat
      isStartWeek: true,
      isEndWeek: false,
    });
    expect(grid.weeklySpans[weekOfApr26]).toHaveLength(1);
    expect(grid.weeklySpans[weekOfApr26][0]).toMatchObject({
      jobId: "j1",
      startCol: 0, // Sun
      endCol: 0,
      isStartWeek: false,
      isEndWeek: true,
    });
    // None of the day cells should have hotel in their events list
    const apr24Cell = grid.weeks.flat().find((d) => d.date === "2026-04-24");
    expect(apr24Cell?.events).toHaveLength(0);
  });

  it("hotel stay within a single week produces one segment", () => {
    const job = makeJob({
      id: "j1",
      steps: [makeStep({ type: "hotel", body: { checkin: "2026-04-20", checkout: "2026-04-23" } })],
    });
    const grid = buildCalendarGrid([job], 2026, 3);
    // Apr 20 = Mon, Apr 22 = Wed. Stay = Mon/Tue/Wed (checkout=Thu excluded)
    const w = grid.weeks.findIndex((wk) => wk.some((d) => d.date === "2026-04-20"));
    expect(grid.weeklySpans[w]).toHaveLength(1);
    expect(grid.weeklySpans[w][0]).toMatchObject({
      startCol: 1, // Mon
      endCol: 3,   // Wed
      isStartWeek: true,
      isEndWeek: true,
      lane: 0,
    });
  });

  it("two overlapping hotel stays get different lanes", () => {
    const job1 = makeJob({
      id: "j1",
      steps: [makeStep({ type: "hotel", body: { checkin: "2026-04-20", checkout: "2026-04-23" } })],
    });
    const job2 = makeJob({
      id: "j2",
      steps: [makeStep({ type: "hotel", body: { checkin: "2026-04-21", checkout: "2026-04-24" } })],
    });
    const grid = buildCalendarGrid([job1, job2], 2026, 3);
    const w = grid.weeks.findIndex((wk) => wk.some((d) => d.date === "2026-04-20"));
    const segs = grid.weeklySpans[w];
    expect(segs).toHaveLength(2);
    // One on lane 0, one on lane 1
    expect(new Set(segs.map((s) => s.lane))).toEqual(new Set([0, 1]));
  });

  it("aggregates single-day events from multiple jobs onto the same day", () => {
    const job1 = makeJob({
      id: "j1",
      trip_label: "NY trip",
      steps: [makeStep({ type: "restaurant", body: { date: "2026-04-24", time: "19:00" } })],
    });
    const job2 = makeJob({
      id: "j2",
      trip_label: "Hamilton",
      steps: [makeStep({ type: "activity", body: { event_date: "2026-04-24T14:00:00" } })],
    });
    const grid = buildCalendarGrid([job1, job2], 2026, 3);
    const apr24 = grid.weeks.flat().find((d) => d.date === "2026-04-24");
    expect(apr24?.events).toHaveLength(2);
    // Sorted by time — 14:00 before 19:00
    expect(apr24?.events[0].jobId).toBe("j2");
    expect(apr24?.events[1].jobId).toBe("j1");
  });

  it("round-trip flight appears as two separate events on outbound + return dates", () => {
    const job = makeJob({
      id: "j1",
      steps: [
        makeStep({
          type: "flight",
          body: { date: "2026-04-24", returnDate: "2026-04-27", targetDepartureTime: "08:30" },
        }),
      ],
    });
    const grid = buildCalendarGrid([job], 2026, 3);
    const apr24 = grid.weeks.flat().find((d) => d.date === "2026-04-24");
    const apr27 = grid.weeks.flat().find((d) => d.date === "2026-04-27");
    expect(apr24?.events).toHaveLength(1);
    expect(apr27?.events).toHaveLength(1);
    expect(apr24?.events[0].event.slot).toBe("outbound");
    expect(apr27?.events[0].event.slot).toBe("return");
  });

  it("sorts timed single-day events by time within a day", () => {
    const job = makeJob({
      id: "j1",
      steps: [
        makeStep({ type: "restaurant", body: { date: "2026-04-24", time: "19:00" } }),
        makeStep({ type: "activity", body: { event_date: "2026-04-24T14:00:00" } }),
        makeStep({ type: "flight", body: { date: "2026-04-24", targetDepartureTime: "08:30" } }),
      ],
    });
    const grid = buildCalendarGrid([job], 2026, 3);
    const apr24 = grid.weeks.flat().find((d) => d.date === "2026-04-24")!;
    expect(apr24.events.map((e) => e.event.time)).toEqual(["08:30", "14:00", "19:00"]);
  });
});
