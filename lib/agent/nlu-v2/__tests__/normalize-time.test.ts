/**
 * Unit tests for normalizeTime — the coerce-layer safety net that turns
 * "now" / "asap" / Chinese equivalents into the current HH:MM so "now"
 * doesn't leak to downstream restaurant planners as a literal string.
 *
 * Pairs with the extractor prompt rule added in the same change (prompt
 * tells the model to emit HH:MM; this is the belt-and-suspenders).
 */

import { describe, it, expect } from "vitest";
import { normalizeTime, buildWeekdayLookup } from "../extractor";

describe("normalizeTime", () => {
  it("passes HH:MM through unchanged", () => {
    expect(normalizeTime("19:00")).toBe("19:00");
    expect(normalizeTime("7:30")).toBe("7:30");
    expect(normalizeTime("00:00")).toBe("00:00");
  });

  it("converts 'now' variants to current HH:MM", () => {
    const out = normalizeTime("now");
    expect(out).toMatch(/^\d{2}:\d{2}$/);
    expect(normalizeTime("NOW")).toMatch(/^\d{2}:\d{2}$/);
    expect(normalizeTime("right now")).toMatch(/^\d{2}:\d{2}$/);
    expect(normalizeTime("asap")).toMatch(/^\d{2}:\d{2}$/);
    expect(normalizeTime("ASAP")).toMatch(/^\d{2}:\d{2}$/);
    expect(normalizeTime("immediately")).toMatch(/^\d{2}:\d{2}$/);
  });

  it("converts Chinese 'now' equivalents", () => {
    expect(normalizeTime("现在")).toMatch(/^\d{2}:\d{2}$/);
    expect(normalizeTime("立刻")).toMatch(/^\d{2}:\d{2}$/);
    expect(normalizeTime("马上")).toMatch(/^\d{2}:\d{2}$/);
  });

  it("returns undefined for empty / non-string input", () => {
    expect(normalizeTime(undefined)).toBeUndefined();
    expect(normalizeTime("")).toBeUndefined();
    expect(normalizeTime("   ")).toBeUndefined();
    expect(normalizeTime(null)).toBeUndefined();
    expect(normalizeTime(42)).toBeUndefined();
  });

  it("leaves unrecognized strings as-is (trimmed)", () => {
    // The prompt tells the model to emit HH:MM, but if it emits "7pm" we
    // don't want to destructively drop info — pass through for downstream.
    expect(normalizeTime("7pm")).toBe("7pm");
    expect(normalizeTime("  19時  ")).toBe("19時");
    expect(normalizeTime("dinner")).toBe("dinner");
  });
});

describe("buildWeekdayLookup", () => {
  // Use local-TZ Date constructor (YYYY, MM-1, DD) so tests are stable
  // regardless of what TZ the machine is in. The function under test
  // intentionally uses local-TZ getters to match the server/user clock.

  it("anchored on Wed 2026-04-22, Friday row is 2026-04-24", () => {
    // Reproduces the production bug: user said "this Friday" on Wed 4/22,
    // v2 returned 4/25 (Saturday). Table must make Friday row unambiguous.
    const wed = new Date(2026, 3, 22, 12, 0, 0); // April 22 2026, noon local
    const table = buildWeekdayLookup(wed);
    expect(table).toContain("2026-04-22 (Wednesday) — (today)");
    expect(table).toContain("2026-04-23 (Thursday) — tomorrow");
    expect(table).toContain("2026-04-24 (Friday) — this Friday");
    expect(table).toContain("2026-04-25 (Saturday) — this Saturday");
    expect(table).toContain("2026-04-26 (Sunday) — this Sunday");
  });

  it("correctly labels 'next <Weekday>' starting at offset 7", () => {
    const wed = new Date(2026, 3, 22, 12, 0, 0);
    const table = buildWeekdayLookup(wed);
    expect(table).toContain("2026-04-29 (Wednesday) — next Wednesday / a week from today");
    expect(table).toContain("2026-05-01 (Friday) — next Friday");
    expect(table).toContain("2026-05-02 (Saturday) — next Saturday");
  });

  it("emits exactly 14 rows", () => {
    const anchor = new Date(2026, 3, 22, 12, 0, 0);
    const table = buildWeekdayLookup(anchor);
    expect(table.split("\n")).toHaveLength(14);
  });

  it("handles year boundary (anchor late December)", () => {
    const dec29 = new Date(2026, 11, 29, 12, 0, 0); // Dec is month 11 (0-indexed)
    const table = buildWeekdayLookup(dec29);
    expect(table).toContain("2026-12-29");
    expect(table).toContain("2027-01-01"); // crosses into next year
  });
});
