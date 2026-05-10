import { describe, expect, it } from "vitest";
import {
  buildProviderEventChoiceActionItem,
  getProviderEventChoiceActionItem,
  providerEventChoiceMessage,
  stepNeedsProviderEventChoice,
} from "@/lib/booking-jobs/provider-choice";

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

  it("preserves visible provider candidates as review-only choices", () => {
    expect(
      buildProviderEventChoiceActionItem(
        "Ticketmaster shows multiple visible events. Which one should I use?",
        [
          { label: "Sep 17 7:00 PM Disney On Ice Detroit" },
          { label: "Sep 18 11:00 AM Disney On Ice Detroit", url: "https://example.com/event" },
        ],
      ),
    ).toEqual({
      message: "Ticketmaster shows multiple visible events. Which one should I use?",
      options: [
        { label: "Sep 17 7:00 PM Disney On Ice Detroit", url: "" },
        { label: "Sep 18 11:00 AM Disney On Ice Detroit", url: "https://example.com/event" },
      ],
    });
  });

  it("recovers provider choice intent from legacy decision logs", () => {
    const step = {
      decisionLog: [
        {
          message: "[tm-rpa] Task state: user_event_choice_required (executorStatus=paused_payment)",
        },
        {
          message: "Which event date, city, and showtime should I use from this Ticketmaster page?",
        },
      ],
    };

    expect(stepNeedsProviderEventChoice(step)).toBe(true);
    expect(providerEventChoiceMessage(step)).toBe(
      "Which event date, city, and showtime should I use from this Ticketmaster page?",
    );
    expect(getProviderEventChoiceActionItem(step)).toMatchObject({
      options: [],
    });
  });
});
