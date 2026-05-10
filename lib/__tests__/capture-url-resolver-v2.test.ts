import { describe, expect, it } from "vitest";
import {
  normalizeTravelUrl,
  resolveTravelLinkFromUrl,
  titleizeTravelSlug,
} from "@/lib/capture/travel-link-resolver";
import {
  buildDirectActivityTask,
  parseDirectActivityProviderUrl,
} from "@/lib/capture/direct-provider-url";
import {
  buildCaptureTravelObjectFromNlu,
  detectCaptureSource,
  extractAllCaptureUrls,
  type CaptureTravelObject,
} from "@/lib/capture/travel-object";
import { buildCaptureTaskBoundary } from "@/lib/capture/task-boundary";
import type {
  IntentState,
  NluV2ParseResult,
  RouterAction,
} from "@/lib/agent/nlu-v2";

// URL Resolver V2 — homepage capture entry-point hardening.
//
// The resolver (`resolveTravelLinkFromUrl`) and the direct-booking thin
// adapter (`parseDirectActivityProviderUrl`) are already in lib/capture
// (commits 28d3e27, eda495d, 24e1142, 041045f, dc98911, b3d631c on the
// codex/stage0-capture-mvp base). This file is a comprehensive no-live
// fixture pass: 50+ tests pinning the resolver against the URL classes
// the founder explicitly listed plus impersonation, scheme, and edge
// cases. Each fixture asserts the documented evidence shape:
//
//   provider, vertical, page_type, provider_page_id, title_hint,
//   confidence, execution_mode, needs_user_choice, safe_next_action,
//   evidence.{source, matched_pattern, title_source}
//
// Existing pinned contracts in sibling files (this file does not
// duplicate them):
//   - lib/__tests__/direct-provider-url.test.ts: 14 tests covering the
//     thin adapter + buildDirectActivityTask provider-aware copy.
//   - lib/__tests__/capture-direct-provider-v2.test.ts: 23 tests
//     covering multi-URL gate + Eventbrite/SeatGeek non-direct pin +
//     TM regression.
//   - lib/__tests__/capture-nlu-stage0-hardening.test.ts: URL trim,
//     boundary projection, screenshot precision.
//
// All tests are deterministic. No live OpenAI / provider / browser /
// payment / login / OTP / final-confirm.

const capturedAt = "2026-05-07T17:00:00.000Z";

// ─── Helpers ─────────────────────────────────────────────────────────

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

// ─── A. Ticketmaster: /event/, /artist/, /search ────────────────────

