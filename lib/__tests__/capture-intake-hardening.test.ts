import { describe, expect, it } from "vitest";
import type {
  IntentState,
  NluV2ParseResult,
  RouterAction,
} from "@/lib/agent/nlu-v2";
import {
  buildCaptureTravelObjectFromNlu,
  detectCaptureSource,
} from "@/lib/capture/travel-object";

// Stage 0 Capture Intake / NLU Robustness audit — pin the deterministic
// no-live behavior of the homepage capture pipeline against bug classes
// the spec called out:
//
//   1. Activity (Broadway / Lion King) URL/text must not classify into a
//      generic missing-fields trip flow.
//   2. Restaurant cuisine constraints must stay hard constraints and never
//      flip a cuisine-only search into direct_booking.
//   3. Hotel host hints must survive natural-phrasing URLs.
//   4. Pasted links should become source-aware capture objects with the
//      right scenario or stay `needs_review` for unknown hosts.
//   5. Ambiguous capture (screenshot reference, low confidence, weak host)
//      must ask for the next useful clarification, not "unsupported_source".
//
// All tests are deterministic — they call the pure capture builder and the
// pure source detector with prebuilt NLU results. No live LLM, provider,
// or runtime calls.

const capturedAt = "2026-05-07T12:00:00.000Z";

function baseState(overrides: Partial<IntentState>): IntentState {
  return {
    confidence: 0.91,
    turn_count: 1,
    updated_at: capturedAt,
    intent: "create_plan",
    scenario: null,
    categories: [],
    party_type: "solo",
    member_names: [],
    refined_target_id: null,
    planning_assumptions: [],
    ...overrides,
  };
}

function resultFor(
  state: IntentState,
  action: RouterAction,
  extra: Partial<NluV2ParseResult> = {},
): NluV2ParseResult {
  return {
    intent: state.intent,
    scenario: state.scenario,
    categories: state.categories,
    party_type: state.party_type,
    member_names: state.member_names,
    collected_constraints: {},
    missing_fields: action.type === "ask_clarification" ? action.missing : [],
    suggested_clarify_question: null,
    suggested_quick_picks: null,
    confirm_ready: action.type === "show_confirm_card",
    refined_target_id: null,
    assistant_reply: "ok",
    __v2_state: state,
    __v2_action: action,
    ...extra,
  };
}

function fallbackResultWithoutState(
  scenario: string | null = null,
): NluV2ParseResult {
  return {
    intent: "chitchat",
    scenario: scenario as NluV2ParseResult["scenario"],
    categories: [],
    party_type: "solo",
    member_names: [],
    collected_constraints: {},
    missing_fields: [],
    suggested_clarify_question: null,
    suggested_quick_picks: null,
    confirm_ready: false,
    refined_target_id: null,
    assistant_reply: "ok",
  };
}

// ─── 1. Source detector hardening ───────────────────────────────────────

describe("detectCaptureSource — looksLikeScreenshotReference precision", () => {
  it("does not flag 'photo' inside ordinary travel phrasing", () => {
    // Pre-fix bug: literal substring match for "photo" / "image" turned
    // any travel sentence with those words into source.type=screenshot,
    // which downstream readiness logic treated as a non-text source.
    const source = detectCaptureSource(
      "Find a hotel near the famous photos of Yosemite",
      capturedAt,
    );
    expect(source.type).not.toBe("screenshot");
  });

  it("does not flag 'image' inside ordinary travel phrasing", () => {
    const source = detectCaptureSource(
      "Book a restaurant in New York with a great image of the skyline",
      capturedAt,
    );
    expect(source.type).not.toBe("screenshot");
  });

  it("still flags an explicit screenshot reference", () => {
    expect(
      detectCaptureSource("here is a screenshot of the booking", capturedAt)
        .type,
    ).toBe("screenshot");
    expect(
      detectCaptureSource("uploaded image of the page", capturedAt).type,
    ).toBe("screenshot");
    expect(
      detectCaptureSource("attached photo of the receipt", capturedAt).type,
    ).toBe("screenshot");
    expect(
      detectCaptureSource("这张截图里的酒店", capturedAt)
        .type,
    ).toBe("screenshot");
  });

  it("still flags filenames with image extensions", () => {
    expect(
      detectCaptureSource("lion-king-ticketmaster.png", capturedAt).type,
    ).toBe("screenshot");
  });
});

