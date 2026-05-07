import { beforeEach, describe, expect, it, vi } from "vitest";

import { runActivityPipeline } from "../agent/pipelines/activity";

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);
vi.stubEnv("SEATGEEK_CLIENT_ID", "sg-test");
vi.stubEnv("TICKETMASTER_API_KEY", "tm-test");

function makeResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
  });
}

function tmEvent(id: string, localDate: string) {
  return {
    id,
    name: "The Lion King",
    url: `https://www.ticketmaster.com/event/${id}`,
    dates: {
      start: { localDate, localTime: "19:00:00" },
      status: { code: "onsale" },
    },
    _embedded: {
      venues: [
        {
          name: "Minskoff Theatre",
          address: { line1: "200 W 45th St" },
          city: { name: "New York" },
        },
      ],
      attractions: [{ url: "https://www.ticketmaster.com/the-lion-king-tickets/artist/805961" }],
    },
    classifications: [{ genre: { name: "Theatre" } }],
    images: [{ url: "https://img.example.com/lion-king.jpg", width: 1024, ratio: "16_9" }],
  };
}

describe("runActivityPipeline nearby date fallback", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("seatgeek.com")) {
        return makeResponse({ events: [], meta: { total: 0 } });
      }
      if (url.includes("ticketmaster.com")) {
        return makeResponse({
          _embedded: {
            events: [
              tmEvent("Z7r9jZ1A7jJeb", "2026-05-31"),
              tmEvent("Z7r9jZ1A7jJ7w", "2026-06-02"),
            ],
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  });

  it("shows nearby show dates when the exact activity date has no provider matches", async () => {
    const result = await runActivityPipeline({
      category: "activity",
      event_type: "theater",
      event_name: "The Lion King",
      city: "New York, NY",
      date_from: "2026-06-01",
      date_to: "2026-06-01",
      num_tickets: 2,
    });

    expect(result.missing_fields).toEqual([]);
    expect(result.activityRecommendations.length).toBeGreaterThan(0);
    expect(result.activityRecommendations[0].activity.datetime_local).toMatch(/^2026-(05-31|06-02)/);
    expect(result.activityRecommendations[0].why_recommended).toContain("No exact 2026-06-01");
    expect(result.suggested_refinements[0]).toContain("showing nearby The Lion King dates");
  });
});
