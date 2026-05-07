import { describe, expect, it } from "vitest";
import {
  CAPTURE_BENCHMARK_FIXTURES,
  evaluateCaptureBenchmarkGate,
  renderCaptureBenchmarkMarkdown,
  runCaptureBenchmark,
  selectCaptureBenchmarkFixtures,
} from "@/lib/capture/benchmark";

describe("Stage 0 capture benchmark", () => {
  it("ships at least 200 no-live fixtures across required verticals and source shapes", () => {
    expect(CAPTURE_BENCHMARK_FIXTURES.length).toBeGreaterThanOrEqual(200);

    const verticals = new Set(CAPTURE_BENCHMARK_FIXTURES.map((fixture) => fixture.vertical));
    for (const vertical of ["restaurant", "hotel", "flight", "activity", "trip", "ambiguous", "refine", "profile", "chitchat"]) {
      expect(verticals.has(vertical)).toBe(true);
    }

    const sourceShapes = new Set(CAPTURE_BENCHMARK_FIXTURES.map((fixture) => fixture.sourceShape));
    for (const sourceShape of [
      "plain_natural_language",
      "pasted_url",
      "screenshot_description",
      "mixed_url_instruction",
      "vague_inspiration",
      "exact_task_ready",
      "group_decision_request",
    ]) {
      expect(sourceShapes.has(sourceShape)).toBe(true);
    }
  });

  it("locks founder dogfood examples and critical entity preservation", () => {
    const report = runCaptureBenchmark({ vertical: "all" });
    expect(report.summary.routingMismatchCount).toBe(0);

    const lionKingZh = report.results.find((result) => result.id.includes("dogfood-lion-king-zh"));
    expect(lionKingZh).toMatchObject({
      actualScenario: "activity",
      actualReady: true,
      failureClass: "none",
    });
    expect(lionKingZh?.capture.entities.activity?.event_name).toBe("The Lion King");
    expect(lionKingZh?.capture.entities.activity?.city).toBe("New York");
    expect(lionKingZh?.capture.entities.activity?.event_date).toBe("2026-06-01");

    const restaurantChinese = report.results.find((result) => result.id.includes("dogfood-chinese-zh"));
    expect(restaurantChinese?.capture.entities.restaurant?.cuisine).toBe("Chinese");

    const hotelBudget = report.results.find((result) => result.id.includes("dogfood-hotel-nyc-budget-zh"));
    expect(hotelBudget?.capture.entities.hotel?.check_in).toBe("2026-05-20");
    expect(hotelBudget?.capture.entities.hotel?.check_out).toBe("2026-05-24");
    expect(hotelBudget?.capture.entities.hotel?.budget_max_per_night).toBe(300);

    const flight = report.results.find((result) => result.id.includes("dogfood-flight-bna-nyc-zh"));
    expect(flight?.capture.entities.flight).toMatchObject({
      origin: "Nashville",
      dest: "New York",
      date: "2026-06-01",
    });
  });

  it("distinguishes task-ready, missing-field, URL-review, screenshot, and ambiguity states", () => {
    const report = runCaptureBenchmark({ vertical: "all" });

    const ready = report.results.find((result) => result.id.includes("sushi-nyc-en"));
    expect(ready?.actualReady).toBe(true);
    expect(ready?.capture.possible_actions.map((action) => action.type)).toContain("create_task");

    const missing = report.results.find((result) => result.id === "hotel-missing-checkout-01");
    expect(missing?.actualReady).toBe(false);
    expect(missing?.actualReadinessReason).toBe("missing_fields");
    expect(missing?.capture.task_readiness.next_missing_fields).toContain("check_out");

    const urlOnly = report.results.find((result) => result.id === "activity-url-review-01");
    expect(urlOnly?.actualSourceType).toBe("url");
    expect(urlOnly?.actualReadinessReason).toBe("needs_review");
    expect(urlOnly?.sourceMetadataComplete).toBe(true);

    const screenshot = report.results.find((result) => result.id.includes("activity-screenshot"));
    expect(screenshot?.actualSourceType).toBe("screenshot");
    expect(screenshot?.sourceMetadataComplete).toBe(true);

    const ambiguous = report.results.find((result) => result.vertical === "ambiguous" && result.input.includes("NYC June 1"));
    expect(ambiguous?.actualScenario).toBeNull();
    expect(ambiguous?.actualReady).toBe(false);
    expect(ambiguous?.actualObjectType).toBe("needs_clarification");
  });

  it("selects a balanced no-live sample for --vertical all --count", () => {
    const selected = selectCaptureBenchmarkFixtures({ vertical: "all", count: 50 });
    expect(selected).toHaveLength(50);
    expect(new Set(selected.map((fixture) => fixture.vertical)).size).toBeGreaterThanOrEqual(8);
  });

  it("reports gateable Stage 0 capture metrics and markdown", () => {
    const report = runCaptureBenchmark({ vertical: "all" });
    expect(report.summary.total).toBeGreaterThanOrEqual(200);
    expect(report.summary.routingMismatchCount).toBe(0);
    expect(report.summary.taskReadyAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(report.summary.sourceMetadataCompletenessRate).toBeGreaterThanOrEqual(0.95);
    expect(report.summary.artifactCompletenessRate).toBeGreaterThanOrEqual(0.95);
    expect(report.summary.unknownFailureRate).toBe(0);
    expect(report.summary.byFailureClass.artifact_incomplete).toBeGreaterThan(0);

    const gate = evaluateCaptureBenchmarkGate(report);
    expect(gate).toMatchObject({ pass: true, errors: [] });

    const failedGate = evaluateCaptureBenchmarkGate(report, {
      minArtifactCompleteness: 1,
    });
    expect(failedGate.pass).toBe(false);
    expect(failedGate.errors.join(" ")).toContain("artifactCompletenessRate");

    const markdown = renderCaptureBenchmarkMarkdown(report);
    expect(markdown).toContain("# Stage 0 Capture Benchmark");
    expect(markdown).toContain("Task-ready accuracy");
    expect(markdown).toContain("Top Failed Fixtures");
  });
});