// ─── 2. Screenshot capture w/o scenario should ask for review ────────────

describe("buildCaptureTravelObjectFromNlu — screenshot readiness", () => {
  it("treats a screenshot reference with no scenario as needs_review, not unsupported_source", () => {
    // Pre-fix bug: source.type=="screenshot" + scenario==null routed into
    // the "unsupported_source" branch, which read like "Onegent can't
    // process this." We DO support screenshots — we just need the user to
    // describe what's on it. Reason should be "needs_review" so the
    // homepage UI nudges the user for context instead of declining.
    const capture = buildCaptureTravelObjectFromNlu({
      message: "Here is a screenshot of the place",
      result: fallbackResultWithoutState(),
      capturedAt,
    });

    expect(capture.source.type).toBe("screenshot");
    expect(capture.task_readiness.ready).toBe(false);
    expect(capture.task_readiness.reason).toBe("needs_review");
  });
});

// ─── 3. Host hint hardening — subdomain impersonation ──────────────────

describe("buildCaptureTravelObjectFromNlu — host impersonation guard", () => {
  it("does not classify subdomain-impersonated hosts as a known scenario", () => {
    // Pre-fix bug: PROVIDER_SCENARIO_HINTS used unanchored substring
    // matches like /ticketmaster\./i. A pasted URL like
    // https://www.ticketmaster.com.evil.example/buy contains the
    // substring "ticketmaster." and was wrongly classified as activity.
    // Anchored matching must require the brand to be the apex/registrable
    // host, not a subdomain of an attacker-controlled domain.
    const capture = buildCaptureTravelObjectFromNlu({
      message: "https://www.ticketmaster.com.evil.example/buy",
      result: fallbackResultWithoutState(),
      capturedAt,
    });

    expect(capture.source.type).toBe("url");
    expect(capture.classification.scenario).toBeNull();
    expect(capture.classification.categories).toEqual([]);
    // Still URL source, so readiness is needs_review (not
    // unsupported_source) — the user can give us context.
    expect(capture.task_readiness.reason).toBe("needs_review");
  });

  it("does not classify dotless brand-substring hosts (ticketmaster-impersonator.com)", () => {
    const capture = buildCaptureTravelObjectFromNlu({
      message: "https://ticketmaster-impersonator.com/buy",
      result: fallbackResultWithoutState(),
      capturedAt,
    });
    expect(capture.classification.scenario).toBeNull();
  });

  it("does classify the legitimate apex (ticketmaster.com)", () => {
    const capture = buildCaptureTravelObjectFromNlu({
      message: "https://ticketmaster.com/event/Z1r9-lion-king",
      result: fallbackResultWithoutState(),
      capturedAt,
    });
    expect(capture.classification.scenario).toBe("activity");
    expect(capture.classification.categories).toEqual(["activity"]);
  });

  it("does classify a www. or m. subdomain of a legitimate host", () => {
    const a = buildCaptureTravelObjectFromNlu({
      message: "https://www.opentable.com/r/carbone",
      result: fallbackResultWithoutState(),
      capturedAt,
    });
    expect(a.classification.scenario).toBe("restaurant");

    const b = buildCaptureTravelObjectFromNlu({
      message: "https://m.booking.com/hotel/us/the-pierre.html",
      result: fallbackResultWithoutState(),
      capturedAt,
    });
    expect(b.classification.scenario).toBe("hotel");
  });

  it("classifies locale TLDs of legitimate hosts (.co.uk, .ca, .com.au)", () => {
    const uk = buildCaptureTravelObjectFromNlu({
      message: "https://www.ticketmaster.co.uk/event/123",
      result: fallbackResultWithoutState(),
      capturedAt,
    });
    expect(uk.classification.scenario).toBe("activity");

    const au = buildCaptureTravelObjectFromNlu({
      message: "https://www.booking.com.au/hotel/sydney/the-langham",
      result: fallbackResultWithoutState(),
      capturedAt,
    });
    expect(au.classification.scenario).toBe("hotel");
  });
});

