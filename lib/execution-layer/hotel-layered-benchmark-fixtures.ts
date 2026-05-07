import type {
  LayeredBenchmarkArtifactExpectations,
  LayeredBenchmarkCase,
  LayeredBenchmarkEvidenceCompleteness,
  LayeredBenchmarkFailureClass,
  LayeredBenchmarkHotelContract,
  LayeredBenchmarkHotelFallbackParams,
  LayeredBenchmarkL2Status,
  LayeredBenchmarkOwner,
  LayeredBenchmarkPatchProposal,
  LayeredBenchmarkVerticalConfig,
} from "./layered-benchmark";

const HOTEL_TARGET: LayeredBenchmarkHotelFallbackParams = {
  hotel: "YOTEL New York Times Square",
  city: "New York",
  checkin: "2026-06-10",
  checkout: "2026-06-12",
  adults: 1,
  rooms: 1,
  budget: "300",
};

export function buildHotelLayeredBenchmarkCases(
  config: LayeredBenchmarkVerticalConfig,
): LayeredBenchmarkCase[] {
  return [
    hotelDirectPass(config),
    hotelExactNoAvailability(config),
    hotelWeakNoAvailabilityFallback(config),
    hotelProviderDegraded(config),
    hotelFallbackPreservesParams(config),
    hotelRoomSelectionDrift(config),
    hotelGuestReviewBoundary(config),
    hotelAccountBoundary(config),
    hotelArtifactIncomplete(config),
    hotelStaleRunningState(config),
  ];
}

function hotelDirectPass(config: LayeredBenchmarkVerticalConfig): LayeredBenchmarkCase {
  return hotelBaseCase(config, 1, {
    failureClass: "none",
    l1Result: {
      status: "passed",
      terminalState: "guest_details_manual_review_reached",
      summary: "L1 reached Booking.com guest-details review without payment, login, or final confirmation.",
    },
    evidenceCompleteness: completeHotelEvidence(1),
    l2Eligible: false,
    l2SimulatedResult: {
      status: "not_applicable",
      summary: "No L2 recovery is needed after a safe hotel review handoff.",
    },
    patchProposal: noPatch("Direct hotel review pass does not require a patch."),
    owner: "product/manual-boundary",
    hotelContract: {
      artifactContract: completeArtifactContract(),
    },
  });
}

function hotelExactNoAvailability(config: LayeredBenchmarkVerticalConfig): LayeredBenchmarkCase {
  return hotelBaseCase(config, 2, {
    failureClass: "true_no_availability",
    l1Result: {
      status: "blocked",
      terminalState: "provider_no_availability",
      summary: "Booking.com showed exact no-availability for the target hotel and approved stay.",
    },
    evidenceCompleteness: completeHotelEvidence(2),
    l2Eligible: false,
    l2SimulatedResult: {
      status: "not_applicable",
      summary: "Provider fallback is not eligible when exact hotel/date/stay unavailability is proven.",
    },
    patchProposal: noPatch("Exact no-availability is a provider inventory outcome."),
    owner: "product/manual-boundary",
    hotelContract: {
      noAvailabilityEvidence: {
        state: "verified_true_no_availability",
        missingEvidence: [],
        reason: "Exact hotel, city, dates, adults, rooms, budget, and scoped inventory copy are present.",
      },
      providerFallback: fallbackContract(false, [], "Exact no-availability is verified."),
      artifactContract: completeArtifactContract(),
    },
  });
}

function hotelWeakNoAvailabilityFallback(config: LayeredBenchmarkVerticalConfig): LayeredBenchmarkCase {
  return hotelBaseCase(config, 3, {
    failureClass: "provider_degraded",
    l1Result: {
      status: "blocked",
      terminalState: "weak_no_availability",
      summary: "Booking.com showed generic not-available copy without exact hotel/date/stay proof.",
    },
    evidenceCompleteness: completeHotelEvidence(3),
    l2Eligible: false,
    l2SimulatedResult: {
      status: "not_applicable",
      summary: "Shared Browser Harness L2 is not eligible; alternate-provider fallback is eligible.",
    },
    patchProposal: noPatch("Weak no-availability should not be patched as true inventory unavailable."),
    owner: "product/manual-boundary",
    hotelContract: {
      noAvailabilityEvidence: {
        state: "weak_no_availability",
        missingEvidence: ["exact hotel", "exact dates/adults/rooms", "scoped room inventory"],
        reason: "Generic search/listing copy is provider-degraded evidence only.",
      },
      providerFallback: fallbackContract(
        true,
        ["hotels-com", "expedia-hotel"],
        "Weak no-availability can fall back only while preserving exact stay params.",
      ),
      artifactContract: completeArtifactContract(),
    },
  });
}

