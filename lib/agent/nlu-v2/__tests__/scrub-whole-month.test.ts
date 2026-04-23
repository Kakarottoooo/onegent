/**
 * Unit tests for scrubWholeMonthAssumption — the guard that catches the
 * "user said 'next month' → extractor filled the whole month" trap.
 *
 * The scrub function must fire only when BOTH conditions hold:
 *   1. The state has a ≥25-day trip window (nights or end-start delta).
 *   2. The user's text mentioned a bare month cue AND no explicit duration.
 *
 * So "Go to Paris for a month" stays intact, but "Go to Paris next month"
 * (with nights=30 from an over-eager model) gets scrubbed.
 */

import { describe, it, expect } from "vitest";
import { scrubWholeMonthAssumption } from "../extractor";
import type { IntentState } from "../types";

const tripState = (trip: Partial<NonNullable<IntentState["trip"]>> = {}): IntentState => ({
  confidence: 0.9,
  turn_count: 1,
  updated_at: "2026-04-22T00:00:00Z",
  intent: "create_plan",
  scenario: "trip",
  party_type: "solo",
  member_names: [],
  refined_target_id: null,
  planning_assumptions: [],
  trip: {
    activities: [],
    cuisine_preferences: [],
    vibe: "mixed",
    planning_assumptions: [],
    ...trip,
  },
});

describe("scrubWholeMonthAssumption", () => {
  it("scrubs nights=30 when user said 'next month' with no duration", () => {
    const state = tripState({
      destination_city: "Tokyo",
      start_date: "2026-05-01",
      end_date: "2026-05-31",
      nights: 30,
    });
    const out = scrubWholeMonthAssumption(state, [], "I wanna go to Tokyo next month");
    expect(out.trip?.nights).toBeUndefined();
    expect(out.trip?.start_date).toBeUndefined();
    expect(out.trip?.end_date).toBeUndefined();
    expect(out.trip?.destination_city).toBe("Tokyo"); // other fields intact
    expect(out.planning_assumptions.some((a) => a.includes("Bare month"))).toBe(true);
  });

  it("scrubs Chinese '下个月' with no duration", () => {
    const state = tripState({
      destination_city: "Los Angeles",
      start_date: "2026-05-01",
      end_date: "2026-05-31",
      nights: 30,
    });
    const out = scrubWholeMonthAssumption(state, [], "下个月去洛杉矶");
    expect(out.trip?.nights).toBeUndefined();
    expect(out.trip?.start_date).toBeUndefined();
  });

  it("preserves 'for a month' (explicit duration)", () => {
    const state = tripState({
      destination_city: "Paris",
      start_date: "2026-05-01",
      end_date: "2026-05-31",
      nights: 30,
    });
    const out = scrubWholeMonthAssumption(state, [], "Go to Paris for a month");
    expect(out.trip?.nights).toBe(30);
    expect(out.trip?.start_date).toBe("2026-05-01");
  });

  it("preserves '下个月 + 5 天' (explicit duration)", () => {
    const state = tripState({
      destination_city: "Tokyo",
      start_date: "2026-05-10",
      end_date: "2026-05-15",
      nights: 5,
    });
    const out = scrubWholeMonthAssumption(state, [], "下个月去东京玩 5 天");
    expect(out.trip?.nights).toBe(5);
    expect(out.trip?.start_date).toBe("2026-05-10");
  });

  it("preserves 'for 7 days next month' (explicit duration)", () => {
    const state = tripState({
      destination_city: "Tokyo",
      start_date: "2026-05-10",
      end_date: "2026-05-17",
      nights: 7,
    });
    const out = scrubWholeMonthAssumption(state, [], "I wanna go to Tokyo next month for 7 days");
    expect(out.trip?.nights).toBe(7);
  });

  it("preserves short trips even with 'next month' (span < 25)", () => {
    const state = tripState({
      destination_city: "NYC",
      start_date: "2026-05-02",
      end_date: "2026-05-05",
      nights: 3,
    });
    const out = scrubWholeMonthAssumption(state, [], "NYC trip next month");
    expect(out.trip?.nights).toBe(3);
  });

  it("scrubs when cue is in history, not the new message", () => {
    const state = tripState({
      destination_city: "Paris",
      start_date: "2026-05-01",
      end_date: "2026-05-31",
      nights: 30,
    });
    const history = [
      { role: "user" as const, content: "I wanna go to Paris next month" },
      { role: "assistant" as const, content: "Sure! Where from and how many people?" },
    ];
    const out = scrubWholeMonthAssumption(state, history, "2 people from SFO");
    expect(out.trip?.nights).toBeUndefined();
  });

  it("no-op for non-trip scenarios", () => {
    const state: IntentState = {
      confidence: 0.9,
      turn_count: 1,
      updated_at: "2026-04-22T00:00:00Z",
      intent: "create_plan",
      scenario: "hotel",
      party_type: "solo",
      member_names: [],
      refined_target_id: null,
      planning_assumptions: [],
      hotel: {
        city: "Paris",
        check_in: "2026-05-01",
        check_out: "2026-05-31",
        nights: 30,
      },
    };
    const out = scrubWholeMonthAssumption(state, [], "hotel in Paris next month");
    expect(out).toEqual(state); // unchanged
  });

  it("preserves 'in April' alone if no ≥25-day span", () => {
    const state = tripState({
      destination_city: "Paris",
      start_date: "2026-04-10",
      end_date: "2026-04-17",
      nights: 7,
    });
    const out = scrubWholeMonthAssumption(state, [], "trip to Paris in April");
    expect(out.trip?.nights).toBe(7);
  });

  it("scrubs 'in April' with full-month span", () => {
    const state = tripState({
      destination_city: "Paris",
      start_date: "2026-04-01",
      end_date: "2026-04-30",
      nights: 29,
    });
    const out = scrubWholeMonthAssumption(state, [], "trip to Paris in April");
    expect(out.trip?.nights).toBeUndefined();
  });
});
