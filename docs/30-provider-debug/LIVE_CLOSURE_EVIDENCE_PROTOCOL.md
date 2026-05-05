# Live Closure Evidence Protocol

Last updated: 2026-05-05

Scope: no-live post-run evidence handling for the next controlled restaurant,
flight, and hotel closure attempts. This protocol does not approve or start a
live provider run. A human must separately approve one exact command before any
live provider, OpenAI, Computer Use, or browser automation is used.

Operator surface: the read-only cockpit at `/dev/provider-closure` mirrors this
protocol per vertical (current closure posture, last known blocker, evidence
required, hard stops, what to inspect after run, no-live CLI commands). See
`docs/30-provider-debug/PROVIDER_CLOSURE_OPERATOR_ROOM.md` for the cockpit's
usage doc and
`docs/30-provider-debug/PROVIDER_CLOSURE_ACCEPTANCE.md` for the canonical
per-vertical pass / fail / inconclusive criteria. Tooling passing is not
provider closure passing; until the acceptance doc records verified live
closure for a lane, that lane remains `liveVerified: false`. Phase 0A
restaurant now has accepted OpenTable evidence in the acceptance doc; flight
and hotel remain not live verified.

## Hard Stops

These stops apply to every vertical:

- Payment submission or final purchase/reserve/booking confirmation.
- CVV, CVC, card number, or security-code request.
- OTP, one-time code, SMS code, phone verification, CAPTCHA, bot challenge, or
  login/account-sensitive prompt.
- Login, CAPTCHA, OTP, or account-check bypass.
- Wrong provider item selected: wrong restaurant/time/covers, wrong flight,
  wrong hotel/dates/room/guest count, or wrong price.
- Provider leaves the expected public search/detail/review path.
- Any automation path that would click an irreversible final action.
- Do not add run/retry/live buttons, retry loops, or one-click live controls.

Stop immediately, preserve evidence, and move to manual review. Do not retry,
patch, or continue from task UI copy alone.

## Evidence Order

For all verticals, collect evidence in this order:

1. DB row fields from `booking_jobs`.
2. Benchmark report or live-run report when the attempt came from a benchmark
   harness.
3. Bounded worker log excerpt from the active worktree.
4. Next.js log excerpt only when the app surface or API route failed before
   provider execution.
5. Provider screenshot paths.
6. Live snapshot JSON paths.
7. Operator notes with hard-stop observations.
8. Artifact bundle template filled from copied evidence.
9. Analyzer output.

The analyzer result is evidence summarization, not proof by itself. If it
returns `insufficient_evidence`, collect more DB/log/screenshot data before
patching or retrying.

## Unified Closure Harness

Use the provider closure harness when an operator has already collected the
DB row, bounded worker log excerpt, screenshot paths, live snapshot paths, and
notes for one restaurant, flight, or hotel attempt.

```powershell
npx tsx scripts/provider-closure.ts preflight --kind restaurant
npx tsx scripts/provider-closure.ts preflight --kind flight
npx tsx scripts/provider-closure.ts preflight --kind hotel
```

The harness accepts either the normalized closure schema or the older analyzer
bundle shape used by the restaurant, Expedia, and hotel artifact analyzers.
It normalizes provider-specific states plus the runtime-forensics classifier
into this terminal taxonomy:

- `safe_handoff`
- `login_otp_boundary`
- `no_availability`
- `provider_degraded`
- `selector_drift`
- `model_env_transient`
- `unsafe_blocked`
- `insufficient_evidence`

Analyze and report from an already-collected local artifact only:

```powershell
npx tsx scripts/provider-closure.ts analyze --kind flight --artifact .tmp\expedia-retry-artifact-bundle.json
npx tsx scripts/provider-closure.ts report --kind flight --artifact .tmp\expedia-retry-artifact-bundle.json --markdown
```

The harness never reads `.env.local`, opens a browser, starts a worker, starts
a provider run, calls OpenAI, writes booking state, or clicks anything. Treat
its `exactNextStep` field as the operator's next safe action, then verify
against DB/log/screenshots before patching.

Synthetic example reports live under:

```text
docs/30-provider-debug/provider-closure-reports/
```

## Provider Closure War Room

Use the war-room CLI when the operator needs the full closed loop:
preflight checklist, artifact ingestion, normalized evidence object,
classification, root-cause recommendation, regression checklist, and demo
readiness verdict.

