import { describe, expect, it } from "vitest";
import {
  classifyExpediaFlightBlockingOverlayText,
  classifyExpediaFlightCheckoutState,
  classifyExpediaFlightSafetyBoundaryText,
  buildExpediaCardExpirySelectCandidates,
  buildExpediaDateOfBirthSelectCandidates,
  describeExpediaFlightCandidateRejection,
  extractExpediaFlightCandidateEvidence,
  formatExpediaFlightCandidateEvidence,
  formatExpediaFlightTravelerFormStateForTrace,
  hasExpediaFlightBundlePopupText,
  normalizeExpediaTravelerGender,
  readExpediaFlightLocatorBoundingBox,
  readExpediaFlightLocatorCandidateLabel,
  selectExpediaFlightCandidateLabels,
  scoreExpediaFlightCandidateText,
  scrollExpediaFlightLocatorIntoView,
  summarizeExpediaFlightTravelerFormState,
} from "../booking-autopilot/providers/expedia";

describe("scoreExpediaFlightCandidateText", () => {
  it("matches the observed Southwest MCO to BNA flight card", () => {
    const score = scoreExpediaFlightCandidateText(
      [
        "Select flight",
        "Southwest",
        "WN 3084",
        "Departing at 08:50",
        "Orlando Intl. to Nashville Intl.",
        "$152",
      ].join(" "),
      {
        airline: "Southwest",
        price: 152,
        time: "08:50",
        flightNumber: "WN 3084",
      },
    );

    expect(score.hasAirline).toBe(true);
    expect(score.hasExplicitDifferentAirline).toBe(false);
    expect(score.hasPrice).toBe(true);
    expect(score.hasFlightNumber).toBe(true);
    expect(score.timeScore).toBe(4);
    expect(score.exactMatch).toBe(true);
    expect(score.fallbackEligible).toBe(true);
  });

  it("keeps a same-airline nearby price/time card eligible as fallback", () => {
    const score = scoreExpediaFlightCandidateText(
      "Select flight Southwest WN 3084 Departing at 8:55 AM $157",
      {
        airline: "Southwest",
        price: 152,
        time: "08:50",
        flightNumber: "WN 3084",
      },
    );

    expect(score.hasAirline).toBe(true);
    expect(score.hasExplicitDifferentAirline).toBe(false);
    expect(score.hasFlightNumber).toBe(true);
    expect(score.priceDelta).toBe(5);
    expect(score.timeDelta).toBe(5);
    expect(score.fallbackEligible).toBe(true);
  });

  it("keeps the visible Expedia card shape eligible when flight number is hidden", () => {
    const score = scoreExpediaFlightCandidateText(
      [
        "Select flight",
        "8:50am 9:55am",
        "Orlando (MCO) - Nashville (BNA)",
        "Southwest Airlines",
        "2h 5m Nonstop",
        "$152",
      ].join(" "),
      {
        airline: "Southwest",
        price: 152,
        time: "08:50",
        flightNumber: "WN 3084",
      },
    );

    expect(score.hasAirline).toBe(true);
    expect(score.hasExplicitDifferentAirline).toBe(false);
    expect(score.hasFlightNumber).toBe(false);
    expect(score.hasPrice).toBe(true);
    expect(score.timeScore).toBe(4);
    expect(score.exactMatch).toBe(false);
    expect(score.fallbackEligible).toBe(true);
  });

  it("does not use price alone when the controlled task has a different target time", () => {
    const score = scoreExpediaFlightCandidateText(
      [
        "Select flight",
        "9:55pm 11:00pm",
        "Orlando (MCO) - Nashville (BNA)",
        "Southwest Airlines",
        "2h 5m Nonstop",
        "$152",
      ].join(" "),
      {
        airline: "Southwest",
        price: 152,
        time: "08:50",
        flightNumber: "WN 3084",
      },
    );

    expect(score.hasAirline).toBe(true);
    expect(score.hasExplicitDifferentAirline).toBe(false);
    expect(score.hasPrice).toBe(true);
    expect(score.hasFlightNumber).toBe(false);
    expect(score.timeDelta).toBeGreaterThan(120);
    expect(score.exactMatch).toBe(false);
    expect(score.fallbackEligible).toBe(false);
  });

  it("rejects a stale-price same-airline card outside the narrow target-time window", () => {
    const score = scoreExpediaFlightCandidateText(
      [
        "Select flight",
        "7:25am 8:35am",
        "Orlando (MCO) - Nashville (BNA)",
        "Southwest Airlines",
        "2h 10m Nonstop",
        "$152",
      ].join(" "),
      {
        airline: "Southwest",
        price: 152,
        time: "08:50",
        flightNumber: "WN 3084",
      },
    );
    const summary = formatExpediaFlightCandidateEvidence(
      "Select flight Southwest Airlines 7:25am 8:35am MCO to BNA $152 Nonstop",
      {
        airline: "Southwest",
        price: 152,
        time: "08:50",
        flightNumber: "WN 3084",
      },
    );

    expect(score.hasAirline).toBe(true);
    expect(score.hasPrice).toBe(true);
    expect(score.timeDelta).toBe(85);
    expect(score.exactMatch).toBe(false);
    expect(score.fallbackEligible).toBe(false);
    expect(summary).toContain("decision=rejected");
    expect(summary).toContain("reason=price-only-time-mismatch");
  });

  it("rejects unrelated airline cards with no useful target overlap", () => {
    const score = scoreExpediaFlightCandidateText(
      "Select flight Delta DL 1212 Departing at 6:10 PM $418",
      {
        airline: "Southwest",
        price: 152,
        time: "08:50",
        flightNumber: "WN 3084",
      },
    );

    expect(score.hasAirline).toBe(false);
    expect(score.hasExplicitDifferentAirline).toBe(true);
    expect(score.hasFlightNumber).toBe(false);
    expect(score.hasPrice).toBe(false);
    expect(score.exactMatch).toBe(false);
    expect(score.fallbackEligible).toBe(false);
  });

  it("rejects explicit different-airline cards even when time and price match", () => {
    const score = scoreExpediaFlightCandidateText(
      "Select flight Frontier Airlines 8:50am 9:55am Orlando (MCO) - Nashville (BNA) $152 Nonstop",
      {
        airline: "Southwest",
        price: 152,
        time: "08:50",
        flightNumber: "WN 3084",
      },
    );

    expect(score.hasAirline).toBe(false);
    expect(score.hasExplicitDifferentAirline).toBe(true);
    expect(score.hasPrice).toBe(true);
    expect(score.timeDelta).toBe(0);
    expect(score.exactMatch).toBe(false);
    expect(score.fallbackEligible).toBe(false);
  });
});

