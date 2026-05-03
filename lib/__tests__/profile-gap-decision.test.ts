/**
 * Unit tests for `lib/profile-gap-decision.ts`.
 *
 * Codex's hardening brief (2026-05-03) specified 2 of these 4 scenarios
 * as decision-helper-level coverage; the other 2 (PATCH success/failure)
 * live in `profile-gap-on-save.test.ts`.
 *
 *   PB-DEC-1: backend `payload.profile_gap` takes priority over legacy
 *             4-field fallback.
 *   PB-DEC-2: `NEXT_PUBLIC_PROFILE_GAP_INLINE=0` (useInlineGate=false)
 *             falls through to legacy modal.
 *
 * Plus regression coverage for "no gap → no_gap" and the legacy-fallback
 * shape (used when backend forgot to emit `profile_gap`).
 */

import { describe, it, expect } from "vitest";
import {
  commitResponseToDecisionInput,
  decideProfileGap,
} from "../profile-gap-decision";
import type { NeedsProfileDataPayload } from "@/lib/core/execution/types";
import type { CommitResponse } from "@/components/ConfirmCard";

const STABLE_CARD_ID = "test-card-1";
const cardIdFactory = () => STABLE_CARD_ID;

const RESTAURANT_BACKEND_GAP: NeedsProfileDataPayload = {
  kind: "needs_profile_data",
  scenario: "restaurant",
  missing: ["first_name", "last_name", "email", "phone"],
  message: "Carbone needs a few contact details before I can hold the table.",
};

const HOTEL_BACKEND_GAP: NeedsProfileDataPayload = {
  kind: "needs_profile_data",
  scenario: "hotel",
  missing: [
    "first_name",
    "last_name",
    "email",
    "phone",
    "address_line1",
    "city",
    "state",
    "zip",
    "country",
  ],
  message: "Booking.com needs your address before checkout.",
};

const FLIGHT_INTERNATIONAL_GAP: NeedsProfileDataPayload = {
  kind: "needs_profile_data",
  scenario: "flight",
  missing: [
    "first_name",
    "last_name",
    "email",
    "phone",
    "date_of_birth",
    "passport_number",
    "passport_expiry",
    "passport_country",
  ],
  message: "International flights need DOB + passport before issuance.",
};

describe("decideProfileGap — PB-DEC-1: backend gap priority", () => {
  it("uses backend gap when both backend and legacy report missing fields", () => {
    const decision = decideProfileGap({
      backendGap: RESTAURANT_BACKEND_GAP,
      legacyMissing: ["phone"], // legacy says only phone, but backend says all 4 — backend wins
      profileExists: true,
      useInlineGate: true,
      venueName: "Carbone",
      scenario: "restaurant",
      cardIdFactory,
    });

    expect(decision.kind).toBe("inline");
    if (decision.kind !== "inline") return;

    expect(decision.cardId).toBe(STABLE_CARD_ID);
    // ProfileGapState carries backend's full 4-field missing list, not
    // the truncated 1-field legacy list.
    expect(decision.gapState.missing).toEqual([
      "first_name",
      "last_name",
      "email",
      "phone",
    ]);
    expect(decision.gapState.trigger).toBe("restaurant");
    expect(decision.gapState.reason).toBe(RESTAURANT_BACKEND_GAP.message);
    expect(decision.assistantMessage).toContain("Carbone");
  });

  it("uses backend hotel scenario gap with all 9 fields (not just legacy 4)", () => {
    const decision = decideProfileGap({
      backendGap: HOTEL_BACKEND_GAP,
      legacyMissing: ["first_name", "last_name", "email", "phone"],
      profileExists: true,
      useInlineGate: true,
      venueName: "Booking — The Plaza",
      scenario: "hotel",
      cardIdFactory,
    });

    expect(decision.kind).toBe("inline");
    if (decision.kind !== "inline") return;

    expect(decision.gapState.missing.length).toBe(9);
    expect(decision.gapState.missing).toContain("address_line1");
    expect(decision.gapState.trigger).toBe("hotel");
  });

  it("uses backend international-flight gap with passport fields", () => {
    const decision = decideProfileGap({
      backendGap: FLIGHT_INTERNATIONAL_GAP,
      legacyMissing: [],
      profileExists: true,
      useInlineGate: true,
      venueName: "JFK → CDG",
      scenario: "flight",
      cardIdFactory,
    });

    expect(decision.kind).toBe("inline");
    if (decision.kind !== "inline") return;

    expect(decision.gapState.missing).toContain("passport_number");
    expect(decision.gapState.missing).toContain("date_of_birth");
    expect(decision.gapState.trigger).toBe("flight");
  });
});

