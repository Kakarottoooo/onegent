import { describe, expect, it } from "vitest";
import {
  ACTIVITY_PROVIDER_SKILLS,
  ACTIVITY_TASK_WORKSPACE_EVIDENCE_REQUIREMENTS,
  findActivityProviderSkill,
  isActivitySkillExactEvent,
  mapActivitySkillOutcomeToTaskDecision,
  resolveActivityProviderSkillUrl,
  validateActivitySkillEvidence,
} from "@/lib/activity-skills";
import type {
  ActivitySkillOutcome,
  ActivitySkillRuntimeNextAction,
} from "@/lib/activity-skills";
import type { TaskWorkspaceBucket } from "@/lib/booking-jobs/workspace";
import type { TravelTaskState } from "@/lib/core";

const completeEvidence = {
  provider: "ticketmaster",
  pageType: "exact_event",
  currentUrl:
    "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
  screenshotRef: "artifact://activity/ticketmaster-lion-king/event-page.png",
  actionLog: [
    "opened provider URL",
    "classified exact_event page",
    "captured visible candidate facts",
  ],
  visibleCandidateFacts: [
    "The Lion King",
    "New York, NY",
    "May 30, 2026",
    "2:00 PM",
  ],
} as const;

describe("activity provider skill registry", () => {
  it("registers the Stage 0B activity providers with safety stops and evidence contracts", () => {
    expect(ACTIVITY_PROVIDER_SKILLS.map((skill) => skill.provider)).toEqual([
      "ticketmaster",
      "seatgeek",
      "stubhub",
      "eventbrite",
      "axs",
    ]);

    for (const skill of ACTIVITY_PROVIDER_SKILLS) {
      expect(skill.requiredInputs).toContain("input_url");
      expect(skill.hardStops).toEqual(
        expect.arrayContaining([
          "seat_selection",
          "login",
          "account_verification",
          "captcha",
          "otp",
          "payment",
          "final_purchase",
          "final_confirmation",
        ]),
      );
      expect(skill.evidenceContract.minimumForLabRun).toEqual(
        expect.arrayContaining([
          "provider",
          "page_type",
          "current_url",
          "screenshot",
          "action_log",
          "visible_candidate_facts",
          "safe_next_action",
        ]),
      );
    }
  });

  it("finds skills by provider without falling back to the wrong provider", () => {
    expect(findActivityProviderSkill("ticketmaster")?.provider).toBe("ticketmaster");
    expect(findActivityProviderSkill("axs")?.provider).toBe("axs");
  });
});