function hotelProviderDegraded(config: LayeredBenchmarkVerticalConfig): LayeredBenchmarkCase {
  return hotelBaseCase(config, 4, {
    failureClass: "provider_degraded",
    l1Result: {
      status: "blocked",
      terminalState: "network_provider_failure",
      summary: "Provider returned 5xx/session instability before exact inventory proof.",
    },
    evidenceCompleteness: completeHotelEvidence(4),
    l2Eligible: false,
    l2SimulatedResult: {
      status: "not_applicable",
      summary: "Shared Browser Harness L2 is not eligible for provider/network degradation.",
    },
    patchProposal: noPatch("Do not patch hotel selectors from provider/network evidence alone."),
    owner: "product/manual-boundary",
    hotelContract: {
      noAvailabilityEvidence: {
        state: "not_no_availability",
        missingEvidence: [],
        reason: "No scoped no-availability signal was present.",
      },
      providerFallback: fallbackContract(
        true,
        ["hotels-com", "expedia-hotel"],
        "Provider degradation can fall back after evidence capture and without a blind retry loop.",
      ),
      artifactContract: completeArtifactContract(),
    },
  });
}

function hotelFallbackPreservesParams(config: LayeredBenchmarkVerticalConfig): LayeredBenchmarkCase {
  return hotelBaseCase(config, 5, {
    failureClass: "selector_drift",
    l1Result: {
      status: "blocked",
      terminalState: "provider_selector_drift",
      summary: "Target hotel card was visible but the L1 selector did not reach property detail.",
    },
    evidenceCompleteness: completeHotelEvidence(5),
    l2Eligible: true,
    l2SimulatedResult: {
      status: "recovered",
      summary: "Simulated L2 selected the visible hotel card and preserved the approved stay.",
      recoveredTerminalState: "room_selection_manual_review_reached",
    },
    patchProposal: noPatch("L2 recovery covered this synthetic selector drift case."),
    owner: "browser-harness",
    hotelContract: {
      providerFallback: fallbackContract(
        true,
        ["hotels-com", "expedia-hotel"],
        "If L2 is unavailable, provider fallback must preserve the exact approved stay.",
      ),
      artifactContract: completeArtifactContract(),
    },
  });
}

function hotelRoomSelectionDrift(config: LayeredBenchmarkVerticalConfig): LayeredBenchmarkCase {
  return hotelBaseCase(config, 6, {
    failureClass: "selector_drift",
    l1Result: {
      status: "blocked",
      terminalState: "room_selection_drift",
      summary: "Room/rate inventory was visible but room selection did not complete.",
    },
    evidenceCompleteness: completeHotelEvidence(6),
    l2Eligible: true,
    l2SimulatedResult: {
      status: "needs_patch",
      summary: "Simulated L2 could not recover without a room-card selector patch.",
    },
    patchProposal: {
      proposed: true,
      title: "Booking.com room selection evidence guard",
      files: ["lib/booking-autopilot/providers/booking-com.ts", "worker/src/booking-autopilot/providers/booking-com.ts"],
      risk: "medium",
      notes: "Patch only after real screenshots prove the visible room control drift.",
    },
    owner: "provider-runtime",
    hotelContract: {
      artifactContract: completeArtifactContract(),
    },
  });
}

