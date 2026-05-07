import { describe, expect, it } from "vitest";
import type {
  IntentState,
  NluV2ParseResult,
  RouterAction,
} from "@/lib/agent/nlu-v2";
import {
  buildCaptureTravelObjectFromNlu,
  detectCaptureSource,
  extractAllCaptureUrls,
  type CaptureTravelObject,
} from "@/lib/capture/travel-object";
import { buildCaptureTaskBoundary } from "@/lib/capture/task-boundary";
import { parseDirectActivityProviderUrl } from "@/lib/capture/direct-provider-url";

// Stage 0 Capture / NLU direct-provider hardening v2.
//
// Existing pinned contracts (this file does not duplicate them):
//   - lib/__tests__/direct-provider-url.test.ts:
//       parseDirectActivityProviderUrl + readDirectActivityProviderUrlFromConstraints
//       + buildDirectActivityTask
//   - lib/__tests__/capture-task-boundary.test.ts: per-scenario complete
//       payload, missing-field path, ambiguity path, URL/confidence/session
//       metadata, two direct-Ticketmaster scenarios.
//   - lib/__tests__/capture-travel-object.test.ts: 5 baseline contracts.
//   - lib/__tests__/capture-intake-hardening.test.ts: source detector
//       precision, screenshot readiness, host impersonation guard, provider
//       host coverage, kind=trip solo-vs-multi, cuisine stays a hard
//       constraint.
//   - lib/__tests__/capture-nlu-stage0-hardening.test.ts: URL extraction
//       trailing-punctuation trim, direct TM URL through full pipeline,
//       activity vs trip collapse via routing-matrix evaluator,
//       screenshot Chinese precision, hotel/flight/restaurant constraint
//       preservation, categories normalization.
//
// This file adds regressions for the four classes the founder explicitly
// re-flagged for direct-provider v2 hardening:
//
//   A) Multi-URL homepage messages must NOT silently pick the first URL
//      and run direct booking against it. The first URL is preserved as
//      `source.url`, but the second+ URLs surface in `additional_urls`
//      and the task boundary holds for review (review_capture, not
//      run_direct_booking).
//   B) Eventbrite / SeatGeek / StubHub URLs are recognized as activity
//      via the host hint but DO NOT take the run_direct_booking shortcut
//      — that path is locked to Ticketmaster /event/<id> until each
//      provider has a deterministic event-id pattern AND a corresponding
//      executor instruction message.
//   C) Pure helper `extractAllCaptureUrls` returns every URL in the
//      message, in order, with the same trailing-punctuation cleanup as
//      the single-URL `extractCaptureUrl` path.
//   D) Existing TM /event/<id> direct-booking contract is not regressed
//      by the multi-URL changes — single TM URL still runs direct.

const capturedAt = "2026-05-07T16:00:00.000Z";

