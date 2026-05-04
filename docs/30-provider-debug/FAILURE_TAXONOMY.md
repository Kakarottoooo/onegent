# Operator Failure Taxonomy

> Last updated: 2026-05-04
> For: anyone reading the result of a controlled live retry, founder
> debug session, or benchmark run.
> Read time: 4 minutes.

A controlled live run can fail in four very different ways. The wrong
classification leads to either a phantom provider regression bug or a
real provider regression that gets ignored. This doc gives the four
categories, the signals that put a failure into each one, and what to
do next per category.

The pure source of truth is `lib/operator-failure-taxonomy/`. This
document is the operator-facing reading order for it.

## Why this doc exists

On 2026-05-04 a founder-approved R-030 Resy live run never reached
Resy. It failed at planning time with an OpenAI Responses API 500.
Without this taxonomy the run is easy to mis-classify as
"Resy fill/OTP regression". It is not. It is a transient model/env
failure. The Resy provider was never exercised.

```text
Task id:      9ca2a595-09cd-4f03-bb19-2b59c474089b
Job id:       77f70121-4460-4bcd-974d-999360221cde
Failure:      OpenAI Responses API 500 server_error
Request id:   req_ce42a48137424a938a7893b131416d28
Benchmark:    benchmark/runs/phase0-resy-2026-05-04T19-14-37-472Z.json
Category:     model_env_transient
```

The next sections give the framework that produced that classification.

## The four categories

Always pick exactly one category before deciding to patch.

### 1. Model / env transient (`model_env_transient`)

The run died during planning, before the provider was reached. OpenAI,
Computer Use, the Stagehand model, or local browser launch returned a
5xx, rate-limit, timeout, or unavailable error.

Signals:

- `OpenAI Responses API 500 server_error` (matches the R-030 case
  above).
- OpenAI rate-limit 429 / quota exhausted.
- Computer Use unavailable / model not enabled for this account.
- Chromium / Playwright launch error before any navigation started.
- `--live-openai` not set / `ONEGENT_ALLOW_LIVE_OPENAI=1` missing.

Do next:

- Treat the run as inconclusive about provider health.
- Capture the OpenAI request id and timestamp.
- Wait for the next clean retry window. Re-run the same case once.
- If the same case finishes a clean run later, reclassify the
  original failure in the artifact bundle notes.

Do NOT:

- Do not patch a Resy / OpenTable / Expedia / hotel selector.
- Do not file a provider regression bug.
- Do not blind-retry in a tight loop.
- Do not assume a Phase 0 boundary regressed; it was never reached.

Severity: `wait`. Related class: `model_or_env_blocked` in
`/dev/runtime-forensics`.

### 2. Provider network degraded (`provider_network_degraded`)

The provider site itself returned a 5xx, gateway timeout, TCP error,
`net::ERR_*`, or rate-limit during a navigation/fetch step. The
worker reached the provider; the provider could not respond.

Signals:

- HTTP 5xx from the provider domain (resy.com, opentable.com,
  expedia.com, booking.com, hotels.com).
- `net::ERR_TIMED_OUT`, `net::ERR_CONNECTION_RESET`,
  `net::ERR_NAME_NOT_RESOLVED`.
- Cloudflare / Akamai / bot-wall response without a CAPTCHA UI.
- Provider rate-limit / cooldown banner.
- Resy public search API 500s observed across multiple cases in the
  same window.

Do next:

- Capture the failed request URL, status code, response headers if
  available, and a screenshot.
- Do not run more cases for the same provider for a few minutes.
- Re-run the same case once after the cooldown.
- If a fresh probe shows the provider responding normally,
  reclassify the original failure once the artifact bundle is
  reviewed.

Do NOT:

- Do not patch selectors based on a single 5xx.
- Do not bypass a CAPTCHA, bot-wall, or login wall.
- Do not run a broad provider suite while the network signal looks
  degraded.

Severity: `wait`. Related class: `network_or_provider_5xx`,
`provider_network_degraded`.

### 3. Provider logic failure (`provider_logic_failure`)

The provider responded normally, but our selector / strategy / state
machine produced the wrong action or stopped on a real bug. Patchable
after evidence.

Signals:

- Worker log shows the provider page rendered, the strategy ladder
  ran, and a specific selector / step failed.
- Screenshot shows the target option (Southwest card, Buvette result,
  YOTEL room) visibly available while the worker reported `not found`.
- `steps[0].body.__source` is missing or wrong (legacy shape).
- Wrong restaurant / wrong flight / wrong hotel selected in screenshot
  vs. params.
- Form locator matched but `auditAndRefill` left a visible field
  empty.
- Booking.com guest-details vs final-details boundary detected the
  wrong page.

Do next:

- Patch only after comparing DB row + worker log + screenshots + live
  snapshot. Task UI alone is not enough.
- Run the matching analyzer (Resy/OpenTable, Expedia retry, hotel)
  and read the analyzer state before editing any provider code.
- Mirror provider patches to the worker tree and run
  `npm run check-drift`.
- Add a no-live regression test that pins the specific shape that
  broke.

