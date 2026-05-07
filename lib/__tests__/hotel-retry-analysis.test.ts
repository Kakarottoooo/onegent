import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  analyzeHotelRetryArtifactBundle,
  buildHotelFallbackRecommendation,
  evaluateHotelNoAvailabilityEvidence,
  formatHotelRetryAnalysisMarkdown,
  formatHotelRetryArtifactBundleMarkdown,
  type HotelRetryArtifactBundle,
  type HotelRetryState,
} from "@/lib/runtime-forensics/hotel-retry-analysis";

const FIXTURE_DIR = path.join(
  process.cwd(),
  "lib",
  "runtime-forensics",
  "__fixtures__",
  "hotel-retry-analysis",
);

const CASES: Array<{ file: string; state: HotelRetryState; provider: string }> = [
  {
    file: "booking-room-selection-drift.json",
    state: "room_selection_drift",
    provider: "booking-com",
  },
  {
    file: "booking-provider-selector-drift.json",
    state: "provider_selector_drift",
    provider: "booking-com",
  },
  {
    file: "booking-room-selection-reached.json",
    state: "room_selection_manual_review_reached",
    provider: "booking-com",
  },
  {
    file: "booking-guest-details-reached.json",
    state: "guest_details_manual_review_reached",
    provider: "booking-com",
  },
  {
    file: "hotels-payment-manual-review-reached.json",
    state: "payment_manual_review_reached",
    provider: "hotels-com",
  },
  {
    file: "booking-login-captcha-boundary.json",
    state: "login_or_captcha_boundary",
    provider: "booking-com",
  },
  {
    file: "booking-profile-gating.json",
    state: "profile_gating",
    provider: "booking-com",
  },
  {
    file: "booking-network-provider-failure.json",
    state: "network_provider_failure",
    provider: "booking-com",
  },
  {
    file: "booking-no-availability.json",
    state: "provider_no_availability",
    provider: "booking-com",
  },
  {
    file: "booking-model-env-transient.json",
    state: "model_env_transient",
    provider: "booking-com",
  },
  {
    file: "hotel-safety-boundary-violation.json",
    state: "safety_boundary_violation",
    provider: "booking-com",
  },
];

