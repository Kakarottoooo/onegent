/**
 * Golden tests for the profile_edit intent path.
 *
 * Two layers:
 *   1. Router (pure function) — given an IntentState with intent="profile_edit"
 *      and a profile_patch, the router must emit apply_profile_patch.
 *      Defensive cases: empty patch / undefined patch fall back to continue_chat.
 *
 *   2. Extractor coercion (`coerceProfilePatch`, `coerceIntentState`) —
 *      validates that the LLM's raw JSON output gets cleaned up correctly:
 *      unknown keys dropped, blank values dropped, ISO dates normalized,
 *      empty patch → undefined.
 *
 * The actual extractor LLM accuracy is verified separately via a smoke run
 * (see existing golden-restaurant / golden-multi tests for that pattern).
 * These golden tests pin the deterministic logic.
 */

import { describe, it, expect } from "vitest";
import { routeIntent } from "../router";
import { coerceProfilePatch, coerceIntentState } from "../extractor";
import type { IntentState, ProfilePatch } from "../types";

const baseState = (overrides: Partial<IntentState> = {}): IntentState => {
  const base: IntentState = {
    confidence: 0.9,
    turn_count: 1,
    updated_at: "2026-05-02T00:00:00Z",
    intent: "profile_edit",
    scenario: null,
    categories: [],
    party_type: "solo",
    member_names: [],
    refined_target_id: null,
    planning_assumptions: [],
  };
  return { ...base, ...overrides };
};

/* ─── Router behavior ─────────────────────────────────────────────── */

