/**
 * Static forensics fixture index.
 *
 * These JSON files are dev-only example data used by:
 *   - `/dev/runtime-forensics?examples=1` to demonstrate the dashboard
 *     in fresh checkouts before any real artifact has been written
 *   - vitest tests that exercise the loader against a known-good payload
 *
 * Hard rules:
 *   - No real PII. Use `+10000000000`, `name@example.com`, fake names.
 *   - No live evidence. These are **synthetic** triage examples.
 *   - Never auto-merged into the real artifact stream — gated behind
 *     `?examples=1` (or `showFixtures=1`) on the dev API.
 *   - Dashboards must visibly tag every fixture row `[FIXTURE]`.
 *
 * Pure module — re-exports the canonical filename whitelist so the
 * loader and tests stay in sync.
 */

import type { FailureClass } from "../types";

/**
 * Canonical fixture filename whitelist. Order is the deterministic
 * display order on the dashboard's "examples" panel.
 */
export const FIXTURE_FILENAMES = [
  "expedia-legacy-shape.json",
  "expedia-checkout-reached.json",
  "resy-no-availability.json",
  "resy-otp-required.json",
  "opentable-form-incomplete.json",
  "booking-5xx.json",
  "unknown.json",
] as const;

export type FixtureFilename = (typeof FIXTURE_FILENAMES)[number];

/** Documented expected primary class per fixture (test invariant). */
export const FIXTURE_EXPECTED_CLASS: Record<FixtureFilename, FailureClass> = {
  "expedia-legacy-shape.json": "legacy_shape_missing_source",
  "expedia-checkout-reached.json": "checkout_reached_manual_review",
  "resy-no-availability.json": "provider_no_availability",
  "resy-otp-required.json": "otp_or_login_required",
  "opentable-form-incomplete.json": "provider_form_incomplete",
  "booking-5xx.json": "network_or_provider_5xx",
  "unknown.json": "unknown",
};

/** Total count surfaced to the dashboard banner. */
export const FIXTURE_COUNT = FIXTURE_FILENAMES.length;