describe("activity provider skill outcome -> task state mapping", () => {
  const cases: Array<{
    outcome: ActivitySkillOutcome;
    taskState: TravelTaskState;
    workspaceBucket: TaskWorkspaceBucket;
    safeNextAction: ActivitySkillRuntimeNextAction;
    executable: boolean;
    hardStop: boolean;
  }> = [
    {
      outcome: "exact_event_ready",
      taskState: "draft",
      workspaceBucket: "queue",
      safeNextAction: "start_provider_execution",
      executable: true,
      hardStop: false,
    },
    {
      outcome: "provider_listing_needs_choice",
      taskState: "ready_for_confirmation",
      workspaceBucket: "queue",
      safeNextAction: "ask_user_to_choose_event",
      executable: false,
      hardStop: false,
    },
    {
      outcome: "single_candidate_ready",
      taskState: "draft",
      workspaceBucket: "queue",
      safeNextAction: "start_provider_execution",
      executable: true,
      hardStop: false,
    },
    {
      outcome: "safe_handoff_reached",
      taskState: "ready_for_confirmation",
      workspaceBucket: "history",
      safeNextAction: "hold_for_manual_review",
      executable: false,
      hardStop: false,
    },
    {
      outcome: "user_seat_selection_required",
      taskState: "ready_for_confirmation",
      workspaceBucket: "history",
      safeNextAction: "ask_user_to_select_seats",
      executable: false,
      hardStop: true,
    },
    {
      outcome: "account_session_required",
      taskState: "awaiting_login",
      workspaceBucket: "history",
      safeNextAction: "ask_user_to_sign_in",
      executable: false,
      hardStop: true,
    },
    {
      outcome: "payment_or_final_action_required",
      taskState: "ready_for_confirmation",
      workspaceBucket: "history",
      safeNextAction: "stop_before_payment_or_final_action",
      executable: false,
      hardStop: true,
    },
    {
      outcome: "provider_degraded",
      taskState: "failed",
      workspaceBucket: "history",
      safeNextAction: "capture_provider_degraded_evidence",
      executable: false,
      hardStop: false,
    },
    {
      outcome: "insufficient_evidence",
      taskState: "failed",
      workspaceBucket: "history",
      safeNextAction: "collect_required_evidence",
      executable: false,
      hardStop: false,
    },
    {
      outcome: "skill_patch_needed",
      taskState: "failed",
      workspaceBucket: "history",
      safeNextAction: "create_reviewed_skill_patch",
      executable: false,
      hardStop: false,
    },
  ];

  for (const row of cases) {
    it(`${row.outcome} maps to ${row.taskState} / ${row.safeNextAction}`, () => {
      const decision = mapActivitySkillOutcomeToTaskDecision({
        ...completeEvidence,
        outcome: row.outcome,
      });
      expect(decision).toMatchObject({
        outcome: row.outcome,
        taskState: row.taskState,
        workspaceBucket: row.workspaceBucket,
        safeNextAction: row.safeNextAction,
        canExecuteProviderContinuation: row.executable,
        hardStop: row.hardStop,
        evidence: { complete: true, missing: [] },
      });
    });
  }

  it("seat selection, account, and payment/final boundaries never become executable continuations", () => {
    const humanOnlyOutcomes: ActivitySkillOutcome[] = [
      "user_seat_selection_required",
      "account_session_required",
      "payment_or_final_action_required",
    ];

    for (const outcome of humanOnlyOutcomes) {
      const decision = mapActivitySkillOutcomeToTaskDecision({
        ...completeEvidence,
        outcome,
      });
      expect(decision.canExecuteProviderContinuation, outcome).toBe(false);
      expect(decision.hardStop, outcome).toBe(true);
      expect(decision.safeNextAction, outcome).not.toBe("start_provider_execution");
      expect(decision.taskState, outcome).not.toBe("executing");
    }
  });

  it("execution-ready outcomes downgrade to insufficient_evidence when task workspace evidence is incomplete", () => {
    const decision = mapActivitySkillOutcomeToTaskDecision({
      outcome: "exact_event_ready",
      provider: "ticketmaster",
      pageType: "exact_event",
      currentUrl: "",
      screenshotRef: "",
      actionLog: [],
      visibleCandidateFacts: [],
    });

    expect(decision.outcome).toBe("insufficient_evidence");
    expect(decision.taskState).toBe("failed");
    expect(decision.workspaceBucket).toBe("history");
    expect(decision.safeNextAction).toBe("collect_required_evidence");
    expect(decision.canExecuteProviderContinuation).toBe(false);
    expect(decision.evidence).toEqual({
      complete: false,
      missing: ["currentUrl", "screenshot", "action_log", "visible_candidate_facts"],
    });
  });
});

