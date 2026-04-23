/**
 * Unit tests for itinerary extraction — verifies each step type produces the
 * right events and that day-grouping + sort is stable.
 *
 * BookingJobStep is cast through `as any` in the test fixtures because the
 * full interface has ~20 runtime fields we don't populate; the extractor
 * only reads a small set per type.
 */

import { describe, it, expect } from "vitest";
import {
  buildItineraryDayGroups,
  extractStepEvents,
  type ItineraryEvent,
} from "../itinerary";
import type { BookingJobStep } from "../db";

// ─── Fixture helpers ────────────────────────────────────────────────────

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

// ─── Per-type extractor tests ───────────────────────────────────────────

describe("extractStepEvents — hotel", () => {
  it("produces a single check-in event with nights badge", () => {
    const step = makeStep({
      type: "hotel",
      label: "Four Seasons",
      body: { checkin: "2026-05-02", checkout: "2026-05-05" },
    });
    const events = extractStepEvents(step, 0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      date: "2026-05-02",
      slot: "checkin",
      badge: "3 nights",
      time: undefined,
    });
  });

  it("handles single-night stay", () => {
    const step = makeStep({
      type: "hotel",
      body: { checkin: "2026-05-02", checkout: "2026-05-03" },
    });
    const [ev] = extractStepEvents(step, 0);
    expect(ev.badge).toBe("1 night");
  });

  it("omits badge when checkout missing", () => {
    const step = makeStep({
      type: "hotel",
      body: { checkin: "2026-05-02" },
    });
    const [ev] = extractStepEvents(step, 0);
    expect(ev.badge).toBeUndefined();
  });

  it("returns empty when checkin missing", () => {
    const step = makeStep({ type: "hotel", body: {} });
    expect(extractStepEvents(step, 0)).toEqual([]);
  });
});

describe("extractStepEvents — flight", () => {
  it("one-way: single outbound event with time", () => {
    const step = makeStep({
      type: "flight",
      body: {
        date: "2026-05-02",
        targetDepartureTime: "08:30",
        origin: "SFO",
        dest: "JFK",
      },
    });
    const events = extractStepEvents(step, 0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      date: "2026-05-02",
      time: "08:30",
      slot: "outbound",
      badge: undefined, // no round-trip, no badge
    });
  });

  it("round-trip: emits outbound + return events", () => {
    const step = makeStep({
      type: "flight",
      body: {
        date: "2026-05-02",
        returnDate: "2026-05-05",
        targetDepartureTime: "08:30 AM",
      },
    });
    const events = extractStepEvents(step, 0);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ date: "2026-05-02", slot: "outbound", badge: "outbound", time: "08:30 AM" });
    expect(events[1]).toMatchObject({ date: "2026-05-05", slot: "return", badge: "return", time: undefined });
  });
});

describe("extractStepEvents — restaurant", () => {
  it("uses body.time when no fallback applied", () => {
    const step = makeStep({
      type: "restaurant",
      body: { date: "2026-05-02", time: "19:00" },
    });
    const [ev] = extractStepEvents(step, 0);
    expect(ev).toMatchObject({ date: "2026-05-02", time: "19:00", slot: "meal" });
  });

  it("prefers runtime selected_time (time fallback succeeded)", () => {
    const step = makeStep({
      type: "restaurant",
      selected_time: "19:30",
      body: { date: "2026-05-02", time: "19:00" },
    });
    const [ev] = extractStepEvents(step, 0);
    expect(ev.time).toBe("19:30");
  });
});

describe("extractStepEvents — activity", () => {
  it("date-only event_date → no time", () => {
    const step = makeStep({
      type: "activity",
      body: { event_date: "2026-05-02" },
    });
    const [ev] = extractStepEvents(step, 0);
    expect(ev).toMatchObject({ date: "2026-05-02", time: undefined, slot: "show" });
  });

  it("ISO datetime event_date → parses time from the T-split", () => {
    const step = makeStep({
      type: "activity",
      body: { event_date: "2026-05-02T19:00:00" },
    });
    const [ev] = extractStepEvents(step, 0);
    expect(ev.date).toBe("2026-05-02");
    expect(ev.time).toBe("19:00");
  });
});

