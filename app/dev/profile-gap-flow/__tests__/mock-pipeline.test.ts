/**
 * Tests for /dev/profile-gap-flow's stub pipeline (mock-pipeline.ts).
 *
 * The pipeline does TWO things:
 *   1. stubExtractor — pattern matches user text → synthetic raw JSON
 *   2. real production coerceIntentState + routeIntent → state + action
 *
 * Step 2 is already covered by golden-profile-edit.test.ts. These tests
 * pin step 1 — the patterns that decide whether the demo treats input
 * as profile_edit / restaurant booking / chitchat / unknown.
 *
 * Why bother testing a dev demo's pattern matcher: if it accepts something
 * the real LLM extractor wouldn't, the demo gives misleading impressions
 * of what triggers what in production. Documenting "the demo recognizes
 * this set of phrasings" is also useful when the demo is shown to PMs /
 * other engineers as the contract reference.
 */

import { describe, expect, it } from "vitest";
import { runMockTurn } from "../mock-pipeline";
import type { IntentState } from "@/lib/agent/nlu-v2";

const fresh = (text: string) => runMockTurn({ userText: text, prevState: null });

/* ─── profile_edit triggers ────────────────────────────────────── */

describe("runMockTurn · profile_edit · DOB formats", () => {
  it("English slash-date: 'save my DOB 1995/05/15'", () => {
    const r = fresh("save my DOB 1995/05/15");
    expect(r.action.type).toBe("apply_profile_patch");
    if (r.action.type === "apply_profile_patch") {
      expect(r.action.patch).toEqual({ date_of_birth: "1995-05-15" });
    }
  });

  it("English ISO: 'save my DOB 1995-05-15'", () => {
    const r = fresh("save my DOB 1995-05-15");
    expect(r.action.type).toBe("apply_profile_patch");
    if (r.action.type === "apply_profile_patch") {
      expect(r.action.patch.date_of_birth).toBe("1995-05-15");
    }
  });

  it("Chinese-format date: '我的 DOB 是 1995年5月15日'", () => {
    const r = fresh("我的 DOB 是 1995年5月15日");
    expect(r.action.type).toBe("apply_profile_patch");
    if (r.action.type === "apply_profile_patch") {
      expect(r.action.patch.date_of_birth).toBe("1995-05-15");
    }
  });

  it("English long form: 'save my date of birth May 15, 1995'", () => {
    const r = fresh("save my date of birth May 15, 1995");
    expect(r.action.type).toBe("apply_profile_patch");
    if (r.action.type === "apply_profile_patch") {
      expect(r.action.patch.date_of_birth).toBe("1995-05-15");
    }
  });

  it("Date pads single-digit month / day: '1995/5/5' → '1995-05-05'", () => {
    const r = fresh("save my DOB 1995/5/5");
    expect(r.action.type).toBe("apply_profile_patch");
    if (r.action.type === "apply_profile_patch") {
      expect(r.action.patch.date_of_birth).toBe("1995-05-05");
    }
  });
});

describe("runMockTurn · profile_edit · single-field patches", () => {
  it("passport (English save verb): 'save my passport A1234567'", () => {
    const r = fresh("save my passport A1234567");
    expect(r.action.type).toBe("apply_profile_patch");
    if (r.action.type === "apply_profile_patch") {
      expect(r.action.patch).toEqual({ passport_number: "A1234567" });
    }
  });

  it("passport uppercases the letter prefix: 'save my passport a1234567'", () => {
    const r = fresh("save my passport a1234567");
    expect(r.action.type).toBe("apply_profile_patch");
    if (r.action.type === "apply_profile_patch") {
      expect(r.action.patch.passport_number).toBe("A1234567");
    }
  });

  it("passport (Chinese, hard signal — no save verb required): '我的护照号 A1234567'", () => {
    // Hard fields (DOB / passport / first_name) bypass the save-verb gate
    // in the matcher: they're unambiguous identifiers, not casual mentions.
    // Mirrors the extractor.ts rule "passport_number is a hard signal".
    const r = fresh("我的护照号 A1234567");
    expect(r.action.type).toBe("apply_profile_patch");
    if (r.action.type === "apply_profile_patch") {
      expect(r.action.patch.passport_number).toBe("A1234567");
    }
  });

  it("email with save verb: 'update my email is jane@example.com'", () => {
    const r = fresh("update my email is jane@example.com");
    expect(r.action.type).toBe("apply_profile_patch");
    if (r.action.type === "apply_profile_patch") {
      expect(r.action.patch).toEqual({ email: "jane@example.com" });
    }
  });

  it("phone with save verb: '把我的电话 +86 138 0000 0000 存一下'", () => {
    const r = fresh("把我的电话 +86 138 0000 0000 存一下");
    expect(r.action.type).toBe("apply_profile_patch");
    if (r.action.type === "apply_profile_patch") {
      expect(r.action.patch.phone).toBe("+86 138 0000 0000");
    }
  });
});

