/**
 * Unit tests for lib/core/cend-adapter — the C-end → lib/core bridge that
 * re-shapes legacy BookingJobStep bodies into ExecutionParams so the dual-gate
 * in /api/booking-jobs/[id]/start dispatches them through
 * runExecutionJobWithRecovery instead of the legacy recovery loop.
 *
 * Pure functions, no I/O. The end-to-end behavior (a marked step actually
 * routes to lib/core at run time) is covered by lib/core/__tests__/integration
 * and the live curl-side verification.
 */

import { describe, it, expect } from "vitest";
import {
  CORE_SUPPORTED_SCENARIOS,
  isCoreSupported,
  markStepForCore,
} from "../cend-adapter";
import type { BookingJobStep } from "@/lib/db";

const SAMPLE_PROFILE = {
  first_name: "Tony",
  last_name: "Stark",
  email: "tony@stark.com",
  phone: "+15551234567",
};

function restaurantStep(overrides: Partial<Record<string, unknown>> = {}): BookingJobStep {
  return {
    type: "restaurant",
    emoji: "🍽️",
    label: "Carbone",
    apiEndpoint: "/api/booking-jobs/start",
    body: {
      restaurantName: "Carbone",
      city: "New York",
      date: "2026-04-30",
      time: "19:00",
      covers: 2,
      profileId: 42,
      profile: SAMPLE_PROFILE,
      ...overrides,
    },
    fallbackUrl: "https://www.opentable.com/s?term=Carbone",
    status: "pending",
  };
}

function hotelStep(overrides: Partial<Record<string, unknown>> = {}): BookingJobStep {
  return {
    type: "hotel",
    emoji: "🏨",
    label: "The Pierre",
    apiEndpoint: "/api/booking-autopilot/universal",
    body: {
      hotel_name: "The Pierre",
      city: "New York",
      checkin: "2026-05-01",
      checkout: "2026-05-03",
      adults: 2,
      profileId: 42,
      profile: SAMPLE_PROFILE,
      ...overrides,
    },
    fallbackUrl: "https://www.booking.com/searchresults.html",
    status: "pending",
  };
}

function flightStep(overrides: Partial<Record<string, unknown>> = {}): BookingJobStep {
  return {
    type: "flight",
    emoji: "✈️",
    label: "JFK→LAX",
    apiEndpoint: "/api/booking-autopilot/universal",
    body: {
      origin: "JFK",
      dest: "LAX",
      date: "2026-05-01",
      returnDate: "2026-05-05",
      passengers: 1,
      cabinClass: "economy",
      profileId: 42,
      profile: SAMPLE_PROFILE,
      ...overrides,
    },
    fallbackUrl: "https://www.expedia.com/Flights-Search",
    status: "pending",
  };
}

describe("CORE_SUPPORTED_SCENARIOS", () => {
  it("matches the four scenarios lib/core/execution can run today", () => {
    expect([...CORE_SUPPORTED_SCENARIOS]).toEqual([
      "restaurant",
      "hotel",
      "flight",
      "activity",
    ]);
  });
});

describe("isCoreSupported", () => {
  it("returns true for restaurant / hotel / flight / activity", () => {
    expect(isCoreSupported("restaurant")).toBe(true);
    expect(isCoreSupported("hotel")).toBe(true);
    expect(isCoreSupported("flight")).toBe(true);
    expect(isCoreSupported("activity")).toBe(true);
  });

  it("returns false for the legacy 'universal' step type", () => {
    expect(isCoreSupported("universal" as BookingJobStep["type"])).toBe(false);
  });
});

describe("markStepForCore — restaurant", () => {
  it("converts restaurantName → restaurant_name and stamps __source marker", () => {
    const marked = markStepForCore(restaurantStep());
    const body = marked.body as Record<string, unknown>;
    expect(body.scenario).toBe("restaurant");
    expect(body.__source).toBe("lib/core/execution");
    expect(body.params).toEqual({
      restaurant_name: "Carbone",
      city: "New York",
      date: "2026-04-30",
      time: "19:00",
      covers: 2,
    });
  });

  it("preserves profile + profileId for executor profile-resolution", () => {
    const marked = markStepForCore(restaurantStep());
    const body = marked.body as Record<string, unknown>;
    expect(body.profileId).toBe(42);
    expect(body.profile).toEqual(SAMPLE_PROFILE);
  });

  it("preserves outer step fields (label, emoji, fallbackUrl) so /tasks UI looks identical", () => {
    const marked = markStepForCore(restaurantStep());
    expect(marked.label).toBe("Carbone");
    expect(marked.emoji).toBe("🍽️");
    expect(marked.fallbackUrl).toBe("https://www.opentable.com/s?term=Carbone");
    expect(marked.status).toBe("pending");
  });

  it("throws on missing required field (covers as string, not number)", () => {
    expect(() => markStepForCore(restaurantStep({ covers: "two" }))).toThrow(
      /missing required number field "covers"/,
    );
  });
});

