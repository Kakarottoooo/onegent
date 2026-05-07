import { describe, expect, it } from "vitest";
import { applyCategoryHintOverride } from "@/lib/agent";
import type { MultilingualQueryContext } from "@/lib/types";

function context(overrides: Partial<MultilingualQueryContext> = {}): MultilingualQueryContext {
  return {
    input_language: "zh",
    output_language: "zh",
    normalized_query: "book The Lion King on Broadway in New York on June 1",
    intent_summary: "book a Broadway show",
    category_hint: null,
    scenario_hint: "city_trip",
    location_hint: "New York, NY",
    ...overrides,
  };
}

describe("applyCategoryHintOverride", () => {
  it("pins activity handoffs away from stale city-trip scenario hints", () => {
    const queryContext = context();

    applyCategoryHintOverride(queryContext, "activity");

    expect(queryContext.category_hint).toBe("activity");
    expect(queryContext.scenario_hint).toBeNull();
  });

  it("does not clear non-activity scenario hints", () => {
    const queryContext = context({ scenario_hint: "date_night" });

    applyCategoryHintOverride(queryContext, "restaurant");

    expect(queryContext.category_hint).toBe("restaurant");
    expect(queryContext.scenario_hint).toBe("date_night");
  });
});
