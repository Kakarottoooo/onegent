import { describe, expect, it } from "vitest";
import {
  NLU_ROUTING_FIXTURES,
  NLU_ROUTING_MATRIX_SCOPE,
  NLU_ROUTING_MATRIX_TODO,
  evaluateNluRoutingMatrix,
  renderNluRoutingMatrixMarkdown,
} from "../routing-matrix";

describe("NLU routing regression matrix", () => {
  it("has broad no-live coverage across verticals and request styles", () => {
    expect(NLU_ROUTING_FIXTURES.length).toBeGreaterThanOrEqual(50);
    expect(new Set(NLU_ROUTING_FIXTURES.map((fixture) => fixture.rawState.scenario))).toEqual(
      new Set(["restaurant", "hotel", "flight", "activity", "trip", null]),
    );
    expect(NLU_ROUTING_MATRIX_SCOPE).toContain("prebuilt IntentState");
    expect(NLU_ROUTING_MATRIX_TODO).toContain("extractor fixtures");
  });

  it("keeps all current no-live routing fixtures green", () => {
    const results = evaluateNluRoutingMatrix();
    expect(results.map((result) => [result.id, result.pass, result.notes])).toEqual(
      results.map((result) => [result.id, true, []]),
    );
  });

  it("locks Lion King ticket requests to activity instead of trip-planner gaps", () => {
    const results = evaluateNluRoutingMatrix(
      NLU_ROUTING_FIXTURES.filter((fixture) => fixture.id.endsWith("lion-king-trip-shaped")),
    );

    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.scenario).toBe("activity");
      expect(result.actionType).toBe("show_confirm_card");
      expect(result.kind).toBe("plan");
      expect(result.notes.join(" ")).not.toMatch(/end_date|nights|travelers/);
    }
  });

  it("preserves restaurant cuisine as a strong planner constraint", () => {
    const [japanese, chinese] = evaluateNluRoutingMatrix(
      NLU_ROUTING_FIXTURES.filter((fixture) =>
        ["zh-restaurant-japanese-complete", "zh-restaurant-chinese-complete"].includes(fixture.id),
      ),
    );

    expect(japanese.pass).toBe(true);
    expect(japanese.scenario).toBe("restaurant");
    expect(japanese.constraints.restaurant?.cuisine).toBe("Japanese");
    expect(chinese.pass).toBe(true);
    expect(chinese.scenario).toBe("restaurant");
    expect(chinese.constraints.restaurant?.cuisine).toBe("Chinese");
  });

  it("covers hotel date and budget parsing as preserved constraints", () => {
    const result = evaluateNluRoutingMatrix(
      NLU_ROUTING_FIXTURES.filter((fixture) => fixture.id === "zh-hotel-complete"),
    )[0];

    expect(result.pass).toBe(true);
    expect(result.scenario).toBe("hotel");
    expect(result.constraints.hotel).toMatchObject({
      city: "New York",
      check_in: "2026-05-20",
      check_out: "2026-05-24",
      budget_max_per_night: 300,
    });
  });

  it("keeps single-vertical requests out of trip missing-field behavior", () => {
    const results = evaluateNluRoutingMatrix(
      NLU_ROUTING_FIXTURES.filter((fixture) =>
        [
          "zh-restaurant-japanese-complete",
          "zh-hotel-complete",
          "zh-flight-complete",
          "en-activity-lion-king-trip-shaped",
        ].includes(fixture.id),
      ),
    );

    for (const result of results) {
      expect(result.scenario).not.toBe("trip");
      expect(result.notes.join(" ")).not.toMatch(/date_range|traveler_count|end_date|nights/);
    }
  });

  it("renders a markdown summary for local no-live review", () => {
    const markdown = renderNluRoutingMatrixMarkdown(evaluateNluRoutingMatrix());
    expect(markdown).toContain("# NLU Routing Matrix");
    expect(markdown).toContain("No-live router/normalizer fixtures only");
    expect(markdown).toContain("Extractor Coverage Gap");
    expect(markdown).toContain("zh-activity-lion-king-trip-shaped");
    expect(markdown).toContain("PASS");
  });
});
