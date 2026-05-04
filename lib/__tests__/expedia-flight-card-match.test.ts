import { describe, expect, it } from "vitest";
import { scoreExpediaFlightCandidateText } from "../booking-autopilot/providers/expedia";

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
    expect(score.hasFlightNumber).toBe(false);
    expect(score.hasPrice).toBe(true);
    expect(score.timeScore).toBe(4);
    expect(score.exactMatch).toBe(false);
    expect(score.fallbackEligible).toBe(true);
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
    expect(score.hasFlightNumber).toBe(false);
    expect(score.hasPrice).toBe(false);
    expect(score.exactMatch).toBe(false);
    expect(score.fallbackEligible).toBe(false);
  });
});
