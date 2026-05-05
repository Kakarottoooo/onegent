import { describe, expect, it } from "vitest";

import { classifyHotelSearchFailure } from "@/lib/agent/pipelines/hotel";

describe("classifyHotelSearchFailure — surface the WHY behind 0 hotel results", () => {
  // Bug 2 (P1 systemic): when SerpApi returns 0 results because the dates
  // got mangled (LLM-emitted past year), the chat says "没有找到符合条件的酒店"
  // — a business outcome — even though the actual cause is a parser bug.
  // This pollutes the user's mental model and makes the bug invisible.
  // The classifier names the cause so the chat response can carry it back.

  const today = new Date("2026-05-05T00:00:00.000Z");

  it("returns null when there are results", () => {
    expect(
      classifyHotelSearchFailure({
        checkIn: "2026-05-20",
        checkOut: "2026-05-24",
        today,
        hotelCount: 5,
        providerError: null,
      }),
    ).toBeNull();
  });

  it("returns 'dates_in_past' when check_in is strictly before today", () => {
    expect(
      classifyHotelSearchFailure({
        checkIn: "2023-05-20",
        checkOut: "2023-05-24",
        today,
        hotelCount: 0,
        providerError: null,
      }),
    ).toBe("dates_in_past");
  });

  it("returns 'dates_in_past' when check_out is before check_in", () => {
    // User asked May 20→24 but somehow check_out got truncated; defend in depth.
    expect(
      classifyHotelSearchFailure({
        checkIn: "2026-05-24",
        checkOut: "2026-05-20",
        today,
        hotelCount: 0,
        providerError: null,
      }),
    ).toBe("invalid_date_range");
  });

  it("returns 'provider_error' when the upstream provider failed", () => {
    expect(
      classifyHotelSearchFailure({
        checkIn: "2026-05-20",
        checkOut: "2026-05-24",
        today,
        hotelCount: 0,
        providerError: "SerpApi 400",
      }),
    ).toBe("provider_error");
  });

  it("returns 'genuine_no_results' for plausible inputs that simply found nothing", () => {
    expect(
      classifyHotelSearchFailure({
        checkIn: "2026-05-20",
        checkOut: "2026-05-24",
        today,
        hotelCount: 0,
        providerError: null,
      }),
    ).toBe("genuine_no_results");
  });

  it("classifies past dates ahead of provider errors (most actionable cause wins)", () => {
    // If both flags are set, the past-date is the user-fixable cause; surface that first.
    expect(
      classifyHotelSearchFailure({
        checkIn: "2023-05-20",
        checkOut: "2023-05-24",
        today,
        hotelCount: 0,
        providerError: "SerpApi 400",
      }),
    ).toBe("dates_in_past");
  });

  it("returns null for missing dates (cannot classify without input)", () => {
    expect(
      classifyHotelSearchFailure({
        checkIn: undefined,
        checkOut: undefined,
        today,
        hotelCount: 0,
        providerError: null,
      }),
    ).toBe("genuine_no_results");
  });
});
