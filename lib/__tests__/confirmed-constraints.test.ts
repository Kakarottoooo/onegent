import { describe, expect, it } from "vitest";

import {
  buildConfirmedHotelIntent,
  buildConfirmedIntentFromConstraints,
  buildConfirmedQueryContext,
} from "@/lib/agent/confirmed-constraints";

describe("confirmed constraints", () => {
  const hotelConstraints = {
    city: "New York",
    check_in: "2026-05-20",
    check_out: "2026-05-24",
    budget_per_night: 300,
    guests: 2,
  };

  it("builds a hotel intent from confirmed card fields without reparsing text", () => {
    const intent = buildConfirmedHotelIntent(hotelConstraints, "New York, NY");

    expect(intent).toMatchObject({
      category: "hotel",
      location: "New York",
      check_in: "2026-05-20",
      check_out: "2026-05-24",
      nights: 4,
      guests: 2,
      budget_per_person: 300,
    });
  });

  it("accepts alternate confirm-card keys from older payloads", () => {
    const intent = buildConfirmedHotelIntent(
      {
        location: "New York",
        date_from: "2026-05-20",
        date_to: "2026-05-24",
        budget_max: "300",
        travelers: "1",
      },
      "New York, NY",
    );

    expect(intent.location).toBe("New York");
    expect(intent.check_in).toBe("2026-05-20");
    expect(intent.check_out).toBe("2026-05-24");
    expect(intent.nights).toBe(4);
    expect(intent.guests).toBe(1);
    expect(intent.budget_per_person).toBe(300);
  });

  it("returns a confirmed hotel intent only for the hotel category", () => {
    expect(
      buildConfirmedIntentFromConstraints("hotel", hotelConstraints, "New York, NY"),
    ).toMatchObject({ category: "hotel", location: "New York" });

    expect(
      buildConfirmedIntentFromConstraints("restaurant", hotelConstraints, "New York, NY"),
    ).toBeNull();
  });

  it("builds a lightweight query context from confirmed fields", () => {
    const context = buildConfirmedQueryContext(
      "帮我订一个5月20号到24号的纽约酒店，预算300一天",
      "hotel",
      hotelConstraints,
      "New York, NY",
    );

    expect(context).toMatchObject({
      input_language: "zh",
      output_language: "zh",
      category_hint: "hotel",
      location_hint: "New York",
      date_text_hint: "2026-05-20",
    });
  });
});
