import { describe, expect, it } from "vitest";
import {
  LIVE_EXTRACTOR_FIXTURES,
  evaluateLiveExtractorFixtures,
  evaluateLiveExtractorGate,
  parseRawUtteranceToIntentState,
  renderLiveExtractorMarkdown,
} from "../live-extractor-eval";

describe("live extractor no-live eval harness", () => {
  it("has at least 120 raw utterance fixtures across required request types", () => {
    expect(LIVE_EXTRACTOR_FIXTURES.length).toBeGreaterThanOrEqual(120);
    expect(new Set(LIVE_EXTRACTOR_FIXTURES.map((fixture) => fixture.vertical))).toEqual(
      new Set([
        "restaurant",
        "hotel",
        "flight",
        "activity",
        "trip",
        "ambiguous",
        "refine",
        "profile-edit",
        "chitchat",
      ]),
    );
  });

  it("keeps 120 all-vertical raw utterance cases green", () => {
    const report = evaluateLiveExtractorFixtures({ vertical: "all", count: 120 });

    expect(report.summary.total).toBe(120);
    expect(report.summary.pass).toBe(120);
    expect(report.summary.byVertical.restaurant).toBeGreaterThan(0);
    expect(report.summary.byVertical.hotel).toBeGreaterThan(0);
    expect(report.summary.byVertical.flight).toBeGreaterThan(0);
    expect(report.summary.byVertical.activity).toBeGreaterThan(0);
    expect(report.summary.byVertical.trip).toBeGreaterThan(0);
    expect(report.summary.byVertical.ambiguous).toBeGreaterThan(0);
    expect(report.summary.byVertical.refine).toBeGreaterThan(0);
    expect(report.summary.byVertical["profile-edit"]).toBeGreaterThan(0);
    expect(report.summary.byVertical.chitchat).toBeGreaterThan(0);
    expect(report.summary.byFailureClass.wrong_vertical).toBe(0);
    expect(report.summary.byFailureClass.constraint_lost).toBe(0);
  });

  it("locks Lion King raw utterance to activity instead of trip", () => {
    const report = evaluateLiveExtractorFixtures({
      fixtures: LIVE_EXTRACTOR_FIXTURES.filter((fixture) => fixture.id === "dogfood-activity-lion-king-zh"),
      vertical: "all",
      count: 1,
    });

    expect(report.results[0]).toMatchObject({
      pass: true,
      scenario: "activity",
      actionType: "show_confirm_card",
      kind: "plan",
      failureClass: "none",
    });
  });

  it("preserves hotel date and budget from raw Chinese utterance", () => {
    const state = parseRawUtteranceToIntentState("帮我订一个5月20号到24号的纽约酒店，预算300一天");
    expect(state.scenario).toBe("hotel");
    expect(state.hotel).toMatchObject({
      city: "New York",
      check_in: "2026-05-20",
      check_out: "2026-05-24",
      budget_max_per_night: 300,
    });
  });

  it("preserves restaurant cuisine and Sirrah direct venue constraints", () => {
    const chinese = parseRawUtteranceToIntentState("帮我订一个明晚7点纽约2个人的中餐");
    expect(chinese.scenario).toBe("restaurant");
    expect(chinese.restaurant).toMatchObject({
      city: "New York",
      date: "2026-05-07",
      time: "19:00",
      party_size: 2,
      cuisine: "Chinese",
    });

    const sirrah = parseRawUtteranceToIntentState("book Sirrah in New York next Thursday at 8pm for 1 person");
    expect(sirrah.restaurant).toMatchObject({
      restaurant_name: "Sirrah",
      city: "New York",
      date: "2026-05-14",
      time: "20:00",
      party_size: 1,
    });
  });

  it("preserves flight origin, destination, and date from raw Chinese utterance", () => {
    const state = parseRawUtteranceToIntentState("帮我订一个6月1号从nashville飞纽约的机票");
    expect(state.scenario).toBe("flight");
    expect(state.flight).toMatchObject({
      origin: "Nashville",
      dest: "New York",
      date: "2026-06-01",
    });
  });

  it("can fail gates for wrong vertical and lost constraints", () => {
    const good = evaluateLiveExtractorFixtures({ vertical: "all", count: 120 });
    expect(
      evaluateLiveExtractorGate(good, {
        minPassRate: 0.85,
        maxWrongVertical: 0,
        maxConstraintLost: 0,
      }),
    ).toEqual({ pass: true, errors: [] });

    const bad = {
      ...good,
      summary: {
        ...good.summary,
        passRate: 0.8,
        byFailureClass: {
          ...good.summary.byFailureClass,
          wrong_vertical: 1,
          constraint_lost: 1,
        },
      },
    };
    const gate = evaluateLiveExtractorGate(bad, {
      minPassRate: 0.85,
      maxWrongVertical: 0,
      maxConstraintLost: 0,
    });
    expect(gate.pass).toBe(false);
    expect(gate.errors.join(" ")).toContain("passRate");
    expect(gate.errors.join(" ")).toContain("wrong_vertical");
    expect(gate.errors.join(" ")).toContain("constraint_lost");
  });

  it("renders founder-readable markdown", () => {
    const markdown = renderLiveExtractorMarkdown(evaluateLiveExtractorFixtures({ vertical: "all", count: 10 }));
    expect(markdown).toContain("# Live Extractor Eval Harness");
    expect(markdown).toContain("No-live raw utterance harness");
    expect(markdown).toContain("Failure Taxonomy");
  });
});
