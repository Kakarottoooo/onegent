/**
 * Provider Closure Operator Room - lane manifest.
 *
 * Three lanes: restaurant, flight, hotel. Each lane records the
 * static closure workflow content - posture, runbook, evidence,
 * hard stops, what to inspect after run, CLI commands, taxonomy
 * classes, and a source-of-truth reminder.
 *
 * Update protocol:
 *   1. Update the corresponding canonical doc/runbook first
 *      (LIVE_CLOSURE_EVIDENCE_PROTOCOL.md, the per-vertical
 *      runbook, or PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md).
 *   2. Mirror the change here.
 *   3. The cockpit picks it up on next render.
 *
 * Pure module - no fs, no DB, no LLM, no live provider call.
 * Imported by the page server component, the loader, and tests.
 */

import { FAILURE_CATEGORY_KEYS } from "@/lib/operator-failure-taxonomy";

import type {
  HardStop,
  EvidenceRequirement,
  InspectAfterRun,
  LaneReference,
  CliCommandBlock,
  ProviderLane,
  ProviderLaneId,
} from "./types";

/* ------ Shared hard stops (apply to every vertical) ----------------------------------------------------------- */

const SHARED_HARD_STOPS: HardStop[] = [
  {
    label: "No payment automation",
    detail:
      "Stop immediately at any payment, CVV, security code, or final " +
      "purchase/reserve/confirmation prompt. Never enter card data.",
  },
  {
    label: "No OTP / CAPTCHA / login bypass",
    detail:
      "Never bypass OTP, one-time codes, SMS verification, CAPTCHA, " +
      "bot challenges, or login walls. Treat any such prompt as a safe " +
      "boundary and capture evidence.",
  },
  {
    label: "No final confirmation click",
    detail:
      "Do not click the final confirm/reserve/book/purchase button. " +
      "Stop at the manual review boundary so a human can verify the " +
      "selection before committing.",
  },
  {
    label: "No retry loop or one-click live control",
    detail:
      "Do not add a run, retry, resume, start, live, execute, or submit " +
      "button on this page or anywhere else. Live runs require a separate " +
      "founder-approved exact command.",
  },
];

/* ------ Source-of-truth reminder template ---------------------------------------------------------------------- */

const SOURCE_OF_TRUTH_REMINDER =
  "Source of truth is the DB row for the booking job, the bounded " +
  "worker log excerpt, and the screenshot/live-snapshot artifacts. " +
  "Never read closure outcome from the task UI copy alone.";

/* ------ Restaurant lane --------------------------------------------------------------------------------------------- */