// ─── Day-grouping + sort ───────────────────────────────────────────────

describe("buildItineraryDayGroups", () => {
  it("groups events by date and sorts by time within each day", () => {
    const steps: BookingJobStep[] = [
      makeStep({ type: "flight", body: { date: "2026-05-02", targetDepartureTime: "08:30" } }),
      makeStep({ type: "hotel", body: { checkin: "2026-05-02", checkout: "2026-05-05" } }),
      makeStep({ type: "restaurant", body: { date: "2026-05-02", time: "19:00" } }),
      makeStep({ type: "activity", body: { event_date: "2026-05-02T14:00:00" } }),
      makeStep({ type: "activity", body: { event_date: "2026-05-04T20:00:00" } }),
    ];
    const groups = buildItineraryDayGroups(steps);
    expect(groups).toHaveLength(2);
    // May 2 — 4 events: flight 08:30, activity 14:00, restaurant 19:00, hotel (untimed → last)
    expect(groups[0].date).toBe("2026-05-02");
    expect(groups[0].events.map((e) => e.time)).toEqual(["08:30", "14:00", "19:00", undefined]);
    // May 4 — single event
    expect(groups[1].date).toBe("2026-05-04");
    expect(groups[1].events).toHaveLength(1);
  });

  it("drops days that have no events by default (e.g. middle nights of a hotel stay)", () => {
    const steps: BookingJobStep[] = [
      makeStep({ type: "hotel", body: { checkin: "2026-05-02", checkout: "2026-05-05" } }),
      makeStep({ type: "flight", body: { date: "2026-05-02", returnDate: "2026-05-05" } }),
    ];
    const groups = buildItineraryDayGroups(steps);
    // Only dates with events — May 3/4 (middle nights) are skipped
    expect(groups.map((g) => g.date)).toEqual(["2026-05-02", "2026-05-05"]);
  });

  it("fillEmptyDays=true emits every day in the span, including gaps", () => {
    const steps: BookingJobStep[] = [
      makeStep({ type: "hotel", body: { checkin: "2026-05-02", checkout: "2026-05-05" } }),
      makeStep({ type: "flight", body: { date: "2026-05-02", returnDate: "2026-05-05" } }),
    ];
    const groups = buildItineraryDayGroups(steps, { fillEmptyDays: true });
    expect(groups.map((g) => g.date)).toEqual([
      "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
    ]);
    // Middle days have no events
    expect(groups[1].events).toEqual([]);
    expect(groups[2].events).toEqual([]);
  });

  it("fillEmptyDays respects maxSpanDays ceiling — bails out on absurd spans", () => {
    const steps: BookingJobStep[] = [
      // 30-day hotel stay
      makeStep({ type: "hotel", body: { checkin: "2026-05-01", checkout: "2026-05-31" } }),
      makeStep({ type: "flight", body: { date: "2026-05-01", returnDate: "2026-05-31" } }),
    ];
    const groups = buildItineraryDayGroups(steps, { fillEmptyDays: true, maxSpanDays: 14 });
    // Bailed out — only dates with real events
    expect(groups.map((g) => g.date)).toEqual(["2026-05-01", "2026-05-31"]);
  });

  it("header includes weekday", () => {
    // 2026-05-02 is a Saturday
    const groups = buildItineraryDayGroups([
      makeStep({ type: "restaurant", body: { date: "2026-05-02", time: "19:00" } }),
    ]);
    expect(groups[0].header).toMatch(/Saturday/);
    expect(groups[0].header).toContain("May");
  });

  it("sorts timed events across 12-hour AM/PM mix", () => {
    const steps: BookingJobStep[] = [
      makeStep({ type: "flight", body: { date: "2026-05-02", targetDepartureTime: "9:00 PM" } }),
      makeStep({ type: "flight", body: { date: "2026-05-02", targetDepartureTime: "11:00 AM" } }),
      makeStep({ type: "flight", body: { date: "2026-05-02", targetDepartureTime: "6:00 AM" } }),
    ];
    const [{ events }] = buildItineraryDayGroups(steps);
    expect(events.map((e: ItineraryEvent) => e.time)).toEqual(["6:00 AM", "11:00 AM", "9:00 PM"]);
  });
});
