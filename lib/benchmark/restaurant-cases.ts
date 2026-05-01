/**
 * Seed benchmark cases for NYC restaurant booking — v2 (2026-05-01).
 *
 * 25 cases across 25 unique NYC venues — strict 1-per-restaurant.
 * Distribution by outcome category:
 *   10 OT happy / fallback
 *    5 Resy happy / fallback
 *    1 verify-gate (Resy OTP)
 *    2 OT edge (closed / not_on_network)
 *    1 deep-link handoff (no online booking)
 *    4 unsupported platform (Tock x3, SevenRooms x1)
 *
 * v2 trim history: v1 had 50 cases with 4 Don Angie / 3 Nobu / 3 Modern /
 * 3 Daniel / 4 Misi / 3 King / 3 Rao's variants exercising different
 * party_size / time_window / occasion combos. User requested strict
 * 1-per-restaurant; the kept variant is whichever covers the most
 * representative path (happy with multi-outcome ±0 preferred so that
 * inventory noise doesn't bias the run).
 *
 * All restaurant URLs and expected_provider values verified live on
 * 2026-04-30 by the platform-research agent. Notable findings:
 *   - Estela is OpenTable (rid=212488), NOT Resy
 *   - Don Angie moved Resy → OpenTable in May 2025
 *   - Per Se / Atomix / Aquavit are all on Tock (unsupported)
 *   - Marea is on SevenRooms (unsupported)
 *   - Rao's accepts no online booking (deep-link handoff only)
 *   - Le Bernardin is Resy (HIGH confidence, official site routes there)
 *   - Eleven Madison Park is Resy (moved from Tock)
 *
 * Date guidance: dates are 2026-05-08 → 2026-06-01 (8-32 days out from
 * 2026-04-30). Sub-2-week windows + prime-time exercise the fallback
 * path; >30 day windows test calendar gating.
 */

import type { RestaurantBenchmarkCase } from "./types";

