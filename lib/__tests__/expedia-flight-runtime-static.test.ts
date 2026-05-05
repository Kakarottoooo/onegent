import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSummaryLog } from "../execution-v2/legacy-stagehand";

describe("Expedia flight runtime safety guards", () => {
  it("falls back to locator fill when checkout page.evaluate fails", () => {
    const source = readFileSync("lib/booking-autopilot/providers/expedia.ts", "utf8");

    expect(source).toContain("results.firstName !== true && profile.first_name");
    expect(source).toContain("results.lastName !== true && profile.last_name");
    expect(source).toContain("results.email !== true && profile.email");
    expect(source).toContain("results.phone !== true && phoneDigits");
    expect(source).toContain("fillExpediaTravelerDobFallback(page, profile.date_of_birth, trace)");
    expect(source).toContain("clickExpediaTravelerGender(page, gender, trace)");
  });

  it("prefills allowed Expedia payment fields before the final manual boundary", () => {
    const source = readFileSync("lib/booking-autopilot/stagehand-executor.ts", "utf8");

    expect(source).toContain("fillExpediaGroupPaymentForm(checkoutPage, effectiveFlightProfile, trace)");
    expect(source).toContain("scrollExpediaCheckoutToFinalReviewBoundary(checkoutPage, trace)");
    expect(source).toContain("CVV/security code and final booking remain human-only");
  });

  it("does not include CVV or security-code selectors in Expedia card iframe candidates", () => {
    const source = readFileSync("lib/booking-autopilot/providers/expedia.ts", "utf8");

    expect(source).toContain("security.?code");
    expect(source).toContain("verification.?code");
    expect(source).toContain("final button not clicked");
  });

  it("treats incomplete traveler checkout as manual review instead of retryable error", () => {
    const source = readFileSync("lib/booking-autopilot/stagehand-executor.ts", "utf8");
    const incompleteBlock = source.slice(
      source.indexOf("travelerState.missingRequiredFields.length > 0"),
      source.indexOf("// Keep the Expedia flight browser open", source.indexOf("travelerState.missingRequiredFields.length > 0")),
    );

    expect(incompleteBlock).toContain('status: "paused_payment" as const');
    expect(incompleteBlock).not.toContain('status: "error" as const');
  });

  it("expands executor trace into visible task decision-log entries", () => {
    const entries = buildSummaryLog(
      [
        "[flight-rpa] Opened site",
        "[flight-rpa] Checkout reached - running AI form fill",
        "[flight-rpa] Traveler form state: filled=none missing=first name",
      ],
      "2026-05-05T00:00:00.000Z",
    );

    expect(entries).toHaveLength(4);
    expect(entries[0].message).toBe("Executor trace (3 entries)");
    expect(entries.map((entry) => entry.message)).toContain("Checkout reached - running AI form fill");
    expect(entries.at(-1)).toMatchObject({
      type: "failed",
      message: "Traveler form state: filled=none missing=first name",
    });
  });
});