```powershell
npx tsx scripts/provider-closure-war-room.ts preflight --vertical restaurant
npx tsx scripts/provider-closure-war-room.ts preflight --vertical flight
npx tsx scripts/provider-closure-war-room.ts preflight --vertical hotel
```

The war-room bundle wraps the existing artifact shape and adds:

- `vertical`: `restaurant`, `flight`, or `hotel`.
- `liveAttempt`: explicit marker that the evidence came from one
  human-approved attempt.
- `evidenceCapturedAt`: ISO timestamp used for freshness checks.
- `dbRow`: copied `booking_jobs` row JSON.
- `workerLogExcerpt` and `workerLogPath`.
- `screenshotManifest.paths`.
- `screenshotManifest.liveSnapshots`.
- `notes`.

Analyze a filled local bundle:

```powershell
npx tsx scripts/provider-closure-war-room.ts analyze --vertical flight --bundle .tmp\expedia-retry-artifact-bundle.json --markdown
```

Summarize bundled synthetic fixtures and check demo posture:

```powershell
npx tsx scripts/provider-closure-war-room.ts summarize --all
npx tsx scripts/provider-closure-war-room.ts demo-verdict
```

War-room verdicts:

- `live_closed_safe_boundary`: a fresh, minimum-evidence live artifact reached
  an accepted safe boundary.
- `live_blocked_provider_or_network`: provider/network evidence blocked the
  attempt before selector conclusions are reliable.
- `live_blocked_selector_or_dom`: screenshots/logs point to selector, DOM,
  matching, or boundary-detection drift.
- `live_blocked_model_or_env`: OpenAI Responses API, Computer Use, model, or
  local environment evidence failed separately from provider selectors.
- `not_live_verified`: synthetic, stale, placeholder, missing
  `liveAttempt`, missing `evidenceCapturedAt`, incomplete DB/log/screenshot
  evidence, or lower-level `insufficient_evidence`.
- `unsafe_or_disallowed_boundary`: payment, CVV/security-code, account
  verification, human verification, login bypass, or final confirmation
  boundary was crossed or attempted by automation.

`ProviderClosureEvidence` is the normalized object for every vertical. It
contains the provider kind, job/task ids, DB row, worker log excerpt, worker
log path, screenshot paths, live snapshot paths, freshness status, minimum
evidence flags, and the lower-level closure analyzer output.

YC/demo claim rule: a vertical is claimable only when a non-synthetic, fresh,
minimum-evidence artifact has `liveAttempt: true` and verdict
`live_closed_safe_boundary`. Synthetic fixtures, old analyzer fixtures, and
task UI summaries alone must remain `not live verified` for demo purposes.

Synthetic war-room reports live under:

```text
docs/30-provider-debug/provider-closure-war-room/
```

## DB Fields

Inspect these fields before reading task UI summaries:

- `id`
- `trip_label`
- `status`
- `created_at`
- `updated_at`
- `task_id`
- `steps[0].type`
- `steps[0].status`
- `steps[0].error`
- `steps[0].terminalReason`
- `steps[0].terminalCode`
- `steps[0].handoff_url`
- `steps[0].body.__source`
- `steps[0].body.scenario`
- `steps[0].body.params`
- `steps[0].decisionLog`
- `steps[0].profileGap`

The source marker and params must come from the DB row. Do not infer them from
the task card.

## Benchmark Report

Restaurant benchmark evidence can include:

- benchmark case id and scenario id;
- benchmark verdict and failure class;
- provider strategy ladder;
- retry history when present;
- `rawWorkerLogExcerpt`;
- screenshot directory;
- analyzer output.

If a benchmark report says no availability, network/provider degraded, or
model/env transient, treat that as a no-patch state until DB/log/screenshots
prove otherwise.

## Logs

Worker log source:

```text
C:\Users\Gzw19\onegent-integrated-20260504\codex-worker.log
```

Use a bounded grep around the job id plus provider-specific markers. Do not
paste full logs or secrets into a bundle.

Next.js logs matter only for app/API failures before provider execution, for
example a local page/API 500 before a booking job reaches a worker. They do not
replace the worker log for provider execution evidence.

OpenAI Responses API 500 must be treated as a model/env transient, not as a
provider 5xx. It belongs with `model_or_env_blocked` / infrastructure evidence
unless screenshots and provider logs independently prove a provider failure.
In short: classify `OpenAI Responses API 500` as model/env transient, not as a
provider 5xx.

## Screenshot Paths

