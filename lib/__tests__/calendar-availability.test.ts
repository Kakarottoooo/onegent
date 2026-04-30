import { describe, expect, it } from "vitest";
import {
  buildBusyCountsByDay,
  buildExternalEventsByDay,
  suggestNextFreeWindow,
  summarizeTripConflicts,
} from "@/lib/calendar-availability";

describe("calendar availability helpers", () => {
  it("counts busy blocks by overlapping day", () => {
    const counts = buildBusyCountsByDay(
      [
        { start_at: "2026-05-03T15:00:00Z", end_at: "2026-05-03T16:00:00Z" },
        { start_at: "2026-05-03T18:00:00Z", end_at: "2026-05-03T19:00:00Z" },
        { start_at: "2026-05-04T23:00:00Z", end_at: "2026-05-05T02:00:00Z" },
      ],
      "2026-05-01",
      "2026-05-06",
    );
    expect(counts["2026-05-03"]).toBe(2);
    expect(counts["2026-05-04"]).toBe(1);
    expect(counts["2026-05-05"]).toBe(1);
  });

  it("summarizes trip conflicts and suggests the next free window", () => {
    const slots = [
      { start_at: "2026-05-10T13:00:00Z", end_at: "2026-05-10T16:00:00Z" },
      { start_at: "2026-05-11T13:00:00Z", end_at: "2026-05-11T16:00:00Z" },
    ];
    const summary = summarizeTripConflicts(slots, "2026-05-10", "2026-05-12");
    expect(summary.conflictCount).toBe(2);
    expect(summary.busyDays).toBe(2);

    const suggestion = suggestNextFreeWindow({
      slots,
      startDate: "2026-05-10",
      nights: 2,
      searchDays: 7,
    });
    expect(suggestion).toEqual({ from: "2026-05-12", to: "2026-05-14" });
  });

  it("expands detailed external events by day", () => {
    const events = buildExternalEventsByDay(
      [
        {
          id: "evt-1",
          user_id: "u1",
          provider: "google",
          connection_id: "conn-1",
          external_event_id: "g-1",
          source_calendar_id: "primary",
          source_calendar_name: "Primary",
          title: "Play tennis",
          event_url: "https://calendar.google.com/event?1",
          start_at: "2026-05-01T12:30:00Z",
          end_at: "2026-05-01T13:30:00Z",
          start_date: null,
          end_date: null,
          is_all_day: false,
          color_hex: "#4285F4",
          status: "confirmed",
          created_at: "2026-04-29T00:00:00Z",
        },
        {
          id: "evt-2",
          user_id: "u1",
          provider: "google",
          connection_id: "conn-1",
          external_event_id: "g-2",
          source_calendar_id: "holidays",
          source_calendar_name: "Holidays",
          title: "Labour Day",
          event_url: null,
          start_at: "2026-05-01T00:00:00Z",
          end_at: "2026-05-02T00:00:00Z",
          start_date: "2026-05-01",
          end_date: "2026-05-02",
          is_all_day: true,
          color_hex: "#34A853",
          status: "confirmed",
          created_at: "2026-04-29T00:00:00Z",
        },
      ],
      "2026-05-01",
      "2026-05-03",
      "UTC",
    );

    expect(events["2026-05-01"]).toHaveLength(2);
    expect(events["2026-05-01"]?.[0]?.title).toBe("Labour Day");
    expect(events["2026-05-01"]?.[0]?.timeLabel).toBe("All day");
    expect(events["2026-05-01"]?.[1]?.title).toBe("Play tennis");
  });

  it("accepts date objects from the database for all-day events", () => {
    const events = buildExternalEventsByDay(
      [
        {
          id: "evt-3",
          user_id: "u1",
          provider: "google",
          connection_id: "conn-1",
          external_event_id: "g-3",
          source_calendar_id: "primary",
          source_calendar_name: "Primary",
          title: "Holiday",
          event_url: null,
          start_at: "2026-05-03T00:00:00Z",
          end_at: "2026-05-04T00:00:00Z",
          start_date: new Date("2026-05-03T00:00:00Z"),
          end_date: new Date("2026-05-04T00:00:00Z"),
          is_all_day: true,
          color_hex: "#34A853",
          status: "confirmed",
          created_at: "2026-04-29T00:00:00Z",
        },
      ],
      "2026-05-01",
      "2026-05-05",
      "UTC",
    );

    expect(events["2026-05-03"]).toHaveLength(1);
    expect(events["2026-05-03"]?.[0]?.timeLabel).toBe("All day");
  });
});