describe("analyzeHotelRetryArtifactBundle", () => {
  it.each(CASES)("classifies $file", async ({ file, state, provider }) => {
    const bundle = await readFixture(file);
    const analysis = analyzeHotelRetryArtifactBundle(bundle);

    expect(analysis.state).toBe(state);
    expect(analysis.jobId).toMatch(/^fixture-hotel-/);
    expect(analysis.provider).toBe(provider);
    expect(analysis.scenario).toBe("hotel");
    expect(analysis.signals.length).toBeGreaterThan(0);
  });

  it("prioritizes safety violations over otherwise successful checkout signals", async () => {
    const bundle = await readFixture("hotel-safety-boundary-violation.json");
    const analysis = analyzeHotelRetryArtifactBundle(bundle);

    expect(analysis.state).toBe("safety_boundary_violation");
    expect(analysis.signals.map((s) => s.kind)).toContain("payment_boundary");
    expect(analysis.signals[0]?.kind).toBe("safety_boundary_violation");
  });

  it("does not treat runbook safety notes as a login/CAPTCHA boundary", async () => {
    const bundle = await readFixture("booking-guest-details-reached.json");
    const analysis = analyzeHotelRetryArtifactBundle(bundle);

    expect(analysis.state).toBe("guest_details_manual_review_reached");
    expect(analysis.signals.map((s) => s.kind)).not.toContain("login_or_captcha");
  });

  it("covers the hotel live-readiness triage split without invoking providers", async () => {
    const triageCases: Array<{ file: string; state: HotelRetryState }> = [
      {
        file: "booking-provider-selector-drift.json",
        state: "provider_selector_drift",
      },
      {
        file: "booking-room-selection-drift.json",
        state: "room_selection_drift",
      },
      {
        file: "booking-guest-details-reached.json",
        state: "guest_details_manual_review_reached",
      },
      {
        file: "booking-model-env-transient.json",
        state: "model_env_transient",
      },
      {
        file: "booking-network-provider-failure.json",
        state: "network_provider_failure",
      },
      {
        file: "booking-no-availability.json",
        state: "provider_no_availability",
      },
    ];

    for (const { file, state } of triageCases) {
      const bundle = await readFixture(file);
      const analysis = analyzeHotelRetryArtifactBundle(bundle);

      expect(analysis.state, file).toBe(state);
      expect(analysis.signals.length, file).toBeGreaterThan(0);
      expect(analysis.nextAction, file).not.toMatch(
        /\b(click|press|submit|enter|fill)\s+(final|cvv|cvc|payment|otp|captcha|login)\b/i,
      );
    }
  });

  it("keeps OpenAI Responses API 500 separate from hotel provider/network bugs", async () => {
    const bundle = await readFixture("booking-model-env-transient.json");
    const analysis = analyzeHotelRetryArtifactBundle(bundle);

    expect(analysis.state).toBe("model_env_transient");
    expect(analysis.signals.map((s) => s.kind)).toContain("model_env_transient");
    expect(analysis.signals.map((s) => s.kind)).toContain("network_provider_failure");
    expect(analysis.nextAction).toContain("Do not patch hotel provider selectors");
  });

  it("classifies weak generic Booking.com not-available copy as provider degraded and fallback eligible", () => {
    const bundle: HotelRetryArtifactBundle = {
      job: yotelJob("booking-com"),
      workerLogExcerpt:
        "[booking-com] Search results page displayed generic copy: This property is not available. No properties match your search.",
      workerLogPath: "codex-worker.log",
      screenshotPaths: ["worker/.debug-screenshots/booking-com/01-generic-not-available.jpg"],
      liveSnapshotPaths: [".debug-screenshots/live/weak-not-available/snapshot.json"],
      notes: ["Synthetic no-live fixture. No payment, login, OTP, CAPTCHA, or final confirmation."],
    };

    const analysis = analyzeHotelRetryArtifactBundle(bundle);

    expect(analysis.state).toBe("network_provider_failure");
    expect(analysis.label).toBe("Network/provider degraded");
    expect(analysis.noAvailabilityEvidence.state).toBe("weak_no_availability");
    expect(analysis.noAvailabilityEvidence.missingEvidence).toContain("exact hotel");
    expect(analysis.noAvailabilityEvidence.missingEvidence).toContain("exact dates/adults/rooms");
    expect(analysis.fallbackRecommendation).toMatchObject({
      eligible: true,
      nextProviders: ["hotels-com", "expedia-hotel"],
      preservedParams: {
        hotel: "YOTEL New York Times Square",
        city: "New York",
        checkIn: "2026-06-10",
        checkOut: "2026-06-12",
        adults: 1,
        rooms: 1,
        budget: "300",
      },
    });
    expect(analysis.nextAction).toContain("provider-degraded/fallback-eligible");
  });

  it("does not recommend fallback when exact hotel/date/stay no-availability is verified", () => {
    const bundle: HotelRetryArtifactBundle = {
      job: yotelJob("booking-com"),
      workerLogExcerpt:
        "[booking-com] Hotel detail visible for YOTEL New York Times Square\n" +
        "[booking-com] approved stay evidence: checkin=2026-06-10 checkout=2026-06-12 adults=1 rooms=1 budget=300\n" +
        "[booking-com] no rooms available for selected dates",
      workerLogPath: "codex-worker.log",
      screenshotPaths: ["worker/.debug-screenshots/booking-com/01-exact-no-availability.jpg"],
      liveSnapshotPaths: [".debug-screenshots/live/exact-no-availability/snapshot.json"],
      notes: ["Synthetic no-live fixture. Exact stay unavailable; no payment/login/final action."],
    };

    const noAvailability = evaluateHotelNoAvailabilityEvidence(bundle);
    const recommendation = buildHotelFallbackRecommendation(
      bundle,
      "provider_no_availability",
      noAvailability,
    );
    const analysis = analyzeHotelRetryArtifactBundle(bundle);

    expect(noAvailability.state).toBe("verified_true_no_availability");
    expect(recommendation.eligible).toBe(false);
    expect(analysis.state).toBe("provider_no_availability");
    expect(analysis.fallbackRecommendation.eligible).toBe(false);
  });

  it("preserves exact stay params when Hotels.com is fallback eligible", () => {
    const analysis = analyzeHotelRetryArtifactBundle({
      job: yotelJob("hotels-com"),
      workerLogExcerpt:
        "[hotels-com] Hotel search result page says not available, but no exact hotel/date/stay inventory proof was captured.",
      workerLogPath: "codex-worker.log",
      screenshotPaths: ["worker/.debug-screenshots/hotels-com/01-generic-not-available.jpg"],
      liveSnapshotPaths: [".debug-screenshots/live/hotels-weak-not-available/snapshot.json"],
    });

    expect(analysis.state).toBe("network_provider_failure");
    expect(analysis.fallbackRecommendation.eligible).toBe(true);
    expect(analysis.fallbackRecommendation.nextProviders).toEqual(["expedia-hotel"]);
    expect(analysis.fallbackRecommendation.preservedParams).toEqual({
      hotel: "YOTEL New York Times Square",
      city: "New York",
      checkIn: "2026-06-10",
      checkOut: "2026-06-12",
      adults: 1,
      rooms: 1,
      budget: "300",
    });
  });

  it("classifies explicit Booking.com runtime boundary log lines", () => {
    const cases: Array<{ line: string; state: HotelRetryState }> = [
      {
        line: "Booking.com hotel runtime boundary: provider_selector_drift - Target hotel candidate is visible but runtime did not reach the property detail page.",
        state: "provider_selector_drift",
      },
      {
        line: "Booking.com hotel runtime boundary: room_selection_manual_review_reached - Room inventory or reserve controls are visible on the hotel detail page.",
        state: "room_selection_manual_review_reached",
      },
      {
        line: "Booking.com hotel runtime boundary: guest_details_manual_review_reached - Guest-details step is visible before payment/final confirmation.",
        state: "guest_details_manual_review_reached",
      },
      {
        line: "Booking.com hotel runtime boundary: payment_manual_review_reached - manual-review/no-payment instruction honored; no card fields filled.",
        state: "payment_manual_review_reached",
      },
      {
        line: "Booking.com hotel runtime boundary: network_provider_failure - Booking.com or the browser reported a degraded provider/network response.",
        state: "network_provider_failure",
      },
    ];

    for (const { line, state } of cases) {
      const analysis = analyzeHotelRetryArtifactBundle({
        job: {
          id: `fixture-hotel-${state}`,
          provider: "booking-com",
          scenario: "hotel",
          status: "failed",
        },
        workerLogExcerpt: line,
      });

      expect(analysis.state, line).toBe(state);
      expect(analysis.signals.length, line).toBeGreaterThan(0);
    }
  });

  it("returns insufficient evidence for bundles without known signals", () => {
    const analysis = analyzeHotelRetryArtifactBundle({
      job: {
        id: "fixture-hotel-no-signals",
        provider: "booking-com",
        scenario: "hotel",
        status: "failed",
      },
    });

    expect(analysis.state).toBe("insufficient_evidence");
    expect(analysis.confidence).toBe("low");
    expect(analysis.signals).toEqual([]);
  });
});

