import { describe, expect, it } from "vitest";
import {
  NLU_ROUTING_FIXTURES,
  evaluateNluRoutingMatrix,
  renderNluRoutingMatrixMarkdown,
} from "../routing-matrix";

describe("NLU routing regression matrix", () => {
  it("keeps all current no-live routing fixtures green", () => {
    const results = evaluateNluRoutingMatrix();
    expect(results.map((result) => [result.id, result.pass, result.notes])).toEqual(
      results.map((result) => [result.id, true, []]),
    );
  });

  it("locks Lion King ticket requests to activity instead of trip-planner gaps", () => {
    const results = evaluateNluRoutingMatrix(
      NLU_ROUTING_FIXTURES.filter((fixture) => fixture.id.includes("lion-king")),
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
    const result = evaluateNluRoutingMatrix(
      NLU_ROUTING_FIXTURES.filter((fixture) => fixture.id === "zh-restaurant-japanese-complete"),
    )[0];

    expect(result.pass).toBe(true);
    expect(result.scenario).toBe("restaurant");
    expect(result.cuisine).toBe("Japanese");
  });

  it("renders a markdown summary for local no-live review", () => {
    const markdown = renderNluRoutingMatrixMarkdown(evaluateNluRoutingMatrix());
    expect(markdown).toContain("# NLU Routing Matrix");
    expect(markdown).toContain("zh-activity-lion-king-trip-shaped");
    expect(markdown).toContain("PASS");
  });
});
