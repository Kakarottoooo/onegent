/**
 * Unit tests for shouldTryProviderFallback — the Phase 3 trigger predicate.
 *
 * Pure function, no DB / no browser / no mocks. Each test is one row of
 * the truth table in should-try-fallback.ts.
 */

import { describe, it, expect } from "vitest";
import { shouldTryProviderFallback } from "../should-try-fallback";

describe("shouldTryProviderFallback", () => {
  describe("scenario gating", () => {
    it("returns false for non-restaurant scenarios even with no_availability", () => {
      expect(
        shouldTryProviderFallback({
          scenario: "hotel",
          status: "no_availability",
          summary: "Anything",
        }),
      ).toBe(false);

      expect(
        shouldTryProviderFallback({
          scenario: "flight",
          status: "no_availability",
          summary: "Anything",
        }),
      ).toBe(false);

      expect(
        shouldTryProviderFallback({
          scenario: "activity",
          status: "error",
          summary: "Stalled at listing page",
        }),
      ).toBe(false);
    });
  });

  describe("status=no_availability (classic, always true)", () => {
    it("returns true regardless of summary content", () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "no_availability",
          summary: "All slots booked",
        }),
      ).toBe(true);

      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "no_availability",
          summary: '"Carbone" was not found on OpenTable',
        }),
      ).toBe(true);
    });
  });

  describe("status=error + whitelist match (the bug fix)", () => {
    it('triggers on "not found on opentable"', () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary: '"Le Bernardin" was not found on OpenTable',
        }),
      ).toBe(true);
    });

    it('triggers on "stalled at listing"', () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary: "Stalled at listing page",
          error: "Stalled at listing — couldn't find booking widget",
        }),
      ).toBe(true);
    });

    it('triggers on "stuck at" variations', () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary: "The agent got stuck at the venue page",
        }),
      ).toBe(true);
    });

    it('triggers on "no recognisable page signals"', () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary:
            "Final state had no recognisable page signals — agent could not proceed",
        }),
      ).toBe(true);
    });

    it('triggers on "stage=unknown"', () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary: "Final stage=unknown after continuation pass",
        }),
      ).toBe(true);
    });

    it('triggers on "unverified checkout field"', () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary:
            "The agent appeared to finish, but guest/contact/card values were not verified in distinct checkout fields",
          error: "Unverified checkout field values on final state.",
        }),
      ).toBe(true);
    });

    it('triggers on "reached a payment-like page"', () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary: "The agent reached a payment-like page, but fields were empty",
        }),
      ).toBe(true);
    });

    it('triggers on "books through their own"', () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary:
            "Carbone books through their own reservation system, agent could not complete",
        }),
      ).toBe(true);
    });
  });

  describe("status=error + blocklist match (must NOT trigger)", () => {
    it('blocks on "page load failed"', () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary: "The browser failed to load the booking page.",
          error: "Page load failed (url: chrome-error://...)",
        }),
      ).toBe(false);
    });

    it("blocks on HTTP 402 quota", () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary: "The automation provider rejected this run",
          error: "Quota/billing issue (HTTP 402) from anthropic",
        }),
      ).toBe(false);
    });

    it("blocks on bot protection", () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary: "The site blocked the automated browser",
        }),
      ).toBe(false);
    });

    it("blocks on chrome-error pages", () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary: "Page failed",
          error: "url=chrome-error://chromewebdata/",
        }),
      ).toBe(false);
    });
  });

  describe("status=error + no whitelist match", () => {
    it("returns false for unrecognised generic error", () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary: "An unexpected error occurred.",
          error: "TypeError: Cannot read property 'foo' of undefined",
        }),
      ).toBe(false);
    });

    it("returns false for transient timeout (no whitelist match)", () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary: "Operation timed out after 60s",
        }),
      ).toBe(false);
    });
  });

  describe("non-eligible statuses", () => {
    it("returns false for captcha", () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "captcha",
          summary: "CAPTCHA detected",
        }),
      ).toBe(false);
    });

    it("returns false for needs_login", () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "needs_login",
          summary: "Login required",
        }),
      ).toBe(false);
    });

    it("returns false for completed", () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "completed",
          summary: "Booking confirmed",
        }),
      ).toBe(false);
    });

    it("returns false for paused_payment", () => {
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "paused_payment",
          summary: "Awaiting payment",
        }),
      ).toBe(false);
    });
  });

  describe("blocklist precedence", () => {
    it("blocklist wins over whitelist when both match", () => {
      // Even though "stalled" is whitelisted, the HTTP 402 should deny.
      expect(
        shouldTryProviderFallback({
          scenario: "restaurant",
          status: "error",
          summary: "Stalled at listing — quota exhausted",
          error: "HTTP 402 from openai",
        }),
      ).toBe(false);
    });
  });
});
