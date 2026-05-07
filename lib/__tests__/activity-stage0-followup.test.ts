import { describe, expect, it } from "vitest";

import {
  drawerMatchesTarget,
  isTicketmasterTicketOptionsPage,
  pickPrimaryTicketmasterUrl,
  type TargetDateTime,
} from "@/lib/booking-autopilot/providers/ticketmaster-rpa";
import { isTicketmasterDomainUrl } from "@/lib/booking-autopilot/providers/ticketmaster-status";
import {
  evaluateNluRoutingMatrix,
  NLU_ROUTING_FIXTURES,
} from "@/lib/agent/nlu-v2/routing-matrix";
import { normalizeSingleActivityTicketRequest } from "@/lib/agent/nlu-v2/unified";
import { routeIntent } from "@/lib/agent/nlu-v2/router";
import type { IntentState } from "@/lib/agent/nlu-v2";

// Stage 0 Activity / Ticketmaster reliability follow-up.
//
// Existing coverage already pins (this file does not duplicate them):
//   - drawerMatchesTarget month/day/time semantics + Wicked/Hamilton no-target
//     fallback + day=20 vs year=2026 false positive guard
//     (`ticketmaster-runtime-hardening.test.ts`)
//   - pickPrimaryTicketmasterUrl checkout > event > artist > auth precedence
//     (`ticketmaster-runtime-hardening.test.ts`)
//   - lib <-> worker mirror byte equality (`ticketmaster-runtime-hardening.test.ts`)
//   - 6-state task classifier full chain to TravelTaskState
//     (`ticketmaster-status-mapping.test.ts`)
//   - normalizeSingleActivityTicketRequest narrow trip-shape collapse
//     (`activity-ticket-normalization.test.ts`)
//   - Routing matrix Lion King zh + en trip-shaped fixtures
//     (`routing-matrix.ts`)
//
// This file adds regressions for the four bug classes the founder explicitly
// re-flagged after the 2026-05-07 dogfood:
//
//   A) Lion King / Broadway trip-shape collapse must not regress as the
//      pipeline grows — pin via the routing-matrix evaluator (full
//      normalize -> route path), not just the inner normalizer.
//   B) Drawer date / time guard edges (ordinal "1st", abbreviated month
//      with period, slug-style date markers, time-only-rescue).
//   C) External ad tab / non-Ticketmaster active tab classification edge
//      cases (impersonation lookalikes, near-brand domains).
//   D) Seat-selection and account/session checkpoints stay deterministic
//      around pure-helper inputs the executor passes in.

// ─── A. Lion King / Broadway end-to-end pipeline ────────────────────────