describe("URL Resolver V2 — Ticketmaster", () => {
  it("Lil Wayne /artist/ with double ?ac_link= preserves the URL through resolver", () => {
    const url =
      "https://www.ticketmaster.com/lil-wayne-tickets/artist/712214?ac_link=ursa_84359098-9ebf-4cbc-a046-9d852562c3bd_a_712214?ac_link=iccp_hp_t3_fallback_K8vZ917GemV";
    const r = resolveTravelLinkFromUrl(url);
    expect(r).not.toBeNull();
    expect(r!).toMatchObject({
      provider: "ticketmaster",
      vertical: "activity",
      page_type: "artist",
      provider_page_id: "712214",
      title_hint: "Lil Wayne",
      execution_mode: "provider_start",
      needs_user_choice: true,
      safe_next_action: "start_task",
    });
    expect(r!.evidence).toMatchObject({
      source: "url_pattern",
      matched_pattern: "ticketmaster_artist",
      title_source: "slug",
    });
    expect(r!.normalized_url).toBe(url);
  });

  it.each([
    [
      "Kacey Musgraves",
      "https://www.ticketmaster.com/kacey-musgraves-tickets/artist/1668663?ac_link=ursa_abcdef",
      "1668663",
      "Kacey Musgraves",
    ],
    [
      "Foster The People",
      "https://www.ticketmaster.com/foster-the-people-tickets/artist/1478293?ac_link=ursa_abcdef",
      "1478293",
      "Foster The People",
    ],
    [
      "Westminster Kennel Club Dog Show",
      "https://www.ticketmaster.com/westminster-kennel-club-dog-show-tickets/artist/847597",
      "847597",
      "Westminster Kennel Club Dog Show",
    ],
    [
      "Monster Jam",
      "https://www.ticketmaster.com/monster-jam-tickets/artist/1542376",
      "1542376",
      "Monster Jam",
    ],
    [
      "Disney On Ice with find-your-tickets slug",
      "https://www.ticketmaster.com/disney-on-ice-presents-find-your-tickets/artist/1742147",
      "1742147",
      "Disney On Ice Presents",
    ],
  ])("classifies Ticketmaster /artist/ for %s", (_label, url, id, title) => {
    const r = resolveTravelLinkFromUrl(url);
    expect(r).not.toBeNull();
    expect(r!.provider).toBe("ticketmaster");
    expect(r!.page_type).toBe("artist");
    expect(r!.provider_page_id).toBe(id);
    expect(r!.title_hint).toBe(title);
    expect(r!.execution_mode).toBe("provider_start");
    expect(r!.needs_user_choice).toBe(true);
    expect(r!.evidence.matched_pattern).toBe("ticketmaster_artist");
  });

  it("classifies a clean Ticketmaster /event/ as exact_event direct_execution", () => {
    const url =
      "https://www.ticketmaster.com/the-lion-king-new-york-ny-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea";
    const r = resolveTravelLinkFromUrl(url);
    expect(r).not.toBeNull();
    expect(r!).toMatchObject({
      provider: "ticketmaster",
      page_type: "exact_event",
      provider_page_id: "Z1r9uZrrZbpZ1Avr9ea",
      execution_mode: "direct_execution",
      needs_user_choice: false,
    });
    expect(r!.evidence.matched_pattern).toBe("ticketmaster_event");
  });

  it("classifies Ticketmaster /search as search_results provider_start", () => {
    const r = resolveTravelLinkFromUrl(
      "https://www.ticketmaster.com/search?q=lil%20wayne",
    );
    expect(r).not.toBeNull();
    expect(r!).toMatchObject({
      provider: "ticketmaster",
      page_type: "search_results",
      execution_mode: "provider_start",
      needs_user_choice: true,
    });
    expect(r!.evidence.matched_pattern).toBe("ticketmaster_search");
  });

  it("classifies a Ticketmaster generic listing as provider_listing provider_start", () => {
    const r = resolveTravelLinkFromUrl(
      "https://www.ticketmaster.com/category/concerts",
    );
    expect(r).not.toBeNull();
    expect(r!.provider).toBe("ticketmaster");
    expect(r!.page_type).toBe("provider_listing");
    expect(r!.execution_mode).toBe("provider_start");
    expect(r!.needs_user_choice).toBe(true);
    expect(r!.evidence.matched_pattern).toBe("ticketmaster_provider_listing");
  });

  it("accepts Ticketmaster apex (no www) and locale TLDs for /event/", () => {
    expect(
      resolveTravelLinkFromUrl("https://ticketmaster.com/foo/event/abc")?.provider_page_id,
    ).toBe("abc");
    expect(
      resolveTravelLinkFromUrl("https://www.ticketmaster.co.uk/event/abc123")?.provider_page_id,
    ).toBe("abc123");
    expect(
      resolveTravelLinkFromUrl("https://www.ticketmaster.ca/foo/event/G5viZbMC_uDmA")?.provider_page_id,
    ).toBe("G5viZbMC_uDmA");
  });

  it("accepts Ticketmaster checkout/payments subdomains", () => {
    expect(
      resolveTravelLinkFromUrl("https://checkout.ticketmaster.com/cart/event/abc")?.provider,
    ).toBe("ticketmaster");
  });
});

// ─── B. StubHub: /performer/, /grouping/ ─────────────────────────────