describe("Hotel retry markdown helpers", () => {
  it("formats a paste-ready summary from an analysis", async () => {
    const bundle = await readFixture("booking-room-selection-drift.json");
    const analysis = analyzeHotelRetryArtifactBundle(bundle);
    const markdown = formatHotelRetryAnalysisMarkdown(analysis);

    expect(markdown).toContain("## Hotel Retry Artifact Analysis");
    expect(markdown).toContain("room_selection_drift");
    expect(markdown).toContain("worker/.debug-screenshots/booking-com-fixture-room-drift");
    expect(markdown).toContain("### No-Availability / Fallback");
    expect(markdown).toContain("### Next Action");
  });

  it("formats a paste-ready summary directly from an artifact bundle", async () => {
    const bundle = await readFixture("hotels-payment-manual-review-reached.json");
    const markdown = formatHotelRetryArtifactBundleMarkdown(bundle);

    expect(markdown).toContain("payment_manual_review_reached");
    expect(markdown).toContain("Hotel Retry Artifact Analysis");
    expect(markdown).toContain("codex-worker.log");
  });
});

async function readFixture(file: string): Promise<HotelRetryArtifactBundle> {
  const raw = await fs.readFile(path.join(FIXTURE_DIR, file), "utf8");
  return JSON.parse(raw) as HotelRetryArtifactBundle;
}

function yotelJob(provider: "booking-com" | "hotels-com"): NonNullable<HotelRetryArtifactBundle["job"]> {
  return {
    id: `fixture-hotel-${provider}-yotel`,
    taskId: `fixture-task-${provider}-yotel`,
    provider,
    scenario: "hotel",
    status: "failed",
    params: {
      hotelName: "YOTEL New York Times Square",
      city: "New York",
      checkIn: "2026-06-10",
      checkOut: "2026-06-12",
      adults: 1,
      rooms: 1,
      budgetPerNight: 300,
    },
  };
}