describe("Expedia flight candidate evidence", () => {
  it("dumps structured fields for the controlled Southwest card", () => {
    const text = [
      "Select flight",
      "Southwest",
      "WN 3084",
      "8:50am 9:55am",
      "Orlando (MCO) - Nashville (BNA)",
      "$152",
    ].join(" ");
    const target = {
      airline: "Southwest",
      price: 152,
      time: "08:50",
      flightNumber: "WN 3084",
    };

    const evidence = extractExpediaFlightCandidateEvidence(text, target);
    const summary = formatExpediaFlightCandidateEvidence(text, target);

    expect(evidence).toMatchObject({
      airline: "Southwest",
      departureTime: "8:50am",
      arrivalTime: "9:55am",
      route: "Orlando (MCO) - Nashville (BNA)",
      price: "$152",
      flightNumber: "WN 3084",
    });
    expect(summary).toContain("flightNumber=WN 3084");
    expect(summary).toContain("route=Orlando (MCO) - Nashville (BNA)");
    expect(summary).toContain("fallbackScore=");
    expect(summary).toContain("decision=eligible");
    expect(summary).toContain("reason=exact-target-fit");
  });

  it("keeps hidden-flight-number cards evidence-ready with text fallback", () => {
    const summary = formatExpediaFlightCandidateEvidence(
      "Select flight Southwest Airlines 8:50am 9:55am MCO to BNA $152 Nonstop",
      {
        airline: "Southwest",
        price: 152,
        time: "08:50",
        flightNumber: "WN 3084",
      },
    );

    expect(summary).toContain("flightNumber=hidden");
    expect(summary).toContain("route=MCO to BNA");
    expect(summary).toContain("price=$152");
    expect(summary).toContain('text="');
  });

  it("keeps locator fallback evidence-ready when Stagehand locator has no evaluate", async () => {
    const label = await readExpediaFlightLocatorCandidateLabel({
      getAttribute: async (name: string) => name === "aria-label" ? "Select flight" : null,
      textContent: async () => "Select",
      locator: () => ({
        innerText: async () => [
          "Select flight",
          "Southwest",
          "WN 3084",
          "8:50am 9:55am",
          "MCO to BNA",
          "$152",
        ].join(" "),
      }),
    });

    expect(label).toContain("Southwest");
    expect(label).toContain("WN 3084");
    expect(label).toContain("$152");

    const score = scoreExpediaFlightCandidateText(label, {
      airline: "Southwest",
      price: 152,
      time: "08:50",
      flightNumber: "WN 3084",
    });
    expect(score.exactMatch).toBe(true);
  });

  it("keeps locator fallback evidence-ready when ancestor lookup is unsupported", async () => {
    const label = await readExpediaFlightLocatorCandidateLabel({
      getAttribute: async (name: string) => name === "aria-label" ? "Select flight Southwest WN 3084" : null,
      textContent: async () => "8:50am MCO to BNA $152",
      locator: () => {
        throw new Error("relative locator unsupported");
      },
    });

    expect(label).toContain("Southwest WN 3084");
    expect(label).toContain("8:50am");
    expect(label).toContain("$152");
  });

  it("reads a bounding box through an element handle when the locator wrapper has no boundingBox", async () => {
    const box = await readExpediaFlightLocatorBoundingBox({
      elementHandle: async () => ({
        boundingBox: async () => ({ x: 10, y: 20, width: 120, height: 32 }),
      }),
    });

    expect(box).toEqual({ x: 10, y: 20, width: 120, height: 32 });
  });

  it("scrolls locator wrappers through evaluate when scrollIntoViewIfNeeded is missing", async () => {
    let scrolled = false;
    const ok = await scrollExpediaFlightLocatorIntoView({
      evaluate: async (fn) => {
        scrolled = await fn({
          scrollIntoView: () => {
            scrolled = true;
          },
        } as unknown as Element);
        return scrolled;
      },
    });

    expect(ok).toBe(true);
    expect(scrolled).toBe(true);
  });
});