describe("URL Resolver V2 — StubHub", () => {
  it.each([
    [
      "Olivia Rodrigo",
      "https://www.stubhub.com/olivia-rodrigo-tickets/performer/101864867",
      "performer",
      "101864867",
      "Olivia Rodrigo",
      "stubhub_performer",
    ],
    [
      "BTS",
      "https://www.stubhub.com/bts-tickets/performer/1503185",
      "performer",
      "1503185",
      "BTS",
      "stubhub_performer",
    ],
    [
      "World Cup grouping",
      "https://www.stubhub.com/world-cup-tickets/grouping/45410",
      "grouping",
      "45410",
      "World Cup",
      "stubhub_grouping",
    ],
    [
      "NBA Playoffs grouping",
      "https://www.stubhub.com/nba-playoffs-tickets/grouping/107517",
      "grouping",
      "107517",
      "NBA Playoffs",
      "stubhub_grouping",
    ],
  ])(
    "classifies StubHub %s as %s provider_start with title hint",
    (_label, url, pageType, id, title, matched) => {
      const r = resolveTravelLinkFromUrl(url);
      expect(r).not.toBeNull();
      expect(r!.provider).toBe("stubhub");
      expect(r!.page_type).toBe(pageType);
      expect(r!.provider_page_id).toBe(id);
      expect(r!.title_hint).toBe(title);
      expect(r!.execution_mode).toBe("provider_start");
      expect(r!.needs_user_choice).toBe(true);
      expect(r!.evidence.matched_pattern).toBe(matched);
    },
  );

  it("StubHub generic listing falls through to provider_listing", () => {
    const r = resolveTravelLinkFromUrl("https://www.stubhub.com/concerts");
    expect(r).not.toBeNull();
    expect(r!.provider).toBe("stubhub");
    expect(r!.page_type).toBe("provider_listing");
    expect(r!.execution_mode).toBe("provider_start");
    expect(r!.needs_user_choice).toBe(true);
    expect(r!.evidence.matched_pattern).toBe("stubhub_listing");
  });

  it("StubHub apex (no www) /performer/ still resolves", () => {
    const r = resolveTravelLinkFromUrl(
      "https://stubhub.com/foo-tickets/performer/12345",
    );
    expect(r?.provider).toBe("stubhub");
    expect(r?.page_type).toBe("performer");
    expect(r?.provider_page_id).toBe("12345");
  });
});

// ─── C. SeatGeek: dated event vs listing ────────────────────────────

describe("URL Resolver V2 — SeatGeek", () => {
  it.each([
    [
      "Nashville SC dated MLS event",
      "https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493?aid=ref",
      "17921493",
      "Nashville Sc",
      "seatgeek_dated_event",
    ],
    [
      "Chris Stapleton concert with venue+date in segment 1",
      "https://seatgeek.com/chris-stapleton-tickets/nashville-tennessee-nissan-stadium-2026-05-23-6-pm/concert/17990981?aid=ref",
      "17990981",
      "Chris Stapleton",
      "seatgeek_dated_event",
    ],
    [
      "Leanne Morgan comedy dated event",
      "https://seatgeek.com/leanne-morgan-tickets/comedy/2026-12-11-7-pm/18140651?aid=ref",
      "18140651",
      "Leanne Morgan",
      "seatgeek_dated_event",
    ],
  ])(
    "classifies SeatGeek dated event %s as exact_event direct_execution",
    (_label, url, id, title, matched) => {
      const r = resolveTravelLinkFromUrl(url);
      expect(r).not.toBeNull();
      expect(r!.provider).toBe("seatgeek");
      expect(r!.page_type).toBe("exact_event");
      expect(r!.provider_page_id).toBe(id);
      expect(r!.title_hint).toBe(title);
      expect(r!.execution_mode).toBe("direct_execution");
      expect(r!.needs_user_choice).toBe(false);
      expect(r!.evidence.matched_pattern).toBe(matched);
    },
  );

  it.each([
    [
      "The R and B Tour listing",
      "https://seatgeek.com/the-r-and-b-tour-tickets?aid=ref",
      "the-r-and-b-tour-tickets",
    ],
    [
      "Hamilton listing",
      "https://seatgeek.com/hamilton-tickets?aid=ref",
      "hamilton-tickets",
    ],
  ])(
    "classifies SeatGeek listing %s as provider_listing provider_start (no claimed event)",
    (_label, url, expectedSegmentId) => {
      const r = resolveTravelLinkFromUrl(url);
      expect(r).not.toBeNull();
      expect(r!.provider).toBe("seatgeek");
      expect(r!.page_type).toBe("provider_listing");
      expect(r!.provider_page_id).toBe(expectedSegmentId);
      expect(r!.execution_mode).toBe("provider_start");
      expect(r!.needs_user_choice).toBe(true);
      expect(r!.evidence.matched_pattern).toBe("seatgeek_listing");
    },
  );

  it("SeatGeek 5-digit ID without date still treated as listing (defensive)", () => {
    // The resolver requires BOTH a 5+ digit segment AND a date-shaped
    // segment to escalate to exact_event. Without the date confirmation
    // we hold on the listing path so a generic numeric segment cannot
    // be misinterpreted as a confirmed event.
    const r = resolveTravelLinkFromUrl("https://seatgeek.com/foo-tickets/12345");
    expect(r?.execution_mode).toBe("provider_start");
    expect(r?.page_type).toBe("provider_listing");
  });

  it("SeatGeek dated event with no surrounding query string still resolves", () => {
    const r = resolveTravelLinkFromUrl(
      "https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493",
    );
    expect(r?.execution_mode).toBe("direct_execution");
    expect(r?.provider_page_id).toBe("17921493");
  });

  it("SeatGeek date with am suffix matches the date regex", () => {
    const r = resolveTravelLinkFromUrl(
      "https://seatgeek.com/early-show-tickets/comedy/2026-04-01-11-am/18234567",
    );
    expect(r?.execution_mode).toBe("direct_execution");
    expect(r?.provider_page_id).toBe("18234567");
  });

  it("SeatGeek root host with no path → provider_listing", () => {
    const r = resolveTravelLinkFromUrl("https://seatgeek.com/");
    expect(r?.provider).toBe("seatgeek");
    expect(r?.page_type).toBe("provider_listing");
  });
});

