import { describe, expect, it } from "vitest";

import { classifyExpediaBillingInputKind } from "@/lib/booking-autopilot/providers/expedia";

describe("classifyExpediaBillingInputKind — Expedia checkout iframe billing-field classifier", () => {
  // Bug (P0, observed live in worker.log):
  //   The Expedia checkout payment widget renders billing inputs INSIDE the
  //   Checkout.com / Braintree iframe. Worker log frame[5] showed inputs with
  //     aria="Billing address 1"  ac="billing address-line1"
  //     aria="City"              ac="billing address-level2"
  //     aria="ZIP code"          ac="billing postal-code"
  //   The pre-fix logic only matched plain "address-line1" / "address-level2"
  //   in main page DOM, so the iframe inputs were never identified and never
  //   filled. The classifier below is the sole gate the iframe scanner uses
  //   to decide which input is which kind.

  describe("billing address 1", () => {
    it("matches CKO/Braintree iframe (autocomplete='billing address-line1')", () => {
      expect(classifyExpediaBillingInputKind({
        ariaLabel: "Billing address 1",
        autocomplete: "billing address-line1",
        placeholder: "(ex. 123 Main)",
      })).toBe("address1");
    });

    it("matches Hotels.com inline form (autocomplete='address-line1')", () => {
      expect(classifyExpediaBillingInputKind({ autocomplete: "address-line1" })).toBe("address1");
    });

    it("matches via tealeaf data-attr", () => {
      expect(classifyExpediaBillingInputKind({ dataTealeafName: "street" })).toBe("address1");
    });

    it("does NOT match address line 2 (suite / apartment)", () => {
      expect(classifyExpediaBillingInputKind({
        ariaLabel: "Billing address 2",
        autocomplete: "billing address-line2",
        placeholder: "(ex. Suite 400, Apt. 4B)",
      })).toBeNull();
    });
  });

  describe("billing city", () => {
    it("matches CKO iframe (autocomplete='billing address-level2')", () => {
      expect(classifyExpediaBillingInputKind({
        ariaLabel: "City",
        autocomplete: "billing address-level2",
      })).toBe("city");
    });

    it("matches Hotels.com inline form", () => {
      expect(classifyExpediaBillingInputKind({ autocomplete: "address-level2" })).toBe("city");
    });

    it("does NOT classify country/state/zip as city", () => {
      expect(classifyExpediaBillingInputKind({ ariaLabel: "Country/Territory" })).not.toBe("city");
      expect(classifyExpediaBillingInputKind({ ariaLabel: "Billing state" })).not.toBe("city");
      expect(classifyExpediaBillingInputKind({ ariaLabel: "ZIP code" })).not.toBe("city");
    });
  });

  describe("billing zip / postal code", () => {
    it("matches CKO iframe ZIP code (autocomplete='billing postal-code')", () => {
      expect(classifyExpediaBillingInputKind({
        ariaLabel: "ZIP code",
        autocomplete: "billing postal-code",
      })).toBe("zip");
    });

    it("matches CKO iframe 'Billing ZIP code' label variant", () => {
      expect(classifyExpediaBillingInputKind({
        ariaLabel: "Billing ZIP code",
        autocomplete: "billing postal-code",
      })).toBe("zip");
    });

    it("matches non-CKO postal-code inputs", () => {
      expect(classifyExpediaBillingInputKind({ autocomplete: "postal-code" })).toBe("zip");
    });

    it("does NOT match CVV / security code (must always reject)", () => {
      expect(classifyExpediaBillingInputKind({
        ariaLabel: "Security code",
        placeholder: "CVV",
      })).toBeNull();
      expect(classifyExpediaBillingInputKind({
        autocomplete: "cc-csc",
        ariaLabel: "Card security code",
      })).toBeNull();
    });

    it("does NOT match credit card number even when nothing else hints zip", () => {
      expect(classifyExpediaBillingInputKind({
        ariaLabel: "Card number",
        autocomplete: "cc-number",
      })).toBeNull();
    });
  });

  describe("billing country / state (selects)", () => {
    it("matches Country/Territory select", () => {
      expect(classifyExpediaBillingInputKind({
        ariaLabel: "Country/Territory",
        tag: "select",
      })).toBe("country");
    });

    it("matches a state select", () => {
      expect(classifyExpediaBillingInputKind({
        ariaLabel: "State",
        tag: "select",
      })).toBe("state");
    });

    it("matches state when rendered as plain input on some forms", () => {
      expect(classifyExpediaBillingInputKind({
        ariaLabel: "Billing state",
        tag: "input",
      })).toBe("state");
    });
  });

  describe("hard-rejects unrelated checkout fields", () => {
    it("rejects coupon / promo / gift-card", () => {
      expect(classifyExpediaBillingInputKind({ ariaLabel: "Promo code" })).toBeNull();
      expect(classifyExpediaBillingInputKind({ ariaLabel: "Coupon" })).toBeNull();
      expect(classifyExpediaBillingInputKind({ ariaLabel: "Gift card" })).toBeNull();
    });

    it("rejects empty descriptor", () => {
      expect(classifyExpediaBillingInputKind({})).toBeNull();
    });

    it("rejects email input", () => {
      expect(classifyExpediaBillingInputKind({
        ariaLabel: "Email address",
        autocomplete: "email",
      })).toBeNull();
    });
  });
});