describe("Expedia flight candidate selection", () => {
  const target = {
    airline: "Southwest",
    price: 152,
    time: "08:50",
    flightNumber: "WN 3084",
  };

  it("selects a correct-time card even when the flight number is missing", () => {
    const selection = selectExpediaFlightCandidateLabels(
      [
        "Select flight Southwest Airlines 9:55pm 11:00pm MCO to BNA $152 Nonstop",
        "Select flight Southwest Airlines 8:50am 9:55am MCO to BNA $152 Nonstop",
      ],
      target,
      "unit",
    );

    expect(selection.selected?.index).toBe(1);
    expect(selection.selected?.score.hasFlightNumber).toBe(false);
    expect(selection.selected?.score.fallbackEligible).toBe(true);
    expect(selection.matchMode).toBe("fallback");
  });

  it("does not select a hidden-airline price-only card at the wrong target time", () => {
    const selection = selectExpediaFlightCandidateLabels(
      [
        "Select flight 9:55pm 11:00pm Orlando (MCO) - Nashville (BNA) 2h 5m Nonstop $152",
      ],
      target,
      "unit",
    );

    expect(selection.selected).toBeNull();
    expect(selection.candidateSummaries.length).toBeGreaterThan(0);
    expect(selection.candidateSummaries[0]).toContain("timeDelta=");
    expect(selection.samples[0]).toContain("9:55pm");
  });

  it("prefers the target flight number and time over stale SerpAPI price hints", () => {
    const selection = selectExpediaFlightCandidateLabels(
      [
        "Select flight Southwest Airlines WN 256 7:25am 8:35am MCO to BNA $152 Nonstop",
        "Select flight Southwest Airlines WN 2515 9:55pm 11:00pm MCO to BNA $152 Nonstop",
        "Select flight Southwest Airlines WN 3084 8:50am 9:55am MCO to BNA $241 Nonstop",
      ],
      target,
      "unit",
    );

    expect(selection.selected?.index).toBe(2);
    expect(selection.selected?.score.hasFlightNumber).toBe(true);
    expect(selection.selected?.score.hasPrice).toBe(false);
    expect(selection.selected?.score.exactMatch).toBe(true);
  });

  it("prefers exact target time over a stale-price card when Expedia hides the flight number", () => {
    const selection = selectExpediaFlightCandidateLabels(
      [
        "Select flight Southwest Airlines 7:25am 8:35am MCO to BNA $152 Nonstop",
        "Select flight Southwest Airlines 8:50am 9:55am MCO to BNA $241 Nonstop",
      ],
      target,
      "unit",
    );

    expect(selection.selected?.index).toBe(1);
    expect(selection.selected?.score.hasFlightNumber).toBe(false);
    expect(selection.selected?.score.hasPrice).toBe(false);
    expect(selection.selected?.score.fallbackEligible).toBe(true);
    expect(selection.matchMode).toBe("fallback");
  });

  it("does not select same-airline stale-price cards when none match target time or flight number", () => {
    const selection = selectExpediaFlightCandidateLabels(
      [
        "Select flight Southwest Airlines 7:25am 8:35am MCO to BNA $152 Nonstop",
        "Select flight Southwest Airlines 9:55pm 11:00pm MCO to BNA $152 Nonstop",
      ],
      target,
      "unit",
    );

    expect(selection.selected).toBeNull();
    expect(selection.candidateCount).toBe(2);
    expect(selection.candidateSummaries.join(" ")).toContain("decision=rejected");
    expect(selection.candidateSummaries.join(" ")).toContain("reason=price-only-time-mismatch");
    expect(selection.matchReason).toContain("wrong_time_candidate_rejected");
  });

  it("does not select a different-airline card just because target time and price match", () => {
    const selection = selectExpediaFlightCandidateLabels(
      [
        "Select flight Frontier Airlines 8:50am 9:55am MCO to BNA $152 Nonstop",
        "Select flight United Airlines 8:50am 9:55am MCO to BNA $152 Nonstop",
      ],
      target,
      "unit",
    );

    expect(selection.selected).toBeNull();
    expect(selection.candidateCount).toBe(0);
    expect(selection.candidateSummaries.join(" ")).toContain("differentAirline=yes");
    expect(selection.matchReason).toContain("wrong_airline_candidate_rejected");
    expect(selection.matchReason).toContain("selected candidate absent");
  });

  it("records explicit rejection reasons for wrong-time and price-only cards", () => {
    expect(
      describeExpediaFlightCandidateRejection(
        ["Select flight Southwest Airlines 9:55pm 11:00pm MCO to BNA $152 Nonstop"],
        target,
        "unit",
      ),
    ).toContain("wrong_time_candidate_rejected");

    const priceOnly = selectExpediaFlightCandidateLabels(
      ["Select flight Orlando (MCO) to Nashville (BNA) 2h 5m Nonstop $152"],
      target,
      "unit",
    );

    expect(priceOnly.selected).toBeNull();
    expect(priceOnly.matchReason).toContain("price_only_fallback_rejected");
    expect(priceOnly.matchReason).toContain("selected candidate absent");
  });
});