describe("markStepForCore — hotel", () => {
  it("converts hotel body 1:1 (already snake_case in legacy shape)", () => {
    const marked = markStepForCore(hotelStep());
    const body = marked.body as Record<string, unknown>;
    expect(body.scenario).toBe("hotel");
    expect(body.params).toEqual({
      hotel_name: "The Pierre",
      city: "New York",
      checkin: "2026-05-01",
      checkout: "2026-05-03",
      adults: 2,
    });
  });

  it("throws on empty hotel_name", () => {
    expect(() => markStepForCore(hotelStep({ hotel_name: "" }))).toThrow(
      /missing required string field "hotel_name"/,
    );
  });
});

describe("markStepForCore — flight", () => {
  it("renames returnDate → return_date and cabinClass → cabin_class", () => {
    const marked = markStepForCore(flightStep());
    const params = (marked.body as Record<string, unknown>).params as Record<string, unknown>;
    expect(params.origin).toBe("JFK");
    expect(params.dest).toBe("LAX");
    expect(params.date).toBe("2026-05-01");
    expect(params.return_date).toBe("2026-05-05");
    expect(params.cabin_class).toBe("economy");
    expect(params.passengers).toBe(1);
  });

  it("treats one-way flight (no returnDate) as oneway — return_date omitted from params", () => {
    const marked = markStepForCore(flightStep({ returnDate: undefined }));
    const params = (marked.body as Record<string, unknown>).params as Record<string, unknown>;
    expect(params.return_date).toBeUndefined();
    expect("return_date" in params).toBe(false);
  });

  it("normalizes Expedia cabin aliases (coach → economy, premiumcoach → premium_economy)", () => {
    const econ = markStepForCore(flightStep({ cabinClass: "coach" }));
    expect((econ.body as Record<string, unknown>).params).toMatchObject({ cabin_class: "economy" });

    const premium = markStepForCore(flightStep({ cabinClass: "premiumcoach" }));
    expect((premium.body as Record<string, unknown>).params).toMatchObject({
      cabin_class: "premium_economy",
    });
  });

  it("drops unknown cabin values rather than passing nonsense to executor", () => {
    const marked = markStepForCore(flightStep({ cabinClass: "luxury_pod" }));
    const params = (marked.body as Record<string, unknown>).params as Record<string, unknown>;
    expect(params.cabin_class).toBeUndefined();
  });

  it("passes through target* hints when present (caller already picked a flight from results)", () => {
    const marked = markStepForCore(
      flightStep({
        targetAirline: "American",
        targetPrice: 412,
        targetDepartureTime: "2:54pm",
        targetFlightNumber: "AA2341",
      }),
    );
    const params = (marked.body as Record<string, unknown>).params as Record<string, unknown>;
    expect(params).toMatchObject({
      targetAirline: "American",
      targetPrice: 412,
      targetDepartureTime: "2:54pm",
      targetFlightNumber: "AA2341",
    });
  });

  it("throws on missing origin", () => {
    expect(() => markStepForCore(flightStep({ origin: "" }))).toThrow(
      /missing required string field "origin"/,
    );
  });
});