const RESTAURANT_LANE: ProviderLane = {
  id: "restaurant",
  displayName: "Restaurant / Resy + OpenTable",
  providerKey: "resy",
  closurePosture:
    "Phase 0A is in flight. Closure for restaurant means at least one " +
    "Resy or OpenTable case reaches an accepted safe outcome - " +
    "ready_for_confirmation, safe_handoff, OTP/login required, or a " +
    "correct no-availability classification - without bypassing OTP, " +
    "login, CAPTCHA, payment, or final confirmation. OpenTable can " +
    "reach the safe contact boundary. Resy has not yet closed a live " +
    "fill/OTP path. The next attempt must be probe-selected, not blind.",
  lastKnownBlocker:
    "Resy R-030 (2026-05-04 controlled retry) closed without booking. " +
    "First run died before provider with OpenAI Responses API 500 " +
    "(req_ce42a48137424a938a7893b131416d28) - now classified as " +
    "model_or_env_blocked, not a Resy regression. Retry reached " +
    "Resy/Charlie Bird safely but ended no_availability_correct " +
    "while the public probe still showed matching slots; screenshots " +
    "showed the venue page loaded but no visible slot cards. No-live " +
    "patches landed: slot detector no longer treats the top time " +
    "filter as a slot, Resy slugs/stage detection are current, and " +
    "Resy deep links preserve time. Next attempt requires a fresh " +
    "probe-recommended case, not a re-run of R-030.",
  primaryRunbook: {
    label: "R-003 live smoke runbook",
    ref: "docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md",
    kind: "runbook",
  },
  supportingReferences: [
    {
      label: "Resy live debug playbook",
      ref: "docs/20-phase0-restaurant/RESY_LIVE_DEBUG_PLAYBOOK.md",
      kind: "runbook",
    },
    {
      label: "Resy availability probe protocol",
      ref: "docs/20-phase0-restaurant/RESY_AVAILABILITY_PROBE_PROTOCOL.md",
      kind: "doc",
    },
    {
      label: "Restaurant artifact analysis",
      ref: "docs/20-phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md",
      kind: "doc",
    },
    {
      label: "Live closure evidence protocol",
      ref: "docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md",
      kind: "doc",
    },
    {
      label: "Operator failure taxonomy",
      ref: "docs/30-provider-debug/FAILURE_TAXONOMY.md",
      kind: "doc",
    },
    {
      label: "Restaurant readiness control center",
      ref: "/dev/restaurant-readiness",
      kind: "page",
    },
    {
      label: "Resy run analysis workbench",
      ref: "/dev/resy-run-analysis",
      kind: "page",
    },
    {
      label: "Resy availability probe runs",
      ref: "/dev/resy-probe-runs",
      kind: "page",
    },
  ],
  evidenceRequired: [
    {
      label: "DB row for the Resy/OpenTable booking job",
      detail:
        "Read steps[0].error, steps[0].terminalReason, steps[0].body.__source, " +
        "steps[0].body.params, steps[0].decisionLog from booking_jobs. " +
        "Never infer from the task UI.",
    },
    {
      label: "Restaurant benchmark report",
      detail:
        "Latest benchmark/runs/phase0-resy-*.json verdict + failure class + " +
        "strategy ladder + retry history. Pair with the per-case fixture id.",
    },
    {
      label: "Bounded worker log excerpt",
      detail:
        "Grep codex-worker.log around the job id plus markers: resy, " +
        "opentable, guest_form, mobile_verify, paused_payment, safe_handoff, " +
        "F-AVAIL-NONE, captcha, login, OTP, CVV, final.",
    },
    {
      label: "Provider screenshots",
      detail:
        "worker/.debug-screenshots/<provider>/<run>/ - confirm the page state " +
        "matches the steps[0].error + log markers; check whether a hard stop " +
        "was visible.",
    },
    {
      label: "Live snapshot JSON",
      detail:
        ".debug-screenshots/live/<job-id>/*.json when present. Confirms the " +
        "DOM state at terminal failure independent of the worker log.",
    },
    {
      label: "Operator notes with hard-stop observations",
      detail:
        "Record any OTP/login/CAPTCHA/payment prompt seen, not the value. " +
        "Required before classifying a run as safe_handoff vs " +
        "no_availability_correct.",
    },
  ],
  hardStops: [
    {
      label: "Stop before final reservation confirmation",
      detail:
        "Do not click the final reserve/confirm button. Resy and OpenTable " +
        "must end at ready_for_confirmation or safe_handoff at the latest.",
    },
    {
      label: "No OTP / SMS / phone-verification entry",
      detail:
        "If a Resy or OpenTable form requests an SMS code or phone " +
        "verification, stop and capture screenshots. Do not enter the code.",
    },
    ...SHARED_HARD_STOPS,
  ],
  inspectAfterRun: [
    {
      label: "Reconcile DB error vs worker log vs screenshots",
      detail:
        "All three must agree on the same root cause before any patch. " +
        "Disagreement means insufficient evidence, not a green light to patch.",
    },
    {
      label: "Classify against the operator failure taxonomy",
      detail:
        "Pick exactly one of model_env_transient / provider_network_degraded / " +
        "provider_logic_failure / safe_boundary_reached. " +
        "OpenAI Responses API 5xx is model_env_transient, not a Resy " +
        "regression.",
    },
    {
      label: "Check whether the next case is probe-recommended",
      detail:
        "Open /dev/restaurant-readiness or /dev/resy-probe-runs. Do not burn " +
        "another live token unless a probe case is recommended.",
    },
    {
      label: "Cross-link the artifact bundle into the handoff",
      detail:
        "Generate a restaurant artifact bundle (template -> filled -> analyzed) " +
        "and paste the analyzer output before any patch decision.",
    },
  ],
  cliCommands: [
    {
      label: "Generate restaurant artifact bundle template (no-live)",
      description:
        "Produces a synthetic JSON template with placeholders for DB row, " +
        "worker log excerpt, screenshots, and live snapshots. Save locally, " +
        "fill with already-collected evidence, redact PII before analyzing.",
      command:
        "npx tsx scripts/create-artifact-bundle-template.ts --kind restaurant",
    },
    {
      label: "Analyze a filled restaurant bundle (no-live)",
      description:
        "Runs the pure no-live analyzer on the filled bundle. " +
        "insufficient_evidence means collect more, not a green light to patch.",
      command:
        "npx tsx scripts/analyze-provider-artifact.ts --kind restaurant " +
        ".tmp\\restaurant-artifact-bundle.json",
    },
    {
      label: "List the synthetic artifact corpus",
      description:
        "Inventory of synthetic restaurant/Expedia/hotel/runtime-forensics " +
        "fixtures. Useful when validating that the no-live corpus is intact.",
      command: "npx tsx scripts/list-artifact-fixtures.ts",
    },
  ],
  taxonomyClasses: [
    "model_env_transient",
    "provider_network_degraded",
    "provider_logic_failure",
    "safe_boundary_reached",
  ],
  sourceOfTruthReminder: SOURCE_OF_TRUTH_REMINDER,
};

