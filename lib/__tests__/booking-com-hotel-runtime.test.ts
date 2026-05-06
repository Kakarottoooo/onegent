import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  captureBookingComHotelResultCandidates,
  captureBookingComRoomSelectionEvidence,
  classifyBookingComHotelRuntimeBoundary,
  dismissBookingComSoftSignInPrompt,
  extractBookingComStayParamsFromUrl,
  shouldStopBookingComBeforePaymentAutomation,
  type BookingComHotelResultCandidateCapture,
} from "@/lib/booking-autopilot/providers/booking-com";

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
const SAFE_MANUAL_REVIEW_PROMPT = `Use only public Booking.com pages to prepare a manual hotel booking review.

Target stay:
- Hotel: YOTEL New York Times Square
- City: New York
- Check-in: June 10, 2026
- Check-out: June 12, 2026
- Guests: 1 adult
- Rooms: 1 room

Before any booking-step action, verify that the visible page matches the exact hotel name, city, check-in date, check-out date, adult count, and room count.

Proceed only through public search/detail/room-selection pages. Stop at the first safe manual-review boundary and report the current page state, URL, and visible evidence.

Hard stop immediately if the page asks for or shows payment, card entry, CVV/CVC/security code, billing details, login, sign-in, account creation, account verification, OTP, SMS code, CAPTCHA, human verification, phone verification, credentials, or any final reserve, confirm, complete booking, purchase, pay, or submit control.

Do not enter payment details, card details, CVV/CVC/security code, credentials, OTP, CAPTCHA, verification, or personal account information.

Do not bypass login, verification, CAPTCHA, OTP, or account checks.

Do not click any final reserve, confirm, complete booking, purchase, payment, or submission control.

If it is unclear whether a button is final, irreversible, account-sensitive, or payment-related, stop and report the page state instead of clicking.`;

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

  it("detects the approved manual-review prompt as a Booking.com no-payment automation stop", () => {
    expect(shouldStopBookingComBeforePaymentAutomation(SAFE_MANUAL_REVIEW_PROMPT)).toBe(true);
    expect(
      shouldStopBookingComBeforePaymentAutomation(
        "Find YOTEL New York Times Square and stop before payment or final confirmation.",
      ),
    ).toBe(true);
    expect(
      shouldStopBookingComBeforePaymentAutomation(
        "Find YOTEL New York Times Square and fill in all guest details.",
      ),
    ).toBe(false);
  });

  it("extracts exact YOTEL stay params from Booking.com search and direct hotel URLs", () => {
    expect(
      extractBookingComStayParamsFromUrl(
        "https://www.booking.com/searchresults.html?ss=YOTEL+New+York+Times+Square+New+York&checkin_year=2026&checkin_month=6&checkin_monthday=10&checkout_year=2026&checkout_month=6&checkout_monthday=12&group_adults=1&no_rooms=1",
      ),
    ).toMatchObject({
      checkin: "2026-06-10",
      checkout: "2026-06-12",
      adults: 1,
      rooms: 1,
    });

    const direct = extractBookingComStayParamsFromUrl(
      "https://www.booking.com/hotel/us/yotel-new-york-times-square.html?checkin=2026-06-10&checkout=2026-06-12&group_adults=1&no_rooms=1",
    );
    expect(direct.summary).toBe("checkin=2026-06-10; checkout=2026-06-12; adults=1; rooms=1");
  });

  it("dismisses only optional Booking.com member prompts with a safe close control", async () => {
    document.body.innerHTML = `
      <div role="dialog">
        <p>Sign in and save money with member prices.</p>
        <button aria-label="Close">x</button>
        <button>Sign in</button>
      </div>
    `;
    let closeClicked = false;
    document.querySelector("[aria-label='Close']")?.addEventListener("click", () => {
      closeClicked = true;
    });

    const traces: string[] = [];
    const result = await dismissBookingComSoftSignInPrompt(
      fakePage("https://www.booking.com/searchresults.html"),
      (message) => traces.push(message),
    );

    expect(result.dismissed).toBe(true);
    expect(closeClicked).toBe(true);
    expect(traces.join("\n")).toContain("dismissed optional sign-in/member prompt");
  });

  it("treats account-sensitive login or verification prompts as hard stops", async () => {
    document.body.innerHTML = `
      <div role="dialog">
        <p>Sign in to continue. Enter your password or verification code.</p>
        <button aria-label="Close">x</button>
      </div>
    `;
    let closeClicked = false;
    document.querySelector("[aria-label='Close']")?.addEventListener("click", () => {
      closeClicked = true;
    });

    const result = await dismissBookingComSoftSignInPrompt(
      fakePage("https://www.booking.com/searchresults.html"),
    );

    expect(result.dismissed).toBe(false);
    expect(result.reason).toBe("account-sensitive boundary visible");
    expect(closeClicked).toBe(false);
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
    ).toBe("network_provider_failure");

    const verifiedNoAvailability = classifyBookingComHotelRuntimeBoundary({
      currentUrl: "https://www.booking.com/hotel/us/yotel-new-york.html?checkin=2026-06-10&checkout=2026-06-12",
      pageText: "YOTEL New York Times Square. This property is sold out and unavailable for your dates.",
      roomEvidence: {
        roomSectionVisible: false,
        roomCardCount: 0,
        roomQuantitySelectCount: 0,
        selectedRoomCount: 0,
        reserveControlVisible: false,
        guestDetailsVisible: false,
        paymentBoundaryVisible: false,
        loginOrCaptchaVisible: false,
        noAvailabilityVisible: true,
        selectorDriftLikely: false,
        summary: "noAvailabilityVisible=true",
      },
    });
    expect(verifiedNoAvailability.state).toBe("provider_no_availability");
    expect(verifiedNoAvailability.reason).toContain("hotel detail");

    const unscopedNoAvailability = classifyBookingComHotelRuntimeBoundary({
      currentUrl: "https://www.booking.com/searchresults.html?ss=New%20York",
      pageText: "No availability. No properties match your search.",
      roomEvidence: {
        roomSectionVisible: false,
        roomCardCount: 0,
        roomQuantitySelectCount: 0,
        selectedRoomCount: 0,
        reserveControlVisible: false,
        guestDetailsVisible: false,
        paymentBoundaryVisible: false,
        loginOrCaptchaVisible: false,
        noAvailabilityVisible: true,
        selectorDriftLikely: false,
        summary: "noAvailabilityVisible=true",
      },
    });
    expect(unscopedNoAvailability.state).toBe("network_provider_failure");

    const driftOnlyNoAvailability = classifyBookingComHotelRuntimeBoundary({
      currentUrl: "https://www.booking.com/searchresults.html?ss=New%20York",
      pageText: "No availability. No properties match your search.",
      roomEvidence: {
        roomSectionVisible: false,
        roomCardCount: 0,
        roomQuantitySelectCount: 0,
        selectedRoomCount: 0,
        reserveControlVisible: false,
        guestDetailsVisible: false,
        paymentBoundaryVisible: false,
        loginOrCaptchaVisible: false,
        noAvailabilityVisible: true,
        selectorDriftLikely: true,
        summary: "selectorDriftLikely=true; noAvailabilityVisible=true",
      },
    });
    expect(driftOnlyNoAvailability.state).toBe("network_provider_failure");

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
    waitForTimeout: async () => undefined,
  } as unknown as Page;
}
