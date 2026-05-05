import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  captureBookingComHotelResultCandidates,
  captureBookingComRoomSelectionEvidence,
  classifyBookingComHotelRuntimeBoundary,
  type BookingComHotelResultCandidateCapture,
} from "@/lib/booking-autopilot/providers/booking-com";

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

describe("Booking.com hotel runtime evidence helpers", () => {
  beforeEach(() => {
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return {
        x: 0,
        y: 0,
        width: 240,
        height: 40,
        top: 0,
        left: 0,
        right: 240,
        bottom: 40,
        toJSON: () => ({}),
      } as DOMRect;
    };
    document.body.innerHTML = "";
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    document.body.innerHTML = "";
  });

  it("captures visible hotel result candidates and marks the approved target", async () => {
    document.body.innerHTML = `
      <div data-testid="property-card">
        <a data-testid="titleLink" href="https://www.booking.com/hotel/us/yotel-new-york.html">
          YOTEL New York Times Square
        </a>
        <button>See availability</button>
      </div>
      <div data-testid="property-card">
        <a data-testid="titleLink" href="https://www.booking.com/hotel/us/other.html">
          Midtown West Hotel
        </a>
        <button>See availability</button>
      </div>
    `;

    const capture = await captureBookingComHotelResultCandidates(
      fakePage("https://www.booking.com/searchresults.html?ss=New%20York"),
      "YOTEL New York Times Square",
    );

    expect(capture.targetVisible).toBe(true);
    expect(capture.targetHref).toContain("/hotel/us/yotel-new-york.html");
    expect(capture.candidates[0]?.matchedTarget).toBe(true);
    expect(capture.summary).toContain("targetVisible=true");

    const boundary = classifyBookingComHotelRuntimeBoundary({
      currentUrl: "https://www.booking.com/searchresults.html?ss=New%20York",
      pageText: document.body.textContent ?? "",
      resultCandidates: capture,
    });

    expect(boundary.state).toBe("provider_selector_drift");
  });

  it("captures room selection evidence from real room controls", async () => {
    document.body.innerHTML = `
      <section id="hp_availability_tempcontainer">
        <table class="hprt-table">
          <tr class="hprt-roomtype">
            <td>Queen Room sleeps 2 Today's price $245</td>
            <td>
              <select aria-label="Select rooms">
                <option value="0">0</option>
                <option value="1" selected>1</option>
              </select>
            </td>
            <td><button>I'll reserve</button></td>
          </tr>
        </table>
      </section>
    `;

    const evidence = await captureBookingComRoomSelectionEvidence(
      fakePage("https://www.booking.com/hotel/us/yotel-new-york.html"),
    );

    expect(evidence.roomSectionVisible).toBe(true);
    expect(evidence.roomQuantitySelectCount).toBe(1);
    expect(evidence.selectedRoomCount).toBe(1);
    expect(evidence.reserveControlVisible).toBe(true);
    expect(evidence.summary).toContain("selectedRoomCount=1");

    const boundary = classifyBookingComHotelRuntimeBoundary({
      currentUrl: "https://www.booking.com/hotel/us/yotel-new-york.html",
      pageText: document.body.textContent ?? "",
      roomEvidence: evidence,
    });

    expect(boundary.state).toBe("room_selection_manual_review_reached");
  });

  it("classifies hard stops before any payment, CVV, login, CAPTCHA, or final confirmation action", () => {
    expect(
      classifyBookingComHotelRuntimeBoundary({
        currentUrl: "https://secure.booking.com/book.html",
        pageText: "Your payment details. Credit or debit card. CVV. Complete booking button visible.",
      }).state,
    ).toBe("payment_manual_review_reached");

    expect(
      classifyBookingComHotelRuntimeBoundary({
        currentUrl: "https://secure.booking.com/book.html",
        pageText: "Enter your details. First name. Last name. Email address. Next: Final details.",
      }).state,
    ).toBe("guest_details_manual_review_reached");

    expect(
      classifyBookingComHotelRuntimeBoundary({
        currentUrl: "https://www.booking.com/hotel/us/yotel-new-york.html",
        pageText: "Security check. CAPTCHA required. Verify you are human.",
      }).state,
    ).toBe("login_or_captcha_boundary");
  });

  it("separates no availability, selector drift, room drift, and provider degraded signals", () => {
    const emptyResults: BookingComHotelResultCandidateCapture = {
      targetHotelName: "YOTEL New York Times Square",
      normalizedTarget: "yotel new york times square",
      candidateCount: 0,
      targetVisible: false,
      targetHref: null,
      candidates: [],
      summary: "candidates=0; targetVisible=false; targetHref=none; top=none",
    };

    expect(
      classifyBookingComHotelRuntimeBoundary({
        currentUrl: "https://www.booking.com/searchresults.html?ss=New%20York",
        pageText: "No properties match your search. No rooms available.",
        resultCandidates: emptyResults,
      }).state,
    ).toBe("provider_no_availability");

    expect(
      classifyBookingComHotelRuntimeBoundary({
        currentUrl: "https://www.booking.com/hotel/us/yotel-new-york.html",
        pageText: "Room type. Availability. Reserve.",
        roomEvidence: {
          roomSectionVisible: true,
          roomCardCount: 0,
          roomQuantitySelectCount: 0,
          selectedRoomCount: 0,
          reserveControlVisible: false,
          guestDetailsVisible: false,
          paymentBoundaryVisible: false,
          loginOrCaptchaVisible: false,
          noAvailabilityVisible: false,
          selectorDriftLikely: true,
          summary: "selectorDriftLikely=true",
        },
      }).state,
    ).toBe("room_selection_drift");

    expect(
      classifyBookingComHotelRuntimeBoundary({
        currentUrl: "https://www.booking.com/hotel/us/yotel-new-york.html",
        pageText: "Booking.com returned 503 temporarily unavailable.",
      }).state,
    ).toBe("network_provider_failure");
  });
});

function fakePage(url: string): Page {
  return {
    url: () => url,
    evaluate: async <T, A>(fn: (arg: A) => T, arg?: A): Promise<T> => fn(arg as A),
  } as unknown as Page;
}