// ─── D. Eventbrite ──────────────────────────────────────────────────

describe("URL Resolver V2 — Eventbrite", () => {
  it("Eventbrite /e/<slug>-tickets-<id> classifies as exact_event direct_execution", () => {
    const r = resolveTravelLinkFromUrl(
      "https://www.eventbrite.com/e/example-event-tickets-987654321012",
    );
    expect(r).not.toBeNull();
    expect(r!.provider).toBe("eventbrite");
    expect(r!.page_type).toBe("exact_event");
    expect(r!.provider_page_id).toBe("987654321012");
    expect(r!.execution_mode).toBe("direct_execution");
    expect(r!.evidence.matched_pattern).toBe("eventbrite_event");
  });

  it("Eventbrite /e/<slug>-<id> (no 'tickets-' prefix) still resolves the trailing id", () => {
    const r = resolveTravelLinkFromUrl(
      "https://www.eventbrite.com/e/example-event-987654321012",
    );
    expect(r?.execution_mode).toBe("direct_execution");
    expect(r?.provider_page_id).toBe("987654321012");
  });

  it("Eventbrite /e/<slug> without numeric id falls through to provider_listing", () => {
    const r = resolveTravelLinkFromUrl(
      "https://www.eventbrite.com/e/some-event-without-id",
    );
    expect(r?.execution_mode).toBe("provider_start");
    expect(r?.page_type).toBe("provider_listing");
  });

  it("Eventbrite /d/ city directory falls through to provider_listing", () => {
    const r = resolveTravelLinkFromUrl(
      "https://www.eventbrite.com/d/ny--new-york/events/",
    );
    expect(r?.provider).toBe("eventbrite");
    expect(r?.page_type).toBe("provider_listing");
    expect(r?.execution_mode).toBe("provider_start");
  });

  it("Eventbrite root host falls through to provider_listing", () => {
    const r = resolveTravelLinkFromUrl("https://www.eventbrite.com/");
    expect(r?.page_type).toBe("provider_listing");
    expect(r?.execution_mode).toBe("provider_start");
  });
});

// ─── E. Impersonation guards ────────────────────────────────────────

