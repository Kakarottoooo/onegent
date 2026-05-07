import { describe, it, expect } from "vitest";
import {
  determineFinalOutcome,
  NO_AVAILABILITY_SIGNALS,
} from "@/lib/booking-autopilot/core/final-outcome";

// These tests pin the specific page-copy fragments we rely on the listing-stage
// classifier in stagehand-executor.ts to recognise as no_availability rather
// than a generic "stuck" → status=error. Discovered while diagnosing the real
// benchmark run on 2026-04-30: OT/Resy not-bookable pages were running 30s+
// before being misclassified as executor_error because none of the previous
// signals matched their copy.

function matchesAnySignal(text: string): boolean {
  const lower = text.toLowerCase();
  return NO_AVAILABILITY_SIGNALS.some((sig) => lower.includes(sig));
}

describe("NO_AVAILABILITY_SIGNALS — restaurant venue not-bookable", () => {
  it("matches OpenTable 'Not available on OpenTable' panel", () => {
    // Real copy from opentable.com/r/lartusi-new-york
    const text = "Not available on OpenTable. Unfortunately, this restaurant is not on the OpenTable booking network. To check availability, please contact them directly.";
    expect(matchesAnySignal(text)).toBe(true);
  });

  it("matches OpenTable 'Permanently Closed' panel", () => {
    // Real copy from opentable.com/r/carbone-new-york
    const text = "Permanently Closed. This restaurant is permanently closed.";
    expect(matchesAnySignal(text)).toBe(true);
  });

  it("matches OpenTable 'Find similar restaurants' fallback button", () => {
    // The CTA on both not-bookable + permanently-closed venue pages
    const text = "Find similar restaurants";
    expect(matchesAnySignal(text)).toBe(true);
  });

  it("matches OpenTable 404 page (octopus illustration + 'embarrassing')", () => {
    // Real copy from opentable.com/via-carota (slug doesn't exist under /r/)
    const text = "Well, this is embarrassing. We weren't able to find the page you're looking for.";
    expect(matchesAnySignal(text)).toBe(true);
  });

  it("matches Resy 404 page", () => {
    // Real copy from resy.com/cities/new-york-ny/venues/don-angie
    const text = "Sorry, but we can't find that page. Please check that the address is correct or go back to the home page.";
    expect(matchesAnySignal(text)).toBe(true);
  });

  it("matches Resy listing where today is full but venue is bookable later", () => {
    // Real copy from resy.com/cities/new-york-ny/venues/lilia (2026-04-30)
    const text = "At the moment, there's no online availability for Today. The next availability for 2 is Tomorrow.";
    expect(matchesAnySignal(text)).toBe(true);
  });
});

describe("NO_AVAILABILITY_SIGNALS — pre-existing hotel signals still match", () => {
  it("still matches Booking.com 'sold out'", () => {
    expect(matchesAnySignal("This property is sold out for your dates")).toBe(true);
  });

  it("still matches Booking.com 'fully booked'", () => {
    expect(matchesAnySignal("Hotel is fully booked")).toBe(true);
  });

  it("still matches the Chinese signals", () => {
    expect(matchesAnySignal("没有可用的房间")).toBe(true);
    expect(matchesAnySignal("找不到任何匹配的酒店")).toBe(true);
  });
});

describe("NO_AVAILABILITY_SIGNALS — does not over-match", () => {
  it("does not match an arbitrary listing page with available slots", () => {
    // Real-ish Resy / OT listing page text — shouldn't trigger any signal
    const text = "Cosme — book a table. Available times: 5:00 PM, 5:15 PM, 7:30 PM. Mexican cuisine, 2 guests.";
    expect(matchesAnySignal(text)).toBe(false);
  });

  it("does not match a checkout / payment page", () => {
    const text = "Complete your reservation. Cancellation policy. Card number, expiry, CVV.";
    expect(matchesAnySignal(text)).toBe(false);
  });
});

describe("Booking.com final no-availability evidence guard", () => {
  it("downgrades search-level empty results instead of terminal no_availability", () => {
    const traces: string[] = [];
    const result = determineFinalOutcome({
      assessment: {
        stage: "listing",
        reason: "search results stayed empty",
        pageText: "No properties match your search. No rooms available.",
        visibleCheckoutFields: false,
        hitPaymentGate: false,
        listingSignals: true,
        bookingProgressSignals: false,
        blocked: false,
      },
      screenshotBase64: "data:image/png;base64,",
      handoffUrl: "https://www.booking.com/searchresults.html?ss=New%20York",
      startUrl: "https://www.booking.com/searchresults.html?ss=YOTEL%20New%20York",
      selectedDatesMatchRequest: true,
      bookingComVerification: {
        pageHasIdentityFields: false,
        pageHasFullNameField: false,
        pageHasFirstNameField: false,
        pageHasLastNameField: false,
        pageHasEmailField: false,
        pageHasPhoneField: false,
        identityOk: false,
        cardOk: false,
        hasMinimumFilledProfile: false,
        visiblePaymentInputs: false,
        paymentSignalsVisible: false,
        cardTypeRequired: false,
        cardTypeSelected: false,
        readyForManualPaymentCompletion: false,
        paymentFieldVisibility: { cardholder: false, cardNumber: false, cardExpiry: false },
        paymentFieldVerification: { cardholder: false, cardNumber: false, cardExpiry: false },
      },
      hasEnteredFullName: false,
      hasEnteredFirstName: false,
      hasEnteredLastName: false,
      hasEnteredEmail: false,
      hasEnteredPhone: false,
      hasEnteredCardNumber: false,
      hasEnteredCardExpiry: false,
      agentMessage: "No availability found.",
      resultMessage: "No availability found.",
      resultCompleted: false,
      cardNumberProvided: false,
      cardExpiryProvided: false,
    }, (message) => traces.push(message));

    expect(result.status).toBe("error");
    expect(result.summary).toContain("hotel-specific");
    expect(traces.join("\n")).toContain("lacked hotel-detail evidence");
  });
});
