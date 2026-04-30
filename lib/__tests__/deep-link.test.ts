import { describe, it, expect } from "vitest";
import { generateRestaurantDeepLink } from "@/lib/booking-autopilot/executors/deep-link";

const NYC_BASELINE = {
  restaurant_name: "L'Artusi",
  city: "New York",
  date: "2026-05-12",
  time: "19:00",
  party_size: 2,
};

// ─── OpenTable ──────────────────────────────────────────────────────────────

describe("generateRestaurantDeepLink — OpenTable", () => {
  it("appends covers + dateTime to a known detail URL", () => {
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      restaurant_url: "https://www.opentable.com/lartusi",
    });
    expect(out.platform).toBe("opentable");
    expect(out.kind).toBe("detail");
    expect(out.label).toBe("Continue on OpenTable");
    expect(out.url).toContain("opentable.com/lartusi");
    expect(out.url).toContain("covers=2");
    expect(out.url).toContain("dateTime=2026-05-12T19%3A00%3A00");
  });

  it("appends to /r/<slug> URLs as well", () => {
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      restaurant_url: "https://www.opentable.com/r/carbone-new-york",
    });
    expect(out.kind).toBe("detail");
    expect(out.url).toContain("/r/carbone-new-york");
    expect(out.url).toContain("covers=2");
  });

  it("OVERWRITES stale covers / dateTime params on detail URLs", () => {
    // E.g. user originally booked covers=4, then modified to 2 — the deep
    // link must reflect the CURRENT party_size, not the URL's history.
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      party_size: 2,
      restaurant_url: "https://www.opentable.com/lartusi?covers=4&dateTime=2026-01-01T19:00:00",
    });
    expect(out.url).toMatch(/covers=2/);
    expect(out.url).not.toMatch(/covers=4/);
    expect(out.url).toMatch(/dateTime=2026-05-12T19%3A00%3A00/);
  });

  it("falls back to a search URL when restaurant_url is missing", () => {
    const out = generateRestaurantDeepLink(NYC_BASELINE);
    expect(out.kind).toBe("search");
    expect(out.url).toContain("opentable.com/s?");
    // City must be folded into the term so OpenTable doesn't return matches
    // for whatever metro the session last viewed. URLSearchParams encodes the
    // apostrophe as %27 (stricter than encodeURIComponent which leaves it raw).
    expect(out.url).toContain("L%27Artusi");
    expect(out.url).toMatch(/New(\+|%20)York/);
    expect(out.url).toContain("covers=2");
  });

  it("falls back to search when given an OpenTable /s URL (not a detail)", () => {
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      restaurant_url: "https://www.opentable.com/s?term=foo",
    });
    expect(out.kind).toBe("search");
  });
});

// ─── Resy ───────────────────────────────────────────────────────────────────

describe("generateRestaurantDeepLink — Resy", () => {
  it("appends date / seats / time to a detail URL", () => {
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      restaurant_url: "https://resy.com/cities/ny/don-angie",
    });
    expect(out.platform).toBe("resy");
    expect(out.kind).toBe("detail");
    expect(out.label).toBe("Continue on Resy");
    expect(out.url).toContain("/cities/ny/don-angie");
    expect(out.url).toContain("date=2026-05-12");
    expect(out.url).toContain("seats=2");
    expect(out.url).toContain("time=19%3A00");
  });

  it("falls back to city homepage with query when no detail URL", () => {
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      platform: "resy",
    });
    expect(out.kind).toBe("search");
    expect(out.url).toContain("resy.com/cities/ny");
    expect(out.url).toContain("query=");
    expect(out.url).toContain("L%27Artusi");
  });

  it("maps known city aliases to Resy slugs", () => {
    const samples: Array<[string, string]> = [
      ["New York", "ny"],
      ["NYC", "ny"],
      ["Brooklyn", "ny"],
      ["Los Angeles", "la"],
      ["Chicago", "chi"],
      ["San Francisco", "sf"],
      ["Boston", "boston"],
    ];
    for (const [city, expectedSlug] of samples) {
      const out = generateRestaurantDeepLink({
        ...NYC_BASELINE,
        platform: "resy",
        city,
      });
      expect(out.url).toContain(`resy.com/cities/${expectedSlug}`);
    }
  });

  it("defaults to ny when city is unknown", () => {
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      platform: "resy",
      city: "Mars Colony",
    });
    expect(out.url).toContain("resy.com/cities/ny");
  });

  it("URL-encoding sanity: L'Artusi search-mode also lands in the city query", () => {
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      platform: "resy",
    });
    expect(out.url).toContain("L%27Artusi");
  });

  it("treats /cities/<city> alone as NOT a detail page", () => {
    // /cities/ny is the city homepage, not a restaurant detail URL.
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      restaurant_url: "https://resy.com/cities/ny",
    });
    expect(out.kind).toBe("search");
  });
});

// ─── Platform pick ──────────────────────────────────────────────────────────

describe("generateRestaurantDeepLink — platform selection", () => {
  it("auto-detects OpenTable from URL", () => {
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      restaurant_url: "https://www.opentable.com/lartusi",
    });
    expect(out.platform).toBe("opentable");
  });

  it("auto-detects Resy from URL", () => {
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      restaurant_url: "https://resy.com/cities/ny/don-angie",
    });
    expect(out.platform).toBe("resy");
  });

  it("defaults to OpenTable when URL is non-platform / missing", () => {
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      restaurant_url: "https://lartusi.com",
    });
    expect(out.platform).toBe("opentable");
  });

  it("explicit platform overrides URL inference", () => {
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      restaurant_url: "https://www.opentable.com/lartusi",
      platform: "resy",
    });
    expect(out.platform).toBe("resy");
  });
});

// ─── URL encoding ───────────────────────────────────────────────────────────

describe("generateRestaurantDeepLink — URL safety", () => {
  it("URL-encodes apostrophes in restaurant names", () => {
    const out = generateRestaurantDeepLink(NYC_BASELINE);
    expect(out.url).toContain("L%27Artusi");
  });

  it("URL-encodes spaces in city names (in search term)", () => {
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      city: "San Francisco",
    });
    expect(out.url).toMatch(/San(\+|%20)Francisco/);
  });

  it("never throws on a malformed restaurant_url (best-effort)", () => {
    const out = generateRestaurantDeepLink({
      ...NYC_BASELINE,
      restaurant_url: "not-actually-a-url",
    });
    expect(typeof out.url).toBe("string");
    expect(out.url.length).toBeGreaterThan(0);
  });
});
