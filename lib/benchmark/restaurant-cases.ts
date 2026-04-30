/**
 * Seed benchmark cases for NYC restaurant booking.
 *
 * This file is the source of truth for which cases exist. Add new cases here,
 * commit to git, and the next run will pick them up. Run history (per-attempt
 * results) lives in the benchmark_cases DB table.
 *
 * Date guidance: pick dates ~1-2 weeks out so reservations are realistically
 * available. Avoid sub-2-day windows (most popular spots are already full)
 * and >30-day windows (some platforms gate the calendar that far out).
 */

import type { RestaurantBenchmarkCase } from "./types";

export const RESTAURANT_BENCHMARK_CASES_NYC: RestaurantBenchmarkCase[] = [
  // ─── OpenTable: classic mid-popularity spot, fixed time ──────────────────
  {
    case_id: "nyc_restaurant_001",
    city: "New York",
    restaurant_name: "L'Artusi",
    restaurant_url: "https://www.opentable.com/lartusi",
    expected_provider: "OpenTable",
    date: "2026-05-12",
    time: "19:00",
    party_size: 2,
    occasion: "date_night",
    preferences: {
      atmosphere: "romantic",
      cuisine: "italian",
    },
    fallback_policy: {
      time_window_minutes: 0,
      allow_platform_switch: false,
      allow_venue_switch: false,
      require_user_approval_before_booking: false,
    },
    notes:
      "Baseline: well-known West Village Italian on OpenTable, popular but not impossible. Tests the happy path.",
  },

  // ─── OpenTable: high-demand spot, allow time fallback ───────────────────
  {
    case_id: "nyc_restaurant_002",
    city: "New York",
    restaurant_name: "Carbone",
    restaurant_url: "https://www.opentable.com/r/carbone-new-york",
    expected_provider: "OpenTable",
    date: "2026-05-14",
    time: "19:30",
    party_size: 2,
    occasion: "anniversary",
    fallback_policy: {
      time_window_minutes: 60,
      allow_platform_switch: false,
      allow_venue_switch: false,
      require_user_approval_before_booking: false,
    },
    notes:
      "Carbone is famously hard to book. Expected outcome: no_availability at 19:30 → time fallback exercises the time-window logic.",
  },

  // ─── OpenTable: medium spot with party size 4 ───────────────────────────
  {
    case_id: "nyc_restaurant_003",
    city: "New York",
    restaurant_name: "Via Carota",
    restaurant_url: "https://www.opentable.com/via-carota",
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
    notes:
      "Tests party_size > 2 + later time slot. Via Carota is walk-in heavy on OpenTable, useful for measuring availability accuracy.",
  },

  // ─── Resy: trendy reservation, fixed time ───────────────────────────────
  {
    case_id: "nyc_restaurant_004",
    city: "New York",
    restaurant_name: "Don Angie",
    restaurant_url: "https://resy.com/cities/ny/don-angie",
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
    notes:
      "Resy baseline: West Village popular spot, no time fallback. Probes Resy login/cookie flow.",
  },

  // ─── Resy: ultra-popular, allow time + platform fallback ────────────────
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
    notes:
      "Resy stress test: Cosme prime-time is usually full. Time + platform fallback should attempt OpenTable / official site if Resy refuses.",
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