describe("activity provider skill task-workspace evidence contract", () => {
  it("names every field Stage 0B requires before task execution can continue", () => {
    expect(ACTIVITY_TASK_WORKSPACE_EVIDENCE_REQUIREMENTS).toEqual([
      "provider",
      "page_type",
      "currentUrl",
      "screenshot",
      "action_log",
      "visible_candidate_facts",
    ]);
  });

  it("validates provider, page type, current URL, screenshot, action log, and visible candidate facts", () => {
    expect(validateActivitySkillEvidence(completeEvidence)).toEqual({
      complete: true,
      missing: [],
    });

    expect(
      validateActivitySkillEvidence({
        provider: "  ",
        pageType: null,
        currentUrl: "",
        screenshotRef: "",
        actionLog: ["  "],
        visibleCandidateFacts: [],
      }),
    ).toEqual({
      complete: false,
      missing: [
        "provider",
        "page_type",
        "currentUrl",
        "screenshot",
        "action_log",
        "visible_candidate_facts",
      ],
    });
  });
});
describe("activity provider skill URL matching", () => {
  it("treats exact Ticketmaster event URLs as direct task starts", () => {
    const match = resolveActivityProviderSkillUrl(
      "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581/event/1D0062E4AABB",
    );

    expect(match).toMatchObject({
      provider: "ticketmaster",
      pageType: "exact_event",
      providerPageId: "1D0062E4AABB",
      executionMode: "direct_execution",
      needsUserChoice: false,
      safeNextAction: "start_task",
    });
    expect(isActivitySkillExactEvent(match!)).toBe(true);
  });

  it("treats Ticketmaster artist pages as provider-start pages requiring user choice", () => {
    const match = resolveActivityProviderSkillUrl(
      "https://www.ticketmaster.com/disney-on-ice-presents-find-your-tickets/artist/1742147",
    );

    expect(match).toMatchObject({
      provider: "ticketmaster",
      pageType: "artist_or_performer",
      providerPageId: "1742147",
      executionMode: "provider_start",
      needsUserChoice: true,
      safeNextAction: "ask_user_to_choose",
    });
    expect(isActivitySkillExactEvent(match!)).toBe(false);
  });

  it("recognizes dated SeatGeek event pages as exact events", () => {
    const match = resolveActivityProviderSkillUrl(
      "https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493",
    );

    expect(match).toMatchObject({
      provider: "seatgeek",
      pageType: "exact_event",
      providerPageId: "17921493",
      executionMode: "direct_execution",
      needsUserChoice: false,
    });
  });

  it("keeps SeatGeek performer/listing pages as provider-start pages", () => {
    const match = resolveActivityProviderSkillUrl("https://seatgeek.com/hamilton-tickets");

    expect(match).toMatchObject({
      provider: "seatgeek",
      pageType: "listing",
      executionMode: "provider_start",
      needsUserChoice: true,
    });
  });

  it("keeps StubHub performer and grouping pages as user-choice provider starts", () => {
    expect(resolveActivityProviderSkillUrl("https://www.stubhub.com/bts-tickets/performer/1503185")).toMatchObject({
      provider: "stubhub",
      pageType: "artist_or_performer",
      providerPageId: "1503185",
      executionMode: "provider_start",
      needsUserChoice: true,
    });
    expect(resolveActivityProviderSkillUrl("https://www.stubhub.com/world-cup-tickets/grouping/45410")).toMatchObject({
      provider: "stubhub",
      pageType: "grouping",
      providerPageId: "45410",
      executionMode: "provider_start",
      needsUserChoice: true,
    });
  });

  it("recognizes StubHub exact events but review-captures checkout/payment URLs", () => {
    expect(resolveActivityProviderSkillUrl("https://www.stubhub.com/world-cup-east-rutherford-tickets-6-16-2026/event/153022598/?quantity=2")).toMatchObject({
      provider: "stubhub",
      pageType: "exact_event",
      providerPageId: "153022598",
      executionMode: "direct_execution",
      needsUserChoice: false,
      safeNextAction: "start_task",
    });

    expect(resolveActivityProviderSkillUrl("https://checkout.stubhub.com/secure/buy/checkout?ID=stubhub-payment-boundary")).toMatchObject({
      provider: "stubhub",
      pageType: "unknown_provider_page",
      providerPageId: "checkout",
      executionMode: "review_capture",
      needsUserChoice: true,
      safeNextAction: "review_capture",
    });
  });

  it("recognizes Eventbrite event pages but keeps directories as listings", () => {
    expect(resolveActivityProviderSkillUrl("https://www.eventbrite.com/e/summer-concert-tickets-123456789")).toMatchObject({
      provider: "eventbrite",
      pageType: "exact_event",
      providerPageId: "123456789",
      executionMode: "direct_execution",
      needsUserChoice: false,
    });
    expect(resolveActivityProviderSkillUrl("https://www.eventbrite.com/d/ny--new-york/music--events/")).toMatchObject({
      provider: "eventbrite",
      pageType: "listing",
      executionMode: "provider_start",
      needsUserChoice: true,
    });
  });

  it("supports AXS event, artist, and listing pages", () => {
    expect(resolveActivityProviderSkillUrl("https://www.axs.com/events/123456/example-event")).toMatchObject({
      provider: "axs",
      pageType: "exact_event",
      providerPageId: "123456",
      executionMode: "direct_execution",
      needsUserChoice: false,
    });
    expect(resolveActivityProviderSkillUrl("https://www.axs.com/artists/98765/example-artist")).toMatchObject({
      provider: "axs",
      pageType: "artist_or_performer",
      providerPageId: "98765",
      executionMode: "provider_start",
      needsUserChoice: true,
    });
    expect(resolveActivityProviderSkillUrl("https://www.axs.com/search?q=concert")).toMatchObject({
      provider: "axs",
      pageType: "search_results",
      executionMode: "provider_start",
      needsUserChoice: true,
    });
  });

  it("rejects provider impersonation and malformed URLs from direct execution", () => {
    for (const url of [
      "https://ticketmaster.com.evil.example/event/abc",
      "https://seatgeek.com.evil.example/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493",
      "https://stubhub.com.evil.example/bts-tickets/performer/1503185",
      "https://eventbrite.com.evil.example/e/summer-concert-tickets-123456789",
      "https://axs.com.evil.example/events/123456/example-event",
    ]) {
      const match = resolveActivityProviderSkillUrl(url);
      expect(match).toMatchObject({
        provider: "unknown",
        pageType: "unknown_provider_page",
        executionMode: "review_capture",
        needsUserChoice: true,
        safeNextAction: "review_capture",
      });
      expect(isActivitySkillExactEvent(match!)).toBe(false);
    }

    expect(resolveActivityProviderSkillUrl("javascript:https://ticketmaster.com/event/abc")).toBeNull();
    expect(resolveActivityProviderSkillUrl("not a url")).toBeNull();
  });
});
