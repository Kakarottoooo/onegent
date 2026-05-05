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

    expect(source).toContain("const paymentPrefill = await fillExpediaGroupPaymentForm(checkoutPage, effectiveFlightProfile, trace)");
    expect(source).toContain("scrollExpediaCheckoutToFinalReviewBoundary(checkoutPage, trace)");
    expect(source).toContain("manual review needed for");
    expect(source).toContain("CVV/security code and Complete Booking remain human-only");
  });

  it("keeps Expedia payment prefill going when optional label APIs are unavailable", () => {
    const source = readFileSync("lib/booking-autopilot/providers/expedia.ts", "utf8");

    expect(source).toContain("getExpediaLabelLocator(page, labelText");
    expect(source).toContain("guest info prefill did not complete; continuing to allowed payment/billing fields");
  });

  it("explicitly scrolls Expedia checkout through payment, billing, and final review sections", () => {
    const source = readFileSync("lib/booking-autopilot/providers/expedia.ts", "utf8");

    expect(source).toContain("scrollExpediaCheckoutToSection(");
    expect(source).toContain('"payment details"');
    expect(source).toContain('"card fields"');
    expect(source).toContain('"billing address"');
    expect(source).toContain("scrollExpediaCheckoutToFinalReviewBoundary");
  });

  it("fills Expedia billing address fields by aria/autocomplete when locators miss", () => {
    const source = readFileSync("lib/booking-autopilot/providers/expedia.ts", "utf8");

    expect(source).toContain("Expedia billing native fill");
    expect(source).toContain("billing address-line1");
    expect(source).toContain("billing address-level2");
    expect(source).toContain("billing postal-code");
    expect(source).toContain("Expedia billing direct fill");
    expect(source).toContain("fillBySelectors");
    expect(source).toContain("addressCandidates");
    expect(source).toContain("b.index - a.index");
    expect(source).toContain("Expedia billing verify");
    expect(source).toContain("Expedia payment profile fields");
  });

  it("targets current Expedia creditCards billing field names directly", () => {
    const source = readFileSync("lib/booking-autopilot/providers/expedia.ts", "utf8");

    expect(source).toContain('input[name="creditCards[0].street"]');
    expect(source).toContain('input[name="creditCards[0].city"]');
    expect(source).toContain('input[name="creditCards[0].zipcode"]');
    expect(source).toContain("billing-address-one");
    expect(source).toContain("billing-city");
    expect(source).toContain("billing-zip-code");
    expect(source).toContain("Expedia billing exact field fill");
  });

  it("does not mark Expedia billing prefill complete when allowed billing fields are missing", () => {
    const source = readFileSync("lib/booking-autopilot/providers/expedia.ts", "utf8");

    expect(source).toContain("export type ExpediaPaymentPrefillResult");
    expect(source).toContain("complete: missing.length === 0");
    expect(source).toContain("const shouldPrefillCard = true");
    expect(source).toContain('"billing address 1"');
    expect(source).toContain('"billing city"');
    expect(source).toContain('"billing ZIP"');
  });

  it("keeps Expedia traveler phone country code on US when filling contact details", () => {
    const source = readFileSync("lib/booking-autopilot/providers/expedia.ts", "utf8");

    expect(source).toContain("phoneCountryCode");
    expect(source).toContain("United States of America +1");
    expect(source).toContain("phone country code");
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
