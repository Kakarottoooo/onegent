import { describe, expect, it } from "vitest";
import {
  STAGE0B_LAB_PROVIDERS,
  STAGE0B_TEST_PLAN,
  STAGE0B_PLAN_COUNTS,
  STAGE0B_HARD_STOPS,
  RECOVERY_OUTCOMES,
  buildLabEvent,
  serializeLabEvent,
  parseLabEvent,
  buildL2RecoveryResult,
  safeNextActionFor,
  isHardStopOutcome,
  isSafeOutcome,
  type L2RecoveryClass,
  type LabEvent,
} from "@/lib/stage0b-skill-runtime";
import { resolveActivityProviderSkillUrl } from "@/lib/activity-skills";

// Stage 0B no-live tests for the controlled Browser Harness lab schema
// + 20-URL test plan. NO browser. NO network. NO live OpenAI. The lab
// runner script (scripts/stage0b-activity-skill-lab.ts) is also pure
// TypeScript and does not import Browser Harness.

const RUN_ID = "00000000-0000-4000-8000-000000000000";

// ─── 1. Provider scope ──────────────────────────────────────────────

describe("Stage 0B — provider scope is locked to TM + SeatGeek", () => {
  it("STAGE0B_LAB_PROVIDERS contains the controlled activity lab providers in stable order", () => {
    expect(STAGE0B_LAB_PROVIDERS).toEqual(["ticketmaster", "seatgeek", "stubhub", "eventbrite"]);
  });
});

// ─── 2. JSONL event writer ──────────────────────────────────────────

describe("Stage 0B — buildLabEvent + serializeLabEvent + parseLabEvent", () => {
  it("builds a complete LabEvent and round-trips through JSONL serialization", () => {
    const event = buildLabEvent({
      run_id: RUN_ID,
      seq: 1,
      provider: "ticketmaster",
      page_type: "exact_event",
      action: "navigate",
      currentUrl: "https://www.ticketmaster.com/foo/event/abc",
      outcome: "ok",
    });
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.run_id).toBe(RUN_ID);
    expect(event.seq).toBe(1);
    const line = serializeLabEvent(event);
    expect(line).not.toContain("\n");
    const parsed = parseLabEvent(line);
    expect(parsed).toEqual(event);
  });

  it("requires screenshotPath when action=screenshot (evidence-first)", () => {
    expect(() =>
      buildLabEvent({
        run_id: RUN_ID,
        seq: 1,
        provider: "seatgeek",
        page_type: "exact_event",
        action: "screenshot",
        currentUrl: "https://seatgeek.com/foo",
        outcome: "ok",
      }),
    ).toThrow(/requires a screenshotPath/);
  });

  it("requires hardStop when action=halt_at_hard_stop", () => {
    expect(() =>
      buildLabEvent({
        run_id: RUN_ID,
        seq: 2,
        provider: "ticketmaster",
        page_type: "exact_event",
        action: "halt_at_hard_stop",
        currentUrl: "https://www.ticketmaster.com/foo/event/abc",
        outcome: "halted",
      }),
    ).toThrow(/requires a hardStop reason/);
  });

  it("rejects empty run_id and non-positive seq", () => {
    expect(() =>
      buildLabEvent({
        run_id: "",
        seq: 1,
        provider: "ticketmaster",
        page_type: "exact_event",
        action: "navigate",
        currentUrl: "https://www.ticketmaster.com/foo/event/abc",
        outcome: "ok",
      }),
    ).toThrow(/run_id is required/);
    expect(() =>
      buildLabEvent({
        run_id: RUN_ID,
        seq: 0,
        provider: "ticketmaster",
        page_type: "exact_event",
        action: "navigate",
        currentUrl: "https://www.ticketmaster.com/foo/event/abc",
        outcome: "ok",
      }),
    ).toThrow(/seq must be an integer >= 1/);
  });

  it("rejects empty currentUrl (evidence-first)", () => {
    expect(() =>
      buildLabEvent({
        run_id: RUN_ID,
        seq: 1,
        provider: "ticketmaster",
        page_type: "exact_event",
        action: "navigate",
        currentUrl: "",
        outcome: "ok",
      }),
    ).toThrow(/currentUrl is required/);
  });

  it("serializeLabEvent always emits a single line — newlines inside `notes` are JSON-escaped, never raw", () => {
    // Defense-in-depth: even if a future field carries a string with raw
    // CR/LF, JSON.stringify must escape them so the JSONL line cannot
    // splice across newlines. We assert the contract on output, not
    // on the (currently unreachable) escape hatch in the writer.
    const event: LabEvent = {
      timestamp: "2026-05-08T00:00:00.000Z",
      run_id: RUN_ID,
      seq: 1,
      provider: "ticketmaster",
      page_type: "exact_event",
      action: "navigate",
      currentUrl: "https://www.ticketmaster.com/foo/event/abc",
      outcome: "ok",
      notes: "with\nnewline\rand line-sep",
    };
    const line = serializeLabEvent(event);
    expect(line.includes("\n")).toBe(false);
    expect(line.includes("\r")).toBe(false);
    // The newline-in-notes survives the round trip as a literal '\n'.
    const parsed = parseLabEvent(line);
    expect(parsed.notes).toBe("with\nnewline\rand line-sep");
  });

  it("parseLabEvent rejects missing required fields", () => {
    expect(() => parseLabEvent("{}")).toThrow(/missing required field/);
    expect(() => parseLabEvent('{"run_id":"x"}')).toThrow(/missing required field/);
  });
});

