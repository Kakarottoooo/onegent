import { describe, it, expect } from "vitest";
import { deriveRole } from "@/lib/decision-session/role";
import type { DecisionSession } from "@/lib/db";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<DecisionSession> = {}): DecisionSession {
  return {
    id: "sess01",
    initiator_user_id: null,
    initiator_session_token: "tok_init_abc",
    partner_session_token: "tok_partner_xyz",
    initiator_constraints: "sushi, quiet",
    partner_constraints: null,
    conflict: false,
    conflict_reason: null,
    merged_options: null,
    initiator_vote: [],
    partner_vote: [],
    status: "waiting_partner",
    decided_card_id: null,
    feedback_initiator: null,
    feedback_partner: null,
    party_size: 2,
    decision_type: "dinner_tonight",
    city_id: "losangeles",
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86400_000).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

function makeReq(cookies: Record<string, string> = {}): { cookies: { get: (k: string) => { value: string } | undefined } } {
  return {
    cookies: {
      get: (k: string) => (k in cookies ? { value: cookies[k] } : undefined),
    },
  };
}

// ─── deriveRole ──────────────────────────────────────────────────────────────

describe("deriveRole", () => {
  it("returns initiator when Clerk userId matches", () => {
    const session = makeSession({ initiator_user_id: "user_clerk_123" });
    const req = makeReq({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(deriveRole(req as any, session, "user_clerk_123")).toBe("initiator");
  });

  it("returns initiator when cookie matches initiator_session_token", () => {
    const session = makeSession({ initiator_user_id: null });
    const req = makeReq({ "dr_init_sess01": "tok_init_abc" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(deriveRole(req as any, session, null)).toBe("initiator");
  });

  it("returns partner when neither Clerk userId nor cookie matches", () => {
    const session = makeSession({ initiator_user_id: "user_clerk_123" });
    const req = makeReq({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(deriveRole(req as any, session, "some_other_user")).toBe("partner");
  });

  it("prefers Clerk userId over cookie when both present", () => {
    // Clerk userId matches → initiator, regardless of cookie
    const session = makeSession({ initiator_user_id: "user_clerk_123" });
    const req = makeReq({ "dr_init_sess01": "tok_init_abc" }); // cookie also set
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(deriveRole(req as any, session, "user_clerk_123")).toBe("initiator");
  });

  it("returns partner when cookie token does not match stored token", () => {
    const session = makeSession({ initiator_user_id: null });
    const req = makeReq({ "dr_init_sess01": "wrong_token" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(deriveRole(req as any, session, null)).toBe("partner");
  });

  it("returns partner when session has no initiator_user_id and no cookie present", () => {
    const session = makeSession({ initiator_user_id: null });
    const req = makeReq({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(deriveRole(req as any, session, null)).toBe("partner");
  });
});

// ─── Mutual approval detection (inline logic from vote action) ────────────────

function findMutualApproval(
  myVotes: { card_id: string; approved: boolean }[],
  otherVotes: { card_id: string; approved: boolean }[]
): { card_id: string; approved: boolean } | undefined {
  return myVotes.find(
    (v) => v.approved && otherVotes.some((ov) => ov.card_id === v.card_id && ov.approved)
  );
}

describe("mutual approval detection", () => {
  it("detects a mutual approval", () => {
    const mine = [{ card_id: "r1", approved: true }];
    const theirs = [{ card_id: "r1", approved: true }];
    expect(findMutualApproval(mine, theirs)?.card_id).toBe("r1");
  });

  it("returns undefined when my vote is false", () => {
    const mine = [{ card_id: "r1", approved: false }];
    const theirs = [{ card_id: "r1", approved: true }];
    expect(findMutualApproval(mine, theirs)).toBeUndefined();
  });

  it("returns undefined when their vote is false", () => {
    const mine = [{ card_id: "r1", approved: true }];
    const theirs = [{ card_id: "r1", approved: false }];
    expect(findMutualApproval(mine, theirs)).toBeUndefined();
  });

  it("returns undefined when cards don't overlap", () => {
    const mine = [{ card_id: "r1", approved: true }];
    const theirs = [{ card_id: "r2", approved: true }];
    expect(findMutualApproval(mine, theirs)).toBeUndefined();
  });

  it("returns undefined when other party hasn't voted yet", () => {
    const mine = [{ card_id: "r1", approved: true }];
    const theirs: { card_id: string; approved: boolean }[] = [];
    expect(findMutualApproval(mine, theirs)).toBeUndefined();
  });

  it("picks the first mutual yes when multiple cards match", () => {
    const mine = [
      { card_id: "r1", approved: true },
      { card_id: "r2", approved: true },
    ];
    const theirs = [
      { card_id: "r1", approved: true },
      { card_id: "r2", approved: true },
    ];
    expect(findMutualApproval(mine, theirs)?.card_id).toBe("r1");
  });

  it("is idempotent — overwriting vote doesn't duplicate", () => {
    // Simulate: existing vote [r1: true], new vote overwrites same card
    const existing = [{ card_id: "r1", approved: true }];
    const filtered = existing.filter((v) => v.card_id !== "r1");
    const newVotes = [...filtered, { card_id: "r1", approved: false }];
    expect(newVotes).toEqual([{ card_id: "r1", approved: false }]);
    expect(newVotes.length).toBe(1); // no duplicate
  });
});