describe("URL Resolver V2 — impersonation rejection", () => {
  it.each([
    ["TM subdomain attack apex.evil", "https://ticketmaster.com.evil.example/event/abc"],
    [
      "TM subdomain attack on artist",
      "https://ticketmaster.com.evil.example/artist/12345",
    ],
    [
      "SeatGeek subdomain attack",
      "https://seatgeek.com.evil.example/the-r-and-b-tour-tickets/2026-05-09/12345",
    ],
    [
      "StubHub subdomain attack",
      "https://stubhub.com.evil.example/olivia-rodrigo-tickets/performer/12345",
    ],
    [
      "Eventbrite subdomain attack",
      "https://eventbrite.com.evil.example/e/some-tickets-12345",
    ],
    [
      "TM hyphen-prefix lookalike",
      "https://ticketmaster-impersonator.com/event/abc",
    ],
    ["TM 'not' prefix lookalike", "https://notticketmaster.com/event/abc"],
    ["TM concatenated lookalike", "https://wwwticketmaster.com/event/abc"],
    [
      "SeatGeek dash-suffix lookalike",
      "https://seatgeek-impersonator.com/foo-tickets/concert/12345",
    ],
  ])("classifies %s as unknown_provider_page review_capture", (_label, url) => {
    const r = resolveTravelLinkFromUrl(url);
    expect(r).not.toBeNull();
    expect(r!.provider).toBe("unknown");
    expect(r!.page_type).toBe("unknown_provider_page");
    expect(r!.execution_mode).toBe("review_capture");
    expect(r!.needs_user_choice).toBe(true);
    expect(r!.safe_next_action).toBe("review_capture");
    expect(r!.evidence.matched_pattern).toBe("unknown_host");
  });

  it("impersonation URLs do NOT pass parseDirectActivityProviderUrl", () => {
    // Defense-in-depth: even if a caller chains the resolver into the
    // direct-booking adapter, an impersonation URL must return null so
    // run_direct_booking cannot fire against an attacker-controlled
    // host. Pinned because the spec says "Guard impersonation".
    const evilHosts = [
      "https://ticketmaster.com.evil.example/event/abc",
      "https://seatgeek.com.evil.example/foo/concert/12345",
      "https://stubhub.com.evil.example/performer/12345",
      "https://ticketmaster-impersonator.com/artist/12345",
    ];
    for (const url of evilHosts) {
      expect(parseDirectActivityProviderUrl(url), url).toBeNull();
    }
  });
});

// ─── F. Non-http schemes & malformed input ──────────────────────────

describe("URL Resolver V2 — scheme guard and malformed input", () => {
  it.each([
    ["javascript: scheme", "javascript:alert(1)"],
    ["data: scheme", "data:text/html,<h1>x</h1>"],
    [
      "data: with TM-shaped payload",
      "data:text/html,<a href='https://www.ticketmaster.com/event/abc'>x</a>",
    ],
    ["mailto: scheme", "mailto:foo@example.com"],
    ["tel: scheme", "tel:+18005551212"],
    ["ftp: scheme", "ftp://files.example.com/event/abc"],
    ["file: scheme", "file:///c:/event/abc"],
    ["raw text", "book this for me"],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["non-string input", 12345 as unknown as string],
  ])("returns null for %s", (_label, value) => {
    expect(resolveTravelLinkFromUrl(value)).toBeNull();
    expect(parseDirectActivityProviderUrl(value)).toBeNull();
  });

  it("normalizeTravelUrl rejects non-http schemes and returns null", () => {
    expect(normalizeTravelUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeTravelUrl("data:text/plain,foo")).toBeNull();
    expect(normalizeTravelUrl("ftp://files.example.com/foo")).toBeNull();
  });

  it("normalizeTravelUrl tolerates the 'ttps://' typo and recovers to https://", () => {
    const out = normalizeTravelUrl(
      "ttps://www.ticketmaster.com/event/abc",
    );
    expect(out?.hostname).toBe("www.ticketmaster.com");
    expect(out?.url.startsWith("https://")).toBe(true);
  });
});

// ─── G. URL hygiene & query / hash preservation ──────────────────────

describe("URL Resolver V2 — URL hygiene", () => {
  it("preserves query string on /event/ exact match", () => {
    const r = resolveTravelLinkFromUrl(
      "https://www.ticketmaster.com/foo/event/Z1r9?ref=email&utm=x",
    );
    expect(r?.normalized_url).toContain("?ref=email&utm=x");
  });

  it("preserves query string on /artist/ provider_start", () => {
    const r = resolveTravelLinkFromUrl(
      "https://www.ticketmaster.com/foo-tickets/artist/12345?ac_link=x",
    );
    expect(r?.normalized_url).toContain("?ac_link=x");
  });

  it("hash fragment survives on /event/ resolution", () => {
    const r = resolveTravelLinkFromUrl(
      "https://www.ticketmaster.com/foo/event/Z1r9#tickets",
    );
    expect(r?.normalized_url).toContain("#tickets");
  });

  it("uppercase host is normalized to lowercase", () => {
    const r = resolveTravelLinkFromUrl(
      "https://WWW.TICKETMASTER.COM/FOO/event/ABC",
    );
    expect(r?.host).toBe("www.ticketmaster.com");
    expect(r?.provider).toBe("ticketmaster");
  });

  it("event id keeps its mixed-case characters intact", () => {
    const r = resolveTravelLinkFromUrl(
      "https://www.ticketmaster.com/foo/event/Z1r9uZrrZbpZ1Avr9ea",
    );
    expect(r?.provider_page_id).toBe("Z1r9uZrrZbpZ1Avr9ea");
  });
});

