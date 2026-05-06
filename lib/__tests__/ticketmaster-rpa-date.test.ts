import { describe, expect, it } from "vitest";

import { parseTargetDateTime } from "@/lib/booking-autopilot/providers/ticketmaster-rpa";

describe("Ticketmaster target date parsing", () => {
  it("parses full activity task dates with year and time", () => {
    expect(
      parseTargetDateTime('Book tickets for "The Lion King - New York" on June 2, 2026 at 7:00 PM.')
    ).toMatchObject({
      monthName: "June",
      monthIndex: 5,
      day: 2,
      year: 2026,
      time: "7:00 PM",
    });
  });

  it("parses ISO event dates and keeps nearby task time", () => {
    expect(
      parseTargetDateTime('Target performance date: 2026-06-02. Preferred time: 7:00 PM.')
    ).toMatchObject({
      monthName: "June",
      monthIndex: 5,
      day: 2,
      year: 2026,
      time: "7:00 PM",
    });
  });

  it("does not pretend abbreviated dateless display text has a target year", () => {
    expect(parseTargetDateTime("Tue, Jun 2, 7:00 PM")).toBeNull();
  });
});
