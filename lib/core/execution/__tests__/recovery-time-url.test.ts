import { describe, expect, it } from "vitest";
import { rewriteRestaurantStartUrlTimeForFallback } from "../recovery";

describe("rewriteRestaurantStartUrlTimeForFallback", () => {
  it("updates Resy exact venue time params", () => {
    expect(
      rewriteRestaurantStartUrlTimeForFallback(
        "https://resy.com/cities/new-york-ny/venues/buvette?date=2026-05-07&seats=1&time=2000",
        "20:30",
      ),
    ).toBe("https://resy.com/cities/new-york-ny/venues/buvette?date=2026-05-07&seats=1&time=2030");
  });

  it("updates OpenTable dateTime params without changing the date", () => {
    expect(
      rewriteRestaurantStartUrlTimeForFallback(
        "https://www.opentable.com/s?term=Buvette&dateTime=2026-05-07T20%3A00%3A00&covers=1",
        "19:30",
      ),
    ).toBe("https://www.opentable.com/s?term=Buvette&dateTime=2026-05-07T19%3A30%3A00&covers=1");
  });

  it("leaves URLs without known time params unchanged", () => {
    const url = "https://taogroup.com/venues/tao-downtown-new-york/";
    expect(rewriteRestaurantStartUrlTimeForFallback(url, "20:30")).toBe(url);
  });
});
