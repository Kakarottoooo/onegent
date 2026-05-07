import { describe, expect, it } from "vitest";
import type {
  ActivityFields,
  FlightFields,
  HotelFields,
  IntentState,
  NluV2ParseResult,
  RestaurantFields,
  RouterAction,
} from "@/lib/agent/nlu-v2";
import type { NluCategory } from "@/lib/agent/nlu-v2/types";
import {
  buildCaptureTravelObjectFromNlu,
  detectCaptureSource,
  type CaptureTravelObject,
} from "@/lib/capture/travel-object";
import { buildCaptureTaskBoundary } from "@/lib/capture/task-boundary";
import {
  parseDirectActivityProviderUrl,
  readDirectActivityProviderUrlFromConstraints,
} from "@/lib/capture/direct-provider-url";
import {
  evaluateNluRoutingMatrix,
  NLU_ROUTING_FIXTURES,
} from "@/lib/agent/nlu-v2/routing-matrix";

// Stage 0 Capture / NLU precision audit.
//
// Existing pinned contracts (this file does not duplicate them):
//   - lib/__tests__/direct-provider-url.test.ts:
//       parseDirectActivityProviderUrl + readDirectActivityProviderUrlFromConstraints
//       + buildDirectActivityTask
//   - lib/__tests__/capture-task-boundary.test.ts:
//       per-scenario complete payload, missing-field path, ambiguity path,
//       URL/confidence/session metadata, two direct-Ticketmaster scenarios
//   - lib/__tests__/capture-travel-object.test.ts: 5 baseline contracts
//   - lib/__tests__/capture-intake-hardening.test.ts: source detector
//       precision, screenshot readiness, host impersonation guard, provider
//       host coverage, kind=trip solo-vs-multi, cuisine stays a hard
//       constraint
//   - lib/agent/nlu-v2/__tests__/activity-ticket-normalization.test.ts +
//       routing-matrix.ts: Lion King zh + en collapse, Hamilton, Knicks,
//       Wicked, sports, restaurant cuisine + dietary, hotel + flight +
//       trip required-field gates
//
// This file adds regressions for the four entry-point precision classes
// the audit re-flagged, focused on joints not yet covered:
//
//   A) Direct Ticketmaster URL through the FULL pipeline (capture builder
//      -> task boundary), in both Chinese and English request shapes,
//      including subdomain impersonation and non-event TM URL guards.
//   B) Activity vs trip collapse end-to-end via the routing-matrix
//      evaluator, plus a sports / concert pin so the Lion King fixture
//      is not the only case keeping the contract green.
//   C) Screenshot/text source detection over- and under-trigger
//      regressions for Chinese phrasing.
//   D) Hotel / flight / restaurant constraint preservation through
//      buildCaptureTaskBoundary -> CaptureTaskConfirmationPayload (cuisine,
//      cabin_class, return_date, is_round_trip, dietary, budget,
//      destination, traveler_count).

const capturedAt = "2026-05-07T15:00:00.000Z";

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

// Build a CaptureTravelObject directly (bypassing the v2 builder) so we can
// assert on the boundary without recomputing the source / classification at
// the same time. Mirrors the helper in capture-task-boundary.test.ts.
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

// ─── A0. URL extraction trailing-punctuation trim ──────────────────────

