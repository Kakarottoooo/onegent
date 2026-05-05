// Operator failure taxonomy - the four-way split that separates a
// transient model/env failure from a real provider regression.
//
// This module is pure. It does not start a live provider, read the
// database, open a browser, or call OpenAI. It is consumed by
// docs/30-provider-debug/FAILURE_TAXONOMY.md and (when it lands) the
// /dev/live-operator-checklist read-only page so the operator has one
// source of truth for "what kind of failure am I looking at" before
// they decide to patch a selector vs. wait out an OpenAI 5xx.

export type FailureCategoryKey =
  | "model_env_transient"
  | "provider_network_degraded"
  | "provider_logic_failure"
  | "safe_boundary_reached";

export type FailureSeverity = "info" | "patchable" | "wait";

export interface FailureCategory {
  key: FailureCategoryKey;
  /** Short human label rendered as a card / heading. */
  label: string;
  /** One-line summary the operator sees first. */
  oneLine: string;
  /**
   * Severity - "wait" means do nothing yet (transient or safe boundary),
   * "patchable" means a real fix is justified after evidence,
   * "info" means observed and OK.
   */
  severity: FailureSeverity;
  /** Cross-references to related runtime-forensics or restaurant classes. */
  relatedClasses: string[];
  /**
   * Concrete signal patterns that put a failure into this category.
   * ASCII only. These are short anchor phrases an operator can grep.
   */
  signals: string[];
  /** What the operator should do next in this category. */
  nextActions: string[];
  /** What the operator must NOT do in this category. */
  doNot: string[];
}

const MODEL_ENV_TRANSIENT: FailureCategory = {
  key: "model_env_transient",
  label: "Model / env transient",
  oneLine:
    "OpenAI / Computer Use / model API returned a 5xx, rate-limit, timeout, or model-not-available error before the provider was reached.",
  severity: "wait",
  relatedClasses: ["model_or_env_blocked"],
  signals: [
    "OpenAI Responses API 500 server_error.",
    "OpenAI rate-limit 429 / quota exhausted.",
    "OpenAI request id present in stack trace; failure happened before any provider step.",
    "Computer Use unavailable / model not enabled for this account.",
    "chromium / Playwright launch error before navigation started.",
    "Token guard / `--live-openai` not set / `ONEGENT_ALLOW_LIVE_OPENAI=1` missing.",
  ],
  nextActions: [
    "Treat the run as inconclusive about provider health. Do not log a Resy / OpenTable / Expedia regression.",
    "Capture the OpenAI request id and timestamp. Attach to the artifact bundle so future runs can be correlated against the OpenAI status page.",
    "Wait for the next clean retry window and re-run the same case once. If it still fails with the same model/env signature, escalate to model/env owners, not provider owners.",
    "If the same case finishes a clean run later, reclassify the original failure as `model_env_transient` in the artifact bundle notes.",
  ],
  doNot: [
    "Do not patch a Resy / OpenTable / Expedia provider selector based on this evidence.",
    "Do not file a provider regression bug.",
    "Do not blind-retry in a tight loop; OpenAI 5xx and rate-limit are usually transient and self-correct.",
    "Do not assume a Phase 0 provider boundary regressed; the run never reached the provider.",
  ],
};

const PROVIDER_NETWORK_DEGRADED: FailureCategory = {
  key: "provider_network_degraded",
  label: "Provider network degraded",
  oneLine:
    "Provider site itself returned a 5xx, gateway timeout, TCP error, `net::ERR_*`, or rate-limit during a navigation/fetch step.",
  severity: "wait",
  relatedClasses: [
    "network_or_provider_5xx",
    "provider_network_degraded",
  ],
  signals: [
    "HTTP 5xx from the provider domain (resy.com, opentable.com, expedia.com, booking.com, hotels.com).",
    "`net::ERR_TIMED_OUT`, `net::ERR_CONNECTION_RESET`, `net::ERR_NAME_NOT_RESOLVED`.",
    "Cloudflare / Akamai / bot-wall response without a CAPTCHA challenge UI.",
    "Provider-side rate-limit / cooldown banner.",
    "Resy public search API 500s observed across multiple cases in the same window.",
  ],
  nextActions: [
    "Capture the failed request URL, status code, response headers if available, and a screenshot.",
    "Do not run more cases for the same provider in the next few minutes; the provider may be in a cooldown.",
    "Re-run the same case once a few minutes later. If it still fails with the same network shape, escalate as provider degraded, not provider logic.",
    "If a fresh probe shows the provider responding normally, reclassify the original failure once the artifact bundle is reviewed.",
  ],
  doNot: [
    "Do not patch selectors or strategies based on a single 5xx; the page may not have rendered at all.",
    "Do not bypass a CAPTCHA, bot-wall, or login wall to keep going.",
    "Do not run a broad provider suite while the network signal looks degraded.",
  ],
};

