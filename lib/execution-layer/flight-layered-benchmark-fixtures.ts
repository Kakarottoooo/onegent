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
    l2Status: "needs_patch",
    l2Summary: "L2 should stop with a selector patch proposal unless a clean Southwest candidate is visible.",
    owner: "provider-runtime",
    patch: true,
    artifactSignals: [
      "differentAirline=yes",
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
    l2Status: "needs_patch",
    l2Summary: "L2 can scan visible cards, but L1 needs a target-time guard before another provider retry.",
    owner: "provider-runtime",
    patch: true,
    artifactSignals: [
      "airline=Southwest",
      "timeDelta>120",
      "priceDelta=0",
      "no price-only acceptance",
    ],
  }),
  flightCase(4, {
    title: "price-only-fallback-rejected",
    terminalState: "price_only_fallback_rejected",
    summary: "Visible card only shares the stale target price; it has no target airline, time, or flight-number proof.",
    failureClass: "selector_drift",
    l2Eligible: true,
    l2Status: "needs_patch",
    l2Summary: "L2 can gather better visible candidates; L1 must not click price-only matches.",
    owner: "provider-runtime",
    patch: true,
    artifactSignals: [
      "priceDelta=0",
      "airline=unknown",
      "departure=unknown or wrong",
      "flightNumber=hidden",
    ],
  }),
  flightCase(5, {
    title: "checkout-reached-traveler-fields-missing",
    terminalState: "checkout_form_incomplete",
    summary: "Checkout/review page is visible, but required allowed traveler fields remain missing.",
    failureClass: "field_fill_miss",
    l2Eligible: true,
    l2Status: "needs_patch",
    l2Summary: "L2 can inspect the form, but the benchmark must not count this as closure success.",
    owner: "provider-runtime",
    patch: true,
    artifactSignals: [
      "Checkout reached",
      "Traveler form state missing=first name,last name,email address,phone number",
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
    patch: true,
    patchTitle: "Expedia flight artifact topology guard",
    patchFiles: ["lib/runtime-forensics/expedia-retry-analysis.ts", "worker log capture path"],
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