describe("detectCaptureSource — URL extraction strips trailing sentence punctuation", () => {
  it("strips a trailing comma when a URL is followed by Chinese chat text", () => {
    // Pre-fix bug: URL_RE allowed ',' inside the URL run, so a pasted
    // shape "...event/Z1r9,帮我预定" produced source.url ending with ','
    // which leaked into capture.constraints.source_url and the boundary
    // _capture_source.url. parseDirectActivityProviderUrl cleaned its
    // OWN return value but the source/constraints leak persisted.
    const url = "https://www.ticketmaster.com/foo/event/Z1r9";
    const src = detectCaptureSource(`${url},帮我预定一下这个`, capturedAt);
    expect(src.type).toBe("url");
    expect(src.url).toBe(url);
  });

  it("strips a trailing period at the end of an English sentence", () => {
    const url = "https://www.opentable.com/r/carbone";
    const src = detectCaptureSource(`Book this for me ${url}.`, capturedAt);
    expect(src.url).toBe(url);
  });

  it("strips multiple trailing delimiters '!?' and stray brackets", () => {
    const url = "https://www.ticketmaster.com/foo/event/abc";
    expect(detectCaptureSource(`${url}!?`, capturedAt).url).toBe(url);
    expect(detectCaptureSource(`${url}]`, capturedAt).url).toBe(url);
    expect(detectCaptureSource(`${url}}`, capturedAt).url).toBe(url);
  });

  it("preserves commas inside the URL path (Google Maps coordinates)", () => {
    const url = "https://www.google.com/maps/@40.7,-74.0,12z";
    const src = detectCaptureSource(`Going here: ${url}`, capturedAt);
    expect(src.url).toBe(url);
  });

  it("preserves query string '?' when not the final character", () => {
    const url = "https://www.example.com/search?q=hotel&city=NY";
    const src = detectCaptureSource(`Found ${url}`, capturedAt);
    expect(src.url).toBe(url);
  });
});

// ─── A. Direct Ticketmaster URL through the full pipeline ──────────────