function baseState(overrides: Partial<IntentState>): IntentState {
  return {
    confidence: 0.9,
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

function fallbackResultWithoutState(): NluV2ParseResult {
  return {
    intent: "chitchat",
    scenario: null,
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

function captureFixture(overrides: Partial<CaptureTravelObject>): CaptureTravelObject {
  return {
    source: {
      type: "request",
      raw_text: "book this",
      captured_at: capturedAt,
    },
    classification: {
      scenario: "restaurant",
      categories: ["restaurant"],
      confidence: 0.92,
      direct_booking: false,
    },
    entities: {},
    constraints: {},
    missing_fields: [],
    possible_actions: [{ type: "create_task", label: "Create pending task" }],
    task_readiness: {
      ready: true,
      reason: "ready",
      next_missing_fields: [],
    },
    provenance: { parser: "nlu-v2" },
    ...overrides,
  };
}

// ─── A. Multi-URL extraction helper ────────────────────────────────────

describe("extractAllCaptureUrls — pure helper", () => {
  it("returns an empty list when no URLs are present", () => {
    expect(extractAllCaptureUrls("just plain travel text")).toEqual([]);
  });

  it("returns a single URL preserving trailing-punctuation cleanup", () => {
    const url = "https://www.ticketmaster.com/foo/event/Z1r9";
    expect(
      extractAllCaptureUrls(`${url}, please book this`),
    ).toEqual([url]);
  });

  it("returns all URLs in the order they appear", () => {
    const a = "https://www.ticketmaster.com/foo/event/AAA";
    const b = "https://www.ticketmaster.com/bar/event/BBB";
    expect(
      extractAllCaptureUrls(`Compare ${a} and ${b}`),
    ).toEqual([a, b]);
  });

  it("strips trailing punctuation from each URL independently", () => {
    const a = "https://www.opentable.com/r/carbone";
    const b = "https://www.booking.com/hotel/foo";
    expect(
      extractAllCaptureUrls(`${a}; ${b}.`),
    ).toEqual([a, b]);
  });

  it("ignores non-ASCII chat tokens between URLs (Chinese)", () => {
    const a = "https://www.ticketmaster.com/foo/event/AAA";
    const b = "https://www.ticketmaster.com/bar/event/BBB";
    expect(
      extractAllCaptureUrls(`${a},帮我比较一下${b}`),
    ).toEqual([a, b]);
  });

  it("preserves internal commas (Google Maps coordinates)", () => {
    const url = "https://www.google.com/maps/@40.7,-74.0,12z";
    expect(extractAllCaptureUrls(`Going here: ${url}`)).toEqual([url]);
  });
});

// ─── B. Multi-URL source detection ─────────────────────────────────────

describe("detectCaptureSource — multi-URL handling", () => {
  it("populates additional_urls when the message contains more than one URL", () => {
    const a = "https://www.ticketmaster.com/foo/event/AAA";
    const b = "https://www.ticketmaster.com/bar/event/BBB";
    const src = detectCaptureSource(`Compare ${a} and ${b}`, capturedAt);
    expect(src.type).toBe("url");
    expect(src.url).toBe(a);
    expect(src.additional_urls).toEqual([b]);
  });

  it("does NOT populate additional_urls when there is only one URL", () => {
    const url = "https://www.ticketmaster.com/foo/event/AAA";
    const src = detectCaptureSource(`Book ${url} please`, capturedAt);
    expect(src.url).toBe(url);
    expect(src.additional_urls).toBeUndefined();
  });

  it("collects 3+ URLs in additional_urls (ordered)", () => {
    const a = "https://www.ticketmaster.com/event/AAA";
    const b = "https://www.eventbrite.com/e/example-tickets-1";
    const c = "https://seatgeek.com/show/tickets/2";
    const src = detectCaptureSource(`Look at ${a}, ${b}, ${c}`, capturedAt);
    expect(src.url).toBe(a);
    expect(src.additional_urls).toEqual([b, c]);
  });

  it("Chinese chat between URLs still extracts both URLs (no glue corruption)", () => {
    const a = "https://www.ticketmaster.com/foo/event/AAA";
    const b = "https://www.ticketmaster.com/bar/event/BBB";
    const src = detectCaptureSource(`帮我对比 ${a},还是 ${b} 更划算？`, capturedAt);
    expect(src.url).toBe(a);
    expect(src.additional_urls).toEqual([b]);
  });
});

// ─── C. Multi-URL readiness + boundary downgrade ───────────────────────

describe("buildCaptureTravelObjectFromNlu — multi-URL forces needs_review", () => {
  it("readiness is needs_review when source has additional_urls", () => {
    const a = "https://www.ticketmaster.com/foo/event/AAA";
    const b = "https://www.ticketmaster.com/bar/event/BBB";
    const message = `Should I book ${a} or ${b}?`;
    const state = baseState({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "Show A",
        event_type: "theater",
        city: "New York",
        event_date: "2026-05-30",
        num_tickets: 1,
      },
    });
    const action: RouterAction = {
      type: "show_confirm_card",
      kind: "plan",
      state,
    };
    const capture = buildCaptureTravelObjectFromNlu({
      message,
      result: resultFor(state, action),
      capturedAt,
    });
    expect(capture.source.additional_urls).toEqual([b]);
    expect(capture.task_readiness.ready).toBe(false);
    expect(capture.task_readiness.reason).toBe("needs_review");
  });
});

describe("buildCaptureTaskBoundary — multi-URL blocks the direct_booking shortcut", () => {
  it("two TM /event/ URLs land on review_capture, not run_direct_booking", () => {
    const a = "https://www.ticketmaster.com/foo/event/AAA";
    const b = "https://www.ticketmaster.com/bar/event/BBB";
    const cap = captureFixture({
      source: {
        type: "url",
        raw_text: `Compare ${a} and ${b}`,
        url: a,
        host: "www.ticketmaster.com",
        additional_urls: [b],
        captured_at: capturedAt,
      },
      classification: {
        scenario: "activity",
        categories: ["activity"],
        confidence: 0.85,
        direct_booking: false,
      },
      entities: {
        activity: {
          event_name: "Show A",
          event_type: "theater",
          city: "New York",
          event_date: "2026-05-30",
          num_tickets: 1,
        },
      },
      constraints: { source_url: a },
      task_readiness: {
        ready: false,
        reason: "needs_review",
        next_missing_fields: [],
      },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.nextAction).not.toBe("run_direct_booking");
    expect(boundary.nextAction).toBe("review_capture");
    expect(boundary.reason).toBe("multiple_urls");
    expect(boundary.payload).toBeUndefined();
  });

  it("a single TM /event/ URL still triggers run_direct_booking (regression)", () => {
    const url = "https://www.ticketmaster.com/foo/event/AAA";
    const cap = captureFixture({
      source: {
        type: "url",
        raw_text: `Book ${url} please`,
        url,
        host: "www.ticketmaster.com",
        captured_at: capturedAt,
      },
      classification: {
        scenario: "activity",
        categories: ["activity"],
        confidence: 0.9,
        direct_booking: false,
      },
      entities: {
        activity: {
          event_name: "Show A",
          event_type: "theater",
          city: "New York",
          event_date: "2026-05-30",
          num_tickets: 1,
        },
      },
      constraints: { source_url: url },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(true);
    expect(boundary.nextAction).toBe("run_direct_booking");
  });

  it("multi-URL with one TM and one non-TM URL also blocks direct_booking", () => {
    const tm = "https://www.ticketmaster.com/foo/event/AAA";
    const eb = "https://www.eventbrite.com/e/some-event-tickets-12345678901";
    const cap = captureFixture({
      source: {
        type: "url",
        raw_text: `${tm} or ${eb}?`,
        url: tm,
        host: "www.ticketmaster.com",
        additional_urls: [eb],
        captured_at: capturedAt,
      },
      classification: {
        scenario: "activity",
        categories: ["activity"],
        confidence: 0.85,
        direct_booking: false,
      },
      entities: {
        activity: {
          event_name: "Show A",
          event_type: "theater",
          city: "New York",
          event_date: "2026-05-30",
          num_tickets: 1,
        },
      },
      constraints: { source_url: tm },
      task_readiness: {
        ready: false,
        reason: "needs_review",
        next_missing_fields: [],
      },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.nextAction).toBe("review_capture");
    expect(boundary.reason).toBe("multiple_urls");
  });
});

// ─── D. Eventbrite / SeatGeek / StubHub: classified but NOT direct ────

describe("non-Ticketmaster activity providers — host hint OK, direct booking deferred", () => {
  it("Eventbrite event URL classifies as activity via host hint", () => {
    const url = "https://www.eventbrite.com/e/sample-event-tickets-987654321012";
    const capture = buildCaptureTravelObjectFromNlu({
      message: url,
      result: fallbackResultWithoutState(),
      capturedAt,
    });
    expect(capture.source.type).toBe("url");
    expect(capture.source.host).toBe("www.eventbrite.com");
    expect(capture.classification.scenario).toBe("activity");
    expect(capture.classification.categories).toEqual(["activity"]);
  });

  it("Eventbrite event URL does NOT trigger run_direct_booking (parser is TM-only by design)", () => {
    // Defense-in-depth: even if someone seeds a complete activity capture
    // around an Eventbrite URL, parseDirectActivityProviderUrl returns
    // null for non-Ticketmaster hosts so the boundary stays on the
    // normal show_confirmation path. Pinning this contract prevents a
    // future "expand DirectActivityProvider" change from silently
    // shipping an executor task that says "Use this exact Ticketmaster
    // event URL" against an Eventbrite link.
    const url = "https://www.eventbrite.com/e/sample-event-tickets-987654321012";
    expect(parseDirectActivityProviderUrl(url)).toBeNull();
    const cap = captureFixture({
      source: {
        type: "url",
        raw_text: url,
        url,
        host: "www.eventbrite.com",
        captured_at: capturedAt,
      },
      classification: {
        scenario: "activity",
        categories: ["activity"],
        confidence: 0.85,
        direct_booking: false,
      },
      entities: {
        activity: {
          event_name: "Sample Event",
          event_type: "concert",
          city: "Austin",
          event_date: "2026-06-15",
          num_tickets: 1,
        },
      },
      constraints: { source_url: url },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.nextAction).not.toBe("run_direct_booking");
    expect(boundary.nextAction).toBe("show_confirmation");
  });

  it("SeatGeek event URL classifies as activity via host hint", () => {
    const url = "https://seatgeek.com/knicks-vs-celtics-tickets/12345";
    const capture = buildCaptureTravelObjectFromNlu({
      message: url,
      result: fallbackResultWithoutState(),
      capturedAt,
    });
    expect(capture.source.type).toBe("url");
    expect(capture.source.host).toBe("seatgeek.com");
    expect(capture.classification.scenario).toBe("activity");
  });

  it("SeatGeek event URL does NOT trigger run_direct_booking", () => {
    const url = "https://seatgeek.com/knicks-vs-celtics-tickets/12345";
    expect(parseDirectActivityProviderUrl(url)).toBeNull();
    const cap = captureFixture({
      source: {
        type: "url",
        raw_text: url,
        url,
        host: "seatgeek.com",
        captured_at: capturedAt,
      },
      classification: {
        scenario: "activity",
        categories: ["activity"],
        confidence: 0.85,
        direct_booking: false,
      },
      entities: {
        activity: {
          event_name: "Knicks vs Celtics",
          event_type: "sports",
          city: "New York",
          event_date: "2026-05-18",
          num_tickets: 2,
        },
      },
      constraints: { source_url: url },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.nextAction).not.toBe("run_direct_booking");
    expect(boundary.nextAction).toBe("show_confirmation");
  });

  it("StubHub URL classifies as activity, does not trigger run_direct_booking", () => {
    const url = "https://www.stubhub.com/example-event/12345";
    expect(parseDirectActivityProviderUrl(url)).toBeNull();
    const capture = buildCaptureTravelObjectFromNlu({
      message: url,
      result: fallbackResultWithoutState(),
      capturedAt,
    });
    expect(capture.classification.scenario).toBe("activity");
  });

  it("Telecharge URL classifies as activity (Broadway-class), no direct booking", () => {
    const url = "https://www.telecharge.com/Broadway/SomeShow/Performance/12345";
    expect(parseDirectActivityProviderUrl(url)).toBeNull();
    const capture = buildCaptureTravelObjectFromNlu({
      message: url,
      result: fallbackResultWithoutState(),
      capturedAt,
    });
    expect(capture.classification.scenario).toBe("activity");
  });
});

// ─── E. Existing TM direct-booking contract — regression coverage ──────

describe("Ticketmaster direct booking — regression after multi-URL changes", () => {
  it("Chinese surrounding text + single TM /event/ URL still becomes run_direct_booking", () => {
    const tmEventUrl =
      "https://www.ticketmaster.com/the-lion-king-new-york-ny-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea";
    const message = `${tmEventUrl}, 帮我预定一下这个`;
    const state = baseState({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "The Lion King",
        event_type: "theater",
        city: "New York",
        event_date: "2026-05-30",
        num_tickets: 1,
      },
    });
    const action: RouterAction = {
      type: "show_confirm_card",
      kind: "plan",
      state,
    };
    const capture = buildCaptureTravelObjectFromNlu({
      message,
      result: resultFor(state, action, {
        collected_constraints: {
          event_name: "The Lion King",
          city: "New York",
          event_date: "2026-05-30",
          num_tickets: 1,
        },
      }),
      capturedAt,
    });
    // Single URL → no additional_urls → direct booking shortcut still fires.
    expect(capture.source.additional_urls).toBeUndefined();
    expect(capture.source.url).toBe(tmEventUrl);
    const boundary = buildCaptureTaskBoundary(capture);
    expect(boundary.ok).toBe(true);
    expect(boundary.nextAction).toBe("run_direct_booking");
    expect(boundary.payload?.nlu.collected_constraints.source_url).toBe(tmEventUrl);
  });

  it("English request + single TM /event/ URL still becomes run_direct_booking", () => {
    const url = "https://www.ticketmaster.com/foo/event/Z1r9";
    const state = baseState({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "Show",
        event_type: "theater",
        city: "New York",
        event_date: "2026-05-30",
        num_tickets: 2,
      },
    });
    const action: RouterAction = {
      type: "show_confirm_card",
      kind: "plan",
      state,
    };
    const capture = buildCaptureTravelObjectFromNlu({
      message: `book this ${url}!`,
      result: resultFor(state, action, {
        collected_constraints: {
          event_name: "Show",
          city: "New York",
          event_date: "2026-05-30",
          num_tickets: 2,
        },
      }),
      capturedAt,
    });
    expect(capture.source.additional_urls).toBeUndefined();
    // Trailing '!' must not stay on the URL after extraction.
    expect(capture.source.url).toBe(url);
    const boundary = buildCaptureTaskBoundary(capture);
    expect(boundary.ok).toBe(true);
    expect(boundary.nextAction).toBe("run_direct_booking");
  });

  it("subdomain impersonation (single URL) still rejected at parseDirectActivityProviderUrl", () => {
    const evil = "https://ticketmaster.com.evil.example/event/abc";
    expect(parseDirectActivityProviderUrl(evil)).toBeNull();
  });
});
