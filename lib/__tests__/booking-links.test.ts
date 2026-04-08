import { describe, it, expect } from "vitest";
import {
  buildGoogleHotelsUrl,
  buildBookingComUrl,
  buildGoogleFlightsUrl,
  buildKayakFlightsUrl,
  buildOpenTableUrl,
} from "../agent/planners/booking-links";

describe("buildGoogleHotelsUrl", () => {
  it("includes city as query param", () => {
    const url = buildGoogleHotelsUrl({ city: "Chicago" });
    expect(url).toContain("google.com/travel/hotels");
    expect(url).toContain("Chicago");
  });

  it("includes checkin/checkout dates when provided", () => {
    const url = buildGoogleHotelsUrl({
      city: "Chicago",
      checkin: "2026-04-10",
      checkout: "2026-04-12",
    });
    expect(url).toContain("2026-04-10");
    expect(url).toContain("2026-04-12");
  });

  it("includes adults count when provided", () => {
    const url = buildGoogleHotelsUrl({ city: "Chicago", adults: 2 });
    expect(url).toContain("adults=2");
  });

  it("omits date and adults params when not provided", () => {
    const url = buildGoogleHotelsUrl({ city: "Chicago" });
    expect(url).not.toContain("dates=");
    expect(url).not.toContain("adults=");
  });

  it("includes hotel name in query when provided", () => {
    const url = buildGoogleHotelsUrl({ hotelName: "Marriott", city: "Chicago" });
    expect(url).toContain("Marriott");
  });
});

describe("buildBookingComUrl", () => {
  it("includes city as ss param", () => {
    const url = buildBookingComUrl({ city: "Paris" });
    expect(url).toContain("booking.com/searchresults.html");
    expect(url).toContain("ss=Paris");
  });

  it("splits checkin date into year/month/day params", () => {
    const url = buildBookingComUrl({ city: "Paris", checkin: "2026-05-01" });
    expect(url).toContain("checkin_year=2026");
    expect(url).toContain("checkin_month=5");
    expect(url).toContain("checkin_monthday=1");
  });

  it("splits checkout date into year/month/day params", () => {
    const url = buildBookingComUrl({ city: "Paris", checkout: "2026-05-04" });
    expect(url).toContain("checkout_year=2026");
    expect(url).toContain("checkout_month=5");
    expect(url).toContain("checkout_monthday=4");
  });

  it("includes group_adults when provided", () => {
    const url = buildBookingComUrl({ city: "Paris", adults: 2 });
    expect(url).toContain("group_adults=2");
  });

  it("includes hotel name and city in the ss query when provided", () => {
    const url = buildBookingComUrl({
      hotelName: "YOTEL New York Times Square",
      city: "New York",
    });
    expect(url).toContain("ss=YOTEL+New+York+Times+Square+New+York");
  });

  it("includes room count when provided", () => {
    const url = buildBookingComUrl({ city: "Paris", rooms: 2 });
    expect(url).toContain("no_rooms=2");
  });

  it("handles invalid date gracefully (no date params added)", () => {
    const url = buildBookingComUrl({ city: "Paris", checkin: "next Friday" });
    expect(url).not.toContain("checkin_year");
  });
});

describe("buildGoogleFlightsUrl", () => {
  it("produces fragment-based deep link when date is provided", () => {
    const url = buildGoogleFlightsUrl({
      origin: "JFK",
      dest: "LAX",
      date: "2026-04-15",
    });
    expect(url).toContain("google.com/flights");
    expect(url).toContain("#flt=JFK.LAX.2026-04-15");
  });

  it("includes return leg when returnDate is provided", () => {
    const url = buildGoogleFlightsUrl({
      origin: "JFK",
      dest: "LAX",
      date: "2026-04-15",
      returnDate: "2026-04-17",
    });
    expect(url).toContain("JFK.LAX.2026-04-15");
    expect(url).toContain("LAX.JFK.2026-04-17");
  });

  it("falls back to search query form when no date provided", () => {
    const url = buildGoogleFlightsUrl({ origin: "JFK", dest: "ORD" });
    expect(url).toContain("google.com/travel/flights");
    expect(url).toContain("JFK");
    expect(url).toContain("ORD");
  });

  it("includes USD currency in deep link", () => {
    const url = buildGoogleFlightsUrl({ origin: "JFK", dest: "LAX", date: "2026-04-15" });
    expect(url).toContain("c:USD");
  });
});

describe("buildKayakFlightsUrl", () => {
  it("builds round-trip URL with all fields", () => {
    const url = buildKayakFlightsUrl({
      origin: "BNA",
      dest: "LAX",
      date: "2026-03-28",
      returnDate: "2026-03-30",
      passengers: 1,
      cabinClass: "economy",
    });
    expect(url).toBe(
      "https://www.kayak.com/flights/BNA-LAX/2026-03-28/2026-03-30/1adults/economy"
    );
  });

  it("builds one-way URL when no returnDate", () => {
    const url = buildKayakFlightsUrl({ origin: "JFK", dest: "ORD", date: "2026-05-01" });
    expect(url).toBe(
      "https://www.kayak.com/flights/JFK-ORD/2026-05-01/1adults/economy"
    );
  });

  it("maps premium_economy to 'premium'", () => {
    const url = buildKayakFlightsUrl({
      origin: "LAX",
      dest: "LHR",
      date: "2026-06-01",
      cabinClass: "premium_economy",
    });
    expect(url).toContain("/premium");
  });

  it("maps business cabin correctly", () => {
    const url = buildKayakFlightsUrl({ origin: "JFK", dest: "CDG", date: "2026-07-01", cabinClass: "business" });
    expect(url).toContain("/business");
  });

  it("includes passenger count in URL", () => {
    const url = buildKayakFlightsUrl({ origin: "BNA", dest: "LAX", date: "2026-03-28", passengers: 2 });
    expect(url).toContain("2adults");
  });

  it("falls back to route-only URL when no date", () => {
    const url = buildKayakFlightsUrl({ origin: "BNA", dest: "LAX" });
    expect(url).toBe("https://www.kayak.com/flights/BNA-LAX");
  });
});

describe("buildOpenTableUrl", () => {
  it("includes covers when provided", () => {
    const url = buildOpenTableUrl({ covers: 2 });
    expect(url).toContain("opentable.com/s");
    expect(url).toContain("covers=2");
  });

  it("includes dateTime with default 19:00 when date but no time provided", () => {
    const url = buildOpenTableUrl({ date: "2026-02-14" });
    expect(url).toContain("dateTime=2026-02-14T19%3A00%3A00");
  });

  it("includes dateTime with provided time", () => {
    const url = buildOpenTableUrl({ date: "2026-02-14", time: "20:30" });
    expect(url).toContain("2026-02-14T20%3A30%3A00");
  });

  it("includes restaurant name as term when provided", () => {
    const url = buildOpenTableUrl({ restaurantName: "Le Bernardin" });
    expect(url).toContain("Le+Bernardin");
  });

  it("falls back to city as term when no restaurant name provided", () => {
    const url = buildOpenTableUrl({ city: "New York" });
    expect(url).toContain("New+York");
  });

  it("returns bare URL with no params when all opts are empty", () => {
    const url = buildOpenTableUrl({});
    expect(url).toBe("https://www.opentable.com/s?");
  });
});