// ─── 3. L2RecoveryResult schema + outcome map ───────────────────────

describe("Stage 0B — L2RecoveryResult outcome map is canonical", () => {
  const ALL_CLASSES: ReadonlyArray<L2RecoveryClass> = [
    "exact_event_ready",
    "single_candidate_ready",
    "provider_listing_needs_choice",
    "safe_handoff_reached",
    "user_seat_selection_required",
    "account_session_required",
    "payment_or_final_action_required",
    "provider_degraded",
    "insufficient_evidence",
    "skill_patch_needed",
  ];

  it("RECOVERY_OUTCOMES has exactly one row per L2RecoveryClass", () => {
    expect(RECOVERY_OUTCOMES.length).toBe(ALL_CLASSES.length);
    const seen = new Set(RECOVERY_OUTCOMES.map((r) => r.classification));
    expect(seen.size).toBe(RECOVERY_OUTCOMES.length);
    for (const cls of ALL_CLASSES) expect(seen.has(cls)).toBe(true);
  });

  it.each([
    ["exact_event_ready", "start_task"],
    ["single_candidate_ready", "start_task"],
    ["provider_listing_needs_choice", "ask_user_choice"],
    ["safe_handoff_reached", "user_handoff_required"],
    ["user_seat_selection_required", "user_handoff_required"],
    ["account_session_required", "user_handoff_required"],
    ["payment_or_final_action_required", "user_handoff_required"],
    ["provider_degraded", "review_capture"],
    ["insufficient_evidence", "review_capture"],
    ["skill_patch_needed", "review_patch_proposal"],
  ] as Array<[L2RecoveryClass, string]>)(
    "safeNextActionFor(%s) returns %s",
    (cls, expected) => {
      expect(safeNextActionFor(cls)).toBe(expected);
    },
  );

  it("isHardStopOutcome is true only for the user-handoff hard stops, not for safe_handoff_reached", () => {
    expect(isHardStopOutcome("user_seat_selection_required")).toBe(true);
    expect(isHardStopOutcome("account_session_required")).toBe(true);
    expect(isHardStopOutcome("payment_or_final_action_required")).toBe(true);
    expect(isHardStopOutcome("safe_handoff_reached")).toBe(false);
    expect(isHardStopOutcome("exact_event_ready")).toBe(false);
    expect(isHardStopOutcome("skill_patch_needed")).toBe(false);
  });

  it("isSafeOutcome covers ready + needs_choice + safe_handoff + the three hard stops", () => {
    expect(isSafeOutcome("exact_event_ready")).toBe(true);
    expect(isSafeOutcome("single_candidate_ready")).toBe(true);
    expect(isSafeOutcome("provider_listing_needs_choice")).toBe(true);
    expect(isSafeOutcome("safe_handoff_reached")).toBe(true);
    expect(isSafeOutcome("user_seat_selection_required")).toBe(true);
    expect(isSafeOutcome("account_session_required")).toBe(true);
    expect(isSafeOutcome("payment_or_final_action_required")).toBe(true);
    expect(isSafeOutcome("provider_degraded")).toBe(false);
    expect(isSafeOutcome("insufficient_evidence")).toBe(false);
    expect(isSafeOutcome("skill_patch_needed")).toBe(false);
  });

  it("STAGE0B_HARD_STOPS lists every hard-stop reason the runbook mandates", () => {
    expect(STAGE0B_HARD_STOPS).toContain("login_or_signin_wall");
    expect(STAGE0B_HARD_STOPS).toContain("captcha_or_challenge");
    expect(STAGE0B_HARD_STOPS).toContain("otp_or_phone_verification");
    expect(STAGE0B_HARD_STOPS).toContain("seat_selection_required");
    expect(STAGE0B_HARD_STOPS).toContain("payment_form_visible");
    expect(STAGE0B_HARD_STOPS).toContain("final_confirm_button");
    expect(STAGE0B_HARD_STOPS).toContain("cookie_consent_blocking_render");
    expect(STAGE0B_HARD_STOPS).toContain("harness_error_or_disconnect");
    expect(STAGE0B_HARD_STOPS.length).toBe(8);
  });
});

