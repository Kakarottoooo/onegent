import type { LayeredBenchmarkCase } from "./layered-benchmark";

const FLIGHT_FIELDS = {
  origin: "MCO",
  destination: "BNA",
  departure_date: "2026-06-01",
  passengers: 1,
  trip_type: "one-way",
  cabin: "economy",
  target_airline: "Southwest",
  target_departure_time: "08:50",
  target_flight_number: "WN 3084",
};

const REQUIRED_FLIGHT_SOURCES = [
  "booking_jobs row",
  "steps[0].body.__source",
  "steps[0].body.params",
  "decisionLog",
  "worker log excerpt",
  "flight candidate evidence dump",
  "provider screenshot",
  "current URL",
  "benchmark report",
];

export const FLIGHT_LAYERED_BENCHMARK_CASES: LayeredBenchmarkCase[] = [
  flightCase(1, {
    title: "l1-direct-pass",
    l1Status: "passed",
    terminalState: "checkout_manual_review_reached",
    summary: "Expedia L1 selected the target Southwest flight and reached the safe manual-review boundary.",
    failureClass: "none",
    l2Eligible: false,
    l2Status: "not_applicable",
    l2Summary: "No L2 recovery is needed after a clean L1 direct pass.",
    owner: "product/manual-boundary",
    patch: false,
    artifactSignals: [
      "source marker present",
      "MCO/BNA/2026-06-01 params",
      "selected candidate airline=Southwest timeDelta=0 differentAirline=no",
      "checkout/manual-review URL or traveler fields visible",
    ],
  }),
  flightCase(2, {
    title: "wrong-airline-candidate-rejected",
    terminalState: "wrong_airline_candidate_rejected",
    summary: "Candidate evidence names Frontier at the target time/price, so L1 must reject it instead of false-success selecting it.",
    failureClass: "selector_drift",
    l2Eligible: true,
    l2Status: "recovered",
    l2Summary: "L1 now rejects explicit different-airline cards and preserves rejected-candidate evidence.",
    owner: "provider-runtime",
    patch: false,
    artifactSignals: [
      "differentAirline=yes",
      "decision=rejected",
      "reason=explicit-different-airline",
      "timeDelta=0",
      "priceDelta=0",
      "selected candidate absent",
    ],
  }),
  flightCase(3, {
    title: "wrong-time-candidate-rejected",
    terminalState: "wrong_time_candidate_rejected",
    summary: "Candidate evidence matches Southwest and price, but departure time is outside the target window.",
    failureClass: "selector_drift",
    l2Eligible: true,
    l2Status: "recovered",
    l2Summary: "L1 now rejects same-airline stale-price cards outside the narrow target-time window.",
    owner: "provider-runtime",
    patch: false,
    artifactSignals: [
      "airline=Southwest",
      "timeDelta>15",
      "priceDelta=0",
      "decision=rejected",
      "reason=price-only-time-mismatch",
      "no price-only acceptance",
    ],
  }),
  flightCase(4, {
    title: "price-only-fallback-rejected",
    l1Status: "insufficient_evidence",
    terminalState: "price_only_fallback_rejected",
    summary: "Visible card only shares the stale target price; it has no target airline, time, or flight-number proof.",
    failureClass: "insufficient_evidence",
    l2Eligible: false,
    l2Status: "not_applicable",
    l2Summary: "L2 is not eligible because price-only evidence cannot prove target identity without airline, target-time, or flight-number support.",
    owner: "provider-runtime",
    patch: false,
    artifactSignals: [
      "priceDelta=0",
      "airline=unknown",
      "departure=unknown or wrong",
      "flightNumber=hidden",
      "price_only_fallback_rejected",
      "insufficient_evidence",
      "decision=rejected",
    ],
  }),
  flightCase(5, {
    title: "checkout-reached-traveler-fields-missing",
    l1Status: "insufficient_evidence",
    terminalState: "checkout_form_incomplete",
    summary: "Checkout/review page is visible, but required allowed traveler fields remain missing, so the run must not be marked successful.",
    failureClass: "insufficient_evidence",
    l2Eligible: false,
    l2Status: "not_applicable",
    l2Summary: "L2 is not eligible because incomplete traveler fields are not a completed safe handoff.",
    owner: "provider-runtime",
    patch: false,
    artifactSignals: [
      "Checkout reached",
      "Traveler form state missing=first name,last name,email address,phone number",
      "status=error",
      "paused_payment is not sufficient without allowed-field evidence",
    ],
  }),
  flightCase(6, {
    title: "stale-mixed-worker-evidence",
    l1Status: "insufficient_evidence",
    terminalState: "mixed_or_stale_worker_evidence",
    summary: "Worker log excerpt includes multiple worker instances or a claimed job id that differs from the DB row.",
    failureClass: "insufficient_evidence",
    evidenceScore: 0.5,
    hasDecisionLog: false,
    hasScreenshot: false,
    l2Eligible: false,
    l2Status: "not_applicable",
    l2Summary: "L2 is not eligible until the worker topology and artifact bundle are clean.",
    owner: "task-workspace",
    patch: false,
    artifactSignals: [
      "mixed_or_stale_worker_evidence",
      "workerInstances>1 or claimedJobMismatch=true",
      "checkout marker ignored",
    ],
  }),
  flightCase(7, {
    title: "dismissable-promo-overlay",
    terminalState: "dismissable_member_price_overlay",
    summary: "OneKeyCash/member-price promo overlays block the card scan but are safe to dismiss.",
    failureClass: "click_miss",
    l2Eligible: true,
    l2Status: "recovered",
    l2Summary: "Simulated L2 dismisses the promo overlay and returns to candidate capture.",
    owner: "browser-harness",
    patch: false,
    artifactSignals: [
      "dismissable_member_price_overlay",
      "overlay screenshot",
      "No thanks or close affordance visible",
    ],
  }),
  flightCase(8, {
    title: "account-required-boundary",
    l1Status: "manual_boundary",
    terminalState: "account_checkpoint",
    summary: "Expedia requires account sign-in or verification to continue.",
    failureClass: "account_checkpoint",
    l2Eligible: false,
    l2Status: "not_applicable",
    l2Summary: "Account checkpoints are human-only boundaries and must not be bypassed.",
    owner: "product/manual-boundary",
    patch: false,
    artifactSignals: [
      "login boundary",
      "account required",
      "no credential handling",
    ],
  }),
  flightCase(9, {
    title: "provider-degraded",
    terminalState: "provider_degraded",
    summary: "Expedia or the network returns a provider/server failure before card selection can be proven.",
    failureClass: "provider_degraded",
    l2Eligible: false,
    l2Status: "not_applicable",
    l2Summary: "Provider degradation is not a Browser Harness recovery class.",
    owner: "product/manual-boundary",
    patch: false,
    artifactSignals: [
      "network/provider failure",
      "5xx or net::ERR",
      "no selector patch from provider outage alone",
    ],
  }),
  flightCase(10, {
    title: "final-review-checkpoint",
    l1Status: "manual_boundary",
    terminalState: "final_review_checkpoint",
    summary: "Expedia reaches the human-only final review or complete-booking checkpoint.",
    failureClass: "user_only_final_action",
    l2Eligible: false,
    l2Status: "not_applicable",
    l2Summary: "Final review and purchase confirmation remain user-controlled.",
    owner: "product/manual-boundary",
    patch: false,
    artifactSignals: [
      "final review checkpoint",
      "payment/CVV/final confirmation hard stop",
      "safe handoff evidence present",
    ],
  }),
  flightCase(11, {
    title: "target-card-not-visible-no-availability",
    terminalState: "target_card_not_visible",
    summary: "Evidence shows the requested Southwest target card is absent from Expedia results, so generic no-match copy must not become selector drift.",
    failureClass: "true_no_availability",
    l2Eligible: false,
    l2Status: "not_applicable",
    l2Summary: "L2 is not eligible when screenshots and logs show the target card is absent from provider inventory.",
    owner: "product/manual-boundary",
    patch: false,
    artifactSignals: [
      "target Southwest card is not visible",
      "no matching flight button found",
      "screenshot confirms target absent",
      "provider inventory changed",
    ],
  }),
  flightCase(12, {
    title: "card-scan-failed-before-fallback",
    terminalState: "card_scan_failed_before_fallback",
    summary: "DOM flight-card scan fails before locator fallback can produce candidate evidence.",
    failureClass: "selector_drift",
    l2Eligible: true,
    l2Status: "needs_patch",
    l2Summary: "L2 cannot recover without a runtime patch that preserves card candidates and reaches fallback.",
    owner: "provider-runtime",
    patch: true,
    patchTitle: "Harden Expedia flight card scan entrypoint",
    artifactSignals: [
      "Flight-card DOM scan failed",
      "fallback not attempted",
      "candidate evidence absent",
      "runtime patch proposal required",
      "requires screenshot plus DOM entrypoint evidence",
    ],
  }),
  flightCase(13, {
    title: "fallback-matched-no-checkout",
    terminalState: "fallback_matched_no_checkout",
    summary: "Locator fallback identifies a defensible target card, but the click or fare-modal transition does not reach checkout.",
    failureClass: "progress_stall",
    l2Eligible: true,
    l2Status: "needs_patch",
    l2Summary: "L2 cannot count this as recovered until the transition emits checkout, manual-boundary, or no-availability evidence.",
    owner: "provider-runtime",
    patch: true,
    patchTitle: "Emit Expedia fallback click transition evidence",
    artifactSignals: [
      "Locator fallback matched flight card",
      "Selected flight candidate evidence",
      "fallback_matched_no_checkout",
      "flight checkout was not reached",
      "current URL stayed on review/search",
      "generic checkout marker ignored without safe handoff/manual-review",
      "requires selected candidate, fare modal, current URL, and screenshot evidence",
    ],
  }),
  flightCase(14, {
    title: "model-env-transient",
    terminalState: "model_or_env_transient",
    summary: "OpenAI/model environment failed after provider evidence started, so the run is not Expedia selector evidence.",
    failureClass: "network_model_env_issue",
    l2Eligible: false,
    l2Status: "not_applicable",
    l2Summary: "Model/env failures require environment repair, not Expedia selector or Browser Harness recovery.",
    owner: "planner",
    patch: false,
    artifactSignals: [
      "OpenAI Responses API 500",
      "model_or_env_transient",
      "provider selector evidence preserved",
    ],
  }),
  flightCase(15, {
    title: "hidden-flight-number-target-time-pass",
    l1Status: "passed",
    terminalState: "checkout_manual_review_reached",
    summary: "Expedia hides the flight number, but airline and exact target departure time provide enough identity to reach the safe checkout/manual-review boundary.",
    failureClass: "none",
    l2Eligible: false,
    l2Status: "not_applicable",
    l2Summary: "No L2 recovery is needed when hidden-flight-number evidence still has strong target airline and time identity.",
    owner: "product/manual-boundary",
    patch: false,
    artifactSignals: [
      "flightNumber=hidden",
      "airline=Southwest",
      "timeDelta=0",
      "fallback-target-fit",
      "checkout/manual-review URL or traveler fields visible",
    ],
  }),
];

