import { describe, it, expect } from "vitest";
import { mapAIStageToRPA } from "@/lib/booking-autopilot/core/stage-assessment";

// Pinning test for the AI → RPA stage mapping. The previous behaviour dropped
// no_availability into the unknown bucket, which caused stagehand-executor to
// run a 20+ second continuation pass on pages like "Permanently Closed" or
// "Not available on OpenTable" before falling out as executor_error.
//
// Real benchmark observation that motivated the fix (Carbone, 2026-04-30):
//   "[stage-detect] AI=no_availability(conf=0.95) → mapped=unknown | RPA=unknown"
// After this fix the same row reads "mapped=no_availability" and the
// stagehand-executor early-exit branch terminates within ~10s.

describe("mapAIStageToRPA", () => {
  it("forwards no_availability through (was previously dropped to unknown)", () => {
    expect(mapAIStageToRPA("no_availability")).toBe("no_availability");
  });

  it("maps the booking-progress stages 1:1", () => {
    expect(mapAIStageToRPA("listing")).toBe("listing");
    expect(mapAIStageToRPA("hotel_detail")).toBe("room_selection");
    expect(mapAIStageToRPA("room_selection")).toBe("room_selection");
    expect(mapAIStageToRPA("guest_form")).toBe("checkout_form");
    expect(mapAIStageToRPA("payment_form")).toBe("payment_gate");
    expect(mapAIStageToRPA("paused_payment")).toBe("payment_gate");
    expect(mapAIStageToRPA("captcha")).toBe("blocked");
  });

  it("keeps confirmation + unknown as unknown (no RPA equivalent)", () => {
    expect(mapAIStageToRPA("confirmation")).toBe("unknown");
    expect(mapAIStageToRPA("unknown")).toBe("unknown");
  });
});