Provider screenshots are expected under:

```text
C:\Users\Gzw19\onegent-integrated-20260504\worker\.debug-screenshots\
```

Live snapshots are expected under:

```text
C:\Users\Gzw19\onegent-integrated-20260504\.debug-screenshots\live\<job-id>\*.json
```

For every screenshot set, answer:

- Did the page show the intended target?
- Did the page state match `steps[0].error` and the worker log?
- Was a hard stop visible?
- Did a network/model/env failure happen before provider controls were usable?

## Restaurant Closure

Controlled docs:

- `docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md`
- `docs/20-phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md`

Primary evidence:

- DB row for the Resy/OpenTable job.
- Restaurant benchmark report when the run came from the benchmark harness.
- Worker log markers: `resy`, `opentable`, `guest_form`, `mobile_verify`,
  `paused_payment`, `safe_handoff`, `F-AVAIL-NONE`, `captcha`, `login`, `OTP`,
  `CVV`, `final`.
- Provider screenshots under the provider run directory.
- Live snapshot JSON.

Safe classifications:

- `resy_modal_disabled_details_api_failed`
- `resy_otp_login_boundary`
- `resy_no_availability`
- `opentable_phone_otp_handoff`
- `opentable_form_incomplete`
- `provider_network_degraded`
- `safe_manual_review_reached`
- `model_or_env_blocked`

Use:

```powershell
npx tsx scripts/create-artifact-bundle-template.ts --kind restaurant
npx tsx scripts/analyze-provider-artifact.ts --kind restaurant .tmp\restaurant-artifact-bundle.json
```

## Flight Closure

Controlled doc:

- `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`

Primary evidence:

- DB row for the Expedia flight job.
- Worker log markers: `flight-rpa`, `Expedia`, `Flight-card DOM scan`,
  `Trying locator fallback`, `Locator fallback matched`, `Flight match`,
  `Fare modal`, `Checkout reached`, `flight checkout was not reached`,
  `profile`, `payment`, `captcha`, `login`, `OTP`, `CVV`, `final`.
- Screenshots under `worker\.debug-screenshots\flight-rpa-*`.
- Live snapshot JSON.

Safe classifications:

- `card_scan_failed_before_fallback`
- `fallback_attempted_no_match`
- `fallback_matched_no_checkout`
- `checkout_manual_review_reached`
- `network_provider_failure`
- `model_or_env_blocked`

Use:

```powershell
npx tsx scripts/create-artifact-bundle-template.ts --kind expedia
npx tsx scripts/analyze-provider-artifact.ts --kind expedia .tmp\expedia-retry-artifact-bundle.json
```

## Hotel Closure

Controlled doc:

- `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`

Primary evidence:

- DB row for the Booking.com / Hotels.com hotel job.
- Worker log markers: `Booking.com`, `booking-com`, `Hotels.com`,
  `hotels-com`, `hotel`, `normaliseStartUrl`, `searchresults`,
  `hotel detail`, `room`, `selected room`, `guest-details`, `guest details`,
  `final details`, `payment`, `paused_payment`, `checkout`, `sold out`,
  `fully booked`, `No exact matches`, `captcha`, `login`, `OTP`, `CVV`,
  `final`.
- Screenshots under `worker\.debug-screenshots\`.
- Live snapshot JSON.

Safe classifications:

- `room_selection_manual_review_reached`
- `guest_details_manual_review_reached`
- `payment_manual_review_reached`
- `login_or_captcha_boundary`
- `profile_gating`
- `network_provider_failure`
- `room_selection_drift`
- `model_or_env_blocked`

Use:

```powershell
npx tsx scripts/create-artifact-bundle-template.ts --kind hotel
npx tsx scripts/analyze-provider-artifact.ts --kind hotel .tmp\hotel-retry-artifact-bundle.json
```

## Bundle Redaction

Before saving or analyzing a filled bundle, verify:

- no real email address, phone number, address, account id, or profile data;
- no payment card number;
- no CVV/CVC/security-code value;
- no OTP, one-time-code, SMS-code, phone-verification, or CAPTCHA value;
- no login-bypass, account-bypass, payment-submission, or final-confirm action
  recorded as an automated step.

Safe-boundary terms may appear as descriptions. Secret values must not.

## Patch Rule

Patch only after DB row, worker log, screenshots, and live snapshots agree on
the same root cause. Do not patch selectors from provider/network degradation,
model/env transients, or task UI summaries alone.