/* ------ Flight lane ---------------------------------------------------------------------------------------------------- */

const FLIGHT_LANE: ProviderLane = {
  id: "flight",
  displayName: "Flight / Expedia",
  providerKey: "expedia",
  closurePosture:
    "Phase 2 candidate, not live-verified. Closure for flight means " +
    "the Expedia retry of MCO->BNA reaches the checkout manual-review " +
    "boundary on the audited Southwest WN 3084 card without bypassing " +
    "OTP/login/CAPTCHA/payment. The visible-card DOM-scan fallback " +
    "shipped on integrated preview; no live retry has run since the " +
    "fallback landed. A controlled live retry requires explicit " +
    "founder approval for the exact run.",
  lastKnownBlocker:
    "Most recent Expedia flight failure had a valid __source marker " +
    "and correct flight params, but the bulk DOM scan failed while " +
    "the target Southwest card was visible. Visible-text locator " +
    "fallback is now in place. Outstanding: confirm the fallback " +
    "matches in a controlled live retry, then verify checkout reaches " +
    "the manual-review boundary without a hard stop firing.",
  primaryRunbook: {
    label: "Expedia controlled retry runbook",
    ref: "docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md",
    kind: "runbook",
  },
  supportingReferences: [
    {
      label: "Phase 2 vertical revival audit",
      ref: "docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
      kind: "doc",
    },
    {
      label: "Phase 2 sidecar coordination",
      ref: "docs/10-coordination/phase2.md",
      kind: "doc",
    },
    {
      label: "Live closure evidence protocol",
      ref: "docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md",
      kind: "doc",
    },
    {
      label: "Live artifact bridge",
      ref: "docs/50-product-areas/LIVE_ARTIFACT_BRIDGE.md",
      kind: "doc",
    },
    {
      label: "Operator failure taxonomy",
      ref: "docs/30-provider-debug/FAILURE_TAXONOMY.md",
      kind: "doc",
    },
    {
      label: "Provider runtime debug playbook",
      ref: "docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md",
      kind: "runbook",
    },
    {
      label: "Provider runtime forensics workbench",
      ref: "/dev/runtime-forensics",
      kind: "page",
    },
  ],
  evidenceRequired: [
    {
      label: "DB row for the Expedia flight job",
      detail:
        "Read steps[0].body.__source, steps[0].body.params (origin/dest/date/" +
        "passengers), steps[0].error, steps[0].decisionLog from booking_jobs. " +
        "Confirm the source marker prefix is lib/core/execution or " +
        "lib/execution-v2.",
    },
    {
      label: "Bounded worker log excerpt",
      detail:
        "Grep codex-worker.log around the job id plus markers: flight-rpa, " +
        "Expedia, Flight-card DOM scan, Trying locator fallback, Locator " +
        "fallback matched, Flight match, Fare modal, Checkout reached, " +
        "flight checkout was not reached, profile, payment, captcha, login, " +
        "OTP, CVV, final.",
    },
    {
      label: "Flight-RPA screenshots",
      detail:
        "worker/.debug-screenshots/flight-rpa-* - confirm visibility of the " +
        "audited Southwest WN 3084 card and whether the fare modal opened.",
    },
    {
      label: "Live snapshot JSON",
      detail:
        ".debug-screenshots/live/<job-id>/*.json when present. " +
        "Cross-check whether the page reached the checkout manual-review boundary.",
    },
    {
      label: "Card-match diagnostic",
      detail:
        "Confirm the visible-text locator fallback matched the audited card. " +
        "If it did not, the failure class is fallback_attempted_no_match, " +
        "not a generic Expedia regression.",
    },
    {
      label: "Operator notes with hard-stop observations",
      detail:
        "Record any OTP/login/CAPTCHA/payment prompt seen on the Expedia " +
        "flow, not the value. Required before classifying as " +
        "checkout_manual_review_reached.",
    },
  ],
  hardStops: [
    {
      label: "Stop before final purchase confirmation",
      detail:
        "Do not click final purchase or confirmation. The retry must end " +
        "at the checkout manual-review boundary - no card entry, no submit.",
    },
    {
      label: "Wrong card means stop",
      detail:
        "If the runtime selects a card other than the audited Southwest " +
        "WN 3084, stop and capture evidence. Do not auto-correct.",
    },
    ...SHARED_HARD_STOPS,
  ],
  inspectAfterRun: [
    {
      label: "Confirm card-scan vs fallback path in worker log",
      detail:
        "If 'Locator fallback matched' is absent, the bulk scan succeeded; " +
        "if both are absent, the run did not reach the card list and the " +
        "failure is upstream of the fallback fix.",
    },
    {
      label: "Verify checkout manual-review boundary",
      detail:
        "Screenshots must show the checkout page reached without a final " +
        "purchase button being clicked. If a hard-stop fired, record which.",
    },
    {
      label: "Classify against the operator failure taxonomy",
      detail:
        "Pick from card_scan_failed_before_fallback / fallback_attempted_no_match / " +
        "fallback_matched_no_checkout / checkout_manual_review_reached / " +
        "network_provider_failure / model_or_env_blocked.",
    },
    {
      label: "Cross-link the artifact bundle into the handoff",
      detail:
        "Generate an Expedia retry artifact bundle (template -> filled -> " +
        "analyzed) and paste the analyzer output before any patch decision.",
    },
  ],
  cliCommands: [
    {
      label: "Generate Expedia retry bundle template (no-live)",
      description:
        "Synthetic placeholders for the Expedia retry shape - flight " +
        "params, card-scan diagnostic, screenshot paths, live snapshot " +
        "paths, checkout boundary marker. Save locally and fill with " +
        "already-collected evidence.",
      command:
        "npx tsx scripts/create-artifact-bundle-template.ts --kind expedia",
    },
    {
      label: "Analyze a filled Expedia bundle (no-live)",
      description:
        "Runs the pure no-live Expedia analyzer. insufficient_evidence " +
        "means collect more screenshots/log excerpts before patching.",
      command:
        "npx tsx scripts/analyze-provider-artifact.ts --kind expedia " +
        ".tmp\\expedia-retry-artifact-bundle.json",
    },
    {
      label: "Run Expedia retry preflight tests (no-live)",
      description:
        "Pure preflight: validates env names, exact prompt/start URL, " +
        "hard-stop labels, and expected artifact paths. Does not read " +
        ".env.local, open Expedia, start a worker, or call OpenAI.",
      command:
        "npx vitest run lib/__tests__/expedia-controlled-retry-preflight.test.ts " +
        "lib/__tests__/expedia-retry-analysis.test.ts " +
        "lib/__tests__/expedia-flight-card-match.test.ts",
    },
  ],
  taxonomyClasses: [
    "model_env_transient",
    "provider_network_degraded",
    "provider_logic_failure",
    "safe_boundary_reached",
  ],
  sourceOfTruthReminder: SOURCE_OF_TRUTH_REMINDER,
};