describe("classifyExpediaFlightSafetyBoundaryText", () => {
  it("classifies login, OTP, and CAPTCHA boundaries without broad sign-in false positives", () => {
    expect(classifyExpediaFlightSafetyBoundaryText("Sign in to continue to checkout")).toBe("login boundary");
    expect(classifyExpediaFlightSafetyBoundaryText("Enter the verification code sent to your phone")).toBe("OTP boundary");
    expect(classifyExpediaFlightSafetyBoundaryText("Complete this CAPTCHA to prove you are not a robot")).toBe("CAPTCHA boundary");
    expect(classifyExpediaFlightSafetyBoundaryText("Sign in for member prices, or continue as guest")).toBeNull();
  });
});

describe("classifyExpediaFlightBlockingOverlayText", () => {
  it("treats member-price sign-in copy as a dismissable overlay, not an auth boundary", () => {
    expect(
      classifyExpediaFlightBlockingOverlayText(
        "Unlock instant savings with Member Prices Sign in Learn more about One Key",
      ),
    ).toBe("dismissable_member_price_overlay");
  });

  it("treats OneKeyCash sign-in promos as dismissable overlays with evidence", () => {
    expect(
      classifyExpediaFlightBlockingOverlayText(
        "You can sign in or create an account to earn OneKeyCash after this trip. You're on your way!",
      ),
    ).toBe("dismissable_member_price_overlay");
  });

  it("keeps true sign-in-to-continue copy as a hard safety boundary", () => {
    expect(
      classifyExpediaFlightBlockingOverlayText("Sign in to continue to checkout"),
    ).toBe("hard_safety_boundary");
  });

  it("keeps account-required sign-in overlays as a hard boundary", () => {
    expect(
      classifyExpediaFlightBlockingOverlayText("Sign in or create an account to continue"),
    ).toBe("hard_safety_boundary");
  });
});

