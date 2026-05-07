import { describe, expect, it } from "vitest";

import {
  classifyHotelL1Stage,
  classifyHotelProviderFallbackEligibility,
  evaluateHotelNoAvailabilityEvidence,
  extractHotelLayeredContextFromArtifact,
  validateHotelLayeredArtifactCompleteness,
} from "@/lib/runtime-forensics/hotel-layered-recovery";
import {
  analyzeHotelRetryArtifactBundle,
  type HotelRetryArtifactBundle,
} from "@/lib/runtime-forensics/hotel-retry-analysis";

const EXACT_CONTEXT = {
  provider: "booking-com",
  targetHotelName: "YOTEL New York Times Square",
  city: "New York",
  checkin: "2026-06-10",
  checkout: "2026-06-12",
  adults: 1,
  rooms: 1,
};

describe("hotel layered recovery", () => {
  it("guards false no-availability when exact hotel/date/stay evidence is missing", () => {
    const noAvailability = evaluateHotelNoAvailabilityEvidence({
      ...EXACT_CONTEXT,
      currentUrl: "https://www.booking.com/searchresults.html?ss=New+York",
      workerLogExcerpt: "Search results showed no availability. No properties match your search.",
    });

    expect(noAvailability.state).toBe("weak_no_availability");
    expect(noAvailability.missingEvidence).toContain("exact hotel");
    expect(noAvailability.missingEvidence).toContain("exact dates/adults/rooms");

    const analysis = analyzeHotelRetryArtifactBundle({
      job: baseJob(),
      workerLogExcerpt: "Search results showed no availability. No properties match your search.",
      workerLogPath: "codex-worker.log",
      screenshotPaths: ["worker/.debug-screenshots/booking-com/01-search-results.jpg"],
      liveSnapshotPaths: [".debug-screenshots/live/weak-no-availability/snapshot.json"],
      notes: ["Synthetic fixture. No payment/login/final boundary crossed."],
    });

    expect(analysis.state).toBe("network_provider_failure");
    expect(analysis.layeredRecovery.noAvailabilityEvidence.state).toBe("weak_no_availability");
    expect(analysis.layeredRecovery.fallbackEligibility.eligible).toBe(true);
    expect(analysis.layeredRecovery.fallbackEligibility.nextProviders).toEqual([
      "hotels-com",
      "expedia-hotel",
    ]);
  });

  it("requires exact hotel/date/stay evidence before true no-availability", () => {
    const missingStay = evaluateHotelNoAvailabilityEvidence({
      ...EXACT_CONTEXT,
      workerLogExcerpt: "YOTEL New York Times Square is fully booked.",
    });
    expect(missingStay.state).toBe("weak_no_availability");
    expect(missingStay.missingEvidence).toContain("exact dates/adults/rooms");

    const verified = evaluateHotelNoAvailabilityEvidence({
      ...EXACT_CONTEXT,
      currentUrl:
        "https://www.booking.com/hotel/us/yotel-new-york.html?checkin=2026-06-10&checkout=2026-06-12&group_adults=1&no_rooms=1",
      workerLogExcerpt:
        "YOTEL New York Times Square has no rooms available for selected dates.",
    });
    expect(verified.state).toBe("verified_true_no_availability");
    expect(verified.missingEvidence).toEqual([]);

    const analysis = analyzeHotelRetryArtifactBundle({
      job: baseJob(),
      workerLogExcerpt:
        "Hotel detail visible for YOTEL New York Times Square. checkin=2026-06-10 checkout=2026-06-12 adults=1 rooms=1. No rooms available for selected dates.",
      workerLogPath: "codex-worker.log",
      screenshotPaths: ["worker/.debug-screenshots/booking-com/01-hotel-detail.jpg"],
      liveSnapshotPaths: [".debug-screenshots/live/verified-no-availability/snapshot.json"],
      notes: ["Synthetic fixture. Exact stay unavailable; no payment/login/final boundary crossed."],
    });
    expect(analysis.state).toBe("provider_no_availability");
    expect(analysis.layeredRecovery.fallbackEligibility.eligible).toBe(false);
  });

  it("marks provider fallback eligibility for L2-safe failures only", () => {
    expect(
      classifyHotelProviderFallbackEligibility({
        ...EXACT_CONTEXT,
        state: "provider_selector_drift",
      }),
    ).toMatchObject({
      eligible: true,
      nextProviders: ["hotels-com", "expedia-hotel"],
    });

    expect(
      classifyHotelProviderFallbackEligibility({
        ...EXACT_CONTEXT,
        state: "guest_details_manual_review_reached",
      }).eligible,
    ).toBe(false);

    expect(
      classifyHotelProviderFallbackEligibility({
        ...EXACT_CONTEXT,
        state: "login_or_captcha_boundary",
      }).eligible,
    ).toBe(false);
  });

  it("classifies guest/review boundaries as human-controlled L1 stops", () => {
    expect(
      classifyHotelL1Stage({
        ...EXACT_CONTEXT,
        currentUrl: "https://secure.booking.com/book.html",
        workerLogExcerpt: "Guest details form visible before payment. First name, last name, email.",
      }),
    ).toBe("guest_review");

    const analysis = analyzeHotelRetryArtifactBundle({
      job: baseJob(),
      workerLogExcerpt:
        "Booking.com hotel runtime boundary: guest_details_manual_review_reached - Guest details page visible before payment.",
      workerLogPath: "codex-worker.log",
      screenshotPaths: ["worker/.debug-screenshots/booking-com/02-guest-details.jpg"],
      liveSnapshotPaths: [".debug-screenshots/live/guest-review/snapshot.json"],
      notes: ["Synthetic fixture. Operator stopped before payment, login, CVV, or final confirmation."],
    });

    expect(analysis.state).toBe("guest_details_manual_review_reached");
    expect(analysis.layeredRecovery.l1Stage).toBe("guest_review");
    expect(analysis.layeredRecovery.fallbackEligibility.eligible).toBe(false);
  });

  it("validates artifact completeness without reading external systems", () => {
    const completeBundle: HotelRetryArtifactBundle = {
      job: baseJob(),
      workerLogExcerpt:
        "Hotel detail visible for YOTEL New York Times Square. checkin=2026-06-10 checkout=2026-06-12 adults=1 rooms=1. Room selection reached.",
      workerLogPath: "codex-worker.log",
      screenshotPaths: ["worker/.debug-screenshots/booking-com/01-room-selection.jpg"],
      liveSnapshotPaths: [".debug-screenshots/live/complete/snapshot.json"],
      notes: ["Synthetic no-live artifact bundle."],
    };

    expect(validateHotelLayeredArtifactCompleteness(completeBundle).complete).toBe(true);
    expect(extractHotelLayeredContextFromArtifact(completeBundle)).toMatchObject(EXACT_CONTEXT);

    const incomplete = validateHotelLayeredArtifactCompleteness({
      job: { id: "fixture-hotel-incomplete", provider: "booking-com", scenario: "hotel", status: "failed" },
    });
    expect(incomplete.complete).toBe(false);
    expect(incomplete.missing).toContain("hotel name");
    expect(incomplete.missing).toContain("workerLogExcerpt");
    expect(incomplete.missing).toContain("screenshotPaths");
  });
});

function baseJob(): NonNullable<HotelRetryArtifactBundle["job"]> {
  return {
    id: "fixture-hotel-layered-recovery",
    taskId: "fixture-task-hotel-layered-recovery",
    provider: "booking-com",
    scenario: "hotel",
    status: "failed",
    params: {
      city: "New York",
      checkIn: "2026-06-10",
      checkOut: "2026-06-12",
      adults: 1,
      rooms: 1,
      hotelName: "YOTEL New York Times Square",
    },
  };
}