/* ------ Hotel lane ----------------------------------------------------------------------------------------------------- */

const HOTEL_LANE: ProviderLane = {
  id: "hotel",
  displayName: "Hotel / Booking.com first, Hotels.com fallback",
  providerKey: "booking-com",
  closurePosture:
    "Phase 2 needs fresh artifacts before live promises. Closure for " +
    "hotel means a Booking.com retry of YOTEL New York Times Square " +
    "reaches the guest-details or payment manual-review boundary on " +
    "the correct hotel/dates/room/guest count without bypassing " +
    "OTP/login/CAPTCHA/payment. Hotels.com is a fallback only after " +
    "Booking.com is explicitly blocked. Expedia hotel stays out of " +
    "scope until a separate founder-approved hotel case exists.",
  lastKnownBlocker:
    "No fresh probe / screenshot artifacts since the last live " +
    "verification. Booking.com URL builder, stage helpers, room " +
    "selection helpers, guest-details detection, payment-boundary " +
    "guards, bot patterns, and synthetic no-live fixtures are in " +
    "place, but a controlled live retry has not produced fresh " +
    "DB/log/screenshot evidence to confirm the path stops at the " +
    "manual-review boundary.",
  primaryRunbook: {
    label: "Hotel controlled retry runbook",
    ref: "docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md",
    kind: "runbook",
  },
  supportingReferences: [
    {
      label: "Hotel vertical revival audit",
      ref: "docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md",
      kind: "doc",
    },
    {
      label: "Phase 2 vertical revival audit",
      ref: "docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md",
      kind: "doc",
    },
    {
      label: "Live closure evidence protocol",
      ref: "docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md",
      kind: "doc",
    },
    {
      label: "Live artifact bridge",
      ref: "docs/50-product-areas/LIVE_ARTIFACT_BRIDGE.md",
      kind: "doc",
    },
    {
      label: "Operator failure taxonomy",
      ref: "docs/30-provider-debug/FAILURE_TAXONOMY.md",
      kind: "doc",
    },
    {
      label: "Provider runtime debug playbook",
      ref: "docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md",
      kind: "runbook",
    },
    {
      label: "Provider runtime forensics workbench",
      ref: "/dev/runtime-forensics",
      kind: "page",
    },
  ],
  evidenceRequired: [
    {
      label: "DB row for the hotel booking job",
      detail:
        "Read steps[0].body.__source, steps[0].body.params (hotel_name/" +
        "city/checkin/checkout/adults/rooms), steps[0].error, " +
        "steps[0].decisionLog from booking_jobs. Confirm the source marker " +
        "prefix is lib/core/execution or lib/execution-v2.",
    },
    {
      label: "Bounded worker log excerpt",
      detail:
        "Grep codex-worker.log around the job id plus markers: " +
        "Booking.com, booking-com, Hotels.com, hotels-com, hotel, " +
        "normaliseStartUrl, searchresults, hotel detail, room, " +
        "selected room, guest-details, guest details, final details, " +
        "payment, paused_payment, checkout, sold out, fully booked, " +
        "No exact matches, captcha, login, OTP, CVV, final.",
    },
    {
      label: "Hotel screenshots",
      detail:
        "worker/.debug-screenshots/ for the hotel run - confirm the " +
        "selected hotel/dates/room/guest count match the prompt; check " +
        "whether the path reached guest-details vs payment vs final-confirm.",
    },
    {
      label: "Live snapshot JSON",
      detail:
        ".debug-screenshots/live/<job-id>/*.json when present. " +
        "Cross-check the DOM at terminal failure for room-selection drift.",
    },
    {
      label: "Operator notes with hard-stop observations",
      detail:
        "Record any OTP/login/CAPTCHA/payment prompt, not the value. " +
        "Required before classifying as guest_details_manual_review_reached " +
        "vs payment_manual_review_reached.",
    },
  ],
  hardStops: [
    {
      label: "Stop before final reservation",
      detail:
        "Do not click final reserve/book/purchase. Hotel must end at " +
        "guest-details or payment manual-review boundary at the latest.",
    },
    {
      label: "Wrong hotel/dates/room means stop",
      detail:
        "If the runtime selects a different hotel, dates, room class, or " +
        "guest count from the prompt, stop and capture evidence. Do not " +
        "auto-correct.",
    },
    ...SHARED_HARD_STOPS,
  ],
  inspectAfterRun: [
    {
      label: "Confirm correct hotel selection",
      detail:
        "Screenshots must show the hotel name + dates + room class + guest " +
        "count match the prompt. Drift means room_selection_drift, not a " +
        "manual-review-reached classification.",
    },
    {
      label: "Verify boundary stage",
      detail:
        "Determine whether the run stopped at room selection, guest " +
        "details, or payment review. Each maps to a different safe-boundary " +
        "subclass.",
    },
    {
      label: "Classify against the operator failure taxonomy",
      detail:
        "Pick from room_selection_manual_review_reached / " +
        "guest_details_manual_review_reached / payment_manual_review_reached / " +
        "login_or_captcha_boundary / profile_gating / network_provider_failure / " +
        "room_selection_drift / model_or_env_blocked.",
    },
    {
      label: "Cross-link the artifact bundle into the handoff",
      detail:
        "Generate a hotel retry artifact bundle (template -> filled -> " +
        "analyzed) and paste the analyzer output before any patch decision.",
    },
  ],
  cliCommands: [
    {
      label: "Generate hotel retry bundle template (no-live)",
      description:
        "Synthetic placeholders for hotel retry shape - hotel params, " +
        "stage markers, screenshot paths, live snapshot paths, boundary " +
        "marker. Save locally and fill with already-collected evidence.",
      command:
        "npx tsx scripts/create-artifact-bundle-template.ts --kind hotel",
    },
    {
      label: "Analyze a filled hotel bundle (no-live)",
      description:
        "Runs the pure no-live hotel analyzer. insufficient_evidence " +
        "means collect more screenshots/log excerpts before patching.",
      command:
        "npx tsx scripts/analyze-provider-artifact.ts --kind hotel " +
        ".tmp\\hotel-retry-artifact-bundle.json",
    },
    {
      label: "Run hotel retry preflight tests (no-live)",
      description:
        "Pure preflight: validates the hotel runbook against env names, " +
        "expected start URLs, hard-stop labels, and artifact paths. Does " +
        "not read .env.local, open the provider, or call OpenAI.",
      command:
        "npx vitest run lib/__tests__/hotel-retry-analysis.test.ts " +
        "lib/__tests__/hotel-controlled-retry-preflight.test.ts",
    },
  ],
  taxonomyClasses: [
    "model_env_transient",
    "provider_network_degraded",
    "provider_logic_failure",
    "safe_boundary_reached",
  ],
  sourceOfTruthReminder: SOURCE_OF_TRUTH_REMINDER,
};