// ─── 4. Provider coverage — the common "missing provider" gap ───────────

describe("buildCaptureTravelObjectFromNlu — provider host coverage", () => {
  it("classifies an Airbnb URL as hotel-class (closest existing scenario)", () => {
    // Pre-fix gap: airbnb is the most common short-stay provider users
    // paste, but it was missing from PROVIDER_SCENARIO_HINTS so the
    // capture object stayed scenario=null and the user saw "needs_review"
    // with no quick-pick path forward.
    const capture = buildCaptureTravelObjectFromNlu({
      message: "https://www.airbnb.com/rooms/12345",
      result: fallbackResultWithoutState(),
      capturedAt,
    });
    expect(capture.classification.scenario).toBe("hotel");
    expect(capture.classification.categories).toEqual(["hotel"]);
  });

  it("classifies an Eventbrite URL as activity", () => {
    const capture = buildCaptureTravelObjectFromNlu({
      message: "https://www.eventbrite.com/e/example-tickets-12345",
      result: fallbackResultWithoutState(),
      capturedAt,
    });
    expect(capture.classification.scenario).toBe("activity");
    expect(capture.classification.categories).toEqual(["activity"]);
  });

  it("classifies a Vrbo URL as hotel-class", () => {
    const capture = buildCaptureTravelObjectFromNlu({
      message: "https://www.vrbo.com/12345",
      result: fallbackResultWithoutState(),
      capturedAt,
    });
    expect(capture.classification.scenario).toBe("hotel");
  });
});

// ─── 5. Solo trip kind="trip" must produce create_task, not create_room ─

describe("buildCaptureActions — kind=trip preserves solo intent", () => {
  it("solo trip plan emits create_task with consistent label", () => {
    // Pre-fix bug: kind="trip" mapped to type="create_room" + label
    // "Create pending task" — type/label mismatch. Solo trip plans
    // (state.intent="create_plan") must be a pending task, not a DR.
    const state = baseState({
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: {
        destination_city: "New York",
        departure_city: "Nashville",
        start_date: "2026-06-01",
        end_date: "2026-06-04",
        travelers: 2,
        activities: ["Broadway show"],
        cuisine_preferences: [],
        vibe: "mixed",
        planning_assumptions: [],
      },
    });
    const action: RouterAction = {
      type: "show_confirm_card",
      kind: "trip",
      state,
    };
    const capture = buildCaptureTravelObjectFromNlu({
      message:
        "Plan a New York trip June 1 to June 4 from Nashville for two, with hotel, food, flights, and a show",
      result: resultFor(state, action),
      capturedAt,
    });

    const action_token = capture.possible_actions.find(
      (a) => a.type === "create_task" || a.type === "create_room",
    );
    expect(action_token).toBeDefined();
    expect(action_token!.type).toBe("create_task");
    expect(action_token!.label).toBe("Create pending task");
  });

  it("multi trip room emits create_room consistently", () => {
    // Multi-party trip (intent=create_room): kind="trip" still maps to
    // create_room (legacy alias). This assertion pins that the existing
    // DR path doesn't regress when we tighten the solo path.
    const state = baseState({
      intent: "create_room",
      party_type: "multi",
      member_names: ["Alex"],
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      trip: {
        destination_city: "New York",
        departure_city: "Nashville",
        start_date: "2026-06-01",
        end_date: "2026-06-04",
        travelers: 2,
        activities: [],
        cuisine_preferences: [],
        vibe: "mixed",
        planning_assumptions: [],
      },
    });
    const action: RouterAction = {
      type: "show_confirm_card",
      kind: "trip",
      state,
    };
    const capture = buildCaptureTravelObjectFromNlu({
      message:
        "Create a room with Alex for a New York trip June 1 to 4 from Nashville",
      result: resultFor(state, action),
      capturedAt,
    });

    const action_token = capture.possible_actions.find(
      (a) => a.type === "create_task" || a.type === "create_room",
    );
    expect(action_token).toBeDefined();
    expect(action_token!.type).toBe("create_room");
    expect(action_token!.label).toBe("Create decision room");
  });

  it("solo composite_plan still emits create_task", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant", "activity"],
      restaurant: {
        city: "New York",
        date: "2026-05-07",
        time: "19:00",
        party_size: 2,
        cuisine: "any",
      },
      activity: {
        event_name: "Broadway show",
        city: "New York",
        event_date: "2026-05-07",
        num_tickets: 2,
      },
    });
    const action: RouterAction = {
      type: "show_confirm_card",
      kind: "composite_plan",
      state,
    };
    const capture = buildCaptureTravelObjectFromNlu({
      message: "Plan dinner and a show in New York tomorrow for two",
      result: resultFor(state, action),
      capturedAt,
    });

    const action_token = capture.possible_actions.find(
      (a) => a.type === "create_task" || a.type === "create_room",
    );
    expect(action_token).toBeDefined();
    expect(action_token!.type).toBe("create_task");
  });
});

