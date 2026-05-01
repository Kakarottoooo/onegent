/**
 * Seed benchmark cases for NYC restaurant booking — v1 (2026-04-30).
 *
 * 50 cases across 19 NYC venues, distributed by outcome category:
 *   13 OT happy        4 Tock/SevenRooms unsupported_platform
 *   11 Resy happy       3 Rao's no_online handoff
 *    9 fallback         2 Cosme verify_gate
 *    8 edge cases
 *
 * All restaurant URLs and expected_provider values were verified live on
 * 2026-04-30 by the platform-research agent (see PROJECT_SUMMARY.md).
 * Notable findings vs initial guess:
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
  // FULLY-AUTOMATED FOCUS SET (cases 001-005, 2026-05-01)
  //
  // User curated these 5 OT-confirmed-bookable venues to stress-test the
  // form-fill chain in isolation — without the no_availability cases
  // diluting the signal. Each is expected to:
  //   1. land on /r/<slug> detail page
  //   2. find a slot at requested time (or ±60 min via C2 ladder)
  //   3. transit through specials/seating-options preflight (B1)
  //   4. hit /booking/details
  //   5. fillGuestForm → firstName=true lastName=true email=true phone=true
  //   6. emit dry_run boundary marker → fully_automated_success=true
  //
  // The 13 OT-happy / 11 Resy-happy / 9 fallback / 8 edge / 4 unsupported /
  // 3 handoff / 2 verify-gate cases below remain unchanged for the v1
  // baseline; only the first 5 slots got swapped to focus the signal.
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
    fallback_policy: {
      time_window_minutes: 60,
      allow_platform_switch: false,
      allow_venue_switch: false,
      require_user_approval_before_booking: false,
    },
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
    // 2026-05-09 23:00 — user screenshot 2026-05-01 confirmed
    // 10:15/10:45/11:00 PM available on this exact date.
    date: "2026-05-09",
    time: "23:00",
    party_size: 2,
    occasion: "late_night",
    fallback_policy: {
      time_window_minutes: 60,
      allow_platform_switch: false,
      allow_venue_switch: false,
      require_user_approval_before_booking: false,
    },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "OT vanity URL (no /r/ prefix); should redirect. Date/time chosen from user screenshot confirming availability.",
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
    fallback_policy: {
      time_window_minutes: 60,
      allow_platform_switch: false,
      allow_venue_switch: false,
      require_user_approval_before_booking: false,
    },
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
    // Late-night Saturday slot to maximise availability — pairs with case
    // 002 in stress-testing OT vanity-URL path on confirmed-bookable dates.
    date: "2026-05-09",
    time: "22:00",
    party_size: 2,
    occasion: "late_night",
    fallback_policy: {
      time_window_minutes: 60,
      allow_platform_switch: false,
      allow_venue_switch: false,
      require_user_approval_before_booking: false,
    },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "OT vanity URL (no /r/ prefix); late-night Saturday slot for max availability.",
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
    fallback_policy: {
      time_window_minutes: 60,
      allow_platform_switch: false,
      allow_venue_switch: false,
      require_user_approval_before_booking: false,
    },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "User-confirmed bookable on OpenTable 2026-05-01.",
  },
  {
    case_id: "nyc_restaurant_003",
    city: "New York",
    restaurant_name: "Carbone",
    restaurant_url: "https://www.opentable.com/r/carbone-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-13",
    time: "20:00",
    party_size: 4,
    occasion: "friends_dinner",
    fallback_policy: {
      time_window_minutes: 30,
      allow_platform_switch: false,
      allow_venue_switch: false,
      require_user_approval_before_booking: false,
    },
    expected_outcome: "no_availability",
    category: "edge_closed",
    notes:
      "Carbone detail page exists but renders 'Permanently Closed'. Should classify as no_availability in <15s. (Edge case despite case_id range; was an early seed case.)",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // RESY HAPPY PATH (11 cases)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_004",
    city: "New York",
    restaurant_name: "Lilia",
    restaurant_url: "https://resy.com/cities/ny/lilia",
    expected_provider: "Resy",
    date: "2026-05-15",
    time: "19:00",
    party_size: 2,
    occasion: "date_night",
    fallback_policy: {
      time_window_minutes: 0,
      allow_platform_switch: false,
      allow_venue_switch: false,
      require_user_approval_before_booking: false,
    },
    expected_outcome: "no_availability",
    category: "resy_happy",
    notes:
      "Williamsburg Italian Resy baseline. Probes Resy login/cookie flow + cities/ny/<slug> redirect. Often full at prime; expected_outcome=no_availability acceptable.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // VERIFY-GATE (Cosme — 2 cases)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_005",
    city: "New York",
    restaurant_name: "Cosme",
    restaurant_url: "https://resy.com/cities/ny/cosme",
    expected_provider: "Resy",
    date: "2026-05-16",
    time: "19:30",
    party_size: 2,
    occasion: "celebration",
    fallback_policy: {
      time_window_minutes: 90,
      allow_platform_switch: true,
      allow_venue_switch: false,
      require_user_approval_before_booking: false,
    },
    expected_outcome: "verify_gate",
    category: "verify_gate",
    notes:
      "Resy enforces mobile phone OTP gate on guest checkout for this venue. Benchmark .test phone numbers cannot receive SMS, so executor cannot pass the gate. Real prod users with Resy account or real phone bypass this.",
  },

  // ─── Don Angie (OT, moved from Resy May 2025) — 3 happy + 1 fallback ──
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
    notes:
      "Don Angie OT happy. ±0 + peak-time = inventory uncertain. Either fully_automated (slot open) or no_availability (slot full, correctly identified) counts as PASS.",
  },
  {
    case_id: "nyc_restaurant_007",
    city: "New York",
    restaurant_name: "Don Angie",
    restaurant_url: "https://www.opentable.com/r/don-angie-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-20",
    time: "19:30",
    party_size: 4,
    occasion: "friends_dinner",
    fallback_policy: { time_window_minutes: 30 },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "Don Angie OT happy, party=4 variant.",
  },
  {
    case_id: "nyc_restaurant_008",
    city: "New York",
    restaurant_name: "Don Angie (legacy Resy URL)",
    restaurant_url: "https://resy.com/cities/ny/don-angie",
    expected_provider: "Resy",
    date: "2026-05-13",
    time: "19:00",
    party_size: 2,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "no_availability",
    category: "edge_platform_moved",
    notes:
      "Don Angie moved Resy → OpenTable in May 2025. Old Resy URL should resolve to a venue-not-found / 404 / redirect — agent must classify as no_availability or recover by searching OpenTable, not flap on a missing booking widget.",
  },

  // ─── Gramercy Tavern (OT) — 2 happy ───────────────────────────────────
  {
    case_id: "nyc_restaurant_009",
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
    notes:
      "USHG OT happy. ±0 + peak-time = inventory uncertain (USHG reservations very competitive). Either outcome counts as PASS.",
  },
  {
    case_id: "nyc_restaurant_010",
    city: "New York",
    restaurant_name: "Gramercy Tavern",
    restaurant_url: "https://www.opentable.com/r/gramercy-tavern-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-21",
    time: "19:00",
    party_size: 4,
    occasion: "celebration",
    fallback_policy: { time_window_minutes: 30 },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "Gramercy Tavern OT happy, party=4.",
  },

  // ─── Nobu Downtown (OT) — 3 happy ─────────────────────────────────────
  {
    case_id: "nyc_restaurant_011",
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
    notes:
      "Nobu Downtown happy, party=2. ±0 + peak-time = inventory uncertain. Either outcome counts as PASS.",
  },
  {
    case_id: "nyc_restaurant_012",
    city: "New York",
    restaurant_name: "Nobu Downtown",
    restaurant_url: "https://www.opentable.com/r/nobu-downtown-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-19",
    time: "18:30",
    party_size: 4,
    fallback_policy: { time_window_minutes: 30 },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "Nobu Downtown happy, party=4.",
  },
  {
    case_id: "nyc_restaurant_013",
    city: "New York",
    restaurant_name: "Nobu Downtown",
    restaurant_url: "https://www.opentable.com/r/nobu-downtown-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-26",
    time: "19:30",
    party_size: 6,
    fallback_policy: { time_window_minutes: 30 },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "Nobu Downtown happy, party=6 (large group path).",
  },

  // ─── The Modern (OT) — 2 happy + 1 fallback ───────────────────────────
  {
    case_id: "nyc_restaurant_014",
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
    notes:
      "MoMA's The Modern (Michelin 1*). USHG, OT primary. ±0 + peak-time = inventory uncertain. Either outcome counts as PASS.",
  },
  {
    case_id: "nyc_restaurant_015",
    city: "New York",
    restaurant_name: "The Modern",
    restaurant_url: "https://www.opentable.com/r/the-modern-dining-room",
    expected_provider: "OpenTable",
    date: "2026-05-22",
    time: "19:00",
    party_size: 4,
    fallback_policy: { time_window_minutes: 30 },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "The Modern happy, party=4.",
  },
  {
    case_id: "nyc_restaurant_016",
    city: "New York",
    restaurant_name: "The Modern",
    restaurant_url: "https://www.opentable.com/r/the-modern-dining-room",
    expected_provider: "OpenTable",
    date: "2026-05-09",
    time: "19:00",
    party_size: 2,
    fallback_policy: {
      time_window_minutes: 90,
      allow_platform_switch: true,
    },
    expected_outcome: "no_availability",
    category: "ot_fallback",
    notes:
      "Sub-2-week prime-time fallback. The Modern at 7pm Saturday is usually full; ±90min window + platform-switch should kick in. NOTE: allow_platform_switch=true is dataset-side intent; agent does not currently implement cross-platform switch, so no_availability is the realistic expected outcome until that fallback ships.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // OT FALLBACK (rest)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_017",
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
    case_id: "nyc_restaurant_018",
    city: "New York",
    restaurant_name: "Don Angie",
    restaurant_url: "https://www.opentable.com/r/don-angie-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-09",
    time: "19:00",
    party_size: 2,
    fallback_policy: {
      time_window_minutes: 90,
      allow_platform_switch: true,
    },
    expected_outcome: "no_availability",
    category: "ot_fallback",
    notes:
      "Don Angie 9am-drop venue, sub-2-week prime — typical 'no inventory' state. Tests fallback-failed → no_availability classifier.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // RESY HAPPY PATH (rest)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_019",
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
    notes: "Lilia 2nd happy variant, off-prime time.",
  },

  // ─── Daniel (Resy) — 2 happy + 1 fallback ─────────────────────────────
  {
    case_id: "nyc_restaurant_020",
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
    case_id: "nyc_restaurant_021",
    city: "New York",
    restaurant_name: "Daniel",
    restaurant_url: "https://resy.com/cities/new-york-ny/venues/daniel",
    expected_provider: "Resy",
    date: "2026-05-22",
    time: "18:30",
    party_size: 4,
    fallback_policy: { time_window_minutes: 30 },
    expected_outcome: "fully_automated",
    category: "resy_happy",
    notes: "Daniel happy, party=4.",
  },

  // ─── Misi (Resy) — 2 happy + 1 fallback ──────────────────────────────
  {
    case_id: "nyc_restaurant_022",
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
    notes:
      "Missy Robbins's Williamsburg sister to Lilia. 30-day Resy drop, often '~impossible' — happy if found, no_availability if not.",
  },
  {
    case_id: "nyc_restaurant_023",
    city: "New York",
    restaurant_name: "Misi",
    restaurant_url: "https://resy.com/cities/new-york-ny/venues/misi",
    expected_provider: "Resy",
    date: "2026-05-22",
    time: "19:00",
    party_size: 4,
    fallback_policy: { time_window_minutes: 60 },
    expected_outcome: "no_availability",
    category: "resy_happy",
    notes: "Misi happy, party=4.",
  },

  // ─── King (Resy) — 2 happy + 1 fallback ──────────────────────────────
  {
    case_id: "nyc_restaurant_024",
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
    notes:
      "King West Village Mediterranean. 30-day rolling Resy. ±0 + peak-time = inventory uncertain. Either outcome counts as PASS.",
  },
  {
    case_id: "nyc_restaurant_025",
    city: "New York",
    restaurant_name: "King",
    restaurant_url: "https://resy.com/cities/new-york-ny/venues/king",
    expected_provider: "Resy",
    date: "2026-05-21",
    time: "18:30",
    party_size: 4,
    fallback_policy: { time_window_minutes: 30 },
    expected_outcome: "fully_automated",
    category: "resy_happy",
    notes: "King happy, party=4.",
  },

  // ─── Estela (OT — corrected from initial Resy guess) — 2 happy ──────
  {
    case_id: "nyc_restaurant_026",
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
    notes:
      "Estela is on OpenTable (rid=212488), NOT Resy. Verified 2026-04-30 via estelanyc.com DOM — OT widget loader is the only third-party booking reference.",
  },
  {
    case_id: "nyc_restaurant_027",
    city: "New York",
    restaurant_name: "Estela",
    restaurant_url: "https://www.opentable.com/r/estela-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-20",
    time: "19:00",
    party_size: 4,
    fallback_policy: { time_window_minutes: 30 },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "Estela happy, party=4.",
  },

  // ─── Le Bernardin (Resy) — 1 happy + 1 fallback ───────────────────────
  {
    case_id: "nyc_restaurant_028",
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
    notes:
      "Eric Ripert's Le Bernardin (Michelin 3*). Verified Resy-primary 2026-04-30 via le-bernardin.com/reservations DOM. Top-tier prime-time demand → no_availability is the realistic happy-path outcome.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // RESY FALLBACK (5 cases)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_029",
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
    notes:
      "EMP (Michelin 3*) moved off Tock to Resy. Monthly drop on 1st. Likely deposit/prepayment required. Strict fallback test.",
  },
  {
    case_id: "nyc_restaurant_030",
    city: "New York",
    restaurant_name: "Le Bernardin",
    restaurant_url: "https://resy.com/cities/ny/le-bernardin",
    expected_provider: "Resy",
    date: "2026-05-09",
    time: "19:30",
    party_size: 2,
    fallback_policy: {
      time_window_minutes: 120,
      allow_platform_switch: true,
    },
    expected_outcome: "no_availability",
    category: "resy_fallback",
    notes: "Le Bernardin sub-2-week prime — fallback exercise.",
  },
  {
    case_id: "nyc_restaurant_031",
    city: "New York",
    restaurant_name: "Daniel",
    restaurant_url: "https://resy.com/cities/new-york-ny/venues/daniel",
    expected_provider: "Resy",
    date: "2026-05-23",
    time: "19:30",
    party_size: 2,
    fallback_policy: { time_window_minutes: 90 },
    expected_outcome: "no_availability",
    category: "resy_fallback",
    notes: "Daniel Sat 7:30pm prime — fallback exercise.",
  },
  {
    case_id: "nyc_restaurant_032",
    city: "New York",
    restaurant_name: "Misi",
    restaurant_url: "https://resy.com/cities/new-york-ny/venues/misi",
    expected_provider: "Resy",
    date: "2026-05-09",
    time: "19:00",
    party_size: 2,
    fallback_policy: { time_window_minutes: 60 },
    expected_outcome: "no_availability",
    category: "resy_fallback",
    notes: "Misi sub-2-week prime — 10am Resy drop fallback.",
  },
  {
    case_id: "nyc_restaurant_033",
    city: "New York",
    restaurant_name: "Eleven Madison Park",
    restaurant_url:
      "https://resy.com/cities/new-york-ny/venues/eleven-madison-park",
    expected_provider: "Resy",
    date: "2026-05-30",
    time: "18:30",
    party_size: 4,
    fallback_policy: {
      time_window_minutes: 120,
      allow_platform_switch: true,
    },
    expected_outcome: "no_availability",
    category: "resy_fallback",
    notes: "EMP party=4 fallback.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // VERIFY-GATE 2nd variant
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_034",
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
    notes:
      "Cosme verify-gate 2nd variant, party=4. Mobile OTP gate is session/cookie/IP/AB-test dependent — sometimes gate fires, sometimes doesn't.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // EDGE (rest)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_035",
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
    notes: "L'Artusi not_on_network, party=4 path.",
  },
  {
    case_id: "nyc_restaurant_036",
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
    notes: "Carbone closed, party=2 path.",
  },
  {
    case_id: "nyc_restaurant_037",
    city: "New York",
    restaurant_name: "Tao Downtown",
    restaurant_url: "https://www.opentable.com/r/tao-downtown-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-14",
    time: "19:30",
    party_size: 20,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "no_availability",
    category: "edge_party_too_large",
    notes:
      "party_size=20 should trip OT party-size cap (most venues max ~12-14). Agent must classify as no_availability, not silently book a smaller party.",
  },
  {
    case_id: "nyc_restaurant_038",
    city: "New York",
    restaurant_name: "Lilia",
    restaurant_url: "https://resy.com/cities/ny/lilia",
    expected_provider: "Resy",
    date: "2026-05-01",
    time: "19:00",
    party_size: 2,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "no_availability",
    category: "edge_date_too_close",
    notes: "Sub-2-day window — most popular Resy spots are already full.",
  },
  {
    case_id: "nyc_restaurant_039",
    city: "New York",
    restaurant_name: "Lilia",
    restaurant_url: "https://resy.com/cities/ny/lilia",
    expected_provider: "Resy",
    date: "2026-06-30",
    time: "19:00",
    party_size: 2,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "no_availability",
    category: "edge_date_too_far",
    notes:
      "60-day window — exceeds Resy's 30-day rolling calendar. Agent must classify as no_availability, not flap on missing date picker.",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DEEP-LINK HANDOFF (Rao's — 3 cases)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_040",
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
      "Rao's (East Harlem, 455 E 114th St, founded 1896) accepts NO online bookings. Tables effectively private property of long-standing regulars. Agent should hand off to user (provide phone 212-722-6709 or restaurant page link), not attempt OT/Resy form-fill.",
  },
  {
    case_id: "nyc_restaurant_041",
    city: "New York",
    restaurant_name: "Rao's",
    expected_provider: "no_online",
    date: "2026-05-15",
    time: "19:00",
    party_size: 4,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "deep_link_handoff",
    category: "handoff_no_online",
    notes: "Rao's handoff, party=4.",
  },
  {
    case_id: "nyc_restaurant_042",
    city: "New York",
    restaurant_name: "Rao's",
    expected_provider: "no_online",
    date: "2026-05-15",
    time: "20:00",
    party_size: 6,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "deep_link_handoff",
    category: "handoff_no_online",
    notes: "Rao's handoff, party=6 (large group).",
  },

  // ═══════════════════════════════════════════════════════════════════════
  // UNSUPPORTED PLATFORM (4 cases — Tock x3, SevenRooms x1)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_043",
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
      "Thomas Keller's Per Se (Michelin 3*). Tock-only, prepaid tasting menu ($390pp). Onegent executor doesn't support Tock — agent should classify as unsupported_platform and hand off cleanly.",
  },
  {
    case_id: "nyc_restaurant_044",
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
    notes:
      "Atomix Korean (Michelin 2*). Tock-only, prepaid tasting + deposit. Sells out instantly on monthly drop.",
  },
  {
    case_id: "nyc_restaurant_045",
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
    notes:
      "Aquavit Scandinavian (Michelin 1*). Tock-only, monthly drop on 1st 3pm.",
  },
  {
    case_id: "nyc_restaurant_046",
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

  // ═══════════════════════════════════════════════════════════════════════
  // BACKFILL (extra happy + fallback variants to round to 50)
  // ═══════════════════════════════════════════════════════════════════════
  {
    case_id: "nyc_restaurant_047",
    city: "New York",
    restaurant_name: "Daniel",
    restaurant_url: "https://resy.com/cities/new-york-ny/venues/daniel",
    expected_provider: "Resy",
    date: "2026-05-19",
    time: "18:30",
    party_size: 2,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "fully_automated",
    category: "resy_happy",
    notes: "Daniel Wed off-prime happy.",
  },
  {
    case_id: "nyc_restaurant_048",
    city: "New York",
    restaurant_name: "King",
    restaurant_url: "https://resy.com/cities/new-york-ny/venues/king",
    expected_provider: "Resy",
    date: "2026-05-28",
    time: "19:00",
    party_size: 2,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "fully_automated",
    category: "resy_happy",
    notes: "King Thu off-prime happy.",
  },
  {
    case_id: "nyc_restaurant_049",
    city: "New York",
    restaurant_name: "Don Angie",
    restaurant_url: "https://www.opentable.com/r/don-angie-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-27",
    time: "18:30",
    party_size: 2,
    fallback_policy: { time_window_minutes: 0 },
    expected_outcome: "fully_automated",
    category: "ot_happy",
    notes: "Don Angie Wed early happy.",
  },
  {
    case_id: "nyc_restaurant_050",
    city: "New York",
    restaurant_name: "Misi",
    restaurant_url: "https://resy.com/cities/new-york-ny/venues/misi",
    expected_provider: "Resy",
    date: "2026-05-30",
    time: "18:30",
    party_size: 2,
    fallback_policy: { time_window_minutes: 60 },
    expected_outcome: "no_availability",
    category: "resy_fallback",
    notes: "Misi Sat off-prime fallback.",
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