function hotelGuestReviewBoundary(config: LayeredBenchmarkVerticalConfig): LayeredBenchmarkCase {
  return hotelBaseCase(config, 7, {
    failureClass: "user_only_final_action",
    l1Result: {
      status: "manual_boundary",
      terminalState: "guest_details_manual_review_reached",
      summary: "Guest/review page was reached and the run stopped before payment or final confirmation.",
    },
    evidenceCompleteness: completeHotelEvidence(7),
    l2Eligible: false,
    l2SimulatedResult: {
      status: "not_applicable",
      summary: "Guest/review is a user-controlled continuation point, not an L2 recovery target.",
    },
    patchProposal: noPatch("Manual review boundary is expected hotel behavior."),
    owner: "product/manual-boundary",
    hotelContract: {
      artifactContract: completeArtifactContract(),
    },
  });
}

function hotelAccountBoundary(config: LayeredBenchmarkVerticalConfig): LayeredBenchmarkCase {
  return hotelBaseCase(config, 8, {
    failureClass: "account_checkpoint",
    l1Result: {
      status: "manual_boundary",
      terminalState: "login_or_captcha_boundary",
      summary: "Provider displayed sign-in, account, CAPTCHA, OTP, or session verification boundary.",
    },
    evidenceCompleteness: completeHotelEvidence(8),
    l2Eligible: false,
    l2SimulatedResult: {
      status: "not_applicable",
      summary: "L2 must not bypass account, login, CAPTCHA, OTP, or verification checks.",
    },
    patchProposal: noPatch("Account/session checkpoint is a hard stop."),
    owner: "product/manual-boundary",
    hotelContract: {
      artifactContract: completeArtifactContract(),
    },
  });
}

function hotelArtifactIncomplete(config: LayeredBenchmarkVerticalConfig): LayeredBenchmarkCase {
  return hotelBaseCase(config, 9, {
    failureClass: "insufficient_evidence",
    l1Result: {
      status: "insufficient_evidence",
      terminalState: "missing_hotel_artifact_contract",
      summary: "The hotel bundle lacks enough DB/log/screenshot/current URL evidence to classify safely.",
    },
    evidenceCompleteness: incompleteHotelEvidence(9),
    l2Eligible: false,
    l2SimulatedResult: {
      status: "not_applicable",
      summary: "L2 and provider fallback are blocked until artifact capture is complete.",
    },
    patchProposal: {
      proposed: true,
      title: "Hotel artifact completeness guard",
      files: ["lib/runtime-forensics/hotel-retry-analysis.ts"],
      risk: "low",
      notes: "Improve report/artifact capture before another recovery decision.",
    },
    owner: "task-workspace",
    hotelContract: {
      artifactContract: {
        complete: false,
        missing: ["decisionLog", "screenshotPaths", "currentUrl"],
        summary: "Missing decision log, screenshots, and current URL.",
      },
    },
  });
}

function hotelStaleRunningState(config: LayeredBenchmarkVerticalConfig): LayeredBenchmarkCase {
  return hotelBaseCase(config, 10, {
    failureClass: "insufficient_evidence",
    l1Result: {
      status: "insufficient_evidence",
      terminalState: "stale_running_state",
      summary:
        "Worker/browser evidence ended, but task status remained running; do not count stale evidence as closure.",
    },
    evidenceCompleteness: completeHotelEvidence(10),
    l2Eligible: false,
    l2SimulatedResult: {
      status: "not_applicable",
      summary: "L2 and provider fallback are blocked until stale evidence is re-collected or reconciled.",
    },
    patchProposal: {
      proposed: true,
      title: "Hotel stale running evidence guard",
      files: ["lib/booking-jobs/workspace.ts", "app/api/booking-jobs/[id]/start/route.ts"],
      risk: "low",
      notes:
        "Close or reclassify stale running state from clean current evidence before scheduling more provider work.",
    },
    owner: "task-workspace",
    hotelContract: {
      artifactContract: completeArtifactContract(),
      staleRunningState: {
        staleStatus: "running",
        ownerAction: "task-workspace must close or reclassify stale running state from artifact evidence.",
      },
    },
  });
}