describe("decideProfileGap — PB-DEC-2: feature flag off → legacy modal", () => {
  it("returns legacy_modal when useInlineGate=false even if backend gap present", () => {
    const decision = decideProfileGap({
      backendGap: RESTAURANT_BACKEND_GAP,
      legacyMissing: ["first_name", "phone"],
      profileExists: true,
      useInlineGate: false,
      venueName: "Carbone",
      scenario: "restaurant",
      cardIdFactory,
    });

    expect(decision.kind).toBe("legacy_modal");
    if (decision.kind !== "legacy_modal") return;

    expect(decision.missing).toEqual(["first_name", "phone"]);
    expect(decision.assistantMessage).toContain("Carbone");
    // Legacy modal copy uses "contact details" not "a few details".
    expect(decision.assistantMessage).toContain("contact details");
  });

  it("returns legacy_modal when useInlineGate=false and only legacy reports missing", () => {
    const decision = decideProfileGap({
      backendGap: null,
      legacyMissing: ["email"],
      profileExists: true,
      useInlineGate: false,
      venueName: "Don Angie",
      scenario: "restaurant",
      cardIdFactory,
    });

    expect(decision.kind).toBe("legacy_modal");
  });
});

describe("decideProfileGap — no_gap path (regression)", () => {
  it("returns no_gap when profile is complete (no backend gap, no legacy missing)", () => {
    const decision = decideProfileGap({
      backendGap: null,
      legacyMissing: [],
      profileExists: true,
      useInlineGate: true,
      venueName: "Carbone",
      scenario: "restaurant",
      cardIdFactory,
    });

    expect(decision.kind).toBe("no_gap");
  });

  it("returns no_gap regardless of useInlineGate when nothing's missing", () => {
    const decisionA = decideProfileGap({
      backendGap: null,
      legacyMissing: [],
      profileExists: true,
      useInlineGate: true,
      venueName: "X",
      cardIdFactory,
    });
    const decisionB = decideProfileGap({
      backendGap: null,
      legacyMissing: [],
      profileExists: true,
      useInlineGate: false,
      venueName: "X",
      cardIdFactory,
    });

    expect(decisionA.kind).toBe("no_gap");
    expect(decisionB.kind).toBe("no_gap");
  });
});

describe("decideProfileGap — defensive fallback (backend forgot to emit)", () => {
  it("uses legacy 4-field shape when backendGap missing but legacy detects missing", () => {
    const decision = decideProfileGap({
      backendGap: null,
      legacyMissing: ["first_name", "phone"],
      profileExists: true,
      useInlineGate: true,
      venueName: "Atomix",
      scenario: "restaurant",
      cardIdFactory,
    });

    expect(decision.kind).toBe("inline");
    if (decision.kind !== "inline") return;

    // Falls back to legacy 4-field shape.
    expect(decision.gapState.missing).toEqual(["first_name", "phone"]);
    expect(decision.gapState.trigger).toBe("restaurant");
    expect(decision.gapState.reason).toContain("Atomix");
  });

  it("treats no profile row + empty legacyMissing as needs-profile (defensive)", () => {
    const decision = decideProfileGap({
      backendGap: null,
      legacyMissing: [],
      profileExists: false,
      useInlineGate: true,
      venueName: "Carbone",
      scenario: "restaurant",
      cardIdFactory,
    });

    // profileExists=false should still trigger needsProfile; we render the
    // inline card with empty missing[] so user can confirm what to fill.
    expect(decision.kind).toBe("inline");
    if (decision.kind !== "inline") return;
    expect(decision.gapState.missing).toEqual([]);
    expect(decision.gapState.trigger).toBe("restaurant");
  });

  it("normalizes unknown scenario → trigger 'generic'", () => {
    const decision = decideProfileGap({
      backendGap: null,
      legacyMissing: ["email"],
      profileExists: true,
      useInlineGate: true,
      venueName: "Mystery Venue",
      scenario: "weird_thing",
      cardIdFactory,
    });

    expect(decision.kind).toBe("inline");
    if (decision.kind !== "inline") return;
    expect(decision.gapState.trigger).toBe("generic");
  });
});

describe("decideProfileGap — id factory", () => {
  it("uses default factory when none injected, returns string id", () => {
    const decision = decideProfileGap({
      backendGap: RESTAURANT_BACKEND_GAP,
      legacyMissing: [],
      profileExists: true,
      useInlineGate: true,
      venueName: "X",
    });

    expect(decision.kind).toBe("inline");
    if (decision.kind !== "inline") return;
    expect(decision.cardId).toMatch(/^profile-gap-/);
  });
});

describe("commitResponseToDecisionInput — adapter sanity", () => {
  it("flattens CommitResponse + page-state inputs into helper input", () => {
    const payload: CommitResponse = {
      ok: true,
      kind: "direct_booking",
      venue_name: "Carbone",
      scenario: "restaurant",
      profile_gap: RESTAURANT_BACKEND_GAP,
    };

    const input = commitResponseToDecisionInput({
      payload,
      legacyMissing: ["phone"],
      profileExists: true,
      useInlineGate: true,
      cardIdFactory,
    });

    expect(input.backendGap).toBe(RESTAURANT_BACKEND_GAP);
    expect(input.venueName).toBe("Carbone");
    expect(input.scenario).toBe("restaurant");
    expect(input.legacyMissing).toEqual(["phone"]);
    expect(input.profileExists).toBe(true);
    expect(input.useInlineGate).toBe(true);
  });

  it("defaults venueName to 'this place' when payload missing it", () => {
    const payload: CommitResponse = {
      ok: true,
      kind: "direct_booking",
    };

    const input = commitResponseToDecisionInput({
      payload,
      legacyMissing: [],
      profileExists: false,
      useInlineGate: true,
    });

    expect(input.venueName).toBe("this place");
  });
});
