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
  // ─── OpenTable: detail page exists but venue not on booking network ──────
  {
    case_id: "nyc_restaurant_001",
    city: "New York",
    restaurant_name: "L'Artusi",
    restaurant_url: "https://www.opentable.com/r/lartusi-new-york",
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
      "Negative case (NO_AVAILABILITY_SIGNALS regression test): L'Artusi detail page exists but renders 'Not available on OpenTable'. Should classify as no_availability in <15s, NOT executor_error after 30s+.",
  },

  // ─── OpenTable: popular date-night spot, allow time fallback ─────────────
  {
    case_id: "nyc_restaurant_002",
    city: "New York",
    restaurant_name: "Tao Downtown",
    restaurant_url: "https://www.opentable.com/r/tao-downtown-new-york",
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
      "Mid-demand mainstream Asian-fusion spot. Stable presence on OpenTable; 19:30 prime-time may exercise the time-window fallback.",
  },

  // ─── OpenTable: detail page exists but venue permanently closed ──────────
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
    notes:
      "Negative case (NO_AVAILABILITY_SIGNALS regression test, party_size=4 path): Carbone detail page exists but renders 'Permanently Closed'. Should classify as no_availability in <15s.",
  },

  // ─── Resy: established Resy venue, fixed time ───────────────────────────
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
    notes:
      "Resy baseline: long-running Williamsburg Italian, reliably listed on Resy. Probes Resy login/cookie flow + the cities/ny/<slug> → cities/new-york-ny/venues/<slug> redirect.",
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
      "Resy stress test: Cosme prime-time is usually full. Time + platform fallback should attempt OpenTable / official site if Resy refuses. " +
      "KNOWN LIMITATION (cont. 7, 2026-04-30): Resy enforces a mobile phone " +
      "OTP gate on guest checkout for this venue (anti-spam). Benchmark " +
      "profiles use 555-prefix .test phone numbers that cannot receive SMS, " +
      "so the executor cannot pass the gate. Behavior depends on Resy " +
      "session cookies / A-B-test variant / time-of-day — sometimes succeeds " +
      "(cookies cached), sometimes hits the gate. Real prod users with a " +
      "Resy account or a real phone bypass this.",
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
