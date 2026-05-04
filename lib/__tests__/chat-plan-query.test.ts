import { describe, expect, it } from "vitest";
import { buildPlanQueryFromConstraints } from "@/lib/chat-plan-query";

describe("buildPlanQueryFromConstraints", () => {
  it("preserves structured flight origin, destination, date, and passengers", () => {
    expect(
      buildPlanQueryFromConstraints("flight", {
        departure_city: "Orlando",
        arrival_city: "Nashville",
        departure_date: "2026-06-01",
        passengers: 1,
        cabin_class: "economy",
        is_round_trip: false,
      }),
    ).toBe("Find a flight from Orlando to Nashville on 2026-06-01 for 1 passenger in economy class one way");
  });

  it("accepts alternate flight constraint keys from older callers", () => {
    expect(
      buildPlanQueryFromConstraints("flight", {
        origin: "MCO",
        dest: "BNA",
        date: "2026-06-01",
        party_size: "2",
        prefer_direct: true,
      }),
    ).toBe("Find a flight from MCO to BNA on 2026-06-01 for 2 passengers nonstop if available");
  });

  it("does not drop destination-only flight constraints", () => {
    expect(
      buildPlanQueryFromConstraints("flight", {
        arrival_city: "Nashville",
        departure_date: "2026-06-01",
      }),
    ).toBe("Find a flight to Nashville on 2026-06-01");
  });

  it("keeps restaurant query behavior stable", () => {
    expect(
      buildPlanQueryFromConstraints("restaurant", {
        city: "New York",
        date: "2026-06-01",
        cuisine_hint: "Italian",
      }),
    ).toBe("Find a Italian restaurant in New York on 2026-06-01");
  });
});
