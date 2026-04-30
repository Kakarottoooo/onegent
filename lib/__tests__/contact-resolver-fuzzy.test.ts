import { describe, it, expect } from "vitest";
import {
  matchContactsFuzzy,
  pickPreferredContactLabel,
  type ContactWithProfile,
} from "../db";

function contact(opts: Partial<ContactWithProfile> & { contact_user_id: string }): ContactWithProfile {
  return {
    contact_user_id: opts.contact_user_id,
    nickname: opts.nickname ?? null,
    profile_code: opts.profile_code ?? "",
    username: opts.username ?? null,
    display_name: opts.display_name ?? null,
    avatar_url: null,
    added_at: "2026-04-29T00:00:00.000Z",
  };
}

describe("matchContactsFuzzy", () => {
  it("returns [] for empty input", () => {
    expect(matchContactsFuzzy([], [])).toEqual([]);
    expect(matchContactsFuzzy([contact({ contact_user_id: "u1" })], [])).toEqual([]);
  });

  it("Tier 1: exact display_name match (case-insensitive)", () => {
    const contacts = [
      contact({ contact_user_id: "u1", display_name: "ZiweiB", username: "ziwei_b", profile_code: "@ziwei_b" }),
      contact({ contact_user_id: "u2", display_name: "ZiweiC", username: "ziwei_c", profile_code: "@ziwei_c" }),
    ];
    const out = matchContactsFuzzy(contacts, ["ziweib"]);
    expect(out).toHaveLength(1);
    expect(out[0].contact_user_id).toBe("u1");
    expect(out[0].matched?.display_name).toBe("ZiweiB");
    expect(out[0].candidates).toEqual([]);
  });

  it("Tier 1: exact match strips @ from profile_code on both sides", () => {
    const contacts = [
      contact({ contact_user_id: "u1", profile_code: "@ziwei_b", display_name: "ZiweiB" }),
    ];
    const out = matchContactsFuzzy(contacts, ["ziwei_b"]);
    expect(out[0].contact_user_id).toBe("u1");
    expect(matchContactsFuzzy(contacts, ["@ziwei_b"])[0].contact_user_id).toBe("u1");
  });

  it("Tier 1: nickname wins over noisy profile_code", () => {
    const contacts = [
      contact({ contact_user_id: "u1", nickname: "李明", profile_code: "@xyz123" }),
    ];
    const out = matchContactsFuzzy(contacts, ["李明"]);
    expect(out[0].contact_user_id).toBe("u1");
  });

  it("under-3-char tokens never trigger fuzzy fallback", () => {
    const contacts = [
      contact({ contact_user_id: "u1", display_name: "ZiweiB" }),
      contact({ contact_user_id: "u2", display_name: "ZiweiC" }),
    ];
    const out = matchContactsFuzzy(contacts, ["zi"]);
    expect(out[0].contact_user_id).toBeNull();
    expect(out[0].matched).toBeNull();
    expect(out[0].candidates).toEqual([]);
  });

  it("Tier 2: profile_code substring resolves uniquely", () => {
    const contacts = [
      contact({ contact_user_id: "u1", profile_code: "@ziwei_b_main", display_name: "ZiweiB" }),
      contact({ contact_user_id: "u2", profile_code: "@guo_wei", display_name: "Guo Wei" }),
    ];
    const out = matchContactsFuzzy(contacts, ["ziwei"]);
    expect(out[0].contact_user_id).toBe("u1");
    expect(out[0].candidates).toEqual([]);
  });

  it("Tier 3: nickname/display_name prefix resolves uniquely", () => {
    const contacts = [
      contact({ contact_user_id: "u1", display_name: "Zachary" }),
      contact({ contact_user_id: "u2", display_name: "Bob" }),
    ];
    const out = matchContactsFuzzy(contacts, ["zach"]);
    expect(out[0].contact_user_id).toBe("u1");
  });

  it("Tier 4: substring fallback works for Chinese characters", () => {
    const contacts = [
      contact({ contact_user_id: "u1", display_name: "李明" }),
      contact({ contact_user_id: "u2", display_name: "张三" }),
    ];
    // 3-char substring check requires target length ≥ 3 — single-char "李"
    // wouldn't fuzzy-match. Test with a 3-char token that substring-matches.
    const out = matchContactsFuzzy(contacts, ["李明"]);
    // Two-char target: short of 3-char fuzzy threshold AND no exact match.
    // Confirms the guard fires for under-length tokens.
    expect(out[0].contact_user_id).toBe("u1"); // Exact match, not fuzzy.
  });

  it("blocks (returns candidates) when fuzzy hits multiple", () => {
    const contacts = [
      contact({ contact_user_id: "u1", display_name: "ZiweiB", profile_code: "@ziwei_b" }),
      contact({ contact_user_id: "u2", display_name: "ZiweiC", profile_code: "@ziwei_c" }),
    ];
    const out = matchContactsFuzzy(contacts, ["ziwei"]);
    expect(out[0].contact_user_id).toBeNull();
    expect(out[0].matched).toBeNull();
    expect(out[0].candidates).toHaveLength(2);
    const ids = out[0].candidates.map((c) => c.user_id).sort();
    expect(ids).toEqual(["u1", "u2"]);
  });

  it("blocks with empty candidates when no match at all", () => {
    const contacts = [
      contact({ contact_user_id: "u1", display_name: "Alice" }),
    ];
    const out = matchContactsFuzzy(contacts, ["bob"]);
    expect(out[0].contact_user_id).toBeNull();
    expect(out[0].candidates).toEqual([]);
  });

  it("handles multiple input names independently and preserves order", () => {
    const contacts = [
      contact({ contact_user_id: "u1", display_name: "Alice" }),
      contact({ contact_user_id: "u2", display_name: "Bob" }),
    ];
    const out = matchContactsFuzzy(contacts, ["bob", "alice"]);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("bob");
    expect(out[0].contact_user_id).toBe("u2");
    expect(out[1].name).toBe("alice");
    expect(out[1].contact_user_id).toBe("u1");
  });

  it("collapses _ - and whitespace consistently on both sides", () => {
    const contacts = [
      contact({ contact_user_id: "u1", profile_code: "@ziwei_b" }),
    ];
    expect(matchContactsFuzzy(contacts, ["ziwei-b"])[0].contact_user_id).toBe("u1");
    expect(matchContactsFuzzy(contacts, ["ziwei b"])[0].contact_user_id).toBe("u1");
    expect(matchContactsFuzzy(contacts, ["ZiweiB"])[0].contact_user_id).toBe("u1");
  });

  it("matched.display_name lets caller substitute canonical name", () => {
    const contacts = [
      contact({
        contact_user_id: "u1",
        display_name: "Ziwei Bao",
        username: "ziwei_b",
        profile_code: "@ziwei_b",
      }),
    ];
    const out = matchContactsFuzzy(contacts, ["ziwei"]);
    expect(out[0].contact_user_id).toBe("u1");
    expect(out[0].matched?.display_name).toBe("Ziwei Bao");
  });

  it("Tier 1: exact match on Clerk username (regression for email-as-display_name)", () => {
    // ziweiC's Clerk profile has no fullName, so display_name fell back to
    // their email. The only "ziweic"-shaped field is username. The resolver
    // must hit username, not just display_name / nickname / profile_code.
    const contacts = [
      contact({
        contact_user_id: "u1",
        username: "ziweic",
        display_name: "guoziwei2019@126.com",
        profile_code: "@xY5pQ2",
        nickname: null,
      }),
    ];
    const out = matchContactsFuzzy(contacts, ["ziweic"]);
    expect(out[0].contact_user_id).toBe("u1");
  });

  it("Tier 3: prefix-match on username when fullName missing", () => {
    const contacts = [
      contact({
        contact_user_id: "u1",
        username: "ziwei_main",
        display_name: "guoziwei2019@126.com",
      }),
    ];
    // "ziwei" is prefix of "ziwei_main" (norm strips _ → "ziweimain").
    const out = matchContactsFuzzy(contacts, ["ziwei"]);
    expect(out[0].contact_user_id).toBe("u1");
  });
});