// ─── 6. Restaurant cuisine constraints stay hard ───────────────────────

describe("buildCaptureTravelObjectFromNlu — cuisine stays a hard constraint", () => {
  it("Sichuan request keeps cuisine in capture.constraints and never sets direct_booking", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "New York",
        date: "2026-05-13",
        time: "19:00",
        party_size: 2,
        cuisine: "Sichuan",
      },
    });
    const action: RouterAction = {
      type: "show_confirm_card",
      kind: "plan",
      state,
    };
    const capture = buildCaptureTravelObjectFromNlu({
      message: "Find a Sichuan restaurant in New York tomorrow at 7 for 2",
      result: resultFor(state, action, {
        collected_constraints: {
          city: "New York",
          date: "2026-05-13",
          time: "19:00",
          party_size: 2,
          cuisine: "Sichuan",
        },
      }),
      capturedAt,
    });

    expect(capture.constraints.cuisine).toBe("Sichuan");
    expect(capture.classification.direct_booking).toBe(false);
    expect(capture.entities.restaurant?.cuisine).toBe("Sichuan");
  });

  it("dietary array survives the capture projection", () => {
    const state = baseState({
      scenario: "restaurant",
      categories: ["restaurant"],
      restaurant: {
        city: "Seattle",
        date: "2026-05-07",
        time: "19:00",
        party_size: 2,
        cuisine: "Seafood",
        dietary: ["no shellfish"],
      },
    });
    const action: RouterAction = {
      type: "show_confirm_card",
      kind: "plan",
      state,
    };
    const capture = buildCaptureTravelObjectFromNlu({
      message: "Dinner in Seattle tomorrow 7pm for 2, no shellfish",
      result: resultFor(state, action, {
        collected_constraints: {
          city: "Seattle",
          date: "2026-05-07",
          time: "19:00",
          party_size: 2,
          cuisine: "Seafood",
          dietary: ["no shellfish"],
        },
      }),
      capturedAt,
    });

    expect(capture.constraints.cuisine).toBe("Seafood");
    expect(capture.constraints.dietary).toEqual(["no shellfish"]);
    expect(capture.entities.restaurant?.dietary).toEqual(["no shellfish"]);
  });
});