describe("activity routing matrix — Lion King / Broadway must collapse to activity, not trip missing-fields", () => {
  it("zh-activity-lion-king-trip-shaped fixture passes (normalize -> route)", () => {
    const matrix = evaluateNluRoutingMatrix();
    const row = matrix.find((r) => r.id === "zh-activity-lion-king-trip-shaped");
    expect(row, "fixture exists in routing matrix").toBeDefined();
    expect(row!.pass, `notes: ${row!.notes.join(" | ")}`).toBe(true);
    expect(row!.scenario).toBe("activity");
    expect(row!.actionType).toBe("show_confirm_card");
    expect(row!.kind).toBe("plan");
    expect(row!.missing).toEqual([]);
  });

  it("en-activity-lion-king-trip-shaped fixture passes (normalize -> route)", () => {
    const matrix = evaluateNluRoutingMatrix();
    const row = matrix.find((r) => r.id === "en-activity-lion-king-trip-shaped");
    expect(row, "fixture exists in routing matrix").toBeDefined();
    expect(row!.pass, `notes: ${row!.notes.join(" | ")}`).toBe(true);
    expect(row!.scenario).toBe("activity");
    expect(row!.actionType).toBe("show_confirm_card");
  });

  it("trip-shape collapse for any show name reaches the activity confirm card via state.trip.activities", () => {
    // Even when the message names a show the inferActivityEventName helper
    // does not hard-code (only Lion King + Hamilton are hard-coded), the
    // collapse must still succeed when the LLM populated trip.activities[0]
    // with the show name and trip.destination_city + trip.start_date are
    // present. This pins the firstString(trip.activities) fallback.
    const state: IntentState = {
      confidence: 0.9,
      turn_count: 1,
      updated_at: "2026-05-07T00:00:00Z",
      intent: "create_plan",
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      party_type: "solo",
      member_names: [],
      refined_target_id: null,
      planning_assumptions: [],
      trip: {
        destination_city: "Chicago",
        start_date: "2026-06-03",
        activities: ["Wicked"],
        cuisine_preferences: [],
        vibe: "mixed",
        planning_assumptions: [],
      },
    };
    const out = normalizeSingleActivityTicketRequest(
      state,
      "buy two Wicked tickets in Chicago on June 3",
      "old trip reply",
    );
    expect(out.state.scenario).toBe("activity");
    expect(out.state.categories).toEqual(["activity"]);
    expect(out.state.activity?.event_name).toBe("Wicked");
    expect(out.state.activity?.city).toBe("Chicago");
    expect(out.state.activity?.event_date).toBe("2026-06-03");
    expect(out.state.trip).toBeUndefined();
    const action = routeIntent(out.state);
    expect(action.type).toBe("show_confirm_card");
    if (action.type === "show_confirm_card") {
      expect(action.kind).toBe("plan");
    }
  });

  it("explicit trip phrasing keeps trip path even when a show name is mentioned", () => {
    // Symmetric guard: if the user clearly asks for a multi-day trip
    // (the looksLikeSingleActivityTicketRequest function rejects on
    // trip cue), the Lion King mention should NOT collapse to activity.
    const state: IntentState = {
      confidence: 0.9,
      turn_count: 1,
      updated_at: "2026-05-07T00:00:00Z",
      intent: "create_plan",
      scenario: "trip",
      categories: ["hotel", "flight", "restaurant", "activity"],
      party_type: "solo",
      member_names: [],
      refined_target_id: null,
      planning_assumptions: [],
      trip: {
        destination_city: "New York",
        start_date: "2026-06-01",
        end_date: "2026-06-04",
        travelers: 2,
        activities: ["The Lion King"],
        cuisine_preferences: [],
        vibe: "mixed",
        planning_assumptions: [],
      },
    };
    const out = normalizeSingleActivityTicketRequest(
      state,
      "Plan a 4-day trip to New York with Lion King, hotel and restaurant",
      "old trip reply",
    );
    expect(out.state.scenario).toBe("trip");
    expect(out.state.trip).toBeDefined();
  });

  it("the entire NLU routing matrix continues to pass (60+ fixtures)", () => {
    // Catch-all so any new bug class that affects a different fixture
    // shows up alongside the targeted Lion King assertions above.
    const matrix = evaluateNluRoutingMatrix();
    const failures = matrix.filter((row) => !row.pass);
    expect(failures, `routing-matrix fail rows: ${failures.map((f) => f.id + " — " + f.notes.join("; ")).join(" | ")}`).toEqual([]);
    expect(matrix.length).toBeGreaterThanOrEqual(NLU_ROUTING_FIXTURES.length);
  });
});

// ─── B. Drawer date/time guard — additional edges ─────────────────────────

