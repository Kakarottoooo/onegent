import { describe, expect, it } from "vitest";
import {
  explainResySlotCandidate,
  parseResyTimeMinutes,
  pickBestResySlotCandidate,
  type ResySlotCandidateMeta,
} from "@/lib/booking-autopilot/providers/resy-slot-detection";

function candidate(overrides: Partial<ResySlotCandidateMeta>): ResySlotCandidateMeta {
  return {
    text: "",
    x: 100,
    y: 520,
    width: 120,
    height: 42,
    ...overrides,
  };
}

describe("Resy slot detection", () => {
  it("parses Resy 12-hour slot text", () => {
    expect(parseResyTimeMinutes("8:00 PM Bar Seats")).toBe(20 * 60);
    expect(parseResyTimeMinutes("12:15 AM")).toBe(15);
    expect(parseResyTimeMinutes("12:15 PM")).toBe(12 * 60 + 15);
  });

  it("accepts availability slot cards with seating labels", () => {
    const result = explainResySlotCandidate(
      candidate({ text: "8:00 PM Bar Seats", tagName: "BUTTON", parentText: "8:00 PM Bar Seats" }),
      20 * 60,
      60,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hit.text).toBe("8:00 PM Bar Seats");
      expect(result.hit.diffMinutes).toBe(0);
    }
  });

  it("rejects the top Time control from the Resy venue filter bar", () => {
    const result = explainResySlotCandidate(
      candidate({
        text: "Time 8:00 PM",
        tagName: "BUTTON",
        parentText: "Guests 2 Guests Date Fri., May 8 Time 8:00 PM",
      }),
      20 * 60,
      60,
    );

    expect(result).toEqual({ ok: false, reason: "filter-control" });
  });

  it("rejects a leaf time node when its parent is the Resy filter bar", () => {
    const result = explainResySlotCandidate(
      candidate({
        text: "8:00 PM",
        tagName: "DIV",
        parentText: "Guests 2 Guests Date Fri., May 8 Time 8:00 PM",
      }),
      20 * 60,
      60,
    );

    expect(result).toEqual({ ok: false, reason: "filter-control" });
  });

  it("chooses the closest real availability slot and ignores controls", () => {
    const hit = pickBestResySlotCandidate(
      [
        candidate({ text: "Time 8:00 PM", parentText: "Guests 2 Guests Date Fri., May 8 Time 8:00 PM", y: 430 }),
        candidate({ text: "8:30 PM Dining Room", parentText: "8:30 PM Dining Room", y: 610 }),
        candidate({ text: "8:00 PM Bar Seats", parentText: "8:00 PM Bar Seats", y: 590 }),
      ],
      20 * 60,
      60,
    );

    expect(hit?.text).toBe("8:00 PM Bar Seats");
    expect(hit?.y).toBe(590);
  });
});
