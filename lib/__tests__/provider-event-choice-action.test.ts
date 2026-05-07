import { describe, expect, it } from "vitest";
import { buildProviderEventChoiceActionItem } from "@/lib/booking-jobs/provider-choice";

describe("provider event choice action item", () => {
  it("preserves the provider question as an action item with no unsafe direct option", () => {
    expect(
      buildProviderEventChoiceActionItem(
        "Which event date, city, and showtime should I use from this Ticketmaster page?",
      ),
    ).toEqual({
      message: "Which event date, city, and showtime should I use from this Ticketmaster page?",
      options: [],
    });
  });

  it("uses a clear fallback question when the executor summary is empty", () => {
    expect(buildProviderEventChoiceActionItem("  ")).toEqual({
      message: "Which event date, city, and showtime should I use from this provider page?",
      options: [],
    });
  });
});