describe("drawerMatchesTarget — additional date edges from real TM drawer text", () => {
  const may1: TargetDateTime = {
    monthName: "May",
    monthIndex: 4,
    day: 1,
    year: 2026,
    time: "8:00 PM",
  };

  it("matches '1st' ordinal for day=1 (single-digit ordinal)", () => {
    const drawer =
      "Event Information Hamilton New York, NY May 1st 2026 8:00 PM Richard Rodgers Theatre Find Tickets";
    const r = drawerMatchesTarget(drawer, may1);
    expect(r.matches).toBe(true);
    expect(r.reason).toMatch(/^(month_day|month_day_and_time)$/);
  });

  it("matches abbreviated month with trailing period (Sep. / Oct.)", () => {
    const target: TargetDateTime = {
      monthName: "September",
      monthIndex: 8,
      day: 15,
      year: 2026,
      time: "7:30 PM",
    };
    const drawer =
      "Event Information Show Sep. 15, 2026 7:30 PM Theatre Find Tickets";
    const r = drawerMatchesTarget(drawer, target);
    expect(r.matches).toBe(true);
    expect(r.reason).toMatch(/^(month_day|month_day_and_time)$/);
  });

  it("matches when month name is present alongside a slug-style day marker", () => {
    // Realistic drawer scrape: rendered "May 30, 2026" plus the URL slug
    // 'the-lion-king-05-30-2026'. The day regex handles both shapes via
    // either the \b30\b alternative (dashes / slashes are non-word chars
    // so \b applies) or the explicit /30/ and -30- alternatives. The
    // function intentionally REQUIRES a month signal too — slug-only
    // (no month name) is not enough, because slugs alone are not date-
    // accurate (multi-event listings often share the URL slug).
    const target: TargetDateTime = {
      monthName: "May",
      monthIndex: 4,
      day: 30,
      year: 2026,
    };
    const drawerSlash =
      "Event Information May 30, 2026 the-lion-king-05-30-2026 Find Tickets";
    expect(drawerMatchesTarget(drawerSlash, target).matches).toBe(true);
    // Slug-only (no month name) is correctly rejected.
    const drawerSlugOnly =
      "Event Information the-lion-king-05-30-2026 Find Tickets";
    expect(drawerMatchesTarget(drawerSlugOnly, target).matches).toBe(false);
  });

  it("matches dayPadded form '01' (calendar grids and ISO-y month tables)", () => {
    const drawer = "Event Information 2026-05-01 Hamilton 8:00 PM Find Tickets";
    const r = drawerMatchesTarget(drawer, may1);
    expect(r.matches).toBe(true);
  });

  it("does not false-match day=1 inside year '2021' (boundary semantics)", () => {
    // Defensive: \b1\b should not match the trailing '1' of "2021".
    const target: TargetDateTime = {
      monthName: "May",
      monthIndex: 4,
      day: 1,
      year: 2026,
    };
    const drawer = "Event Information Year 2021 Find Tickets";
    expect(drawerMatchesTarget(drawer, target).matches).toBe(false);
  });

  it("documents current behavior: a drawer with mismatched year but matching month+day matches on month_day", () => {
    // Important deliberate semantics — pinned here so a future
    // year-mismatch reject patch is a conscious behavior change, not a
    // surprise regression. Drawers commonly omit the year on TM, so the
    // helper intentionally does NOT use year as a hard gate.
    const target: TargetDateTime = {
      monthName: "May",
      monthIndex: 4,
      day: 30,
      year: 2026,
    };
    const drawer =
      "Event Information The Lion King New York, NY May 30, 2025 2:00 PM Find Tickets";
    const r = drawerMatchesTarget(drawer, target);
    expect(r.matches).toBe(true);
    expect(r.reason).toMatch(/^(month_day|month_day_and_time)$/);
  });
});

// ─── C. External ad tab / impersonation classification ───────────────────

describe("Ticketmaster URL classification — impersonation hardening", () => {
  it("isTicketmasterDomainUrl rejects subdomain-impersonation hosts", () => {
    expect(isTicketmasterDomainUrl("https://ticketmaster.com.evil.example/login")).toBe(false);
    expect(isTicketmasterDomainUrl("https://ticketmaster-impersonator.com/event/abc")).toBe(false);
    expect(isTicketmasterDomainUrl("https://www.tickets-master.com/event/abc")).toBe(false);
    expect(isTicketmasterDomainUrl("https://prefix-ticketmaster.com/foo")).toBe(false);
  });

  it("isTicketmasterDomainUrl accepts apex + every locale TLD we list", () => {
    const apex = [
      "https://ticketmaster.com/foo",
      "https://ticketmaster.ca/foo",
      "https://ticketmaster.co.uk/foo",
      "https://ticketmaster.com.au/foo",
      "https://ticketmaster.de/foo",
      "https://ticketmaster.fr/foo",
      "https://ticketmaster.es/foo",
      "https://ticketmaster.it/foo",
      "https://ticketmaster.nl/foo",
      "https://ticketmaster.ie/foo",
    ];
    for (const url of apex) {
      expect(isTicketmasterDomainUrl(url), url).toBe(true);
    }
    const sub = [
      "https://www.ticketmaster.com/foo",
      "https://m.ticketmaster.com/foo",
      "https://checkout.ticketmaster.com/cart/abc",
      "https://payments.ticketmaster.com/foo",
      "https://auth.ticketmaster.com/identity",
      "https://www.ticketmaster.co.uk/event/123",
    ];
    for (const url of sub) {
      expect(isTicketmasterDomainUrl(url), url).toBe(true);
    }
  });

  it("isTicketmasterTicketOptionsPage rejects subdomain-impersonation event URLs", () => {
    // Pre-fix bug: substring regex /ticketmaster\./i + path includes('/event/')
    // matched "ticketmaster.com.evil.example/event/foo" because the
    // substring "ticketmaster." appears in the malicious host. The function
    // is used by the executor to decide whether the active page is a
    // Ticketmaster ticket-options page; mis-classifying an ad-tab URL as a
    // TM event page can drive subsequent polling against the wrong tab.
    expect(
      isTicketmasterTicketOptionsPage(
        "https://ticketmaster.com.evil.example/event/abc",
      ),
    ).toBe(false);
    expect(
      isTicketmasterTicketOptionsPage(
        "https://ticketmaster-impersonator.com/event/abc",
      ),
    ).toBe(false);
    expect(
      isTicketmasterTicketOptionsPage(
        "https://tickets-master.com/event/abc",
      ),
    ).toBe(false);
  });

  it("isTicketmasterTicketOptionsPage accepts legitimate TM event URLs (apex + www + locale)", () => {
    expect(
      isTicketmasterTicketOptionsPage(
        "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
      ),
    ).toBe(true);
    expect(
      isTicketmasterTicketOptionsPage(
        "https://ticketmaster.com/foo/event/abc",
      ),
    ).toBe(true);
    expect(
      isTicketmasterTicketOptionsPage(
        "https://www.ticketmaster.co.uk/event/abc",
      ),
    ).toBe(true);
    expect(
      isTicketmasterTicketOptionsPage(
        "https://www.ticketmaster.ca/foo/event/abc",
      ),
    ).toBe(true);
  });

  it("isTicketmasterTicketOptionsPage continues to reject artist / landing pages", () => {
    expect(
      isTicketmasterTicketOptionsPage(
        "https://www.ticketmaster.com/the-lion-king-new-york-ny-tickets/artist/1039581",
      ),
    ).toBe(false);
    expect(
      isTicketmasterTicketOptionsPage(
        "https://www.ticketmaster.com/some-show-new-york-tickets/",
      ),
    ).toBe(false);
    expect(
      isTicketmasterTicketOptionsPage(
        "https://auth.ticketmaster.com/as/authorization.oauth2",
      ),
    ).toBe(false);
  });
});