const PROVIDER_LOGIC_FAILURE: FailureCategory = {
  key: "provider_logic_failure",
  label: "Provider logic failure",
  oneLine:
    "Provider responded normally, but our selector / strategy / state machine produced the wrong action or stopped on a real bug.",
  severity: "patchable",
  relatedClasses: [
    "legacy_shape_missing_source",
    "provider_form_incomplete",
    "resy_modal_disabled_details_api_failed",
    "opentable_form_incomplete",
    "card_scan_fallback_not_reached",
    "wrong_card_selected",
    "fare_modal_drift",
    "checkout_boundary_drift",
    "hotel_search_result_drift",
    "room_selection_drift",
    "guest_details_incomplete",
  ],
  signals: [
    "Worker log shows the provider page rendered, the strategy ladder ran, and a specific selector / step failed.",
    "Screenshot shows the target option (Southwest card, Buvette result, YOTEL room) visibly available while the worker reported `not found`.",
    "`steps[0].body.__source` is missing or wrong (legacy shape).",
    "Wrong restaurant / wrong flight / wrong hotel selected in screenshot vs. params.",
    "Form locator matched but `auditAndRefill` left a visible field empty.",
    "Booking.com guest-details vs final-details boundary detected the wrong page.",
  ],
  nextActions: [
    "Patch only after comparing DB row + worker log + screenshots + live snapshot. Task UI alone is not enough.",
    "Run the matching analyzer (Resy/OpenTable, Expedia retry, hotel) and read the analyzer state before editing any provider code.",
    "Mirror provider patches to the worker tree if applicable and run `npm run check-drift`.",
    "Add a no-live regression test that pins the specific shape that broke, so the next refactor cannot silently re-break it.",
  ],
  doNot: [
    "Do not click final booking, payment, OTP, CAPTCHA, login, or final confirmation as part of debugging.",
    "Do not bypass a hard stop to confirm a logic theory.",
    "Do not patch on the basis of the task UI alone.",
  ],
};

const SAFE_BOUNDARY_REACHED: FailureCategory = {
  key: "safe_boundary_reached",
  label: "Safe boundary reached",
  oneLine:
    "The agent stopped at the correct boundary (login, OTP, CAPTCHA, payment review, manual confirm, ready_for_confirmation, paused_payment, or safe handoff).",
  severity: "info",
  relatedClasses: [
    "safe_manual_review_reached",
    "checkout_reached_manual_review",
    "checkout_manual_review_reached",
    "paused_payment",
    "otp_or_login_required",
    "resy_otp_login_boundary",
    "opentable_phone_otp_handoff",
    "safe_provider_boundary",
  ],
  signals: [
    "`steps[0].terminalReason` or `steps[0].terminalCode` is one of the safe-boundary codes.",
    "Status is `paused_payment` / `awaiting_confirmation` / `ready_for_confirmation`.",
    "Worker log shows the agent intentionally stopped before payment, OTP, CAPTCHA, login, or final confirmation.",
    "Screenshot shows the page at a safe handoff state (review, payment review, OTP prompt, login wall) - not crashed.",
  ],
  nextActions: [
    "Treat as Phase 0 progress. The run was a success at the safety boundary.",
    "Hand the browser to the human reviewer if the founder wants to complete the flow manually.",
    "Add the case to the success taxonomy notes and (if a real demo) capture the screenshot for the YC operator card.",
    "Do not retry automatically; the boundary was intentional.",
  ],
  doNot: [
    "Do not enter CVV or submit payment.",
    "Do not bypass OTP, CAPTCHA, login, or phone verification.",
    "Do not click final booking / final reserve / final purchase / final confirmation.",
    "Do not classify a safe boundary as a regression.",
  ],
};

export const FAILURE_CATEGORIES: ReadonlyArray<FailureCategory> = Object.freeze([
  MODEL_ENV_TRANSIENT,
  PROVIDER_NETWORK_DEGRADED,
  PROVIDER_LOGIC_FAILURE,
  SAFE_BOUNDARY_REACHED,
]);

export const FAILURE_CATEGORY_KEYS: ReadonlyArray<FailureCategoryKey> =
  Object.freeze(FAILURE_CATEGORIES.map((c) => c.key));

export function listFailureCategories(): FailureCategory[] {
  // Defensive shallow copy so consumers cannot mutate the frozen source.
  return FAILURE_CATEGORIES.map((entry) => ({
    ...entry,
    relatedClasses: [...entry.relatedClasses],
    signals: [...entry.signals],
    nextActions: [...entry.nextActions],
    doNot: [...entry.doNot],
  }));
}

export function getFailureCategory(
  key: FailureCategoryKey,
): FailureCategory | null {
  const found = FAILURE_CATEGORIES.find((entry) => entry.key === key);
  if (!found) return null;
  return listFailureCategories().find((entry) => entry.key === key) ?? null;
}

/**
 * Worked example used in docs and tests so the R-030 OpenAI 500 case
 * is preserved as a permanent reminder that "the run failed" is not the
 * same as "the provider failed".
 */