Do NOT:

- Do not click final booking, payment, OTP, CAPTCHA, login, or final
  confirmation as part of debugging.
- Do not bypass a hard stop to confirm a logic theory.
- Do not patch on the basis of the task UI alone.

Severity: `patchable`. Related classes: `legacy_shape_missing_source`,
`provider_form_incomplete`, `resy_modal_disabled_details_api_failed`,
`opentable_form_incomplete`, `card_scan_fallback_not_reached`,
`wrong_card_selected`, `fare_modal_drift`, `checkout_boundary_drift`,
`hotel_search_result_drift`, `room_selection_drift`,
`guest_details_incomplete`.

### 4. Safe boundary reached (`safe_boundary_reached`)

The agent stopped at the correct boundary (login, OTP, CAPTCHA,
payment review, manual confirm, ready_for_confirmation,
paused_payment, or safe handoff). This is success at the safety
boundary, not a regression.

Signals:

- `steps[0].terminalReason` or `steps[0].terminalCode` is one of the
  safe-boundary codes.
- Status is `paused_payment` / `awaiting_confirmation` /
  `ready_for_confirmation`.
- Worker log shows the agent intentionally stopped before payment,
  OTP, CAPTCHA, login, or final confirmation.
- Screenshot shows the page at a safe handoff state, not crashed.

Do next:

- Treat as Phase 0 progress.
- Hand the browser to the human reviewer if the founder wants to
  complete the flow manually.
- Add the case to the success taxonomy notes.
- Do not retry automatically; the boundary was intentional.

Do NOT:

- Do not enter CVV or submit payment.
- Do not bypass OTP, CAPTCHA, login, or phone verification.
- Do not click final booking / final reserve / final purchase / final
  confirmation.
- Do not classify a safe boundary as a regression.

Severity: `info`. Related classes: `safe_manual_review_reached`,
`checkout_reached_manual_review`, `checkout_manual_review_reached`,
`paused_payment`, `otp_or_login_required`,
`resy_otp_login_boundary`, `opentable_phone_otp_handoff`,
`safe_provider_boundary`.

## Worked example: R-030 OpenAI 500 (2026-05-04)

```text
Category:    model_env_transient
Story:       Authorized R-030 Resy live run; failed during planning;
             OpenAI Responses API returned 500 server_error.
             No Resy navigation, no slot click, no guest form attempt.
Evidence:
  Task id:        9ca2a595-09cd-4f03-bb19-2b59c474089b
  Job id:         77f70121-4460-4bcd-974d-999360221cde
  OpenAI req id:  req_ce42a48137424a938a7893b131416d28
  Benchmark:      benchmark/runs/phase0-resy-2026-05-04T19-14-37-472Z.json
Takeaway:    Inconclusive about Resy fill/OTP closure. Re-run R-030
             once the OpenAI window stabilizes; do not patch Resy
             code based on this evidence.
```

## How to use this taxonomy in a real triage

1. After a controlled retry finishes, open the artifact bundle (DB
   row, worker log excerpt, screenshots, live snapshots).
2. Walk down the four categories in order. Stop at the first one
   whose signals match the evidence. There is exactly one correct
   category per run.
3. Write the chosen category in the artifact bundle notes alongside
   the standard analyzer output.
4. If the category is `model_env_transient` or
   `provider_network_degraded`, do not edit provider code. The next
   step is a clean retry, not a patch.
5. If the category is `provider_logic_failure`, run the matching
   analyzer (`scripts/analyze-restaurant-artifact.ts`,
   `scripts/analyze-expedia-retry-artifact.ts`,
   `scripts/analyze-provider-artifact.ts --kind hotel`) and only then
   propose a patch with a no-live regression test.
6. If the category is `safe_boundary_reached`, the run is a success.
   Capture the screenshot for the operator card, do not retry
   automatically, and update the relevant runbook's success taxonomy.

## Source code and runbooks

- Pure module: `lib/operator-failure-taxonomy/`.
- Restaurant runbook cross-reference:
  `docs/20-phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md`.
- Provider runtime debug playbook:
  `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`.
- Runtime forensics workbench:
  `/dev/runtime-forensics` (read-only).
- Live operator checklist (cockpit, when shipped):
  `/dev/live-operator-checklist`. The taxonomy section in that page,
  if/when it lands, is a render of `lib/operator-failure-taxonomy/`
  so this doc and the page do not drift.

## Hard rules

- This doc does not authorize a live provider run.
- This doc does not authorize an OpenAI / Computer Use / payment /
  OTP / CAPTCHA / login bypass / final-confirmation action.
- Do not classify a failure from the task UI alone. Use DB +
  worker log + screenshots + live snapshots.
- Do not edit `lib/booking-autopilot/**`, `lib/core/**`,
  `lib/execution-v2/**`, `worker/src/**`, `app/api/v1/**`,
  `app/api/booking-jobs/**`, or `lib/db.ts` based on this taxonomy
  alone. Use it to decide whether a patch is justified at all,
  then follow the controlled-retry runbook.