describe("markStepForCore — activity", () => {
  function activityStep(overrides: Partial<Record<string, unknown>> = {}): BookingJobStep {
    return {
      type: "activity",
      emoji: "🎟️",
      label: "Hamilton",
      apiEndpoint: "/api/booking-autopilot/universal",
      body: {
        activity_name: "Hamilton",
        activity_id: "hmlt-2026-05-01",
        venue_name: "Richard Rodgers Theatre",
        city: "New York",
        event_date: "2026-05-01T19:00:00",
        num_tickets: 2,
        provider: "seatgeek",
        startUrl: "https://seatgeek.com/hamilton-tickets/2026-05-01",
        task: "Buy 2 tickets for Hamilton on 2026-05-01. Stop before CVV.",
        profileId: 42,
        profile: SAMPLE_PROFILE,
        ...overrides,
      },
      fallbackUrl: "https://seatgeek.com/hamilton-tickets/2026-05-01",
      status: "pending",
    };
  }

  it("converts startUrl → booking_link and copies task + standardized fields", () => {
    const marked = markStepForCore(activityStep());
    const body = marked.body as Record<string, unknown>;
    expect(body.scenario).toBe("activity");
    expect(body.__source).toBe("lib/core/execution");
    expect(body.params).toEqual({
      event_name: "Hamilton",
      city: "New York",
      event_date: "2026-05-01T19:00:00",
      num_tickets: 2,
      booking_link: "https://seatgeek.com/hamilton-tickets/2026-05-01",
      task: "Buy 2 tickets for Hamilton on 2026-05-01. Stop before CVV.",
    });
  });

  it("omits `task` from params when caller did not provide one (executor builds default)", () => {
    const marked = markStepForCore(activityStep({ task: undefined }));
    const params = (marked.body as Record<string, unknown>).params as Record<string, unknown>;
    expect("task" in params).toBe(false);
  });

  it("throws when startUrl (booking_link) is missing — lib/core has no SeatGeek search yet", () => {
    expect(() => markStepForCore(activityStep({ startUrl: "" }))).toThrow(
      /missing required string field "startUrl"/,
    );
  });

  it("throws on missing num_tickets (string instead of number)", () => {
    expect(() => markStepForCore(activityStep({ num_tickets: "two" }))).toThrow(
      /missing required number field "num_tickets"/,
    );
  });
});

describe("markStepForCore — guards", () => {
  it("does not stamp `profile` key when inline profile is absent (avoids spread of undefined)", () => {
    const marked = markStepForCore(restaurantStep({ profile: undefined }));
    const body = marked.body as Record<string, unknown>;
    expect("profile" in body).toBe(false);
  });

  it("does not stamp `profileId` key when absent", () => {
    const marked = markStepForCore(restaurantStep({ profileId: undefined }));
    const body = marked.body as Record<string, unknown>;
    expect("profileId" in body).toBe(false);
  });
});

describe("trip-level per-step gating (array.map pattern from create-trip route)", () => {
  it("marks all four scenarios in a mixed trip", () => {
    const trip: BookingJobStep[] = [
      hotelStep(),
      flightStep(),
      restaurantStep(),
      {
        type: "activity",
        emoji: "🎟️",
        label: "Hamilton",
        apiEndpoint: "/api/booking-autopilot/universal",
        body: {
          activity_name: "Hamilton",
          city: "New York",
          event_date: "2026-05-01T19:00:00",
          num_tickets: 2,
          startUrl: "https://seatgeek.com/x",
          task: "buy tickets",
        },
        fallbackUrl: "https://seatgeek.com/x",
        status: "pending",
      },
    ];

    const marked = trip.map((s) => (isCoreSupported(s.type) ? markStepForCore(s) : s));

    const sources = marked.map((s) => (s.body as Record<string, unknown>).__source);
    expect(sources).toEqual([
      "lib/core/execution",
      "lib/core/execution",
      "lib/core/execution",
      "lib/core/execution",
    ]);
    const scenarios = marked.map((s) => (s.body as Record<string, unknown>).scenario);
    expect(scenarios).toEqual(["hotel", "flight", "restaurant", "activity"]);
  });

  it("leaves an unknown step type untouched (no scenario/params injection)", () => {
    const unknownStep: BookingJobStep = {
      type: "universal" as BookingJobStep["type"],
      emoji: "?",
      label: "legacy",
      apiEndpoint: "/api/booking-autopilot/universal",
      body: { startUrl: "https://example.com", task: "do something" },
      fallbackUrl: "",
      status: "pending",
    };
    const trip: BookingJobStep[] = [restaurantStep(), unknownStep];
    const marked = trip.map((s) => (isCoreSupported(s.type) ? markStepForCore(s) : s));
    expect((marked[0].body as Record<string, unknown>).__source).toBe("lib/core/execution");
    expect(marked[1].body).toEqual(unknownStep.body);
  });
});