export const RESTAURANT_BENCHMARK_CASES_NYC: RestaurantBenchmarkCase[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // FULLY-AUTOMATED FOCUS SET (cases 001-005, curated 2026-05-01)
  //
  // Five OT-confirmed-bookable venues to stress-test the form-fill chain
  // in isolation. Each is expected to:
  //   1. land on /r/<slug> detail page
  //   2. find a slot at requested time (or ±60 min via C2 ladder)
  //   3. transit through specials/seating-options preflight (B1)
  //   4. hit /booking/details
  //   5. fillGuestForm → firstName=true lastName=true email=true phone=true
  //   6. emit dry_run boundary marker → fully_automated_success=true
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_001",
    city: "New York",
    restaurant_name: "Fumo Soho",
    restaurant_url: "https://www.opentable.com/r/fumo-soho-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-08",
    time: "19:00",
    party_size: 2,
    occasion: "casual_dinner",
    fallback_policy: { time_window_minutes: 60 },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "Italian, Soho. User-confirmed bookable on OpenTable 2026-05-01.",
  },
  {
    case_id: "nyc_restaurant_002",
    city: "New York",
    restaurant_name: "Wild West Village",
    restaurant_url: "https://www.opentable.com/wild-west-village",
    expected_provider: "OpenTable",
    // 2026-05-09 23:00 — user screenshot confirmed 10:15/10:45/11:00 PM
    // available on this exact date. Tests OT vanity URL (no /r/ prefix).
    date: "2026-05-09",
    time: "23:00",
    party_size: 2,
    occasion: "late_night",
    fallback_policy: { time_window_minutes: 60 },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "OT vanity URL; should redirect. Date/time chosen from user screenshot confirming availability.",
  },
  {
    case_id: "nyc_restaurant_003",
    city: "New York",
    restaurant_name: "FOOD",
    restaurant_url: "https://www.opentable.com/r/food-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-09",
    time: "19:00",
    party_size: 2,
    occasion: "casual_dinner",
    fallback_policy: { time_window_minutes: 60 },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "User-confirmed bookable on OpenTable 2026-05-01.",
  },
  {
    case_id: "nyc_restaurant_004",
    city: "New York",
    restaurant_name: "The Clam",
    restaurant_url: "https://www.opentable.com/the-clam",
    expected_provider: "OpenTable",
    date: "2026-05-09",
    time: "22:00",
    party_size: 2,
    occasion: "late_night",
    fallback_policy: { time_window_minutes: 60 },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "OT vanity URL; late-night Saturday slot for max availability.",
  },
  {
    case_id: "nyc_restaurant_005",
    city: "New York",
    restaurant_name: "Mezze on the River",
    restaurant_url: "https://www.opentable.com/r/mezze-on-the-river-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-08",
    time: "19:00",
    party_size: 2,
    occasion: "casual_dinner",
    fallback_policy: { time_window_minutes: 60 },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "User-confirmed bookable on OpenTable 2026-05-01.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // OT HAPPY (peak-time, multi-outcome) — cases 006-009
  //
  // ±0 + peak time: agent should EITHER fully_automate OR correctly
  // identify no_availability. Both count as PASS.
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_006",
    city: "New York",
    restaurant_name: "Don Angie",
    restaurant_url: "https://www.opentable.com/r/don-angie-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-13",
    time: "19:00",
    party_size: 2,
    occasion: "date_night",
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: ["fully_automated", "no_availability"],
    category: "ot_happy",
    notes: "Don Angie OT happy (moved Resy → OT May 2025). ±0 + peak-time = inventory uncertain.",
  },
  {
    case_id: "nyc_restaurant_007",
    city: "New York",
    restaurant_name: "Gramercy Tavern",
    restaurant_url: "https://www.opentable.com/r/gramercy-tavern-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-14",
    time: "18:30",
    party_size: 2,
    occasion: "date_night",
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: ["fully_automated", "no_availability"],
    category: "ot_happy",
    notes: "USHG OT happy. ±0 + peak-time = inventory uncertain.",
  },
  {
    case_id: "nyc_restaurant_008",
    city: "New York",
    restaurant_name: "Nobu Downtown",
    restaurant_url: "https://www.opentable.com/r/nobu-downtown-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-12",
    time: "19:00",
    party_size: 2,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: ["fully_automated", "no_availability"],
    category: "ot_happy",
    notes: "Nobu Downtown happy. ±0 + peak-time = inventory uncertain.",
  },
  {
    case_id: "nyc_restaurant_009",
    city: "New York",
    restaurant_name: "The Modern",
    restaurant_url: "https://www.opentable.com/r/the-modern-dining-room",
    expected_provider: "OpenTable",
    date: "2026-05-15",
    time: "18:30",
    party_size: 2,
    occasion: "date_night",
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: ["fully_automated", "no_availability"],
    category: "ot_happy",
    notes: "MoMA's The Modern (Michelin 1*). USHG, OT primary. ±0 + peak-time = inventory uncertain.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // OT FALLBACK / OT HAPPY — case 010 (Tao ±60), case 011 (Estela)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_010",
    city: "New York",
    restaurant_name: "Tao Downtown",
    restaurant_url: "https://www.opentable.com/r/tao-downtown-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-23",
    time: "20:00",
    party_size: 2,
    fallback_policy: { time_window_minutes: 60 },
    expected_outcome: "fully_automated",
    category: "ot_fallback",
    notes: "Tao Sat 8pm prime — exercises ±60min slot fallback.",
  },
  {
    case_id: "nyc_restaurant_011",
    city: "New York",
    restaurant_name: "Estela",
    restaurant_url: "https://www.opentable.com/r/estela-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-13",
    time: "18:30",
    party_size: 2,
    fallback_policy: { time_window_minutes: 30 },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "Estela is on OpenTable (rid=212488), NOT Resy. Verified 2026-04-30 via estelanyc.com DOM.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // RESY HAPPY — cases 012-016
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_012",
    city: "New York",
    restaurant_name: "Lilia",
    restaurant_url: "https://resy.com/cities/ny/lilia",
    expected_provider: "Resy",
    date: "2026-05-22",
    time: "18:30",
    party_size: 2,
    fallback_policy: { time_window_minutes: 30 },
    expected_outcome: "no_availability",
    category: "resy_happy",
    notes: "Lilia (Williamsburg Italian). 30-day Resy drop, often '~impossible' — no_availability is the realistic happy-path outcome.",
  },
  {
    case_id: "nyc_restaurant_013",
    city: "New York",
    restaurant_name: "Daniel",
    restaurant_url: "https://resy.com/cities/new-york-ny/venues/daniel",
    expected_provider: "Resy",
    date: "2026-05-15",
    time: "19:30",
    party_size: 2,
    occasion: "anniversary",
    preferences: { atmosphere: "fine_dining", cuisine: "french" },
    fallback_policy: { time_window_minutes: 30 },
    expected_outcome: "fully_automated",
    category: "resy_happy",
    notes: "Daniel Boulud (Michelin 2*). Resy-only since 2024.",
  },
  {
    case_id: "nyc_restaurant_014",
    city: "New York",
    restaurant_name: "Misi",
    restaurant_url: "https://resy.com/cities/new-york-ny/venues/misi",
    expected_provider: "Resy",
    date: "2026-05-15",
    time: "18:30",
    party_size: 2,
    fallback_policy: { time_window_minutes: 30 },
    expected_outcome: "no_availability",
    category: "resy_happy",
    notes: "Missy Robbins's Williamsburg sister to Lilia. 30-day Resy drop.",
  },
  {
    case_id: "nyc_restaurant_015",
    city: "New York",
    restaurant_name: "King",
    restaurant_url: "https://resy.com/cities/new-york-ny/venues/king",
    expected_provider: "Resy",
    date: "2026-05-14",
    time: "19:00",
    party_size: 2,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: ["fully_automated", "no_availability"],
    category: "resy_happy",
    notes: "King West Village Mediterranean. 30-day rolling Resy. ±0 + peak-time = inventory uncertain.",
  },
  {
    case_id: "nyc_restaurant_016",
    city: "New York",
    restaurant_name: "Le Bernardin",
    restaurant_url: "https://resy.com/cities/ny/le-bernardin",
    expected_provider: "Resy",
    date: "2026-05-21",
    time: "19:00",
    party_size: 2,
    occasion: "anniversary",
    preferences: { atmosphere: "fine_dining", cuisine: "seafood" },
    fallback_policy: { time_window_minutes: 60 },
    expected_outcome: "no_availability",
    category: "resy_happy",
    notes: "Eric Ripert's Le Bernardin (Michelin 3*). Top-tier prime-time demand → no_availability is the realistic happy-path outcome.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // RESY FALLBACK — case 017 (EMP)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_017",
    city: "New York",
    restaurant_name: "Eleven Madison Park",
    restaurant_url:
      "https://resy.com/cities/new-york-ny/venues/eleven-madison-park",
    expected_provider: "Resy",
    date: "2026-05-23",
    time: "19:30",
    party_size: 2,
    occasion: "anniversary",
    fallback_policy: {
      time_window_minutes: 120,
      allow_platform_switch: true,
    },
    expected_outcome: "no_availability",
    category: "resy_fallback",
    notes: "EMP (Michelin 3*) moved off Tock to Resy. Monthly drop on 1st. Likely deposit/prepayment required. Strict fallback test.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // VERIFY-GATE — case 018 (Cosme Resy OTP)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_018",
    city: "New York",
    restaurant_name: "Cosme",
    restaurant_url: "https://resy.com/cities/ny/cosme",
    expected_provider: "Resy",
    date: "2026-05-23",
    time: "19:00",
    party_size: 4,
    fallback_policy: {
      time_window_minutes: 60,
      allow_platform_switch: true,
    },
    expected_outcome: "verify_gate",
    category: "verify_gate",
    notes: "Cosme verify-gate. Mobile OTP gate is session/cookie/IP/AB-test dependent — agent should fill phone and stop at OTP boundary.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // EDGE — case 019 (L'Artusi not_on_network), 020 (Carbone closed)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_019",
    city: "New York",
    restaurant_name: "L'Artusi",
    restaurant_url: "https://www.opentable.com/r/lartusi-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-19",
    time: "19:00",
    party_size: 4,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "no_availability",
    category: "edge_not_on_network",
    notes: "L'Artusi not_on_network — exercises the 'venue not available on OT' classifier.",
  },
  {
    case_id: "nyc_restaurant_020",
    city: "New York",
    restaurant_name: "Carbone",
    restaurant_url: "https://www.opentable.com/r/carbone-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-23",
    time: "19:00",
    party_size: 2,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "no_availability",
    category: "edge_closed",
    notes: "Carbone permanently closed — exercises the 'venue closed' classifier without false-positiving on cancellation-policy text.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DEEP-LINK HANDOFF — case 021 (Rao's no online booking)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_021",
    city: "New York",
    restaurant_name: "Rao's",
    expected_provider: "no_online",
    date: "2026-05-15",
    time: "19:00",
    party_size: 2,
    occasion: "celebration",
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "deep_link_handoff",
    category: "handoff_no_online",
    notes:
      "Rao's (East Harlem, founded 1896) accepts NO online bookings. Tables effectively private property of long-standing regulars. Agent should hand off to user (provide phone 212-722-6709 or restaurant page link), not attempt OT/Resy form-fill.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // UNSUPPORTED PLATFORM — cases 022-025 (Tock x3, SevenRooms x1)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_022",
    city: "New York",
    restaurant_name: "Per Se",
    restaurant_url: "https://www.exploretock.com/perse",
    expected_provider: "Tock",
    date: "2026-05-15",
    time: "19:00",
    party_size: 2,
    occasion: "celebration",
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "unsupported_platform",
    category: "unsupported_tock",
    notes:
      "Thomas Keller's Per Se (Michelin 3*). Tock-only, prepaid tasting menu ($390pp). Onegent doesn't support Tock — agent should classify as unsupported_platform and hand off cleanly.",
  },
  {
    case_id: "nyc_restaurant_023",
    city: "New York",
    restaurant_name: "Atomix",
    restaurant_url: "https://www.exploretock.com/atomixnyc/",
    expected_provider: "Tock",
    date: "2026-05-15",
    time: "19:00",
    party_size: 2,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "unsupported_platform",
    category: "unsupported_tock",
    notes: "Atomix Korean (Michelin 2*). Tock-only, prepaid tasting + deposit.",
  },
  {
    case_id: "nyc_restaurant_024",
    city: "New York",
    restaurant_name: "Aquavit",
    restaurant_url: "https://www.exploretock.com/aquavit/",
    expected_provider: "Tock",
    date: "2026-05-15",
    time: "19:00",
    party_size: 2,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "unsupported_platform",
    category: "unsupported_tock",
    notes: "Aquavit Scandinavian (Michelin 1*). Tock-only, monthly drop on 1st 3pm.",
  },
  {
    case_id: "nyc_restaurant_025",
    city: "New York",
    restaurant_name: "Marea",
    restaurant_url:
      "https://www.sevenrooms.com/explore/marea/reservations/create/search?venues=marea,aifiori,53",
    expected_provider: "SevenRooms",
    date: "2026-05-15",
    time: "19:00",
    party_size: 2,
    occasion: "anniversary",
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "unsupported_platform",
    category: "unsupported_sevenrooms",
    notes:
      "Marea Italian seafood (Michelin 1*, Altamarea Group). SevenRooms — only restaurant in this dataset on SR. Tests that the executor recognises a different unsupported platform, not just Tock.",
  },
];

/** Get all cases for the canonical NYC restaurant scenario. */
export function getRestaurantBenchmarkCases(): RestaurantBenchmarkCase[] {
  return RESTAURANT_BENCHMARK_CASES_NYC;
}

/** Look up one case by case_id (for replay / debugging). */
export function getRestaurantBenchmarkCase(
  caseId: string,
): RestaurantBenchmarkCase | null {
  return RESTAURANT_BENCHMARK_CASES_NYC.find((c) => c.case_id === caseId) ?? null;
}