/* ------ Manifest ------------------------------------------------------------------------------------------------------------- */

export const PROVIDER_LANES: ReadonlyArray<ProviderLane> = Object.freeze([
  RESTAURANT_LANE,
  FLIGHT_LANE,
  HOTEL_LANE,
]);

const LANE_INDEX: Record<ProviderLaneId, ProviderLane> = Object.freeze(
  Object.fromEntries(PROVIDER_LANES.map((l) => [l.id, l])),
) as Record<ProviderLaneId, ProviderLane>;

/* ------ Lookups -------------------------------------------------------------------------------------------------------------- */

export function listProviderLanes(): ProviderLane[] {
  return PROVIDER_LANES.map((l) => deepCloneLane(l));
}

export function getProviderLane(id: ProviderLaneId): ProviderLane | null {
  const lane = LANE_INDEX[id] ?? null;
  return lane ? deepCloneLane(lane) : null;
}

/* ------ Internal helpers ----------------------------------------------------------------------------------------------- */

/**
 * Defensive deep clone so consumers cannot mutate frozen lane data.
 * Mirrors the pattern in `lib/operator-failure-taxonomy/categories.ts`.
 */
function deepCloneLane(lane: ProviderLane): ProviderLane {
  return {
    ...lane,
    primaryRunbook: { ...lane.primaryRunbook },
    supportingReferences: lane.supportingReferences.map(
      (r) => ({ ...r }) as LaneReference,
    ),
    evidenceRequired: lane.evidenceRequired.map(
      (r) => ({ ...r }) as EvidenceRequirement,
    ),
    hardStops: lane.hardStops.map((r) => ({ ...r }) as HardStop),
    inspectAfterRun: lane.inspectAfterRun.map(
      (r) => ({ ...r }) as InspectAfterRun,
    ),
    cliCommands: lane.cliCommands.map((r) => ({ ...r }) as CliCommandBlock),
    taxonomyClasses: [...lane.taxonomyClasses],
  };
}

/**
 * Validate a lane's taxonomyClasses[] only references known taxonomy
 * keys. Pure, no fs. Useful in tests so a typo in lanes.ts is caught
 * before runtime.
 */
export function laneTaxonomyClassesAreKnown(lane: ProviderLane): boolean {
  const allowed = new Set<string>(FAILURE_CATEGORY_KEYS);
  return lane.taxonomyClasses.every((c) => allowed.has(c));
}
