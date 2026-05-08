import type { LabTestPlanEntry } from "./types";

/**
 * Stage 0B controlled lab — 20-URL test plan.
 *
 * 10 Ticketmaster + 10 SeatGeek URLs spanning artist, listing, exact
 * event, and date-city cases. Each entry pins:
 *
 *   - the intended class the founder/operator wanted exercised,
 *   - the URL the lab runner navigates to (no live calls in this file —
 *     these are inputs, not requests),
 *   - the existing URL Resolver V2 classification we expect (so a no-live
 *     test pins the resolver agrees with the plan author *before* a
 *     harness run starts).
 *
 * URLs were chosen to mirror the real-world examples already used in the
 * URL Resolver V2 fixture suite (lib/__tests__/capture-url-resolver-v2.test.ts)
 * plus founder-listed examples in the v2 task brief. No URL here requires
 * live navigation to score the no-live half of the test plan — the lab
 * harness runs are purely additive for the live half.
 */

export const STAGE0B_TEST_PLAN: ReadonlyArray<LabTestPlanEntry> = Object.freeze([
  // ─── Ticketmaster (10) ──────────────────────────────────────────────
  {
    id: "tm-01",
    provider: "ticketmaster",
    intended_class: "ticketmaster_artist",
    url: "https://www.ticketmaster.com/kacey-musgraves-tickets/artist/1668663?ac_link=ursa_kacey",
    expected_resolver_page_type: "artist",
    expected_resolver_execution_mode: "provider_start",
    reason: "Real /artist/ page with ?ac_link= referral query — confirm resolver preserves URL and surfaces N event candidates for user choice.",
  },
  {
    id: "tm-02",
    provider: "ticketmaster",
    intended_class: "ticketmaster_artist",
    url: "https://www.ticketmaster.com/foster-the-people-tickets/artist/1478293?ac_link=ursa_foster",
    expected_resolver_page_type: "artist",
    expected_resolver_execution_mode: "provider_start",
    reason: "Smaller-tour artist page; expect provider_listing_needs_choice if multiple cities, single_candidate_ready otherwise.",
  },
  {
    id: "tm-03",
    provider: "ticketmaster",
    intended_class: "ticketmaster_artist",
    url: "https://www.ticketmaster.com/westminster-kennel-club-dog-show-tickets/artist/847597",
    expected_resolver_page_type: "artist",
    expected_resolver_execution_mode: "provider_start",
    reason: "Annual single-event artist page — should reach single_candidate_ready when the page renders one date.",
  },
  {
    id: "tm-04",
    provider: "ticketmaster",
    intended_class: "ticketmaster_artist",
    url: "https://www.ticketmaster.com/monster-jam-tickets/artist/1542376",
    expected_resolver_page_type: "artist",
    expected_resolver_execution_mode: "provider_start",
    reason: "Multi-city tour; expect provider_listing_needs_choice with a candidate count.",
  },
  {
    id: "tm-05",
    provider: "ticketmaster",
    intended_class: "ticketmaster_artist",
    url: "https://www.ticketmaster.com/disney-on-ice-presents-find-your-tickets/artist/1742147",
    expected_resolver_page_type: "artist",
    expected_resolver_execution_mode: "provider_start",
    reason: "Slug includes 'find-your-tickets' suffix — verify title hint stays sane and DOM renders normally.",
  },
  {
    id: "tm-06",
    provider: "ticketmaster",
    intended_class: "ticketmaster_event",
    url: "https://www.ticketmaster.com/the-lion-king-new-york-ny-05-30-2026/event/Z1r9uZrrZbpZ1Avr9ea",
    expected_resolver_page_type: "exact_event",
    expected_resolver_execution_mode: "direct_execution",
    reason: "Exact /event/<id> URL — expect exact_event_ready and a clean safe_handoff before seat selection.",
  },
  {
    id: "tm-07",
    provider: "ticketmaster",
    intended_class: "ticketmaster_event",
    url: "https://www.ticketmaster.com/hamilton-new-york-ny-04-15-2026/event/A1B2C3D4E5F6",
    expected_resolver_page_type: "exact_event",
    expected_resolver_execution_mode: "direct_execution",
    reason: "Second exact event in NYC — verify the lab can reach the seat-map handoff for a different show class.",
  },
  {
    id: "tm-08",
    provider: "ticketmaster",
    intended_class: "ticketmaster_search",
    url: "https://www.ticketmaster.com/search?q=lil%20wayne",
    expected_resolver_page_type: "search_results",
    expected_resolver_execution_mode: "provider_start",
    reason: "/search results — should always need user choice; verify the lab does not click the first card silently.",
  },
  {
    id: "tm-09",
    provider: "ticketmaster",
    intended_class: "ticketmaster_listing",
    url: "https://www.ticketmaster.com/category/concerts",
    expected_resolver_page_type: "provider_listing",
    expected_resolver_execution_mode: "provider_start",
    reason: "Category landing page (no /artist/, no /event/) — verify provider_listing_needs_choice and that no exact-event evidence is claimed.",
  },
  {
    id: "tm-10",
    provider: "ticketmaster",
    intended_class: "ticketmaster_artist",
    url: "https://www.ticketmaster.com/sabrina-carpenter-tickets/artist/2932128?ac_link=ursa_sabrina",
    expected_resolver_page_type: "artist",
    expected_resolver_execution_mode: "provider_start",
    reason: "High-demand pop tour — verify lab handles long event lists, paginated dates, and reaches choice without seat-mapping.",
  },

  // ─── SeatGeek (10) ──────────────────────────────────────────────────
  {
    id: "sg-01",
    provider: "seatgeek",
    intended_class: "seatgeek_dated_event",
    url: "https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493?aid=ref",
    expected_resolver_page_type: "exact_event",
    expected_resolver_execution_mode: "direct_execution",
    reason: "Dated MLS event — slug + date segment + numeric id; verify lab reaches safe_handoff.",
  },
  {
    id: "sg-02",
    provider: "seatgeek",
    intended_class: "seatgeek_dated_event",
    url: "https://seatgeek.com/chris-stapleton-tickets/nashville-tennessee-nissan-stadium-2026-05-23-6-pm/concert/17990981?aid=ref",
    expected_resolver_page_type: "exact_event",
    expected_resolver_execution_mode: "direct_execution",
    reason: "Date inside the segment-1 slug (venue-and-date format) — verify resolver still recognizes exact event.",
  },
  {
    id: "sg-03",
    provider: "seatgeek",
    intended_class: "seatgeek_dated_event",
    url: "https://seatgeek.com/leanne-morgan-tickets/comedy/2026-12-11-7-pm/18140651?aid=ref",
    expected_resolver_page_type: "exact_event",
    expected_resolver_execution_mode: "direct_execution",
    reason: "Comedy dated event — verify the safe_handoff arrives before SeatGeek's seat-map iframe loads.",
  },
  {
    id: "sg-04",
    provider: "seatgeek",
    intended_class: "seatgeek_dated_event",
    url: "https://seatgeek.com/early-bird-comedy-tickets/comedy/2026-04-01-11-am/18234567",
    expected_resolver_page_type: "exact_event",
    expected_resolver_execution_mode: "direct_execution",
    reason: "AM-suffix dated event — pin that the lab renders on early-morning shows where the date regex's am branch fires.",
  },
  {
    id: "sg-05",
    provider: "seatgeek",
    intended_class: "seatgeek_listing",
    url: "https://seatgeek.com/the-r-and-b-tour-tickets?aid=ref",
    expected_resolver_page_type: "provider_listing",
    expected_resolver_execution_mode: "provider_start",
    reason: "Tour landing without dates in the URL — expect provider_listing_needs_choice with N city candidates.",
  },
  {
    id: "sg-06",
    provider: "seatgeek",
    intended_class: "seatgeek_listing",
    url: "https://seatgeek.com/hamilton-tickets?aid=ref",
    expected_resolver_page_type: "provider_listing",
    expected_resolver_execution_mode: "provider_start",
    reason: "High-traffic listing — verify the lab does not silently pick a date.",
  },
  {
    id: "sg-07",
    provider: "seatgeek",
    intended_class: "seatgeek_listing",
    url: "https://seatgeek.com/foo-tickets/12345",
    expected_resolver_page_type: "provider_listing",
    expected_resolver_execution_mode: "provider_start",
    reason: "5-digit ID without date — defensive: resolver MUST stay on listing path because no date evidence is present.",
  },
  {
    id: "sg-08",
    provider: "seatgeek",
    intended_class: "seatgeek_listing",
    url: "https://seatgeek.com/",
    expected_resolver_page_type: "provider_listing",
    expected_resolver_execution_mode: "provider_start",
    reason: "Root host (no path) — defensive provider_listing.",
  },
  {
    id: "sg-09",
    provider: "seatgeek",
    intended_class: "seatgeek_dated_event",
    url: "https://seatgeek.com/nashville-sc-tickets/mls/2026-05-09-8-pm/17921493",
    expected_resolver_page_type: "exact_event",
    expected_resolver_execution_mode: "direct_execution",
    reason: "Same as sg-01 but without query string — pin that the lab's behavior does not depend on query params.",
  },
  {
    id: "sg-10",
    provider: "seatgeek",
    intended_class: "seatgeek_dated_event",
    url: "https://seatgeek.com/world-cup-tickets/soccer/2026-06-14-3-pm/18555111?aid=ref",
    expected_resolver_page_type: "exact_event",
    expected_resolver_execution_mode: "direct_execution",
    reason: "Sports dated event — pin behavior on a 2026 World Cup-class URL pattern.",
  },
]);

/**
 * Counts that the runbook + the cockpit cite. Pinned here so a no-live
 * test breaks if someone trims the plan below the founder-stipulated
 * minimums (10 + 10).
 */
export const STAGE0B_PLAN_COUNTS = {
  total: STAGE0B_TEST_PLAN.length,
  ticketmaster: STAGE0B_TEST_PLAN.filter((p) => p.provider === "ticketmaster").length,
  seatgeek: STAGE0B_TEST_PLAN.filter((p) => p.provider === "seatgeek").length,
} as const;
