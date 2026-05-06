import { describe, expect, it } from "vitest";

import { formatActivityTaskDate } from "@/lib/activity-task-date";

describe("formatActivityTaskDate", () => {
  it("prefers structured local datetime and preserves year and time", () => {
    expect(
      formatActivityTaskDate({
        datetimeLocal: "2026-06-02T19:00:00",
        datetimeDisplay: "Tue, Jun 2, 7:00 PM",
      })
    ).toBe("June 2, 2026 at 7:00 PM");
  });

  it("formats date-only overrides with a full year", () => {
    expect(formatActivityTaskDate({ overrideDate: "2026-06-01" })).toBe(
      "June 1, 2026"
    );
  });

  it("falls back to display text only when no structured date exists", () => {
    expect(formatActivityTaskDate({ datetimeDisplay: "Tue, Jun 2, 7:00 PM" })).toBe(
      "Tue, Jun 2, 7:00 PM"
    );
  });
});