describe("Stage 0B — buildL2RecoveryResult validation", () => {
  const baseEvidence = {
    input_url: "https://www.ticketmaster.com/foo/event/abc",
    final_url: "https://www.ticketmaster.com/foo/event/abc",
    final_page_type: "exact_event" as const,
    jsonl_path: ".stage0b-evidence/run/events.jsonl",
    event_count: 4,
    screenshot_paths: [".stage0b-evidence/run/01.png"],
    visible_facts: { title: "Lion King" },
    hard_stops: ["seat_selection_required" as const],
  };

  it("derives safe_next_action from classification (not free-form)", () => {
    const r = buildL2RecoveryResult({
      run_id: RUN_ID,
      started_at: "2026-05-08T10:00:00.000Z",
      finished_at: "2026-05-08T10:01:00.000Z",
      provider: "ticketmaster",
      classification: "user_seat_selection_required",
      evidence: baseEvidence,
    });
    expect(r.safe_next_action).toBe("user_handoff_required");
    expect(r.skill_patch_needed).toBe(false);
    expect(r.skill_patch_proposal).toBeUndefined();
  });

  it("requires a skill_patch_proposal when classification=skill_patch_needed", () => {
    expect(() =>
      buildL2RecoveryResult({
        run_id: RUN_ID,
        started_at: "2026-05-08T10:00:00.000Z",
        finished_at: "2026-05-08T10:01:00.000Z",
        provider: "ticketmaster",
        classification: "skill_patch_needed",
        evidence: baseEvidence,
      }),
    ).toThrow(/requires a skill_patch_proposal/);
  });

  it("forbids skill_patch_proposal on any other classification", () => {
    expect(() =>
      buildL2RecoveryResult({
        run_id: RUN_ID,
        started_at: "2026-05-08T10:00:00.000Z",
        finished_at: "2026-05-08T10:01:00.000Z",
        provider: "ticketmaster",
        classification: "exact_event_ready",
        evidence: baseEvidence,
        skill_patch_proposal: {
          kind: "selector_drift",
          title: "x",
          observed_evidence: "x",
          patch_target: "x",
          proposed_change: "x",
          risk: "low",
          evidence_event_seqs: [1],
        },
      }),
    ).toThrow(/skill_patch_proposal is only allowed/);
  });

  it("rejects malformed evidence bundle (missing jsonl_path / non-array hard_stops)", () => {
    expect(() =>
      buildL2RecoveryResult({
        run_id: RUN_ID,
        started_at: "x",
        finished_at: "x",
        provider: "seatgeek",
        classification: "exact_event_ready",
        evidence: { ...baseEvidence, jsonl_path: "" },
      }),
    ).toThrow(/jsonl_path is required/);
    expect(() =>
      buildL2RecoveryResult({
        run_id: RUN_ID,
        started_at: "x",
        finished_at: "x",
        provider: "seatgeek",
        classification: "exact_event_ready",
        evidence: { ...baseEvidence, hard_stops: "x" as unknown as never },
      }),
    ).toThrow(/hard_stops must be an array/);
  });
});