describe("runMockTurn · profile_edit · multi-field", () => {
  it("Chinese two-field with save verb: '把我的护照号 A1234567 和电话 ... 都存一下'", () => {
    const r = fresh("把我的护照号 A1234567 和电话 +86 138 0000 0000 都存一下");
    expect(r.action.type).toBe("apply_profile_patch");
    if (r.action.type === "apply_profile_patch") {
      expect(r.action.patch).toEqual({
        passport_number: "A1234567",
        phone: "+86 138 0000 0000",
      });
    }
  });

  it("English name split: 'save my name as Jane Doe' → first/last (NOT full_name)", () => {
    const r = fresh("save my name as Jane Doe");
    expect(r.action.type).toBe("apply_profile_patch");
    if (r.action.type === "apply_profile_patch") {
      expect(r.action.patch).toEqual({ first_name: "Jane", last_name: "Doe" });
      // full_name is the legacy alias; the canonical schema uses first + last.
      expect("full_name" in r.action.patch).toBe(false);
    }
  });

  it("Three-token name: 'save my name as Mary Jane Smith' → first=Mary, last='Jane Smith'", () => {
    const r = fresh("save my name as Mary Jane Smith");
    expect(r.action.type).toBe("apply_profile_patch");
    if (r.action.type === "apply_profile_patch") {
      expect(r.action.patch).toEqual({
        first_name: "Mary",
        last_name: "Jane Smith",
      });
    }
  });
});

/* ─── Anti-patterns ──────────────────────────────────────────────── */

describe("runMockTurn · profile_edit anti-patterns", () => {
  it("phone without save verb is dropped: 'call me at 555-555-5555'", () => {
    // Save-verb gate: phone-only with no save verb and no hard signal → drop.
    // Casual mentions of phone numbers shouldn't trigger a profile patch.
    const r = fresh("call me at 555-555-5555");
    expect(r.action.type).not.toBe("apply_profile_patch");
  });

  it("email without save verb is dropped: 'reach me at test@example.com'", () => {
    const r = fresh("reach me at test@example.com");
    expect(r.action.type).not.toBe("apply_profile_patch");
  });

  it("casual age mention is not profile_edit: \"I'll be 30 next month\"", () => {
    const r = fresh("I'll be 30 next month");
    expect(r.action.type).not.toBe("apply_profile_patch");
    // No DOB / passport / name pattern hit → falls through to unknown.
  });

  it("question is not profile_edit: \"what's my email on file?\"", () => {
    // The matcher requires a SAVE/store/update/set verb (or a hard-signal
    // field). Questions don't fit either bucket.
    const r = fresh("what's my email on file?");
    expect(r.action.type).not.toBe("apply_profile_patch");
  });

  it("Single-token name doesn't crash, returns no patch: 'save my name as Jane'", () => {
    // Mock matcher requires 2+ space-separated parts to split into first/last.
    // Real LLM extractor handles single-token CN names with surname rules
    // ("张伟" → first="伟", last="张") — out of scope for this stub.
    const r = fresh("save my name as Jane");
    expect(r.action.type).not.toBe("apply_profile_patch");
  });

  it("Single-token Chinese name (mock limitation, documented): '我的名字是张伟'", () => {
    // KNOWN limitation: mock matcher needs space-separated parts. Real
    // extractor would split surname/given. The demo isn't trying to
    // duplicate LLM accuracy.
    const r = fresh("我的名字是张伟");
    expect(r.action.type).not.toBe("apply_profile_patch");
  });
});

/* ─── Restaurant booking matcher ─────────────────────────────────── */

describe("runMockTurn · restaurant booking", () => {
  it("Full booking: 'Book Buvette in New York tomorrow 8pm for 2'", () => {
    const r = fresh("Book Buvette in New York tomorrow 8pm for 2");
    expect(r.action.type).toBe("show_confirm_card");
    expect(r.state.intent).toBe("create_plan");
    expect(r.state.scenario).toBe("restaurant");
    expect(r.state.restaurant).toMatchObject({
      restaurant_name: "Buvette",
      city: "New York",
      time: "20:00",
      party_size: 2,
    });
  });

  it("'NYC' canonicalizes to 'New York'", () => {
    const r = fresh("Book Carbone in NYC tomorrow 7pm for 4");
    expect(r.state.restaurant?.city).toBe("New York");
  });

  it("24h time format passes through: 'reserve a table at 19:30 tonight'", () => {
    const r = fresh("reserve a table at 19:30 tonight");
    expect(r.state.restaurant?.time).toBe("19:30");
  });

  it("'12am' → '00:00'", () => {
    const r = fresh("book Lilia tomorrow 12am for 2");
    expect(r.state.restaurant?.time).toBe("00:00");
  });

  it("'12pm' → '12:00'", () => {
    const r = fresh("book Lilia tomorrow 12pm for 2");
    expect(r.state.restaurant?.time).toBe("12:00");
  });

  it("Partial booking still routes to ask_clarification (missing required fields)", () => {
    // Just "Book a table" — no party / time / venue / city → router asks
    // for the missing required fields. Action SHOULD be ask_clarification,
    // not show_confirm_card.
    const r = fresh("Book a table tonight");
    expect(r.action.type).toBe("ask_clarification");
    expect(r.state.scenario).toBe("restaurant");
  });
});