describe("Expedia flight checkout state", () => {
  it("does not classify a Flights-Search bundle upsell as checkout", () => {
    const state = classifyExpediaFlightCheckoutState({
      currentUrl: "https://www.expedia.com/Flights-Search?trip=oneway&leg1=from:MCO,to:BNA",
      bodyText: [
        "Bundle & Save up to $974 with flight + car package deals",
        "Includes your selected flight",
        "Car rental dates",
        "Explore packages",
        "No thanks",
      ].join(" "),
      visibleInputDescriptions: ["pick-up date", "drop-off date"],
    });

    expect(hasExpediaFlightBundlePopupText(state.reason)).toBe(false);
    expect(hasExpediaFlightBundlePopupText("Car rental dates Explore packages")).toBe(true);
    expect(state.onCheckout).toBe(false);
    expect(state.reason).toBe("bundle-popup-open");
  });

  it("requires checkout URL or non-search traveler fields for checkout success", () => {
    expect(
      classifyExpediaFlightCheckoutState({
        currentUrl: "https://www.expedia.com/Flights-Search?trip=oneway",
        bodyText: "Traveler information Traveler 1",
        visibleInputDescriptions: ["first name", "last name"],
      }),
    ).toMatchObject({ onCheckout: false, reason: "still-on-flight-search" });

    expect(
      classifyExpediaFlightCheckoutState({
        currentUrl: "https://www.expedia.com/Flights-Checkout?cart=abc",
        bodyText: "Traveler information Traveler 1",
        visibleInputDescriptions: ["first name", "last name"],
      }),
    ).toMatchObject({ onCheckout: true, reason: "checkout-url" });
  });

  it("does not treat the Review your trip page as checkout even when it has traveler price copy", () => {
    const state = classifyExpediaFlightCheckoutState({
      currentUrl: "https://www.expedia.com/Flight-Information?journeyContinuationId=abc",
      bodyText: "Review your trip Price details Traveler 1: Adult Next: Checkout",
      visibleInputDescriptions: [],
    });

    expect(state).toMatchObject({
      onCheckout: false,
      reason: "still-on-review-url",
      stillOnReview: true,
      stillOnReviewUrl: true,
    });
  });
});

