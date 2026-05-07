import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCalendarRecommendationContext } from "@/lib/calendar-recommendation-context";
import { syncGoogleCalendarEvents } from "@/lib/calendar-service";

vi.mock("@/lib/calendar-service", () => ({
  syncGoogleCalendarEvents: vi.fn(),
}));

const mockedSync = vi.mocked(syncGoogleCalendarEvents);

describe("loadCalendarRecommendationContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats calendar sync failures as optional context misses", async () => {
    mockedSync.mockRejectedValueOnce(new Error("Token has been expired or revoked."));

    await expect(
      loadCalendarRecommendationContext({
        userId: "user_123",
        dateText: "2026-05-30",
        durationMinutes: 180,
      }),
    ).resolves.toBeNull();
  });

  it("returns null when the connected calendar has no relevant events", async () => {
    mockedSync.mockResolvedValueOnce({
      connected: true,
      events: [],
      calendarTimeZone: "America/New_York",
    });

    await expect(
      loadCalendarRecommendationContext({
        userId: "user_123",
        dateText: "2026-05-30",
        durationMinutes: 180,
      }),
    ).resolves.toBeNull();
  });
});
