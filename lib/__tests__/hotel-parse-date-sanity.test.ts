import { describe, expect, it } from "vitest";

import { bumpPastDateToNextOccurrence } from "@/lib/agent/parse/hotel";

describe("bumpPastDateToNextOccurrence — server-side past-date sanity", () => {
  // Bug 1 (P0): user says "5月20号" without year, MiniMax LLM defaults to 2023
  // even when prompt says today is 2026-05-05. SerpApi rejects past dates with
  // 400 → user sees "no hotels found" — false negative.
  //
  // Defense in depth: after the LLM returns dates, we validate them server-side.
  // If a returned date is strictly in the past relative to today, we bump it
  // forward by one year on the assumption the user meant the next occurrence
  // (this is what humans almost always mean when they omit a year).
  //
  // The pure helper makes this deterministic and testable without mocking the
  // LLM. parseHotelIntent calls it for both check_in and check_out.

  const today = new Date("2026-05-05T00:00:00.000Z");

  it("returns the date unchanged when it's in the future", () => {
    expect(bumpPastDateToNextOccurrence("2026-05-20", today)).toBe("2026-05-20");
    expect(bumpPastDateToNextOccurrence("2026-12-31", today)).toBe("2026-12-31");
    expect(bumpPastDateToNextOccurrence("2027-01-01", today)).toBe("2027-01-01");
  });

  it("returns today's date unchanged (same-day check-in is allowed)", () => {
    expect(bumpPastDateToNextOccurrence("2026-05-05", today)).toBe("2026-05-05");
  });

  it("bumps a clearly-past year forward to the next occurrence", () => {
    // The actual prod bug: MiniMax returned 2023-05-20 for "5月20号" on 2026-05-05.
    // After bumping, May 20 has not yet passed in 2026, so it should land on 2026-05-20.
    expect(bumpPastDateToNextOccurrence("2023-05-20", today)).toBe("2026-05-20");
    expect(bumpPastDateToNextOccurrence("2023-05-24", today)).toBe("2026-05-24");
  });

  it("bumps a date earlier this same year to next year", () => {
    // User on 2026-05-05 says "January 10" → LLM emits 2026-01-10.
    // 01-10 has already passed in 2026, so we shift to 2027-01-10.
    expect(bumpPastDateToNextOccurrence("2026-01-10", today)).toBe("2027-01-10");
  });

  it("handles year-rollover edge case across multiple past years", () => {
    // 2024-06-01 on 2026-05-05 → 2026-06-01 (June has not passed in 2026).
    expect(bumpPastDateToNextOccurrence("2024-06-01", today)).toBe("2026-06-01");
    // 2024-04-01 on 2026-05-05 → 2027-04-01 (April has passed in 2026).
    expect(bumpPastDateToNextOccurrence("2024-04-01", today)).toBe("2027-04-01");
  });

  it("returns the input unchanged when it is null / undefined / malformed", () => {
    expect(bumpPastDateToNextOccurrence(null, today)).toBeNull();
    expect(bumpPastDateToNextOccurrence(undefined, today)).toBeUndefined();
    expect(bumpPastDateToNextOccurrence("", today)).toBe("");
    expect(bumpPastDateToNextOccurrence("not a date", today)).toBe("not a date");
    expect(bumpPastDateToNextOccurrence("2026-13-40", today)).toBe("2026-13-40");
  });
});