describe("Expedia flight traveler form state", () => {
  it("builds DOB select candidates for split Expedia traveler dropdowns", () => {
    expect(buildExpediaDateOfBirthSelectCandidates("1994-06-09")).toEqual({
      month: ["06", "6", "June", "Jun"],
      day: ["09", "9"],
      year: ["1994"],
    });
  });

  it("builds split card-expiry candidates without requiring security code", () => {
    expect(buildExpediaCardExpirySelectCandidates("07/29")).toEqual({
      month: ["07", "7", "July", "Jul"],
      year: ["2029", "29"],
    });
    expect(buildExpediaCardExpirySelectCandidates("0130")).toEqual({
      month: ["01", "1", "January", "Jan"],
      year: ["2030", "30"],
    });
    expect(buildExpediaCardExpirySelectCandidates("13/29")).toBeNull();
  });

  it("normalizes traveler gender only when the profile explicitly provides it", () => {
    expect(normalizeExpediaTravelerGender("male")).toBe("male");
    expect(normalizeExpediaTravelerGender("Female")).toBe("female");
    expect(normalizeExpediaTravelerGender("")).toBeUndefined();
    expect(normalizeExpediaTravelerGender(undefined)).toBeUndefined();
  });

  it("does not treat a filled country-code select as completed traveler identity fields", () => {
    const state = summarizeExpediaFlightTravelerFormState({
      bodyText: [
        "Who's traveling?",
        "First name *",
        "Last name *",
        "Email address *",
        "Country/Territory Code *",
        "Phone number *",
        "Gender *",
        "Date of birth *",
        "Month",
        "Day",
        "Year",
      ].join(" "),
      controls: [
        { tagName: "input", type: "text", text: "first name", value: "", checked: false, selectedIndex: -1 },
        { tagName: "input", type: "text", text: "last name", value: "", checked: false, selectedIndex: -1 },
        { tagName: "input", type: "email", text: "email address", value: "", checked: false, selectedIndex: -1 },
        {
          tagName: "select",
          type: "select",
          text: "country territory code",
          value: "United States of America +1",
          checked: false,
          selectedIndex: 1,
        },
        { tagName: "input", type: "tel", text: "phone number", value: "", checked: false, selectedIndex: -1 },
        { tagName: "input", type: "radio", text: "male gender", value: "male", checked: false, selectedIndex: -1 },
        { tagName: "input", type: "radio", text: "female gender", value: "female", checked: false, selectedIndex: -1 },
        { tagName: "select", type: "select", text: "month", value: "", checked: false, selectedIndex: 0 },
        { tagName: "select", type: "select", text: "day", value: "", checked: false, selectedIndex: 0 },
        { tagName: "select", type: "select", text: "year", value: "", checked: false, selectedIndex: 0 },
      ],
    });

    expect(state.filledFields).toEqual([]);
    expect(state.missingRequiredFields).toEqual([
      "first name",
      "last name",
      "email address",
      "phone number",
      "birth month",
      "birth day",
      "birth year",
      "gender",
    ]);
  });

  it("formats traveler form trace with required-field names and no field values", () => {
    const state = summarizeExpediaFlightTravelerFormState({
      bodyText: "Who's traveling? First name Last name Email address Phone number",
      controls: [
        { tagName: "input", type: "text", text: "first name", value: "Jane", checked: false, selectedIndex: -1 },
        { tagName: "input", type: "text", text: "last name", value: "", checked: false, selectedIndex: -1 },
        { tagName: "input", type: "email", text: "email address", value: "jane@example.com", checked: false, selectedIndex: -1 },
        { tagName: "input", type: "tel", text: "phone number", value: "", checked: false, selectedIndex: -1 },
      ],
    });

    const trace = formatExpediaFlightTravelerFormStateForTrace(state);

    expect(trace).toContain("filled=first name,email address");
    expect(trace).toContain("missing=last name,phone number");
    expect(trace).toContain("visible=first name,last name,email address,phone number");
    expect(trace).not.toContain("Jane");
    expect(trace).not.toContain("jane@example.com");
  });
});
