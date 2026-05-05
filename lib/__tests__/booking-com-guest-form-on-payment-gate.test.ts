import { describe, expect, it } from "vitest";

import { shouldRunBookingComGuestFormDespitePaymentGate } from "@/lib/booking-autopilot/providers/booking-com";

describe("shouldRunBookingComGuestFormDespitePaymentGate — fix Booking.com Step 2 misclassification", () => {
  // Bug 4 (P1, observed live): Booking.com's checkout has TWO sequential pages
  // both under /book.html — Step 2 is guest details (姓/名/email/phone/address),
  // Step 3 is payment (card iframe). assessBookingStage classifies both as
  // `payment_gate` because the URL pattern matches /book.html. Result: when
  // user actually lands on Step 2, fillPaymentForm runs (and finds nothing
  // because there's no payment iframe), and fillGuestForm is SKIPPED entirely
  // because the routing only calls it for stage === "checkout_form".
  //
  // The discriminator: a real payment page has a payment iframe
  // (paymentcomponent.booking.com). Step 2 has no such iframe.

  it("returns true on Booking.com payment_gate when no payment iframe is present", () => {
    expect(
      shouldRunBookingComGuestFormDespitePaymentGate({
        providerId: "booking-com",
        stage: "payment_gate",
        hasPaymentIframe: false,
      }),
    ).toBe(true);
  });

  it("returns false on Booking.com payment_gate when payment iframe IS present (real payment page)", () => {
    expect(
      shouldRunBookingComGuestFormDespitePaymentGate({
        providerId: "booking-com",
        stage: "payment_gate",
        hasPaymentIframe: true,
      }),
    ).toBe(false);
  });

  it("returns false on stages that already route to fillGuestForm correctly", () => {
    expect(
      shouldRunBookingComGuestFormDespitePaymentGate({
        providerId: "booking-com",
        stage: "checkout_form",
        hasPaymentIframe: false,
      }),
    ).toBe(false);
  });

  it("returns false on stages outside checkout (listing / room_selection / etc)", () => {
    for (const stage of ["listing", "room_selection", "intermediate_gate"] as const) {
      expect(
        shouldRunBookingComGuestFormDespitePaymentGate({
          providerId: "booking-com",
          stage,
          hasPaymentIframe: false,
        }),
      ).toBe(false);
    }
  });

  it("does NOT apply to non-Booking.com providers (their two-page checkout patterns differ)", () => {
    expect(
      shouldRunBookingComGuestFormDespitePaymentGate({
        providerId: "expedia",
        stage: "payment_gate",
        hasPaymentIframe: false,
      }),
    ).toBe(false);
    expect(
      shouldRunBookingComGuestFormDespitePaymentGate({
        providerId: "opentable",
        stage: "payment_gate",
        hasPaymentIframe: false,
      }),
    ).toBe(false);
  });

  it("handles undefined / null providerId safely", () => {
    expect(
      shouldRunBookingComGuestFormDespitePaymentGate({
        providerId: undefined,
        stage: "payment_gate",
        hasPaymentIframe: false,
      }),
    ).toBe(false);
    expect(
      shouldRunBookingComGuestFormDespitePaymentGate({
        providerId: null,
        stage: "payment_gate",
        hasPaymentIframe: false,
      }),
    ).toBe(false);
  });
});