// ─── D. pickPrimaryTicketmasterUrl — recovery URL stability ───────────────

describe("pickPrimaryTicketmasterUrl — recovery URL stability", () => {
  it("when two URLs tie at the same score, returns the first one in input order (stable preference)", () => {
    // Realistic case: two browser windows ended up on the same checkout
    // route. The handoff URL we surface should be the first one the
    // executor observed, not a random pick. JS Array.sort is stable per
    // ECMAScript 2019; this test pins that we depend on the stable
    // contract.
    const urls = [
      "https://checkout.ticketmaster.com/cart/abc",
      "https://checkout.ticketmaster.com/cart/def",
    ];
    expect(pickPrimaryTicketmasterUrl(urls)).toBe(
      "https://checkout.ticketmaster.com/cart/abc",
    );
  });

  it("when no checkout URL is open but multiple /event/ URLs exist, returns the first event URL", () => {
    const urls = [
      "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
      "https://www.ticketmaster.com/hamilton-04-15-2026/event/AAAAAA",
      "https://auth.ticketmaster.com/as/authorization.oauth2",
    ];
    expect(pickPrimaryTicketmasterUrl(urls)).toBe(
      "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    );
  });

  it("real ad-tab handoff: ad URL + auth + event — picks event for the user-visible recovery", () => {
    // Simulates the 2026-05-07 dogfood scenario: active tab is an ad
    // domain, but the original Ticketmaster event window is still open
    // somewhere in the tab list. The recovery URL we surface to the user
    // should be the most actionable TM URL — the event page, not the
    // auth fallback.
    const urls = [
      "https://promo.example-ad.com/landing",
      "https://auth.ticketmaster.com/as/authorization.oauth2",
      "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    ];
    expect(pickPrimaryTicketmasterUrl(urls)).toBe(
      "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    );
  });

  it("malformed URL strings are skipped, not crashed on", () => {
    const urls = [
      "not-a-url",
      "",
      // intentional weird input — must not throw
      "javascript:alert(1)",
      "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    ];
    expect(() => pickPrimaryTicketmasterUrl(urls)).not.toThrow();
    expect(pickPrimaryTicketmasterUrl(urls)).toBe(
      "https://www.ticketmaster.com/the-lion-king-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    );
  });

  it("rejects subdomain-impersonation URL even when it is the only candidate", () => {
    // Defense-in-depth so the recovery URL we hand the user is never an
    // impersonation domain — that would be worse than null.
    expect(
      pickPrimaryTicketmasterUrl([
        "https://ticketmaster.com.evil.example/event/abc",
      ]),
    ).toBeNull();
  });
});
