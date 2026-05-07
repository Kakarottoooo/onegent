import { describe, expect, it } from "vitest";
import {
  CAPTURE_BENCHMARK_FIXTURES,
  evaluateCaptureBenchmarkGate,
  renderCaptureBenchmarkMarkdown,
  runCaptureBenchmark,
  selectCaptureBenchmarkFixtures,
} from "@/lib/capture/benchmark";
import { buildCaptureTaskBoundary } from "@/lib/capture/task-boundary";

describe("Stage 0 capture benchmark", () => {
  it("ships at least 500 no-live fixtures across required verticals and source shapes", () => {
    expect(CAPTURE_BENCHMARK_FIXTURES.length).toBeGreaterThanOrEqual(500);

    const verticals = new Set(CAPTURE_BENCHMARK_FIXTURES.map((fixture) => fixture.vertical));
    for (const vertical of ["restaurant", "hotel", "flight", "activity", "trip", "ambiguous", "refine", "profile", "chitchat"]) {
      expect(verticals.has(vertical)).toBe(true);
    }

    const byVertical = CAPTURE_BENCHMARK_FIXTURES.reduce<Record<string, number>>((acc, fixture) => {
      acc[fixture.vertical] = (acc[fixture.vertical] ?? 0) + 1;
      return acc;
    }, {});
    expect(byVertical.restaurant).toBeGreaterThanOrEqual(80);
    expect(byVertical.hotel).toBeGreaterThanOrEqual(80);
    expect(byVertical.flight).toBeGreaterThanOrEqual(80);
    expect(byVertical.activity).toBeGreaterThanOrEqual(80);
    expect(byVertical.trip).toBeGreaterThanOrEqual(80);
    expect(byVertical.ambiguous).toBeGreaterThanOrEqual(50);
    expect(byVertical.refine).toBeGreaterThanOrEqual(50);
    expect(byVertical.profile).toBeGreaterThanOrEqual(30);
    expect(byVertical.chitchat).toBeGreaterThanOrEqual(20);

    const sourceShapes = new Set(CAPTURE_BENCHMARK_FIXTURES.map((fixture) => fixture.sourceShape));
    for (const sourceShape of [
      "plain_natural_language",
      "pasted_url",
      "screenshot_description",
      "mixed_url_instruction",
      "vague_inspiration",
      "exact_task_ready",
      "group_decision_request",
      "save_only",
      "compare_only",
      "provider_url_impersonation",
    ]) {
      expect(sourceShapes.has(sourceShape)).toBe(true);
    }

    for (const fixture of CAPTURE_BENCHMARK_FIXTURES) {
      expect(fixture.note.trim().length).toBeGreaterThan(12);
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
    expect(report.summary.byFailureClass.artifact_incomplete).toBe(0);
    expect(report.artifactGapClosures).toHaveLength(4);
    expect(report.artifactGapClosures.every((closure) => closure.outcome === "closed")).toBe(true);
    expect(report.dogfoodLinks.find((link) => link.dogfoodId === "DOG-005")).toBeDefined();
    expect(report.recommendedNextActions.length).toBeGreaterThan(0);

    const gate = evaluateCaptureBenchmarkGate(report);
    expect(gate).toMatchObject({ pass: true, errors: [] });

    const failedGate = evaluateCaptureBenchmarkGate(report, {
      minArtifactCompleteness: 1.01,
    });
    expect(failedGate.pass).toBe(false);
    expect(failedGate.errors.join(" ")).toContain("artifactCompletenessRate");

    const markdown = renderCaptureBenchmarkMarkdown(report);
    expect(markdown).toContain("# Stage 0 Capture Benchmark");
    expect(markdown).toContain("Task-ready accuracy");
    expect(markdown).toContain("Artifact Gap Closure");
    expect(markdown).toContain("Recommended Next Actions");
    expect(markdown).toContain("Top Failed Fixtures");
  });

  it("locks Stage 0 source edge cases for screenshots, provider URLs, and group decisions", () => {
    const report = runCaptureBenchmark({ vertical: "all" });

    const imageText = report.results.find((result) => result.id.includes("ambiguous-generated") && result.input.startsWith("image of"));
    expect(imageText?.actualSourceType).toBe("request");
    expect(imageText?.actualReady).toBe(false);

    const impersonation = report.results.find((result) => result.input.includes("ticketmaster.com.evil.example"));
    expect(impersonation?.actualSourceType).toBe("url");
    expect(impersonation?.actualScenario).toBeNull();
    expect(impersonation?.actualReadinessReason).toBe("needs_review");

    const group = report.results.find((result) => result.id.includes("restaurant-group"));
    expect(group?.actualObjectType).toBe("group_decision");
    expect(group?.capture.possible_actions.map((action) => action.type)).toContain("create_room");
  });

  it("respects direct Ticketmaster event URL behavior without treating artist links or impersonation as direct", () => {
    const report = runCaptureBenchmark({ vertical: "activity" });

    const directEvent = report.results.find((result) => result.id === "activity-ticketmaster-event-direct-01");
    expect(directEvent).toMatchObject({
      actualScenario: "activity",
      actualSourceType: "url",
      actualReady: true,
      failureClass: "none",
    });
    expect(directEvent?.capture.constraints.source_url).toContain("/event/Z1r9uZrrZbpZ1Avr9ea");

    const directBoundary = buildCaptureTaskBoundary(directEvent!.capture);
    expect(directBoundary).toMatchObject({
      ok: true,
      scenario: "activity",
      missingFields: [],
      nextAction: "run_direct_booking",
    });
    expect(directBoundary.payload?.nlu.direct_booking).toBe(true);

    const urlOnlyEvent = report.results.find((result) => result.id === "activity-ticketmaster-event-url-only-01");
    expect(urlOnlyEvent).toMatchObject({
      actualScenario: "activity",
      actualSourceType: "url",
      actualReady: false,
      actualReadinessReason: "needs_review",
      failureClass: "none",
    });
    expect(buildCaptureTaskBoundary(urlOnlyEvent!.capture).nextAction).toBe("run_direct_booking");

    const artistLink = report.results.find((result) => result.id === "activity-url-review-01");
    expect(buildCaptureTaskBoundary(artistLink!.capture).nextAction).not.toBe("run_direct_booking");

    const allReport = runCaptureBenchmark({ vertical: "all" });
    const impersonation = allReport.results.find((result) => result.input.includes("ticketmaster.com.evil.example"));
    expect(buildCaptureTaskBoundary(impersonation!.capture).nextAction).not.toBe("run_direct_booking");
  });
});
