/**
 * Fixtures for /dev/profile-gap-demo.
 *
 * Each entry models a realistic missing-field combo that codex's Track A
 * status response (`needs_profile_data` + `missing: ProfileFieldId[]`)
 * could produce. Stays internal (not re-exported via index.ts) so
 * production code paths can never accidentally read fixture values.
 *
 * Field names use the canonical 13-field schema (see `CANONICAL_FIELD_IDS`
 * in `./types.ts`). One fixture (`restaurant_legacy_full_name`)
 * deliberately uses the legacy `full_name` alias to verify
 * `normalizeMissingFields` expands it to `first_name + last_name` at
 * render time.
 */

import type { ProfileGapState } from "./types";

export const FIXTURE_SCENARIOS: Record<string, { label: string; state: ProfileGapState }> = {
  flight_dob_only: {
    label: "Flight — only DOB missing",
    state: {
      trigger: "flight",
      missing: ["date_of_birth"],
      reason: "We need this for TSA before booking your JFK→LAX flight.",
    },
  },
  flight_full_intl: {
    label: "Flight — international, all docs missing",
    state: {
      trigger: "flight",
      missing: [
        "date_of_birth",
        "passport_number",
        "passport_expiry",
        "passport_country",
      ],
      reason: "International flights require a current passport.",
    },
  },
  hotel_payment_only: {
    label: "Hotel — needs card on file",
    state: {
      trigger: "hotel",
      missing: ["card_number", "card_expiry", "billing_address"],
      reason: "Most hotels hold a card to confirm the reservation.",
    },
  },
  hotel_address_and_payment: {
    label: "Hotel — address + payment missing",
    state: {
      trigger: "hotel",
      missing: [
        "address_line1",
        "city",
        "zip",
        "country",
        "card_number",
        "card_expiry",
      ],
    },
  },
  restaurant_basic: {
    label: "Restaurant — name + phone missing",
    state: {
      trigger: "restaurant",
      // Canonical contract: codex sends first_name + last_name (not full_name).
      missing: ["first_name", "last_name", "phone"],
      reason: "OpenTable needs a name and phone to confirm the reservation.",
    },
  },
  restaurant_legacy_full_name: {
    label: "Restaurant — legacy full_name (auto-expanded)",
    state: {
      trigger: "restaurant",
      // Legacy contract: a stale Track A path (or a hand-crafted demo) might
      // still emit `full_name`. `normalizeMissingFields` should expand it
      // into first_name + last_name so the card renders the modern form.
      missing: ["full_name", "phone"],
      reason: "Legacy alias — should render as First name + Last name + Phone.",
    },
  },
  generic_minimal: {
    label: "Generic — just email",
    state: {
      trigger: "generic",
      missing: ["email"],
    },
  },
};

export const FIXTURE_ORDER: (keyof typeof FIXTURE_SCENARIOS)[] = [
  "flight_dob_only",
  "flight_full_intl",
  "restaurant_basic",
  "restaurant_legacy_full_name",
  "hotel_address_and_payment",
  "hotel_payment_only",
  "generic_minimal",
];
