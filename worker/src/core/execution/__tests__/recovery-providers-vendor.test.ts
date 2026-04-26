/**
 * Unit tests for matchKnownVendor — the booking-widget URL classifier
 * that drives Bug B's handoff-URL fallback decision.
 *
 * Pure function, no network. Real HTTP probing (headProbe) lives behind
 * the same module but isn't unit-tested here — fetch-mocking would test
 * MSW more than our logic. The behavior gets exercised end-to-end
 * whenever a real venue route hits Phase 3's website fallback.
 */

import { describe, it, expect } from "vitest";
import { matchKnownVendor } from "../recovery-providers";

describe("matchKnownVendor", () => {
  it("identifies SevenRooms event URLs (Carbone / Le Bernardin / Marea pattern)", () => {
    const url =
      "https://www.sevenrooms.com/events/ahNzfnNldmVucm9vbXMtc2VjdXJlchgL";
    const v = matchKnownVendor(url);
    expect(v?.name).toBe("SevenRooms");
  });

  it("identifies Tock URLs (prix-fixe restaurants)", () => {
    expect(matchKnownVendor("https://www.exploretock.com/atomix")?.name).toBe(
      "Tock",
    );
    expect(matchKnownVendor("https://tock.com/restaurant/eleven")?.name).toBe(
      "Tock",
    );
  });

  it("identifies OpenTable widget deep links (not the main search URL)", () => {
    expect(
      matchKnownVendor(
        "https://www.opentable.com/widget/reservation/find?rid=12345",
      )?.name,
    ).toBe("OpenTable widget");
    expect(
      matchKnownVendor("https://www.opentable.com/restref/client/?rid=99")?.name,
    ).toBe("OpenTable widget");
  });

  it("identifies Resy event/city deep URLs", () => {
    expect(
      matchKnownVendor("https://resy.com/cities/ny/some-restaurant")?.name,
    ).toBe("Resy");
    expect(
      matchKnownVendor("https://resy.com/events/special-dinner")?.name,
    ).toBe("Resy");
  });

  it("identifies Yelp Reservations / biz_redir URLs", () => {
    expect(
      matchKnownVendor("https://www.yelp.com/reservations/some-place")?.name,
    ).toBe("Yelp Reservations");
  });

  it("identifies long-tail vendors (Eat App / Dineplan)", () => {
    expect(matchKnownVendor("https://eatapp.co/r/abc123")?.name).toBe("Eat App");
    expect(matchKnownVendor("https://reservation.dineplan.com/x")?.name).toBe(
      "Dineplan",
    );
  });

  it("returns null for the OpenTable main search URL (NOT a vendor deep link)", () => {
    // Search URLs are surfaced via Phase 1, not the website fallback.
    // Treating them as a "vendor" would loop the user back to OpenTable.
    expect(
      matchKnownVendor("https://www.opentable.com/s?term=Carbone&covers=2"),
    ).toBeNull();
  });

  it("returns null for plain restaurant homepages", () => {
    expect(
      matchKnownVendor("https://www.marearestaurant.com/new-york"),
    ).toBeNull();
    expect(matchKnownVendor("https://carbonenewyork.com/")).toBeNull();
  });

  it("returns null for unrelated marketing pages", () => {
    expect(matchKnownVendor("https://www.google.com/maps/place/X")).toBeNull();
    expect(matchKnownVendor("https://example.com/page")).toBeNull();
  });
});