describe("routeIntent · profile_edit", () => {
  it("PE1. profile_edit + non-empty patch → apply_profile_patch", () => {
    const state = baseState({
      profile_patch: { date_of_birth: "1995-05-15" },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("apply_profile_patch");
    if (action.type === "apply_profile_patch") {
      expect(action.patch).toEqual({ date_of_birth: "1995-05-15" });
    }
  });

  it("PE2. profile_edit + multiple fields → patch carries all of them", () => {
    const state = baseState({
      profile_patch: {
        first_name: "Jane",
        last_name: "Doe",
        phone: "+1 555 0100",
      },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("apply_profile_patch");
    if (action.type === "apply_profile_patch") {
      expect(action.patch).toEqual({
        first_name: "Jane",
        last_name: "Doe",
        phone: "+1 555 0100",
      });
    }
  });

  it("PE3. profile_edit but profile_patch undefined → continue_chat (defensive)", () => {
    const state = baseState({ profile_patch: undefined });
    const action = routeIntent(state);
    // Router refuses to ship an empty PATCH — falls back to chat so the
    // user gets a conversational reply instead of a no-op.
    expect(action.type).toBe("continue_chat");
  });

  it("PE4. profile_edit but profile_patch is empty object → continue_chat", () => {
    // coerceIntentState is supposed to strip empty patches, but if a hand-built
    // state slips through the router still defends.
    const state = baseState({ profile_patch: {} });
    const action = routeIntent(state);
    expect(action.type).toBe("continue_chat");
  });

  it("PE5. profile_edit takes precedence over a populated booking sub-state", () => {
    // User said "实际我的 DOB 是 1995/5/15" mid-restaurant-flow. The booking
    // sub-state is preserved (next turn resumes), but THIS turn routes to
    // apply_profile_patch — the booking pipeline should NOT advance.
    const state = baseState({
      intent: "profile_edit",
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "New York",
        date: "2026-05-14",
        time: "19:00",
        party_size: 2,
        cuisine: "Italian",
      },
      profile_patch: { date_of_birth: "1995-05-15" },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("apply_profile_patch");
    // Crucially: the router does NOT emit show_confirm_card / ask_clarification
    // for the restaurant flow this turn.
  });

  it("PE6. profile_edit precedence vs. ambiguous party_mode (multi + no member_names)", () => {
    // Even when the booking state would normally trigger the solo-vs-DR ask,
    // profile_edit short-circuits before reaching that gate.
    const state = baseState({
      intent: "profile_edit",
      scenario: "restaurant",
      categories: ["restaurant"],
      party_type: "multi",
      member_names: [],
      profile_patch: { phone: "555-0100" },
    });
    const action = routeIntent(state);
    expect(action.type).toBe("apply_profile_patch");
  });
});

/* ─── coerceProfilePatch — defensive cleanup ─────────────────────── */

describe("coerceProfilePatch", () => {
  it("PC1. valid canonical fields pass through", () => {
    const out = coerceProfilePatch({
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      phone: "+1 555 0100",
    });
    expect(out).toEqual({
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      phone: "+1 555 0100",
    });
  });

  it("PC2. unknown keys (ssn / credit_card / full_name) are dropped", () => {
    const out = coerceProfilePatch({
      first_name: "Jane",
      ssn: "123-45-6789",
      credit_card: "4111111111111111",
      // full_name is the LEGACY alias — not in PROFILE_EDIT_FIELDS, so dropped.
      // The extractor prompt teaches the model to split into first_name + last_name.
      full_name: "Jane Doe",
    });
    expect(out).toEqual({ first_name: "Jane" });
  });

  it("PC3. blank / whitespace values are dropped", () => {
    const out = coerceProfilePatch({
      first_name: "Jane",
      last_name: "",
      email: "   ",
      phone: "+1 555 0100",
    });
    expect(out).toEqual({
      first_name: "Jane",
      phone: "+1 555 0100",
    });
  });

  it("PC4. date_of_birth ISO already → unchanged", () => {
    const out = coerceProfilePatch({ date_of_birth: "1995-05-15" });
    expect(out).toEqual({ date_of_birth: "1995-05-15" });
  });

  it("PC5. date_of_birth — non-ISO that resolveDateHint can't parse stays dropped", () => {
    // The extractor prompt asks the model to emit YYYY-MM-DD. If it slips,
    // coerceProfilePatch falls back to isoDateOrUndef which uses
    // resolveDateHint. Random strings drop entirely so we never PATCH a
    // garbage DOB.
    const out = coerceProfilePatch({ date_of_birth: "circa 1995, May" });
    // Either dropped or normalized; both acceptable as long as it's not the raw string.
    if (out !== undefined && out.date_of_birth !== undefined) {
      expect(out.date_of_birth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("PC6. passport_expiry follows the same ISO rule as DOB", () => {
    const out = coerceProfilePatch({ passport_expiry: "2030-12-01" });
    expect(out).toEqual({ passport_expiry: "2030-12-01" });
  });

  it("PC7. address_line2 / ktn (UI-only optional) are dropped", () => {
    // Per PROFILE-GAP contract, ktn and address_line2 are UI-only — backend
    // never includes them in `missing[]`. NLU should mirror that: don't accept
    // them via profile_patch either.
    const out = coerceProfilePatch({
      address_line1: "123 Main St",
      address_line2: "Apt 5",
      ktn: "999999999",
    });
    expect(out).toEqual({ address_line1: "123 Main St" });
  });

  it("PC8. empty input → undefined (so the spread-skip works)", () => {
    expect(coerceProfilePatch({})).toBeUndefined();
    expect(coerceProfilePatch(null)).toBeUndefined();
    expect(coerceProfilePatch(undefined)).toBeUndefined();
    expect(coerceProfilePatch("not an object")).toBeUndefined();
    expect(coerceProfilePatch([])).toBeUndefined();
  });

  it("PC9. all-blank values → undefined (post-strip, nothing left)", () => {
    expect(
      coerceProfilePatch({ first_name: "", last_name: "  ", email: "" }),
    ).toBeUndefined();
  });
});

/* ─── End-to-end via coerceIntentState ─────────────────────────── */

describe("coerceIntentState · profile_edit integration", () => {
  it("PI1. profile_edit + valid patch → state has profile_patch attached", () => {
    const state = coerceIntentState(
      {
        intent: "profile_edit",
        scenario: null,
        categories: [],
        party_type: "solo",
        member_names: [],
        refined_target_id: null,
        planning_assumptions: [],
        profile_patch: { date_of_birth: "1995-05-15" },
      },
      null,
    );
    expect(state.intent).toBe("profile_edit");
    expect(state.profile_patch).toEqual({ date_of_birth: "1995-05-15" });
  });

  it("PI2. profile_edit + empty patch → profile_patch field omitted", () => {
    const state = coerceIntentState(
      {
        intent: "profile_edit",
        scenario: null,
        categories: [],
        party_type: "solo",
        member_names: [],
        refined_target_id: null,
        planning_assumptions: [],
        profile_patch: {},
      },
      null,
    );
    expect(state.intent).toBe("profile_edit");
    expect(state.profile_patch).toBeUndefined();
    // And the router falls back to continue_chat for this combo:
    expect(routeIntent(state).type).toBe("continue_chat");
  });

  it("PI3. profile_edit mid-flow preserves prev booking sub-state", () => {
    const prev: IntentState = baseState({
      intent: "create_plan",
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "New York",
        date: "2026-05-14",
        time: "19:00",
        party_size: 2,
        cuisine: "Italian",
      },
    });
    const next = coerceIntentState(
      {
        // Model emits profile_edit + the patch, while leaving categories/scenario alone
        intent: "profile_edit",
        scenario: "restaurant",
        categories: ["restaurant"],
        party_type: "solo",
        member_names: [],
        refined_target_id: null,
        planning_assumptions: [],
        restaurant: {
          city: "New York",
          date: "2026-05-14",
          time: "19:00",
          party_size: 2,
          cuisine: "Italian",
        },
        profile_patch: { date_of_birth: "1995-05-15" },
      },
      prev,
    );
    expect(next.intent).toBe("profile_edit");
    expect(next.scenario).toBe("restaurant");
    expect(next.categories).toEqual(["restaurant"]);
    expect(next.restaurant).toBeDefined();
    expect(next.restaurant?.city).toBe("New York");
    expect(next.restaurant?.cuisine).toBe("Italian");
    expect(next.profile_patch).toEqual({ date_of_birth: "1995-05-15" });
    // Router emits apply_profile_patch this turn — booking flow waits.
    const action = routeIntent(next);
    expect(action.type).toBe("apply_profile_patch");
    if (action.type === "apply_profile_patch") {
      expect(action.patch).toEqual({ date_of_birth: "1995-05-15" });
    }
  });

  it("PI4. profile_edit doesn't pollute non-profile turns: prev profile_patch is NOT carried forward", () => {
    // Each turn carries the fresh patch. Once the frontend has applied it,
    // the next turn's coercion shouldn't re-emit the same patch — that would
    // double-PATCH on the next profile-edit turn.
    const prev: IntentState = baseState({
      intent: "profile_edit",
      profile_patch: { date_of_birth: "1995-05-15" },
    });
    const next = coerceIntentState(
      {
        intent: "create_plan",
        scenario: "restaurant",
        categories: ["restaurant"],
        party_type: "solo",
        member_names: [],
        refined_target_id: null,
        planning_assumptions: [],
        restaurant: { city: "New York" },
        // model omits profile_patch — user just continued booking
      },
      prev,
    );
    expect(next.intent).toBe("create_plan");
    expect(next.profile_patch).toBeUndefined();
  });
});

/* ─── Date format normalization (PD1-PD7) ────────────────────────── */
//
// The model is told to emit YYYY-MM-DD. When it slips up, coerceProfilePatch
// runs the value through resolveDateHint as a safety net. These tests pin
// what does and doesn't get normalized so we don't accidentally PATCH a
// raw string that the backend will reject.

describe("coerceProfilePatch · date format normalization", () => {
  it("PD1. ISO YYYY-MM-DD passes through unchanged", () => {
    const out = coerceProfilePatch({ date_of_birth: "1995-05-15" });
    expect(out).toEqual({ date_of_birth: "1995-05-15" });
  });

  it("PD2. MM/DD/YYYY normalizes to ISO", () => {
    const out = coerceProfilePatch({ date_of_birth: "5/15/1995" });
    expect(out).toEqual({ date_of_birth: "1995-05-15" });
  });

  it("PD3. zero-padded MM/DD/YYYY normalizes to ISO", () => {
    const out = coerceProfilePatch({ date_of_birth: "05/15/1995" });
    expect(out).toEqual({ date_of_birth: "1995-05-15" });
  });

  it("PD4. textual 'May 15 1995' normalizes to ISO via JS Date", () => {
    const out = coerceProfilePatch({ date_of_birth: "May 15 1995" });
    expect(out).toEqual({ date_of_birth: "1995-05-15" });
  });

  it("PD5. CJK year-month-day '1995年5月15日' is dropped (no parser handles it)", () => {
    // Model output should pre-normalize this to ISO; if it leaks through raw
    // we drop rather than risk PATCHing a string the backend can't read.
    const out = coerceProfilePatch({ date_of_birth: "1995年5月15日" });
    expect(out).toBeUndefined();
  });

  it("PD6. valid + invalid date in same patch — only invalid drops", () => {
    const out = coerceProfilePatch({
      first_name: "Jane",
      date_of_birth: "garbage-date",
      phone: "+1 555 0100",
    });
    expect(out).toEqual({ first_name: "Jane", phone: "+1 555 0100" });
  });

  it("PD7. passport_expiry in MM/DD/YYYY normalizes (same path as DOB)", () => {
    const out = coerceProfilePatch({ passport_expiry: "12/01/2030" });
    expect(out).toEqual({ passport_expiry: "2030-12-01" });
  });
});

/* ─── Adversarial value types (PA1-PA5) ──────────────────────────── */
//
// strOrUndef coerces to a non-blank string or undefined. Pin the behavior
// against typical LLM JSON-mode escapes (numbers in name fields, nulls,
// nested objects, arrays, booleans).

describe("coerceProfilePatch · adversarial value types", () => {
  it("PA1. number value (e.g. phone as int) is dropped", () => {
    const out = coerceProfilePatch({
      first_name: "Jane",
      phone: 4155550100, // number, not string
    });
    // strOrUndef rejects non-strings → phone dropped, only first_name survives
    expect(out).toEqual({ first_name: "Jane" });
  });

  it("PA2. null value is dropped", () => {
    const out = coerceProfilePatch({
      first_name: "Jane",
      last_name: null,
      email: null,
    });
    expect(out).toEqual({ first_name: "Jane" });
  });

  it("PA3. boolean value is dropped", () => {
    const out = coerceProfilePatch({ first_name: true, last_name: "Doe" });
    expect(out).toEqual({ last_name: "Doe" });
  });

  it("PA4. nested object value is dropped", () => {
    const out = coerceProfilePatch({
      first_name: { first: "Jane" },
      last_name: "Doe",
    });
    expect(out).toEqual({ last_name: "Doe" });
  });

  it("PA5. array value is dropped", () => {
    const out = coerceProfilePatch({
      first_name: ["Jane"],
      email: "jane@example.com",
    });
    expect(out).toEqual({ email: "jane@example.com" });
  });
});

/* ─── Field-name aliases dropped (PN1-PN4) ────────────────────────── */
//
// PROFILE_EDIT_FIELDS is the canonical 13. Any case-mangled / camelCased /
// kebab-cased / snake-typo'd alias the LLM might emit gets dropped. The
// extractor prompt teaches canonical snake_case; this is the safety net.

describe("coerceProfilePatch · field-name aliases dropped", () => {
  it("PN1. camelCase 'firstName' is NOT accepted (canonical is 'first_name')", () => {
    const out = coerceProfilePatch({
      firstName: "Jane",
      first_name: "Jane",
    });
    // Only the canonical snake_case key wins
    expect(out).toEqual({ first_name: "Jane" });
  });

  it("PN2. uppercase 'FIRST_NAME' is NOT accepted", () => {
    const out = coerceProfilePatch({
      FIRST_NAME: "Jane",
      last_name: "Doe",
    });
    expect(out).toEqual({ last_name: "Doe" });
  });

  it("PN3. common typo 'dob' is NOT accepted (canonical is 'date_of_birth')", () => {
    // Frequent LLM mistake — model abbreviates "date of birth" to "dob".
    const out = coerceProfilePatch({
      dob: "1995-05-15",
      first_name: "Jane",
    });
    expect(out).toEqual({ first_name: "Jane" });
  });

  it("PN4. common typo 'zip_code' is NOT accepted (canonical is 'zip')", () => {
    const out = coerceProfilePatch({
      zip_code: "10001",
      zip: "10001",
    });
    expect(out).toEqual({ zip: "10001" });
  });
});

/* ─── Sensitive field blocklist hardening (PS1-PS3) ──────────────── */
//
// Any field that smells like authentication / payment-secret should never
// reach a profile PATCH endpoint, even if the LLM hallucinates emitting it.
// PC2 already covers ssn / credit_card / full_name; this layer adds a few
// more LLM-plausible names.

describe("coerceProfilePatch · sensitive field blocklist", () => {
  it("PS1. CVV / CVC / PIN values are dropped", () => {
    const out = coerceProfilePatch({
      first_name: "Jane",
      cvv: "123",
      cvc: "123",
      pin: "1234",
    });
    expect(out).toEqual({ first_name: "Jane" });
  });

  it("PS2. password / secret values are dropped", () => {
    const out = coerceProfilePatch({
      first_name: "Jane",
      password: "hunter2",
      secret: "abc",
      api_key: "sk-...",
    });
    expect(out).toEqual({ first_name: "Jane" });
  });

  it("PS3. nationality dropped (model should use canonical 'passport_country' instead)", () => {
    const out = coerceProfilePatch({
      first_name: "Jane",
      nationality: "American",
      passport_country: "USA",
    });
    expect(out).toEqual({
      first_name: "Jane",
      passport_country: "USA",
    });
  });
});

/* ─── Unicode + edge cases (PU1-PU3) ──────────────────────────────── */

describe("coerceProfilePatch · unicode + edge cases", () => {
  it("PU1. CJK names pass through unchanged", () => {
    // Backend accepts unicode names; coerce shouldn't reject them.
    const out = coerceProfilePatch({
      first_name: "伟",
      last_name: "王",
    });
    expect(out).toEqual({ first_name: "伟", last_name: "王" });
  });

  it("PU2. tab/newline-only values are dropped (treated as blank)", () => {
    const out = coerceProfilePatch({
      first_name: "\t\n  ",
      last_name: "Doe",
      email: "\r\n",
    });
    expect(out).toEqual({ last_name: "Doe" });
  });

  it("PU3. leading/trailing whitespace is trimmed (strOrUndef trims)", () => {
    // strOrUndef returns v.trim() for any non-blank string, so the patch
    // value gets normalized before reaching the wire. Pinning this so we
    // notice if anyone removes the trim and starts shipping ragged spaces.
    const out = coerceProfilePatch({
      first_name: "  Jane  ",
      last_name: "\tDoe\n",
    });
    expect(out).toEqual({ first_name: "Jane", last_name: "Doe" });
  });
});

/* ─── Type-level mirror check (smoke) ───────────────────────────── */

describe("PROFILE_EDIT_FIELDS mirror to backend canonical 13", () => {
  // Pinning the count + key set so any drift in the canonical schema either
  // breaks this test (we add the new field intentionally) or breaks
  // components/profile-gap tests (codex's UI side).
  it("contains exactly 13 fields, matching backend's needs_profile_data canonical set", () => {
    // Hand-rolled; mirrors components/profile-gap/types.ts:CANONICAL_FIELD_IDS.
    const expected = [
      "first_name",
      "last_name",
      "email",
      "phone",
      "date_of_birth",
      "passport_number",
      "passport_expiry",
      "passport_country",
      "address_line1",
      "city",
      "state",
      "zip",
      "country",
    ];
    // Indirect import via a sample call — coerceProfilePatch only accepts canonical keys.
    // ISO-date fields (date_of_birth, passport_expiry) must be valid YYYY-MM-DD
    // or they get dropped. Use real dates for those, "x" for everything else.
    const sample: Record<string, string> = {};
    for (const k of expected) {
      sample[k] = k === "date_of_birth" || k === "passport_expiry" ? "1995-05-15" : "x";
    }
    const out = coerceProfilePatch(sample) as ProfilePatch;
    expect(Object.keys(out).sort()).toEqual([...expected].sort());
  });

  it("rejects all the legacy / payment / optional aliases the backend does not emit", () => {
    const sample = {
      full_name: "Jane Doe",
      ktn: "999999999",
      address_line2: "Apt 5",
      card_number: "4111111111111111",
      card_expiry: "12/30",
      billing_address: "789 Other St",
      ssn: "123-45-6789",
      // valid one to make sure the function still returns SOMETHING
      first_name: "Jane",
    };
    const out = coerceProfilePatch(sample);
    expect(out).toEqual({ first_name: "Jane" });
  });
});