// ─── H. Title hint hygiene ─────────────────────────────────────────

describe("URL Resolver V2 — title hint hygiene", () => {
  it("titleizeTravelSlug uppercases acronyms in its allow list", () => {
    expect(titleizeTravelSlug("nba-playoffs")).toBe("NBA Playoffs");
    expect(titleizeTravelSlug("mls-cup")).toBe("MLS Cup");
    expect(titleizeTravelSlug("bts-world-tour")).toBe("BTS World Tour");
  });

  it("titleizeTravelSlug strips trailing -tickets / -events / -artist / etc.", () => {
    expect(titleizeTravelSlug("hamilton-tickets")).toBe("Hamilton");
    expect(titleizeTravelSlug("foo-events")).toBe("Foo");
    expect(titleizeTravelSlug("bar-find-your-tickets")).toBe("Bar");
  });

  it("titleizeTravelSlug returns empty string for empty input", () => {
    expect(titleizeTravelSlug("")).toBe("");
  });

  it("Ticketmaster /artist/ title_hint matches the slug-titleized name", () => {
    const r = resolveTravelLinkFromUrl(
      "https://www.ticketmaster.com/sabrina-carpenter-tickets/artist/2932128?aff=x",
    );
    expect(r?.title_hint).toBe("Sabrina Carpenter");
  });
});

// ─── I. Capture pipeline integration ────────────────────────────────

describe("URL Resolver V2 — capture pipeline integration", () => {
  it("pasting a TM /artist/ URL produces capture with scenario=activity and source.url preserved exact", () => {
    const url =
      "https://www.ticketmaster.com/lil-wayne-tickets/artist/712214?ac_link=ursa_abc";
    const capture = buildCaptureTravelObjectFromNlu({
      message: url,
      result: fallbackResultWithoutState(),
      capturedAt,
    });
    expect(capture.source.type).toBe("url");
    expect(capture.source.url).toBe(url);
    expect(capture.classification.scenario).toBe("activity");
  });

  it("pasting a SeatGeek dated event URL with Chinese trailing text strips trailing punctuation", () => {
    const cleanUrl =
      "https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493";
    const message = `${cleanUrl},帮我预定一下`;
    const src = detectCaptureSource(message, capturedAt);
    expect(src.type).toBe("url");
    expect(src.url).toBe(cleanUrl);
    const r = resolveTravelLinkFromUrl(src.url!);
    expect(r?.execution_mode).toBe("direct_execution");
    expect(r?.provider).toBe("seatgeek");
  });

  it("pasting a StubHub /performer/ URL with English trailing punctuation strips '.'", () => {
    const cleanUrl =
      "https://www.stubhub.com/olivia-rodrigo-tickets/performer/101864867";
    const src = detectCaptureSource(`Book this please ${cleanUrl}.`, capturedAt);
    expect(src.url).toBe(cleanUrl);
    const r = resolveTravelLinkFromUrl(src.url!);
    expect(r?.page_type).toBe("performer");
    expect(r?.execution_mode).toBe("provider_start");
  });

  it("multi-URL homepage message keeps both URLs in extractAllCaptureUrls (regression)", () => {
    const a = "https://www.ticketmaster.com/foo/event/AAA";
    const b = "https://www.ticketmaster.com/bar/event/BBB";
    const urls = extractAllCaptureUrls(`Compare ${a} and ${b}`);
    expect(urls).toEqual([a, b]);
  });

  it("TM /artist/ URL through buildCaptureTaskBoundary triggers run_direct_booking with provider-start copy", () => {
    const url =
      "https://www.ticketmaster.com/sabrina-carpenter-tickets/artist/2932128";
    const cap = captureFixture({
      source: {
        type: "url",
        raw_text: url,
        url,
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
          event_name: "Sabrina Carpenter",
          event_type: "concert",
          city: "New York",
          event_date: "2026-06-15",
          num_tickets: 1,
        },
      },
      constraints: { source_url: url },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(true);
    expect(boundary.nextAction).toBe("run_direct_booking");
    expect(boundary.payload?.nlu.collected_constraints.source_url).toBe(url);
  });

  it("StubHub /performer/ URL through boundary also reaches run_direct_booking and the executor task says StubHub, not Ticketmaster", () => {
    const url =
      "https://www.stubhub.com/olivia-rodrigo-tickets/performer/101864867";
    const cap = captureFixture({
      source: {
        type: "url",
        raw_text: url,
        url,
        host: "www.stubhub.com",
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
          event_name: "Olivia Rodrigo",
          event_type: "concert",
          city: "New York",
          event_date: "2026-06-15",
          num_tickets: 1,
        },
      },
      constraints: { source_url: url },
    });
    const boundary = buildCaptureTaskBoundary(cap);
    expect(boundary.ok).toBe(true);
    expect(boundary.nextAction).toBe("run_direct_booking");

    // Negative pin: the task copy for StubHub must NOT mention
    // Ticketmaster. This is the founder-flagged "non-Ticketmaster
    // links do not produce Ticketmaster-specific prompt/copy" rule.
    const task = buildDirectActivityTask({
      eventName: "Olivia Rodrigo",
      numTickets: 1,
      providerUrl: url,
      provider: "stubhub",
      pageType: "performer",
    });
    expect(task).toContain("Start from this exact StubHub performer page URL");
    expect(task).toContain("unrelated StubHub page");
    expect(task).not.toContain("Ticketmaster");
  });

  it("SeatGeek dated event task copy says SeatGeek, not Ticketmaster", () => {
    const url =
      "https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493";
    const task = buildDirectActivityTask({
      eventName: "Nashville SC v DC United",
      eventDate: "2026-05-09",
      numTickets: 1,
      providerUrl: url,
      provider: "seatgeek",
      pageType: "event",
    });
    expect(task).toContain("Use this exact SeatGeek event URL");
    expect(task).toContain("Do not search for or replace it with a different SeatGeek event URL");
    expect(task).not.toContain("Ticketmaster");
  });

  it("Eventbrite event task copy says Eventbrite, not Ticketmaster", () => {
    const url = "https://www.eventbrite.com/e/some-event-tickets-987654321012";
    const task = buildDirectActivityTask({
      eventName: "Some Event",
      eventDate: "2026-06-01",
      numTickets: 2,
      providerUrl: url,
      provider: "eventbrite",
      pageType: "event",
    });
    expect(task).toContain("Use this exact Eventbrite event URL");
    expect(task).not.toContain("Ticketmaster");
    expect(task).not.toContain("StubHub");
  });
});