function hotelBaseCase(
  config: LayeredBenchmarkVerticalConfig,
  index: number,
  overrides: Omit<
    LayeredBenchmarkCase,
    | "id"
    | "vertical"
    | "provider"
    | "taskIntent"
    | "expectedTarget"
    | "dogfoodBugLink"
    | "artifactExpectations"
  > & { artifactExpectations?: LayeredBenchmarkArtifactExpectations },
): LayeredBenchmarkCase {
  const caseId = `lbv2-hotel-${String(index).padStart(2, "0")}`;
  const { artifactExpectations, ...rest } = overrides;
  return {
    id: caseId,
    vertical: "hotel",
    provider: config.provider,
    taskIntent: {
      rawUtterance:
        "Prepare a manual hotel booking review for YOTEL New York Times Square in New York from 2026-06-10 to 2026-06-12 for 1 adult, 1 room, under $300 per night.",
      fields: {
        hotel: HOTEL_TARGET.hotel,
        city: HOTEL_TARGET.city,
        checkin: HOTEL_TARGET.checkin,
        checkout: HOTEL_TARGET.checkout,
        adults: HOTEL_TARGET.adults,
        rooms: HOTEL_TARGET.rooms,
        budget: HOTEL_TARGET.budget,
      },
    },
    expectedTarget: {
      providerStage: "Booking.com hotel detail, room selection, and guest/review handoff",
      safeTerminalState: config.safeTerminalState,
      hardStop: "Stop before login, verification, payment/CVV, final confirmation, or any user-only action.",
    },
    dogfoodBugLink: config.dogfoodBugLink,
    artifactExpectations:
      artifactExpectations ??
      defaultHotelArtifactExpectations(caseId, rest.failureClass, rest.patchProposal.proposed),
    ...rest,
  };
}

function fallbackContract(
  eligible: boolean,
  nextProviders: string[],
  reason: string,
): NonNullable<LayeredBenchmarkHotelContract["providerFallback"]> {
  return {
    eligible,
    nextProviders,
    preservedParams: { ...HOTEL_TARGET },
    reason,
  };
}

function completeArtifactContract(): NonNullable<LayeredBenchmarkHotelContract["artifactContract"]> {
  return {
    complete: true,
    missing: [],
    summary: "DB row, decision log, worker log, screenshot, current URL, and benchmark report are present.",
  };
}

function completeHotelEvidence(index: number): LayeredBenchmarkEvidenceCompleteness {
  return {
    syntheticMarker: true,
    fixtureId: `synthetic-hotel-${String(index).padStart(2, "0")}`,
    hasDbRow: true,
    hasDecisionLog: true,
    hasWorkerLog: true,
    hasScreenshot: true,
    hasCurrentUrl: true,
    hasBenchmarkReport: true,
    score: 1,
  };
}

function incompleteHotelEvidence(index: number): LayeredBenchmarkEvidenceCompleteness {
  return {
    syntheticMarker: true,
    fixtureId: `synthetic-hotel-${String(index).padStart(2, "0")}`,
    hasDbRow: true,
    hasDecisionLog: false,
    hasWorkerLog: true,
    hasScreenshot: false,
    hasCurrentUrl: false,
    hasBenchmarkReport: true,
    score: 0.5,
  };
}

function defaultHotelArtifactExpectations(
  caseId: string,
  failureClass: LayeredBenchmarkFailureClass,
  patchProposed: boolean,
): LayeredBenchmarkArtifactExpectations {
  return {
    requiredSources: [
      "booking_jobs row",
      "decisionLog",
      "worker log excerpt",
      "provider screenshot",
      "current URL",
      "hotel retry analysis report",
    ],
    evidenceContract: `${caseId} must preserve exact hotel, city, dates, adults, rooms, budget, and classify ${failureClass}.`,
    classificationSignals: [
      `failureClass=${failureClass}`,
      "provider=Booking.com",
      "hotel=YOTEL New York Times Square",
      "fallbackParamsPreserved=yes",
    ],
    patchProposalFields: patchProposed
      ? ["title", "files", "risk", "notes"]
      : ["proposed=false", "risk=none", "notes"],
  };
}

function noPatch(notes: string): LayeredBenchmarkPatchProposal {
  return {
    proposed: false,
    risk: "none",
    notes,
  };
}