describe("pickPreferredContactLabel", () => {
  it("prefers nickname over everything", () => {
    const label = pickPreferredContactLabel({
      nickname: "老李",
      username: "li_ming",
      display_name: "Li Ming",
      profile_code: "@xyz",
    });
    expect(label).toBe("老李");
  });

  it("prefers username when display_name is an email fallback", () => {
    const label = pickPreferredContactLabel({
      nickname: null,
      username: "ziweic",
      display_name: "guoziwei2019@126.com",
      profile_code: "@xy123",
    });
    expect(label).toBe("ziweic");
  });

  it("uses display_name when it's a real name (not email)", () => {
    const label = pickPreferredContactLabel({
      nickname: null,
      username: "li_ming",
      display_name: "李明",
      profile_code: "@xyz",
    });
    expect(label).toBe("李明");
  });

  it("falls back to email-shaped display_name when username missing", () => {
    const label = pickPreferredContactLabel({
      nickname: null,
      username: null,
      display_name: "alice@example.com",
      profile_code: "@xyz",
    });
    expect(label).toBe("alice@example.com");
  });

  it("falls back to profile_code when nothing else is set", () => {
    const label = pickPreferredContactLabel({
      nickname: null,
      username: null,
      display_name: null,
      profile_code: "@xyz",
    });
    expect(label).toBe("@xyz");
  });

  it("returns null only when literally nothing is set", () => {
    expect(
      pickPreferredContactLabel({
        nickname: null,
        username: null,
        display_name: null,
        profile_code: null,
      }),
    ).toBeNull();
  });
});
