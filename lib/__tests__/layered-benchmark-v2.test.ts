import { describe, expect, it } from "vitest";
import {
  LAYERED_BENCHMARK_CASES,
  evaluateLayeredBenchmarkCase,
  evaluateLayeredBenchmarkGate,
  isLayeredL2EscalationEligible,
  renderLayeredBenchmarkMarkdown,
  runLayeredNoLiveBenchmark,
  selectLayeredBenchmarkCases,
  type LayeredBenchmarkEvidenceCompleteness,
  type LayeredBenchmarkFailureClass,
} from "@/lib/execution-layer/layered-benchmark";

const COMPLETE_EVIDENCE: LayeredBenchmarkEvidenceCompleteness = {
  syntheticMarker: true,
  fixtureId: "synthetic-test",
  hasDbRow: true,
  hasDecisionLog: true,
  hasWorkerLog: true,
  hasScreenshot: true,
  hasCurrentUrl: true,
  hasBenchmarkReport: true,
  score: 1,
};

const INCOMPLETE_EVIDENCE: LayeredBenchmarkEvidenceCompleteness = {
  ...COMPLETE_EVIDENCE,
  hasDecisionLog: false,
  hasScreenshot: false,
  score: 0.5,
};

describe("layered benchmark v2", () => {
  it("escalates to L2 only for page/control failure classes with complete evidence", () => {
    const eligible: LayeredBenchmarkFailureClass[] = [
      "selector_drift",
      "click_miss",
      "iframe_miss",
      "field_fill_miss",
      "progress_stall",
      "unknown_page_mutation",
    ];

    for (const failureClass of eligible) {
      expect(isLayeredL2EscalationEligible(failureClass, COMPLETE_EVIDENCE)).toBe(true);
    }
  });

  it("does not escalate provider, account, evidence, network, or routing failures", () => {
    const ineligible: LayeredBenchmarkFailureClass[] = [
      "true_no_availability",
      "provider_degraded",
      "account_checkpoint",
      "user_only_final_action",
      "insufficient_evidence",
      "network_model_env_issue",
      "routing_mismatch",
      "none",
    ];

    for (const failureClass of ineligible) {
      expect(isLayeredL2EscalationEligible(failureClass, COMPLETE_EVIDENCE)).toBe(false);
    }
  });

  it("does not escalate page/control failures without enough evidence", () => {
    expect(isLayeredL2EscalationEligible("selector_drift", INCOMPLETE_EVIDENCE)).toBe(false);
    expect(isLayeredL2EscalationEligible("unknown_page_mutation", INCOMPLETE_EVIDENCE)).toBe(false);
  });

  it("ships a deterministic four-vertical corpus with required schema fields", () => {
    expect(LAYERED_BENCHMARK_CASES.length).toBeGreaterThanOrEqual(60);

    for (const testCase of LAYERED_BENCHMARK_CASES) {
      expect(testCase.id).toMatch(/^lbv2-(restaurant|hotel|flight|activity)-\d{2}$/);
      expect(testCase.provider).toBeTruthy();
      expect(testCase.taskIntent.rawUtterance).toBeTruthy();
      expect(Object.keys(testCase.taskIntent.fields).length).toBeGreaterThan(0);
      expect(testCase.expectedTarget.safeTerminalState).toContain("safe_handoff");
      expect(testCase.expectedTarget.hardStop).toContain("final confirmation");
      expect(testCase.evidenceCompleteness.syntheticMarker).toBe(true);
      expect(testCase.evidenceCompleteness.fixtureId).toContain("synthetic-");
      expect(testCase.artifactExpectations.requiredSources.length).toBeGreaterThan(0);
      expect(testCase.artifactExpectations.evidenceContract).toContain(testCase.id);
      expect(testCase.artifactExpectations.classificationSignals.length).toBeGreaterThan(0);
      expect(testCase.artifactExpectations.patchProposalFields.length).toBeGreaterThan(0);
      expect(typeof testCase.l2Eligible).toBe("boolean");
      expect(testCase.l2SimulatedResult.status).toBeTruthy();
      expect(typeof testCase.patchProposal.proposed).toBe("boolean");
      expect(testCase.owner).toBeTruthy();
    }
  });

  it("selects a balanced 50-case all-vertical benchmark", () => {
    const report = runLayeredNoLiveBenchmark({ vertical: "all", count: 50, mode: "no-live" });

    expect(report.summary.total).toBe(50);
    expect(report.summary.byVertical.restaurant).toBeGreaterThan(0);
    expect(report.summary.byVertical.hotel).toBeGreaterThan(0);
    expect(report.summary.byVertical.flight).toBeGreaterThan(0);
    expect(report.summary.byVertical.activity).toBeGreaterThan(0);
    expect(report.summary.l1DirectPassRate).toBeGreaterThan(0);
    expect(report.summary.l1PlusL2RecoveredPassRate).toBeGreaterThan(report.summary.l1DirectPassRate);
    expect(report.summary.artifactCompletenessRate).toBeGreaterThanOrEqual(0.9);
  });

  it("filters by vertical and count", () => {
    const cases = selectLayeredBenchmarkCases({ vertical: "hotel", count: 10 });
    expect(cases).toHaveLength(10);
    expect(cases.every((testCase) => testCase.vertical === "hotel")).toBe(true);
  });

  it("uses flight-specific Expedia evidence fixtures for the first 10 flight cases", () => {
    const results = runLayeredNoLiveBenchmark({ vertical: "flight", count: 10 }).results;
    expect(results.map((result) => result.id)).toEqual([
      "lbv2-flight-01",
      "lbv2-flight-02",
      "lbv2-flight-03",
      "lbv2-flight-04",
      "lbv2-flight-05",
      "lbv2-flight-06",
      "lbv2-flight-07",
      "lbv2-flight-08",
      "lbv2-flight-09",
      "lbv2-flight-10",
    ]);

    expect(results.map((result) => result.finalVerdict)).toEqual([
      "l1_direct_pass",
      "l2_recovered_pass",
      "l2_recovered_pass",
      "insufficient_evidence",
      "insufficient_evidence",
      "insufficient_evidence",
      "l2_recovered_pass",
      "expected_manual_boundary",
      "expected_provider_block",
      "expected_manual_boundary",
    ]);
    expect(results[1].artifactExpectations.classificationSignals).toContain("differentAirline=yes");
    expect(results[1].artifactExpectations.classificationSignals).toContain("reason=explicit-different-airline");
    expect(results[2].artifactExpectations.classificationSignals).toContain("timeDelta>15");
    expect(results[2].artifactExpectations.classificationSignals).toContain("reason=price-only-time-mismatch");
    expect(results[3].artifactExpectations.classificationSignals).toContain("priceDelta=0");
    expect(results[3].artifactExpectations.classificationSignals).toContain("price_only_fallback_rejected");
    expect(results[3].failureClass).toBe("insufficient_evidence");
    expect(results[3].calculatedL2Eligible).toBe(false);
    expect(results[3].artifactExpectations.classificationSignals).toContain("decision=rejected");
    expect(results[4].artifactExpectations.classificationSignals.join(" ")).toContain("Traveler form state");
    expect(results[4].artifactExpectations.classificationSignals).toContain("status=error");
    expect(results[5].artifactExpectations.classificationSignals).toContain("mixed_or_stale_worker_evidence");
    expect(results[6].calculatedL2Eligible).toBe(true);
    expect(results[7].calculatedL2Eligible).toBe(false);
    expect(results[8].pass).toBe(true);
    expect(results[9].failureClass).toBe("user_only_final_action");
  });

  it("requires patch proposal fields for flight cases that ask for L1 fixes", () => {
    const patchCases = selectLayeredBenchmarkCases({ vertical: "flight", count: 20 })
      .filter((testCase) => testCase.patchProposal.proposed);

    expect(patchCases.length).toBeGreaterThan(0);
    for (const testCase of patchCases) {
      expect(testCase.patchProposal.title).toBeTruthy();
      expect(testCase.patchProposal.files?.length).toBeGreaterThan(0);
      expect(testCase.patchProposal.risk).toMatch(/low|medium/);
      expect(testCase.patchProposal.notes).toMatch(/fixture-driven|Patch proposal only/);
      expect(testCase.artifactExpectations.patchProposalFields).toEqual([
        "title",
        "files",
        "risk",
        "notes",
      ]);
    }
  });

  it("uses hotel-specific benchmark cases for no-availability and provider fallback contracts", () => {
    const results = runLayeredNoLiveBenchmark({ vertical: "hotel", count: 10 }).results;
    expect(results.map((result) => result.id)).toEqual([
      "lbv2-hotel-01",
      "lbv2-hotel-02",
      "lbv2-hotel-03",
      "lbv2-hotel-04",
      "lbv2-hotel-05",
      "lbv2-hotel-06",
      "lbv2-hotel-07",
      "lbv2-hotel-08",
      "lbv2-hotel-09",
      "lbv2-hotel-10",
    ]);

    const byId = new Map(results.map((result) => [result.id, result]));

    expect(byId.get("lbv2-hotel-01")).toMatchObject({
      finalVerdict: "l1_direct_pass",
      owner: "product/manual-boundary",
      calculatedL2Eligible: false,
    });
    expect(byId.get("lbv2-hotel-02")).toMatchObject({
      failureClass: "true_no_availability",
      finalVerdict: "expected_provider_block",
      owner: "product/manual-boundary",
      calculatedL2Eligible: false,
      hotelContract: {
        noAvailabilityEvidence: { state: "verified_true_no_availability" },
        providerFallback: { eligible: false },
      },
    });
    expect(byId.get("lbv2-hotel-03")).toMatchObject({
      failureClass: "provider_degraded",
      finalVerdict: "expected_provider_block",
      owner: "product/manual-boundary",
      calculatedL2Eligible: false,
      hotelContract: {
        noAvailabilityEvidence: { state: "weak_no_availability" },
        providerFallback: { eligible: true, nextProviders: ["hotels-com", "expedia-hotel"] },
      },
    });
    expect(byId.get("lbv2-hotel-04")).toMatchObject({
      failureClass: "provider_degraded",
      finalVerdict: "expected_provider_block",
      calculatedL2Eligible: false,
    });
    expect(byId.get("lbv2-hotel-05")).toMatchObject({
      failureClass: "selector_drift",
      finalVerdict: "l2_recovered_pass",
      owner: "browser-harness",
      calculatedL2Eligible: true,
    });
    expect(byId.get("lbv2-hotel-06")).toMatchObject({
      failureClass: "selector_drift",
      finalVerdict: "needs_runtime_patch",
      owner: "provider-runtime",
      calculatedL2Eligible: true,
    });
    expect(byId.get("lbv2-hotel-07")).toMatchObject({
      failureClass: "user_only_final_action",
      finalVerdict: "expected_manual_boundary",
      owner: "product/manual-boundary",
      calculatedL2Eligible: false,
    });
    expect(byId.get("lbv2-hotel-08")).toMatchObject({
      failureClass: "account_checkpoint",
      finalVerdict: "expected_manual_boundary",
      owner: "product/manual-boundary",
      calculatedL2Eligible: false,
    });
    expect(byId.get("lbv2-hotel-09")).toMatchObject({
      failureClass: "insufficient_evidence",
      finalVerdict: "insufficient_evidence",
      owner: "task-workspace",
      calculatedL2Eligible: false,
    });
    expect(byId.get("lbv2-hotel-10")).toMatchObject({
      failureClass: "progress_stall",
      finalVerdict: "needs_runtime_patch",
      owner: "task-workspace",
      calculatedL2Eligible: true,
      hotelContract: {
        staleRunningState: { staleStatus: "running" },
      },
    });
  });

  it("preserves exact hotel fallback params in hotel benchmark recommendations", () => {
    const cases = selectLayeredBenchmarkCases({ vertical: "hotel", count: 10 });
    const fallbackCases = cases.filter((testCase) => testCase.hotelContract?.providerFallback?.eligible);
    expect(fallbackCases.length).toBeGreaterThanOrEqual(3);

    for (const testCase of fallbackCases) {
      expect(testCase.hotelContract?.providerFallback?.preservedParams).toEqual({
        hotel: "YOTEL New York Times Square",
        city: "New York",
        checkin: "2026-06-10",
        checkout: "2026-06-12",
        adults: 1,
        rooms: 1,
        budget: "300",
      });
    }
  });

  it("classifies L1, L2, patch, and evidence verdicts", () => {
    const directPass = evaluateLayeredBenchmarkCase(LAYERED_BENCHMARK_CASES[0]);
    expect(directPass.finalVerdict).toBe("l1_direct_pass");
    expect(directPass.pass).toBe(true);

    const recovered = evaluateLayeredBenchmarkCase(
      LAYERED_BENCHMARK_CASES.find((testCase) => testCase.failureClass === "selector_drift")!,
    );
    expect(recovered.calculatedL2Eligible).toBe(true);
    expect(recovered.finalVerdict).toBe("l2_recovered_pass");
    expect(recovered.pass).toBe(true);

    const needsPatch = evaluateLayeredBenchmarkCase(
      LAYERED_BENCHMARK_CASES.find((testCase) => testCase.failureClass === "iframe_miss")!,
    );
    expect(needsPatch.finalVerdict).toBe("needs_runtime_patch");
    expect(needsPatch.patchProposal.proposed).toBe(true);

    const insufficient = evaluateLayeredBenchmarkCase(
      LAYERED_BENCHMARK_CASES.find((testCase) => testCase.failureClass === "insufficient_evidence")!,
    );
    expect(insufficient.finalVerdict).toBe("insufficient_evidence");
    expect(insufficient.pass).toBe(false);
  });

  it("renders machine-readable JSON shape and founder-readable markdown", () => {
    const report = runLayeredNoLiveBenchmark({ vertical: "all", count: 50 });
    const json = JSON.parse(JSON.stringify(report));
    expect(json.summary.total).toBe(50);
    expect(json.summary.byFailureClass.selector_drift).toBeGreaterThan(0);
    expect(json.results[0].taskIntent.fields).toBeDefined();
    expect(json.results[0].evidenceCompleteness.syntheticMarker).toBe(true);

    const markdown = renderLayeredBenchmarkMarkdown(report);
    expect(markdown).toContain("# Layered Benchmark V2");
    expect(markdown).toContain("L1 + L2 recovered pass");
    expect(markdown).toContain("Top Failed Cases");
    expect(markdown).toContain("Sample Case Trace");
  });

  it("can pass and fail configured gates", () => {
    const report = runLayeredNoLiveBenchmark({ vertical: "all", count: 50 });

    expect(
      evaluateLayeredBenchmarkGate(report, {
        minArtifactCompletenessRate: 0.9,
        maxUnknownFailureRate: 0.1,
        maxRoutingMismatch: 0,
        minL1DirectPassRate: 0.2,
        minL1PlusL2RecoveredPassRate: 0.4,
      }),
    ).toMatchObject({ pass: true, errors: [] });

    const failed = evaluateLayeredBenchmarkGate(report, {
      minArtifactCompletenessRate: 1.01,
      maxUnknownFailureRate: 0,
      minL1DirectPassRate: 0.9,
    });
    expect(failed.pass).toBe(false);
    expect(failed.errors.join(" ")).toContain("min_artifact_completeness");
    expect(failed.errors.join(" ")).toContain("max_unknown_failure_rate");
    expect(failed.errors.join(" ")).toContain("min_l1_direct_pass");
  });
});
