/**
 * Unit tests for validateConsent — pure function, no mocks needed.
 * Covers each ConsentAction variant × allow/deny edge cases.
 */

import { describe, it, expect } from "vitest";
import { validateConsent } from "../validator";
import type { ConsentPolicy, ConsentAction } from "../types";
import { DEFAULT_CONSENT_POLICY } from "../default-policy";

describe("validateConsent", () => {
  describe("adjust_time", () => {
    it("allows time shift within policy window", () => {
      const action: ConsentAction = {
        type: "adjust_time",
        fromTime: "19:00",
        toTime: "19:30",
      };
      expect(validateConsent(DEFAULT_CONSENT_POLICY, action)).toEqual({
        allowed: true,
      });
    });

    it("denies when allowTimeAdjustment is false", () => {
      const policy: ConsentPolicy = { ...DEFAULT_CONSENT_POLICY, allowTimeAdjustment: false };
      const action: ConsentAction = { type: "adjust_time", fromTime: "19:00", toTime: "19:30" };
      const result = validateConsent(policy, action);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toMatch(/not permitted/i);
    });

    it("denies when delta exceeds maxTimeAdjustmentMinutes", () => {
      const policy: ConsentPolicy = { ...DEFAULT_CONSENT_POLICY, maxTimeAdjustmentMinutes: 30 };
      const action: ConsentAction = { type: "adjust_time", fromTime: "19:00", toTime: "20:00" }; // 60 min delta
      const result = validateConsent(policy, action);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toMatch(/exceeds/i);
    });

    it("handles negative delta (earlier time) same as positive", () => {
      const policy: ConsentPolicy = { ...DEFAULT_CONSENT_POLICY, maxTimeAdjustmentMinutes: 30 };
      // from 19:00 back to 18:00 is also 60 min delta
      const action: ConsentAction = { type: "adjust_time", fromTime: "19:00", toTime: "18:00" };
      const result = validateConsent(policy, action);
      expect(result.allowed).toBe(false);
    });

    it("parses 1-digit hours correctly (7:30 = 07:30)", () => {
      const policy: ConsentPolicy = { ...DEFAULT_CONSENT_POLICY, maxTimeAdjustmentMinutes: 60 };
      const action: ConsentAction = { type: "adjust_time", fromTime: "7:30", toTime: "8:00" }; // 30 min delta
      expect(validateConsent(policy, action)).toEqual({ allowed: true });
    });
  });

  describe("switch_venue", () => {
    it("allows when allowVenueSwitch is true (default)", () => {
      const action: ConsentAction = {
        type: "switch_venue",
        fromVenue: "Le Bernardin",
        toVenue: "Eleven Madison",
      };
      expect(validateConsent(DEFAULT_CONSENT_POLICY, action)).toEqual({ allowed: true });
    });

    it("denies when allowVenueSwitch is false", () => {
      const policy: ConsentPolicy = { ...DEFAULT_CONSENT_POLICY, allowVenueSwitch: false };
      const action: ConsentAction = {
        type: "switch_venue",
        fromVenue: "Le Bernardin",
        toVenue: "Eleven Madison",
      };
      const result = validateConsent(policy, action);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toMatch(/not permitted/i);
    });
  });

  describe("retry", () => {
    it("allows attempt within maxRetries", () => {
      const action: ConsentAction = { type: "retry", attemptNumber: 2 };
      expect(validateConsent(DEFAULT_CONSENT_POLICY, action)).toEqual({ allowed: true });
    });

    it("allows the boundary attempt (=== maxRetries)", () => {
      const policy: ConsentPolicy = { ...DEFAULT_CONSENT_POLICY, maxRetries: 3 };
      const action: ConsentAction = { type: "retry", attemptNumber: 3 };
      expect(validateConsent(policy, action)).toEqual({ allowed: true });
    });

    it("denies attempt beyond maxRetries", () => {
      const policy: ConsentPolicy = { ...DEFAULT_CONSENT_POLICY, maxRetries: 3 };
      const action: ConsentAction = { type: "retry", attemptNumber: 4 };
      const result = validateConsent(policy, action);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toMatch(/exceeds/i);
    });

    it("uses default 3 when maxRetries undefined", () => {
      const policy: ConsentPolicy = {}; // totally empty
      expect(validateConsent(policy, { type: "retry", attemptNumber: 3 })).toEqual({ allowed: true });
      expect(validateConsent(policy, { type: "retry", attemptNumber: 4 })).toMatchObject({
        allowed: false,
      });
    });
  });

  describe("use_provider", () => {
    it("allows when no list restrictions", () => {
      const action: ConsentAction = { type: "use_provider", providerId: "resy-com" };
      expect(validateConsent(DEFAULT_CONSENT_POLICY, action)).toEqual({ allowed: true });
    });

    it("denies when blocked (blocklist takes precedence)", () => {
      const policy: ConsentPolicy = {
        ...DEFAULT_CONSENT_POLICY,
        allowedProviders: ["resy-com"],
        blockedProviders: ["resy-com"],
      };
      const action: ConsentAction = { type: "use_provider", providerId: "resy-com" };
      const result = validateConsent(policy, action);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toMatch(/blocklist/i);
    });

    it("denies when not in allowedProviders", () => {
      const policy: ConsentPolicy = {
        ...DEFAULT_CONSENT_POLICY,
        allowedProviders: ["opentable-com"],
      };
      const action: ConsentAction = { type: "use_provider", providerId: "resy-com" };
      const result = validateConsent(policy, action);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toMatch(/allowlist/i);
    });

    it("allows when in allowedProviders", () => {
      const policy: ConsentPolicy = {
        ...DEFAULT_CONSENT_POLICY,
        allowedProviders: ["resy-com", "opentable-com"],
      };
      const action: ConsentAction = { type: "use_provider", providerId: "resy-com" };
      expect(validateConsent(policy, action)).toEqual({ allowed: true });
    });

    it("denies when explicitly blocked, no allowlist", () => {
      const policy: ConsentPolicy = {
        ...DEFAULT_CONSENT_POLICY,
        blockedProviders: ["yelp-com"],
      };
      const action: ConsentAction = { type: "use_provider", providerId: "yelp-com" };
      const result = validateConsent(policy, action);
      expect(result.allowed).toBe(false);
    });
  });
});