export interface WorkedExample {
  id: string;
  title: string;
  category: FailureCategoryKey;
  /** Short human-readable description of what happened. */
  story: string;
  /** Concrete artifacts the operator captured at the time. */
  evidence: ReadonlyArray<{ label: string; value: string }>;
  /** What was learned about classification. */
  takeaway: string;
}

const R030_OPENAI_500: WorkedExample = {
  id: "r030-openai-responses-500-2026-05-04",
  title:
    "R-030 Resy live run on 2026-05-04 -- OpenAI Responses API 500 before provider step",
  category: "model_env_transient",
  story:
    "Codex ran an authorized R-030 Resy live case. The run never reached Resy. It failed during the planning phase with an OpenAI Responses API server_error 500. There was no provider navigation, no Resy slot click, no guest form attempt.",
  evidence: Object.freeze([
    Object.freeze({
      label: "Task id",
      value: "9ca2a595-09cd-4f03-bb19-2b59c474089b",
    }),
    Object.freeze({
      label: "Job id",
      value: "77f70121-4460-4bcd-974d-999360221cde",
    }),
    Object.freeze({
      label: "OpenAI request id",
      value: "req_ce42a48137424a938a7893b131416d28",
    }),
    Object.freeze({
      label: "Failure mode",
      value: "OpenAI Responses API 500 server_error",
    }),
    Object.freeze({
      label: "Benchmark report",
      value: "benchmark/runs/phase0-resy-2026-05-04T19-14-37-472Z.json",
    }),
  ]),
  takeaway:
    "This is a model_env_transient failure, not a Resy provider regression. The run is inconclusive about Resy fill/OTP closure. The next clean retry can use the same R-030 case once the OpenAI 500 window passes; do not patch Resy code based on this evidence.",
};

const R030_OPENAI_403_MODEL_NOT_FOUND: WorkedExample = {
  id: "r030-openai-403-model-not-found-2026-05-05",
  title:
    "R-030 Resy retry on 2026-05-05 -- OpenAI 403 model_not_found from runtime env/project mismatch",
  category: "model_env_transient",
  story:
    "A second authorized R-030 Resy retry against the same baseline that contained the 422abe0 Resy recovery patches. The browser opened the exact Resy venue URL (date=2026-05-08, seats=2, time=2000) but no provider decision was made. The run failed in nine seconds with an OpenAI Responses API 403 model_not_found because the running Claude worktree process used an OpenAI project/key or inherited env that was not the intended gpt-5.5-enabled project. decisionLog is null. None of the 422abe0 patches (skip duplicate fallback, preserve exact venue URL, reject bare time controls, separate listing-stall from F-AVAIL-NONE) executed; they remain unvalidated by this run.",
  evidence: Object.freeze([
    Object.freeze({
      label: "Task id",
      value: "caa90661-ceb1-4753-aedc-be6282322a62",
    }),
    Object.freeze({
      label: "Job id",
      value: "f66f9e63-d2d0-43fe-940b-8fc0329ca5ef",
    }),
    Object.freeze({
      label: "Failure mode",
      value: "OpenAI Responses API 403 model_not_found gpt-5.5",
    }),
    Object.freeze({
      label: "DB __source marker",
      value: "lib/core/execution-local-c2110aa34d (M5 gate stamped correctly)",
    }),
    Object.freeze({
      label: "DB handoff_url",
      value:
        "https://resy.com/cities/new-york-ny/venues/charlie-bird?date=2026-05-08&seats=2&time=2000 (exact venue URL preserved)",
    }),
    Object.freeze({
      label: "DB decisionLog",
      value: "null (no provider decision recorded)",
    }),
    Object.freeze({
      label: "Job lifetime",
      value: "9 seconds (created 2026-05-05T02:08:36 -> error 02:08:45)",
    }),
    Object.freeze({
      label: "Benchmark report",
      value: "benchmark/runs/phase0-resy-2026-05-05T02-08-50-530Z.json",
    }),
    Object.freeze({
      label: "Safety boundary",
      value:
        "No payment / CVV / OTP / SMS / phone-verification / CAPTCHA / login bypass / final confirmation touched.",
    }),
  ]),
  takeaway:
    "This is a model_env_transient failure (F-INFRA-MODEL-ACCESS), not a Resy provider regression and not a validation of the 422abe0 patches. Closure outcome is inconclusive, not closure pass and not closure fail. The next safe step is to install/verify the intended gpt-5.5-enabled runtime env for the worktree and pass a no-provider model-access preflight, then the founder may explicitly approve exactly one new R-030 attempt; do not patch Resy code based on this evidence.",
};

export const WORKED_EXAMPLES: ReadonlyArray<WorkedExample> = Object.freeze([
  R030_OPENAI_500,
  R030_OPENAI_403_MODEL_NOT_FOUND,
]);

export function listWorkedExamples(): WorkedExample[] {
  return WORKED_EXAMPLES.map((entry) => ({
    ...entry,
    evidence: entry.evidence.map((row) => ({ ...row })),
  }));
}