type FlightCaseOptions = {
  title: string;
  l1Status?: LayeredBenchmarkCase["l1Result"]["status"];
  terminalState: string;
  summary: string;
  failureClass: LayeredBenchmarkCase["failureClass"];
  evidenceScore?: number;
  hasDecisionLog?: boolean;
  hasScreenshot?: boolean;
  l2Eligible: boolean;
  l2Status: LayeredBenchmarkCase["l2SimulatedResult"]["status"];
  l2Summary: string;
  owner: LayeredBenchmarkCase["owner"];
  patch: boolean;
  patchTitle?: string;
  patchFiles?: string[];
  artifactSignals: string[];
};

function flightCase(index: number, options: FlightCaseOptions): LayeredBenchmarkCase {
  const id = `lbv2-flight-${String(index).padStart(2, "0")}`;
  const patchFiles = options.patchFiles ?? [
    "lib/booking-autopilot/providers/expedia.ts",
    "worker/src/booking-autopilot/providers/expedia.ts",
    "lib/__tests__/expedia-flight-card-match.test.ts",
  ];
  const evidenceScore = options.evidenceScore ?? 1;

  return {
    id,
    vertical: "flight",
    provider: "Expedia",
    taskIntent: {
      rawUtterance: "Book one economy flight from Orlando MCO to Nashville BNA on 2026-06-01",
      fields: FLIGHT_FIELDS,
    },
    expectedTarget: {
      providerStage: "Expedia MCO to BNA flight search and checkout/manual-review boundary",
      safeTerminalState: "safe_handoff_before_ticket_purchase_confirmation",
      hardStop: "Stop before login, verification, payment/CVV, final confirmation, or any user-only action.",
    },
    l1Result: {
      status: options.l1Status ?? "blocked",
      terminalState: options.terminalState,
      summary: options.summary,
    },
    failureClass: options.failureClass,
    evidenceCompleteness: {
      syntheticMarker: true,
      fixtureId: `synthetic-flight-${String(index).padStart(2, "0")}-${options.title}`,
      hasDbRow: true,
      hasDecisionLog: options.hasDecisionLog ?? true,
      hasWorkerLog: true,
      hasScreenshot: options.hasScreenshot ?? true,
      hasCurrentUrl: evidenceScore >= 0.9,
      hasBenchmarkReport: true,
      score: evidenceScore,
    },
    artifactExpectations: {
      requiredSources: REQUIRED_FLIGHT_SOURCES,
      evidenceContract: `${id} requires DB row, decision log, worker log, screenshots, current URL, and candidate/report evidence before any live retry conclusion.`,
      classificationSignals: options.artifactSignals,
      patchProposalFields: options.patch
        ? ["title", "files", "risk", "notes"]
        : ["proposed=false", "risk=none", "notes"],
    },
    l2Eligible: options.l2Eligible,
    l2SimulatedResult: {
      status: options.l2Status,
      summary: options.l2Summary,
      recoveredTerminalState:
        options.l2Status === "recovered"
          ? "safe_handoff_before_ticket_purchase_confirmation"
          : undefined,
    },
    patchProposal: options.patch
      ? {
          proposed: true,
          title: options.patchTitle ?? `Expedia flight ${options.title}`,
          files: patchFiles,
          risk: "low",
          notes: "Patch proposal is fixture-driven only; do not run Expedia before a separate founder-approved retry.",
        }
      : {
          proposed: false,
          risk: "none",
          notes: "Fixture expects classification or safe boundary handling, not a runtime patch.",
        },
    owner: options.owner,
  };
}