// ─── J. Direct-booking adapter cross-checks ─────────────────────────

describe("URL Resolver V2 — direct booking adapter parity with resolver", () => {
  it.each([
    [
      "TM event",
      "https://www.ticketmaster.com/foo/event/abc",
      "ticketmaster",
      "event",
      "direct_execution",
    ],
    [
      "TM artist",
      "https://www.ticketmaster.com/foo-tickets/artist/12345",
      "ticketmaster",
      "artist",
      "provider_start",
    ],
    [
      "StubHub performer",
      "https://www.stubhub.com/foo-tickets/performer/12345",
      "stubhub",
      "performer",
      "provider_start",
    ],
    [
      "StubHub grouping",
      "https://www.stubhub.com/foo-tickets/grouping/12345",
      "stubhub",
      "grouping",
      "provider_start",
    ],
    [
      "SeatGeek dated event",
      "https://seatgeek.com/foo-tickets/concert/2026-06-01-7-pm/18234567",
      "seatgeek",
      "event",
      "direct_execution",
    ],
    [
      "SeatGeek listing",
      "https://seatgeek.com/foo-tickets",
      "seatgeek",
      "listing",
      "provider_start",
    ],
    [
      "Eventbrite event",
      "https://www.eventbrite.com/e/some-event-tickets-987654321012",
      "eventbrite",
      "event",
      "direct_execution",
    ],
  ])(
    "parseDirectActivityProviderUrl maps %s correctly",
    (_label, url, provider, pageType, execution) => {
      const direct = parseDirectActivityProviderUrl(url);
      expect(direct, url).not.toBeNull();
      expect(direct!.provider).toBe(provider);
      expect(direct!.pageType).toBe(pageType);
      expect(direct!.executionMode).toBe(execution);
    },
  );

  it("resolver and adapter agree on impersonation rejection (resolver returns unknown; adapter returns null)", () => {
    const evil = "https://ticketmaster.com.evil.example/event/abc";
    const r = resolveTravelLinkFromUrl(evil);
    expect(r?.provider).toBe("unknown");
    expect(parseDirectActivityProviderUrl(evil)).toBeNull();
  });
});