describe("direct provider URL — Capture builder -> task boundary", () => {
  const tmEventUrl =
    "https://www.ticketmaster.com/the-lion-king-new-york-ny-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea";

  it("Chinese request + Ticketmaster /event/ URL becomes run_direct_booking with URL preserved exact", () => {
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

    expect(capture.source.type).toBe("url");
    expect(capture.source.url).toBe(tmEventUrl);
    expect(capture.source.host).toBe("www.ticketmaster.com");
    expect(capture.classification.scenario).toBe("activity");
    expect(capture.constraints.source_url).toBe(tmEventUrl);

    const boundary = buildCaptureTaskBoundary(capture);
    expect(boundary.ok).toBe(true);
    expect(boundary.nextAction).toBe("run_direct_booking");
    expect(boundary.scenario).toBe("activity");
    expect(boundary.payload?.kind).toBe("plan");
    expect(boundary.payload?.nlu.direct_booking).toBe(true);
    expect(boundary.payload?.nlu.collected_constraints.source_url).toBe(tmEventUrl);
    // The exact URL flows through to the source metadata so the executor
    // task built downstream can lock onto it.
    expect(boundary.payload?.capture_metadata.url).toBe(tmEventUrl);
    expect(boundary.payload?.capture_metadata.original_input).toBe(message);
  });

  it("English request + Ticketmaster /event/ URL becomes run_direct_booking with URL preserved exact", () => {
    const message = `book this for me ${tmEventUrl}`;
    const state = baseState({
      scenario: "activity",
      categories: ["activity"],
      activity: {
        event_name: "The Lion King",
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
      message,
      result: resultFor(state, action, {
        collected_constraints: {
          event_name: "The Lion King",
          city: "New York",
          event_date: "2026-05-30",
          num_tickets: 2,
        },
      }),
      capturedAt,
    });

    const boundary = buildCaptureTaskBoundary(capture);
    expect(boundary.ok).toBe(true);
    expect(boundary.nextAction).toBe("run_direct_booking");
    expect(boundary.payload?.nlu.direct_booking).toBe(true);
    expect(boundary.payload?.capture_metadata.url).toBe(tmEventUrl);
    expect(boundary.payload?.nlu.collected_constraints.source_url).toBe(tmEventUrl);
    // num_tickets must survive the projection so the direct booking task
    // builder can build a non-default seat count.
    expect(boundary.payload?.nlu.collected_constraints.num_tickets).toBe(2);
  });

  it("subdomain impersonation TM URL does NOT trigger run_direct_booking even when scenario=activity is asserted", () => {
    // Defense-in-depth: even if upstream NLU/host hint somehow flagged
    // activity for an impersonation host, the direct-provider parser
    // must reject the URL so the task boundary falls back to the normal
    // confirmation path (or stays in review). This is the load-bearing
    // safety contract the founder explicitly re-flagged.
    const evilUrl = "https://www.ticketmaster.com.evil.example/the-lion-king/event/Z1r9";
    const captureBypass = captureFixture({
      source: {
        type: "url",
        raw_text: evilUrl,
        url: evilUrl,
        host: "www.ticketmaster.com.evil.example",
        captured_at: capturedAt,
      },
      classification: {
        scenario: "activity",
        categories: ["activity"],
        confidence: 0.7,
        direct_booking: false,
      },
      entities: {
        activity: {
          event_name: "The Lion King",
          event_type: "theater",
          city: "New York",
          event_date: "2026-05-30",
          num_tickets: 1,
        },
      },
      constraints: { source_url: evilUrl },
    });
    const boundary = buildCaptureTaskBoundary(captureBypass);
    // Boundary should still complete the path (entities are filled), but
    // it must NOT take the run_direct_booking shortcut for an
    // impersonation URL. Either show_confirmation (because entity fields
    // satisfy required) or review_capture is fine — what's NOT fine is
    // run_direct_booking pointing at the impersonation URL.
    expect(boundary.nextAction).not.toBe("run_direct_booking");
  });

  it("Ticketmaster /artist/ (non-event) URL does NOT trigger run_direct_booking", () => {
    const artistUrl =
      "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581";
    const cap = captureFixture({
      source: {
        type: "url",
        raw_text: artistUrl,
        url: artistUrl,
        host: "www.ticketmaster.com",
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
          event_name: "The Lion King",
          event_type: "theater",
          city: "New York",
          event_date: "2026-05-30",
          num_tickets: 1,
        },
      },
      constraints: { source_url: artistUrl },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.nextAction).not.toBe("run_direct_booking");
    // /artist/ is the calendar landing page, not a booking lock — the
    // boundary should fall through to the regular confirm path because
    // entities are complete.
    expect(boundary.nextAction).toBe("show_confirmation");
  });

  it("Ticketmaster /event/ URL on a locale TLD (.co.uk) triggers run_direct_booking", () => {
    const ukUrl = "https://www.ticketmaster.co.uk/event/AAAAAA1B0";
    const cap = captureFixture({
      source: {
        type: "url",
        raw_text: ukUrl,
        url: ukUrl,
        host: "www.ticketmaster.co.uk",
        captured_at: capturedAt,
      },
      classification: {
        scenario: "activity",
        categories: ["activity"],
        confidence: 0.78,
        direct_booking: false,
      },
      entities: {
        activity: {
          event_name: "Show",
          event_type: "theater",
          city: "London",
          event_date: "2026-06-15",
          num_tickets: 1,
        },
      },
      constraints: { source_url: ukUrl },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(true);
    expect(boundary.nextAction).toBe("run_direct_booking");
    expect(boundary.payload?.capture_metadata.url).toBe(ukUrl);
  });

  it("trailing chat text after the event id does not corrupt the preserved URL", () => {
    // Pre-existing parser already handles this; pin it through the full
    // pipeline so any future capture builder change cannot reintroduce a
    // leak of trailing chat tokens into the executor task URL.
    const baseUrl = "https://www.ticketmaster.com/example/event/1B0063739937BB85";
    const message = `${baseUrl},帮我预定一下这个`;
    const cap = captureFixture({
      source: {
        type: "url",
        raw_text: message,
        url: baseUrl,
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
          event_name: "Match",
          event_type: "sports",
          city: "Nashville",
          event_date: "2026-05-09",
          num_tickets: 1,
        },
      },
      constraints: { source_url: baseUrl },
    });
    const direct = parseDirectActivityProviderUrl(cap.constraints.source_url);
    expect(direct?.url).toBe(baseUrl);
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(true);
    expect(boundary.nextAction).toBe("run_direct_booking");
    // The boundary's `_capture_source` is what's written to constraints
    // for the downstream booking task — it must point at the cleaned
    // event URL, not the raw_text with the trailing chat tokens.
    const captureSource = boundary.payload?.nlu.collected_constraints._capture_source as
      | { url?: string; original_input?: string }
      | undefined;
    expect(captureSource?.url).toBe(baseUrl);
    expect(captureSource?.original_input).toBe(message);
  });

  it("readDirectActivityProviderUrlFromConstraints rejects impersonation in any of the source fields", () => {
    // Defense-in-depth across all the keys the boundary inspects.
    const evil = "https://ticketmaster.com.evil.example/event/abc";
    expect(readDirectActivityProviderUrlFromConstraints({ source_url: evil })).toBeNull();
    expect(readDirectActivityProviderUrlFromConstraints({ event_url: evil })).toBeNull();
    expect(readDirectActivityProviderUrlFromConstraints({ provider_url: evil })).toBeNull();
    expect(readDirectActivityProviderUrlFromConstraints({ booking_link: evil })).toBeNull();
    expect(readDirectActivityProviderUrlFromConstraints({ startUrl: evil })).toBeNull();
    expect(
      readDirectActivityProviderUrlFromConstraints({
        _capture_source: { url: evil },
      }),
    ).toBeNull();
  });
});

// ─── B. Activity vs trip collapse — end-to-end + sports / concert pin ───

describe("activity vs trip collapse — pipeline coverage beyond Lion King", () => {
  it("the routing matrix passes 60+ fixtures end-to-end (normalize -> route)", () => {
    const matrix = evaluateNluRoutingMatrix();
    const failures = matrix.filter((row) => !row.pass);
    expect(failures, `failed: ${failures.map((f) => f.id + " (" + f.notes.join("; ") + ")").join(", ")}`).toEqual([]);
    expect(matrix.length).toBeGreaterThanOrEqual(NLU_ROUTING_FIXTURES.length);
  });

  it("Knicks sports ticket request lands on activity confirm card with sports event_type", () => {
    const matrix = evaluateNluRoutingMatrix();
    const row = matrix.find((r) => r.id === "en-activity-knicks");
    expect(row, "Knicks fixture present").toBeDefined();
    expect(row!.pass).toBe(true);
    expect(row!.scenario).toBe("activity");
    expect(row!.actionType).toBe("show_confirm_card");
    expect(row!.kind).toBe("plan");
  });

  it("Sabrina Carpenter concert ticket request lands on activity confirm card", () => {
    const matrix = evaluateNluRoutingMatrix();
    const row = matrix.find((r) => r.id === "en-activity-concert-budget");
    expect(row, "concert fixture present").toBeDefined();
    expect(row!.pass).toBe(true);
    expect(row!.scenario).toBe("activity");
    expect(row!.actionType).toBe("show_confirm_card");
  });

  it("Hamilton complete request (zh + en) stays activity, not trip", () => {
    const matrix = evaluateNluRoutingMatrix();
    for (const id of ["zh-activity-hamilton-complete", "en-activity-hamilton-complete"]) {
      const row = matrix.find((r) => r.id === id);
      expect(row, `fixture ${id} exists`).toBeDefined();
      expect(row!.pass, `notes: ${row!.notes.join("; ")}`).toBe(true);
      expect(row!.scenario).toBe("activity");
    }
  });

  it("legitimate multi-day Broadway-included trip stays trip (does not collapse to activity)", () => {
    const matrix = evaluateNluRoutingMatrix();
    const row = matrix.find((r) => r.id === "en-trip-lion-king-explicit-trip");
    expect(row, "explicit-trip fixture present").toBeDefined();
    expect(row!.pass).toBe(true);
    expect(row!.scenario).toBe("trip");
    expect(row!.kind).toBe("trip");
  });

  it("activity capture preserves event_type=sports through the boundary projection", () => {
    const activity: ActivityFields = {
      event_name: "Knicks vs Celtics",
      event_type: "sports",
      city: "New York",
      event_date: "2026-05-18",
      num_tickets: 2,
    };
    const cap = captureFixture({
      classification: {
        scenario: "activity",
        categories: ["activity"],
        confidence: 0.9,
        direct_booking: false,
      },
      entities: { activity },
      constraints: {
        event_name: activity.event_name,
        city: activity.city,
        event_date: activity.event_date,
        num_tickets: activity.num_tickets,
      },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(true);
    expect(boundary.nextAction).toBe("show_confirmation");
    expect(boundary.payload?.nlu.collected_constraints.event_type).toBe("sports");
    expect(boundary.payload?.nlu.collected_constraints.num_tickets).toBe(2);
  });
});

// ─── C. Screenshot detector under/over-trigger Chinese coverage ────────

describe("detectCaptureSource — Chinese screenshot vs travel phrasing", () => {
  it("does NOT classify '美丽的图片' inside ordinary travel phrasing as screenshot", () => {
    // Pre-existing demonstrative-gated regex correctly avoids this. Pin
    // the contract so a future Chinese-recall expansion does not silently
    // re-introduce the bare-substring overmatch.
    expect(
      detectCaptureSource("我想去看看那座城市美丽的图片里出现的酒店", capturedAt).type,
    ).not.toBe("screenshot");
  });

  it("does NOT classify '城市的照片' inside ordinary travel phrasing as screenshot", () => {
    expect(
      detectCaptureSource("纽约这个城市的照片我都很喜欢，帮我订个酒店", capturedAt).type,
    ).not.toBe("screenshot");
  });

  it("does classify '这张图片' as a screenshot reference", () => {
    expect(
      detectCaptureSource("这张图片里的酒店帮我订一下", capturedAt).type,
    ).toBe("screenshot");
  });

  it("does classify '附件里的截图' as a screenshot reference", () => {
    expect(
      detectCaptureSource("附件里的截图就是这家餐厅", capturedAt).type,
    ).toBe("screenshot");
  });

  it("does classify a HEIC iPhone photo filename as a screenshot reference", () => {
    expect(
      detectCaptureSource("hotel-lobby.heic", capturedAt).type,
    ).toBe("screenshot");
  });
});

// ─── D. Hotel / flight / restaurant constraint preservation ─────────────

describe("buildCaptureTaskBoundary — constraint preservation through projection", () => {
  it("hotel: city, check_in, check_out, guests, star_rating, budget_max_per_night all survive the payload", () => {
    const hotel: HotelFields = {
      city: "New York",
      check_in: "2026-05-20",
      check_out: "2026-05-24",
      guests: 2,
      star_rating: 4,
      budget_max_per_night: 300,
    };
    const cap = captureFixture({
      classification: {
        scenario: "hotel",
        categories: ["hotel"],
        confidence: 0.9,
        direct_booking: false,
      },
      entities: { hotel },
      constraints: {
        city: hotel.city,
        check_in: hotel.check_in,
        check_out: hotel.check_out,
        guests: hotel.guests,
        // legacy alias path: the constraint set may have already renamed
        star_rating: hotel.star_rating,
        budget_max_per_night: hotel.budget_max_per_night,
      },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(true);
    expect(boundary.nextAction).toBe("show_confirmation");
    const c = boundary.payload!.nlu.collected_constraints;
    expect(c.city).toBe("New York");
    expect(c.check_in).toBe("2026-05-20");
    expect(c.check_out).toBe("2026-05-24");
    expect(c.guests).toBe(2);
    // entities.hotel.star_rating renames to "stars" via flattenCaptureEntities;
    // budget_max_per_night flows through unchanged.
    expect(c.stars).toBe(4);
    expect(c.budget_max_per_night).toBe(300);
  });

  it("flight: round-trip + cabin_class + return_date + passengers all survive", () => {
    const flight: FlightFields = {
      origin: "SFO",
      dest: "JFK",
      date: "2026-06-01",
      return_date: "2026-06-05",
      is_round_trip: true,
      passengers: 2,
      cabin_class: "business",
    };
    const cap = captureFixture({
      classification: {
        scenario: "flight",
        categories: ["flight"],
        confidence: 0.9,
        direct_booking: false,
      },
      entities: { flight },
      constraints: {
        origin: flight.origin,
        dest: flight.dest,
        departure_date: flight.date,
        return_date: flight.return_date,
        is_round_trip: flight.is_round_trip,
        passengers: flight.passengers,
        cabin_class: flight.cabin_class,
      },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(true);
    const c = boundary.payload!.nlu.collected_constraints;
    expect(c.origin).toBe("SFO");
    expect(c.dest).toBe("JFK");
    // entities.flight.date renames to "departure_date" in the projection.
    expect(c.departure_date).toBe("2026-06-01");
    expect(c.return_date).toBe("2026-06-05");
    expect(c.is_round_trip).toBe(true);
    expect(c.passengers).toBe(2);
    expect(c.cabin_class).toBe("business");
  });

  it("restaurant: cuisine, dietary, budget_per_person, party_size, time, date all survive", () => {
    const restaurant: RestaurantFields = {
      city: "Seattle",
      date: "2026-05-13",
      time: "19:00",
      party_size: 4,
      cuisine: "Vegan",
      budget_per_person: 60,
      dietary: ["vegan", "no shellfish"],
    };
    const cap = captureFixture({
      classification: {
        scenario: "restaurant",
        categories: ["restaurant"],
        confidence: 0.9,
        direct_booking: false,
      },
      entities: { restaurant },
      constraints: { ...restaurant },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(true);
    const c = boundary.payload!.nlu.collected_constraints;
    expect(c.cuisine).toBe("Vegan");
    expect(c.party_size).toBe(4);
    expect(c.time).toBe("19:00");
    expect(c.date).toBe("2026-05-13");
    expect(c.budget_per_person).toBe(60);
    expect(c.dietary).toEqual(["vegan", "no shellfish"]);
  });

  it("trip: nights satisfies the date_range gate AND nights value reaches the payload constraints", () => {
    const cap = captureFixture({
      classification: {
        scenario: "trip",
        categories: ["hotel", "flight", "restaurant", "activity"],
        confidence: 0.92,
        direct_booking: false,
      },
      entities: {
        trip: {
          destination_city: "New York",
          departure_city: "Nashville",
          start_date: "2026-06-01",
          // end_date is intentionally undefined; nights is the gate.
          nights: 3,
          travelers: 2,
          activities: ["Broadway show"],
          cuisine_preferences: ["Chinese"],
          vibe: "mixed",
          planning_assumptions: [],
        },
      },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(true);
    expect(boundary.payload?.kind).toBe("trip");
    const c = boundary.payload!.nlu.collected_constraints;
    expect(c.destination_city).toBe("New York");
    expect(c.departure_city).toBe("Nashville");
    expect(c.start_date).toBe("2026-06-01");
    expect(c.nights).toBe(3);
    expect(c.travelers).toBe(2);
    expect(c.cuisine_preferences).toEqual(["Chinese"]);
  });

  it("hotel: missing check_out without nights blocks the confirmation payload", () => {
    // Negative pin: when neither check_out nor nights is set, the
    // boundary must NOT confirm (preserve the strict check).
    const cap = captureFixture({
      classification: {
        scenario: "hotel",
        categories: ["hotel"],
        confidence: 0.85,
        direct_booking: false,
      },
      entities: {
        hotel: {
          city: "New York",
          check_in: "2026-05-20",
          guests: 2,
        },
      },
      missing_fields: ["check_out"],
      task_readiness: {
        ready: false,
        reason: "missing_fields",
        next_missing_fields: ["check_out"],
      },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(false);
    expect(boundary.nextAction).toBe("ask_clarification");
    expect(boundary.missingFields).toContain("check_out");
    expect(boundary.payload).toBeUndefined();
  });

  it("flight: missing origin or date blocks the confirmation payload", () => {
    const cap = captureFixture({
      classification: {
        scenario: "flight",
        categories: ["flight"],
        confidence: 0.85,
        direct_booking: false,
      },
      entities: {
        flight: {
          dest: "JFK",
          passengers: 1,
        },
      },
      missing_fields: ["origin", "departure_date"],
      task_readiness: {
        ready: false,
        reason: "missing_fields",
        next_missing_fields: ["origin", "departure_date"],
      },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(false);
    expect(boundary.nextAction).toBe("ask_clarification");
    expect(boundary.missingFields).toEqual(
      expect.arrayContaining(["origin"]),
    );
    expect(boundary.payload).toBeUndefined();
  });

  it("trip: missing traveler_count blocks the confirmation payload (does not weaken to pass)", () => {
    const cap = captureFixture({
      classification: {
        scenario: "trip",
        categories: ["hotel", "flight", "restaurant", "activity"],
        confidence: 0.85,
        direct_booking: false,
      },
      entities: {
        trip: {
          destination_city: "New York",
          departure_city: "Nashville",
          start_date: "2026-06-01",
          end_date: "2026-06-04",
          // travelers intentionally omitted; the strictness must hold.
          activities: [],
          cuisine_preferences: [],
          vibe: "mixed",
          planning_assumptions: [],
        },
      },
      missing_fields: ["traveler_count"],
      task_readiness: {
        ready: false,
        reason: "missing_fields",
        next_missing_fields: ["traveler_count"],
      },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(false);
    expect(boundary.missingFields).toContain("traveler_count");
    expect(boundary.payload).toBeUndefined();
  });

  it("restaurant: cuisine-only search keeps direct_booking=false (does not promote to direct)", () => {
    // Already pinned for capture builder; pin again at the boundary level
    // so the projection cannot re-introduce the bug downstream.
    const cap = captureFixture({
      classification: {
        scenario: "restaurant",
        categories: ["restaurant"],
        confidence: 0.9,
        direct_booking: false,
      },
      entities: {
        restaurant: {
          city: "New York",
          date: "2026-05-13",
          time: "19:00",
          party_size: 2,
          cuisine: "Sichuan",
        },
      },
      constraints: {
        city: "New York",
        date: "2026-05-13",
        time: "19:00",
        party_size: 2,
        cuisine: "Sichuan",
      },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.payload?.nlu.direct_booking).toBeUndefined();
    expect(boundary.payload?.nlu.collected_constraints.cuisine).toBe("Sichuan");
    // restaurant_name must NOT be invented just because the path was open.
    const restEntity = boundary.payload?.nlu.__v2_state?.restaurant;
    expect(restEntity?.restaurant_name).toBeUndefined();
  });
});

// ─── E. NluCategory normalization for trip and single-category ──────────

describe("buildCaptureTaskBoundary — categories normalization", () => {
  it("trip without explicit 4-category list normalizes to all-four in the payload", () => {
    const cap = captureFixture({
      classification: {
        scenario: "trip",
        // emulate a degenerate state where only one category leaked through
        categories: ["hotel"] as NluCategory[],
        confidence: 0.85,
        direct_booking: false,
      },
      entities: {
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
      },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(true);
    expect(boundary.payload?.nlu.categories).toEqual([
      "hotel",
      "flight",
      "restaurant",
      "activity",
    ]);
  });

  it("single-category capture without explicit categories list normalizes to scenario only", () => {
    const cap = captureFixture({
      classification: {
        scenario: "activity",
        categories: [] as NluCategory[],
        confidence: 0.85,
        direct_booking: false,
      },
      entities: {
        activity: {
          event_name: "Hamilton",
          event_type: "theater",
          city: "New York",
          event_date: "2026-06-01",
          num_tickets: 2,
        },
      },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(true);
    expect(boundary.payload?.nlu.categories).toEqual(["activity"]);
  });
});