/* ─── Mid-flow state preservation ────────────────────────────────── */

describe("runMockTurn · mid-flow profile_edit preserves booking state", () => {
  it("After a restaurant booking turn, profile_edit keeps the restaurant context", () => {
    // Turn 1: book a table
    const turn1 = fresh("Book Buvette in New York tomorrow 8pm for 2");
    expect(turn1.state.scenario).toBe("restaurant");

    // Turn 2: user patches DOB instead of confirming
    const turn2 = runMockTurn({
      userText: "实际我的 DOB 是 1995/5/15",
      prevState: turn1.state,
    });

    expect(turn2.action.type).toBe("apply_profile_patch");
    if (turn2.action.type === "apply_profile_patch") {
      expect(turn2.action.patch).toEqual({ date_of_birth: "1995-05-15" });
    }
    // Critically: the restaurant ambient context survives the profile patch.
    expect(turn2.state.intent).toBe("profile_edit");
    expect(turn2.state.scenario).toBe("restaurant");
    expect(turn2.state.restaurant).toMatchObject({
      restaurant_name: "Buvette",
      city: "New York",
      party_size: 2,
    });
  });

  it("After a profile_edit turn, the next non-profile turn doesn't carry profile_patch forward", () => {
    // Per coerceIntentState contract — each turn carries the fresh patch only.
    const turn1 = fresh("save my DOB 1995/05/15");
    expect(turn1.state.profile_patch).toBeDefined();

    const turn2 = runMockTurn({
      userText: "Book Buvette in New York tomorrow 8pm for 2",
      prevState: turn1.state,
    });
    expect(turn2.state.profile_patch).toBeUndefined();
  });
});

/* ─── Fallbacks ──────────────────────────────────────────────────── */

describe("runMockTurn · fallback paths", () => {
  it("'hi' → chitchat → continue_chat", () => {
    const r = fresh("hi");
    expect(r.state.intent).toBe("chitchat");
    expect(r.action.type).toBe("continue_chat");
  });

  it("'你好' → chitchat → continue_chat", () => {
    const r = fresh("你好");
    expect(r.state.intent).toBe("chitchat");
    expect(r.action.type).toBe("continue_chat");
  });

  it("Unrecognized input → unknown → continue_chat", () => {
    const r = fresh("asdfqwertyzxcv");
    expect(r.state.intent).toBe("unknown");
    expect(r.action.type).toBe("continue_chat");
  });

  it("Empty string is handled (no crash, defaults to unknown)", () => {
    const r = fresh("");
    expect(r.state.intent).toBe("unknown");
    expect(r.action.type).toBe("continue_chat");
  });
});

/* ─── Pipeline contract smoke ────────────────────────────────────── */

describe("runMockTurn · contract smoke", () => {
  it("rawExtractorJson is always populated (debugging aid for /dev/profile-gap-flow sidebar)", () => {
    const inputs = [
      "save my DOB 1995/05/15",
      "Book Buvette in NYC tomorrow 8pm for 2",
      "hi",
      "asdfqwerty",
    ];
    for (const text of inputs) {
      const r = fresh(text);
      expect(r.rawExtractorJson).toBeTypeOf("object");
      expect(r.rawExtractorJson.intent).toBeDefined();
    }
  });

  it("assistantReply is always a non-empty string", () => {
    const inputs = [
      "save my DOB 1995/05/15",
      "Book Buvette in NYC tomorrow 8pm for 2",
      "hi",
      "asdfqwerty",
    ];
    for (const text of inputs) {
      const r = fresh(text);
      expect(typeof r.assistantReply).toBe("string");
      expect(r.assistantReply.length).toBeGreaterThan(0);
    }
  });

  it("apply_profile_patch reply mentions the saved fields by name", () => {
    const r = fresh("save my DOB 1995/05/15");
    expect(r.assistantReply.toLowerCase()).toContain("date of birth");
    expect(r.assistantReply).toContain("1995-05-15");
  });

  it("show_confirm_card reply mentions the restaurant venue", () => {
    const r = fresh("Book Buvette in NYC tomorrow 8pm for 2");
    expect(r.assistantReply.toLowerCase()).toContain("buvette");
  });

  it("Returned state includes turn_count > 0 (coerceIntentState bumped it)", () => {
    const r = fresh("save my DOB 1995/05/15");
    expect(r.state.turn_count).toBeGreaterThan(0);
  });

  it("Pipeline doesn't mutate prevState (immutable input)", () => {
    const turn1 = fresh("Book Buvette in New York tomorrow 8pm for 2");
    const snapshot: IntentState = JSON.parse(JSON.stringify(turn1.state));
    runMockTurn({ userText: "实际我的 DOB 是 1995/5/15", prevState: turn1.state });
    expect(turn1.state).toEqual(snapshot);
  });
});