// ─── 4. 20-URL test plan ────────────────────────────────────────────

describe("Stage 0B — 20-URL test plan size and balance", () => {
  it("plan has exactly 20 entries: 10 Ticketmaster + 10 SeatGeek", () => {
    expect(STAGE0B_PLAN_COUNTS.total).toBe(20);
    expect(STAGE0B_PLAN_COUNTS.ticketmaster).toBe(10);
    expect(STAGE0B_PLAN_COUNTS.seatgeek).toBe(10);
  });

  it("every plan entry has a unique id and a non-empty reason", () => {
    const seenIds = new Set<string>();
    for (const entry of STAGE0B_TEST_PLAN) {
      expect(seenIds.has(entry.id), `duplicate id ${entry.id}`).toBe(false);
      seenIds.add(entry.id);
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  it("every plan entry's URL classifies through the existing pure URL resolver as the entry expects", () => {
    const failures: string[] = [];
    for (const entry of STAGE0B_TEST_PLAN) {
      const resolved = resolveActivityProviderSkillUrl(entry.url);
      if (!resolved) {
        failures.push(`${entry.id}: resolver returned null`);
        continue;
      }
      if (resolved.provider !== entry.provider) {
        failures.push(
          `${entry.id}: expected provider=${entry.provider} got ${resolved.provider}`,
        );
      }
      if (resolved.pageType !== entry.expected_resolver_page_type) {
        failures.push(
          `${entry.id}: expected page_type=${entry.expected_resolver_page_type} got ${resolved.pageType}`,
        );
      }
      if (resolved.executionMode !== entry.expected_resolver_execution_mode) {
        failures.push(
          `${entry.id}: expected execution_mode=${entry.expected_resolver_execution_mode} got ${resolved.executionMode}`,
        );
      }
    }
    expect(failures, failures.join(" | ")).toEqual([]);
  });

  it("plan covers every Ticketmaster intended class the runbook lists", () => {
    const tm = STAGE0B_TEST_PLAN.filter((e) => e.provider === "ticketmaster");
    const tmClasses = new Set(tm.map((e) => e.intended_class));
    expect(tmClasses).toContain("ticketmaster_artist");
    expect(tmClasses).toContain("ticketmaster_event");
    expect(tmClasses).toContain("ticketmaster_search");
    expect(tmClasses).toContain("ticketmaster_listing");
  });

  it("plan covers SeatGeek dated event and listing classes", () => {
    const sg = STAGE0B_TEST_PLAN.filter((e) => e.provider === "seatgeek");
    const sgClasses = new Set(sg.map((e) => e.intended_class));
    expect(sgClasses).toContain("seatgeek_dated_event");
    expect(sgClasses).toContain("seatgeek_listing");
  });

  it("plan is frozen (read-only) so a stale operator copy cannot mutate it at runtime", () => {
    expect(Object.isFrozen(STAGE0B_TEST_PLAN)).toBe(true);
  });
});
