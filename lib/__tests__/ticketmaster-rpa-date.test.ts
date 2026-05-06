import { describe, expect, it } from "vitest";

import {
  isTicketmasterTicketOptionsPage,
  parseTargetDateTime,
} from "@/lib/booking-autopilot/providers/ticketmaster-rpa";

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

  it("recognizes Ticketmaster event pages as user-review ticket options", () => {
    expect(isTicketmasterTicketOptionsPage("https://www.ticketmaster.com/event/Z7r9jZ1A7jJ7w")).toBe(true);
    expect(isTicketmasterTicketOptionsPage("https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581")).toBe(false);
  });
});
