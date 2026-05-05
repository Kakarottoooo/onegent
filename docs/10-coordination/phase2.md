# Phase 2 Coordination - Expedia / Hotel Revival

> Last writer: codex
> Last updated: 2026-05-04
> Current owner: Agent2 / Phase 2 sidecar, with Codex reviewing merges into
> `codex/integrated-preview-20260504`.

## Current State

- Phase 2 remains a demo bonus, not the main trunk.
- Expedia flight is the only current demo-adjacent Phase 2 candidate.
- Booking.com hotel and Hotels.com still need fresh artifacts before any live
  promise.
- No live provider run is approved by default.
- Controlled retry procedure lives in
  `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`.

Safety boundary:

- Do not submit real payment.
- Do not enter CVV.
- Do not bypass OTP, CAPTCHA, or login.
- Do not click final booking or purchase confirmation.
- Do not run a live provider retry without explicit founder approval for that
  exact retry.

## Active Hotel Closure Branch

Codex branch:

- `codex/hotel-live-closure-final`
- Base: latest `origin/codex/integrated-preview-20260504`.
- Scope: Booking.com hotel closure end-to-end toward a safe manual boundary,
  with no live provider run unless the founder explicitly approves exactly one
  Booking.com retry in the active thread.

Closure choice:

- Booking.com is the primary hotel closure candidate because current code and
  docs already contain Booking.com URL construction, hotel result matching,
  direct hotel URL fallback, room-list reveal, room quantity selection,
  guest-details detection, and payment-boundary guards.
- Hotels.com remains fallback only after Booking.com is explicitly blocked.
- Expedia hotel remains out of scope until a separate approved hotel artifact
  proves it is closer than Booking.com.

Runtime hardening in progress:

- Current integrated preview already includes classifier-ready Booking.com hotel
  result candidate capture, room-selection evidence capture, and
  `Booking.com hotel runtime boundary: ...` labels.
- This branch replaces the hotel controlled prompt and generated hotel runtime
  task with a stricter public-Booking.com manual-prep prompt: verify hotel,
  city, dates, guest count, and room count first; stop at the first safe
  manual-review boundary; do not enter payment/card, credentials, OTP/CAPTCHA,
  verification, or final reserve/confirmation controls.
- No-live `provider-closure.ts preflight --kind hotel`, hotel template
  generation, provider closure fixture analyze/report, and hotel artifact
  analyzer fixture classification completed before any live attempt.

Controlled retry remains the exact YOTEL New York Times Square Booking.com case
in `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`.

No live provider, OpenAI live call, payment, CVV/security-code,
OTP/CAPTCHA/login/verification handling, or final confirmation is authorized by
this branch without separate exact founder approval.

## Latest Expedia Evidence

Agent2 audited the latest Expedia MCO to BNA failure and found that job shape
and routing were valid, but the provider failed at the card scan/selector
layer.

Authoritative DB row from `booking_jobs`:

- Job id: `dfa54219-dd3d-447a-9231-a9dd13edf0cb`
- Created: `2026-05-04T06:08:51.821Z`
- Updated: `2026-05-04T06:21:14.177Z`
- Trip label: `Southwest MCO->BNA 2026-06-01`
- Job status: `failed`
- Step type: `flight`
- Step status: `error`
- Source marker: `lib/core/execution-local-c2110aa34d`
- Scenario: `flight`

Step params:

```json
{
  "date": "2026-06-01",
  "dest": "BNA",
  "origin": "MCO",
  "passengers": 1,
  "cabin_class": "economy",
  "targetPrice": 152,
  "targetAirline": "Southwest",
  "targetFlightNumber": "WN 3084",
  "targetDepartureTime": "08:50"
}
```

Step error:

```text
Found a matching outbound earlier, but Expedia no longer shows that exact
option. The fare may have sold out, changed price, or shifted to a different
schedule.
```

Worker log source:

- `C:\Users\Gzw19\onegent-e2e-20260503\codex-worker.log`

Relevant log lines from the latest failure:

- `31667`: start URL normalized to Expedia `Flights-Search` with
  `from:MCO`, `to:BNA`, `departure:2026-06-01`.
- `31681-31683`: Expedia Flight detected; blind agent disabled; programmatic
  flow started for Southwest, `$152`, `08:50`, `WN 3084`.
- `31734`, `31815`, `31903`, `32965`, `33042`, `33128`: search-result
  screenshots written.
- `33129`: `Flight-card DOM scan failed: StagehandEvalError: Uncaught`.
- `33130`: no matching flight button found.
- `33136`: job failed after not reaching checkout.

Artifact paths:

- Latest provider screenshot:
  `C:\Users\Gzw19\onegent-e2e-20260503\worker\.debug-screenshots\flight-rpa-1777875646570\01-search-results.jpg`
- Earlier same-job provider screenshots:
  - `C:\Users\Gzw19\onegent-e2e-20260503\worker\.debug-screenshots\flight-rpa-1777875610611\01-search-results.jpg`
  - `C:\Users\Gzw19\onegent-e2e-20260503\worker\.debug-screenshots\flight-rpa-1777875578337\01-search-results.jpg`
  - `C:\Users\Gzw19\onegent-e2e-20260503\worker\.debug-screenshots\flight-rpa-1777875020259\01-search-results.jpg`
- Latest live snapshot JSON:
  `C:\Users\Gzw19\onegent-e2e-20260503\.debug-screenshots\live\dfa54219-dd3d-447a-9231-a9dd13edf0cb\1777875646269-aeca84.json`

Visual state in the latest screenshot:

- Expedia flight search results loaded.
- One-way MCO to BNA for Monday, June 1 is selected.
- Visible target card shows Southwest Airlines, `8:50am` to `9:55am`,
  Orlando (MCO) to Nashville (BNA), nonstop, `$152`.
- A member-prices/sign-in panel is visible on the right, but public search
  results and the target card are visible. This is not an early login wall.

Failure class:

- Expedia flight-card DOM scan / provider selector layer.

Why this is not routing, job shape, profile gating, or UI copy:

- `steps[0].body.__source` is present and has a current core execution marker:
  `lib/core/execution-local-c2110aa34d`.
- `steps[0].body.scenario` is `flight`.
- `steps[0].body.params` contains route, date, passenger count, cabin, airline,
  target price, departure time, and flight number.
- Worker logs show Expedia Flight programmatic flow activated and the blind
  agent was skipped.
- The normalized URL is the expected Expedia `Flights-Search` URL.
- The worker opened Expedia and reached public search results, so this was not
  an early profile gate.
- The failure happened during flight-card scan before checkout, passenger form,
  payment form, DOB, or travel-document handling.
- The screenshot shows the target Southwest result card visibly present while
  the log reports `Flight-card DOM scan failed`.

## Merged Into Integrated Preview

- `d4eb8c7 test(expedia): cover visible flight card shape`
- Adds a no-live regression test for visible Expedia card shape where time,
  route, airline, and price are visible but flight number is hidden.
- Syncs the worker mirror cend-adapter test so `check-drift` passes.

Verification after merge:

- Expedia / flight / cend-adapter targeted Vitest: 64/64 pass.
- `npm run check-drift`: pass.
- `npx tsc --noEmit --pretty false`: pass.
- `npm run gate:phase1 -- --allow-known-drift`: pass, 9/9, no known drift.

## Next Phase 2 Task

Prepare, but do not run, the controlled Expedia retry. The retry runbook must
be treated as a checklist for a future founder-approved single run, not as an
authorization to start a live provider session.

Before any retry, confirm:

1. Exact founder approval for one Expedia MCO to BNA retry.
2. Worktree is `C:\Users\Gzw19\onegent-integrated-20260504`.
3. Branch is `codex/integrated-preview-20260504`.
4. Branch contains `dd4b19f`, `d4eb8c7`, and current Phase 2 docs.
5. No broad hotel/flight suite will run.

Post-live evidence parser plan:

- DB fields:
  - `booking_jobs.id`
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
- Worker log grep targets:
  - `<retry-job-id>`
  - `flight-rpa`
  - `Expedia`
  - `Flight-card DOM scan`
  - `Trying locator fallback`
  - `Locator fallback matched`
  - `Flight match`
  - `Fare modal`
  - `Checkout reached`
  - `flight checkout was not reached`
  - `profile`
  - `payment`
  - `captcha`
  - `login`
- Screenshot directories:
  - `worker/.debug-screenshots/flight-rpa-*`
  - `.debug-screenshots/live/<retry-job-id>/*.json`

Retry success means one of:

- It gets past card scan into checkout or a safe provider boundary.
- It stops at login, OTP, CAPTCHA, payment review, profile gap, or another
  account-sensitive/provider boundary without bypassing it.
- It returns `paused_payment`, `awaiting_confirmation`, or equivalent safe
  handoff with provider URL and screenshots.

Retry failure means one of:

- `legacy_shape_missing_source`: no `__source` marker or wrong scenario.
- `Flight-card DOM scan failed` appears and no `Trying locator fallback` log
  follows.
- `Trying locator fallback` appears, the screenshot still shows the target
  card, and no candidate is selected.
- A wrong airline, price, or time card is clicked.
- The worker proceeds into CVV, payment submission, OTP/CAPTCHA bypass, or
  final booking confirmation.

Patch only after classifying the retry from DB, logs, and screenshots.

## No-Live Retry Analysis Pack

Agent2 branch:

- `codex/phase2-expedia-retry-analysis-pack`
- Base: `origin/codex/integrated-preview-20260504 @ 400a716`
- Scope: no-live Expedia artifact analysis only.

Added:

- Pure analyzer module:
  `lib/runtime-forensics/expedia-retry-analysis.ts`
- Synthetic no-live fixtures:
  `lib/runtime-forensics/__fixtures__/expedia-retry-analysis/*.json`
- Targeted tests:
  `lib/__tests__/expedia-retry-analysis.test.ts`
- Runbook instructions for using the analyzer on a future controlled retry
  artifact bundle after founder approval.

Analyzer states:

- `card_scan_failed_before_fallback`
- `fallback_attempted_no_match`
- `fallback_matched_no_checkout`
- `checkout_manual_review_reached`
- `network_provider_failure`

Verification from the branch worktree:

- `npx vitest run lib/__tests__/expedia-retry-analysis.test.ts`: pass, 9/9.
- `npm run build:mcp`: pass; needed in the clean worktree before the requested
  TypeScript command could resolve the local MCP workspace package.
- `npx tsc --noEmit --pretty false`: pass after `npm run build:mcp`.
- `npm run check-drift`: pass.
- `git diff --check`: pass.

No live provider was run for this analysis pack. No payment, CVV,
OTP/CAPTCHA/login bypass, or final confirmation path was exercised.

## No-Live Artifact CLI

Agent2 branch:

- `codex/phase2-expedia-artifact-cli`
- Base: `origin/codex/integrated-preview-20260504 @ e76346a`
- Scope: no-live Expedia artifact bundle parsing only.

Added:

- CLI script:
  `scripts/analyze-expedia-retry-artifact.ts`
- Fake-data template:
  `docs/50-product-areas/EXPEDIA_RETRY_ARTIFACT_TEMPLATE.json`
- Targeted CLI helper tests:
  `lib/__tests__/analyze-expedia-retry-artifact-cli.test.ts`

Exact usage after a founder-approved retry has already produced evidence:

```powershell
cd C:\Users\Gzw19\onegent-integrated-20260504
npx tsx scripts/analyze-expedia-retry-artifact.ts .tmp\expedia-retry-artifact-bundle.json
```

The CLI reads only the local JSON artifact bundle and prints the existing
Expedia retry markdown analysis. It does not run a provider, read the database,
open Expedia, click anything, or start a retry.

Validation behavior:

- Missing file: non-zero exit with missing path.
- Invalid JSON: non-zero exit with parse error.
- Empty JSON object: non-zero exit.
- Unknown but valid bundle: Markdown output with `insufficient_evidence`.

Verification from the branch worktree:

- `npx vitest run lib/__tests__/expedia-retry-analysis.test.ts lib/__tests__/analyze-expedia-retry-artifact-cli.test.ts`:
  pass, 17/17.
- `npm run build:mcp`: pass; needed in the clean worktree before the requested
  TypeScript command could resolve the local MCP workspace package.
- `npx tsc --noEmit --pretty false`: pass after `npm run build:mcp`.
- `npm run check-drift`: pass.
- `git diff --check`: pass.

No live provider was run for this CLI pack. No payment, CVV,
OTP/CAPTCHA/login bypass, or final confirmation path was exercised.

## Hotel No-Live Artifact Audit

Agent2 branch:

- `codex/phase2-hotel-artifact-audit`
- Base: latest `origin/codex/integrated-preview-20260504`
- Scope: no-live hotel vertical audit and controlled retry preparation only.

Added:

- Hotel audit:
  `docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md`
- Hotel controlled retry runbook:
  `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`
- Synthetic Booking.com hotel runtime-forensics fixture:
  `lib/runtime-forensics/__fixtures__/booking-hotel-guest-form-incomplete.json`
- Fixture index/test updates for the synthetic hotel fixture.

Current hotel posture:

- Booking.com is the primary hotel path, but still needs fresh artifacts before
  live promises.
- Hotels.com remains a fallback/Expedia Group checkout compatibility path, not
  a separate live-ready demo promise.
- Expedia hotel provider support exists, but there is no current fresh hotel
  artifact proving checkout reach.
- Clean branch artifact check found no current `codex-worker.log`,
  `benchmark/runs`, `worker/.debug-screenshots`, or `.debug-screenshots/live`
  hotel evidence in the worktree.

Verification from the branch worktree:

- `npx vitest run lib/__tests__/runtime-forensics-fixtures.test.ts lib/__tests__/final-outcome-signals.test.ts lib/__tests__/booking-links.test.ts lib/__tests__/demo-control-room-phase2-status.test.ts`:
  pass, 116/116.
- `npm run build:mcp`: pass; needed in the clean worktree before the requested
  TypeScript command could resolve the local MCP workspace package.
- `npx tsc --noEmit --pretty false`: pass after `npm run build:mcp`.
- `npm run check-drift`: pass.
- `git diff --check`: pass.

No live provider was run for this hotel audit. No payment, CVV,
OTP/CAPTCHA/login bypass, or final confirmation path was exercised.

## No-Live Hotel Analyzer Port

Codex branch:

- `codex/phase2-goal-hotel-analyzer-port`
- Base: latest `origin/codex/integrated-preview-20260504`
- Source goal commit:
  `0214f0a23963cffa4a9c6a8d36696a8bbb4d8236`
- Scope: confirm the selective hotel analyzer port on latest integrated and
  record no-live verification. The analyzer files themselves are present in
  latest integrated via `98473e9`.

Confirmed present on latest integrated:

- Pure hotel artifact analyzer:
  `lib/runtime-forensics/hotel-retry-analysis.ts`
- Synthetic no-live hotel analyzer fixtures:
  `lib/runtime-forensics/__fixtures__/hotel-retry-analysis/*.json`
- Targeted analyzer tests:
  `lib/__tests__/hotel-retry-analysis.test.ts`
- Runtime-forensics barrel export for the hotel analyzer.

Still not ported by this branch:

- `scripts/analyze-phase2-artifact.ts`; the existing Expedia-specific CLI
  remains the current robust validated artifact CLI path.
- Goal-branch hotel runbook/audit rewrites. Current integrated
  `HOTEL_CONTROLLED_RETRY_RUNBOOK.md` and `HOTEL_VERTICAL_REVIVAL_AUDIT.md`
  were preserved.
- `HUDDLE.md`.

Hotel analyzer states:

- `room_selection_drift`
- `guest_details_manual_review_reached`
- `payment_manual_review_reached`
- `login_or_captcha_boundary`
- `profile_gating`
- `network_provider_failure`
- `safety_boundary_violation`
- `insufficient_evidence`

Verification from the branch worktree:

- `npx vitest run lib/__tests__/hotel-retry-analysis.test.ts lib/__tests__/runtime-forensics-fixtures.test.ts`:
  pass, 58/58.
- `npm run build:mcp`: pass; needed in the clean worktree before the requested
  TypeScript command could resolve the local MCP workspace package.
- `npx tsc --noEmit --pretty false`: pass after `npm run build:mcp`.
- `npm run check-drift`: pass.
- `git diff --check`: pass.

No live provider was run for this analyzer port. No payment, CVV,
OTP/CAPTCHA/login bypass, or final confirmation path was exercised.

## Unified No-Live Artifact CLI

Agent2 branch:

- `codex/phase2-unified-artifact-cli`
- Base: latest `origin/codex/integrated-preview-20260504 @ 0b83d1b`
- Scope: pure local artifact bundle analysis only.

Added:

- Unified CLI:
  `scripts/analyze-provider-artifact.ts`
- Supported kinds:
  `expedia`, `hotel`, `restaurant`
- Targeted CLI tests:
  `lib/__tests__/analyze-provider-artifact-cli.test.ts`

Usage:

```powershell
npx tsx scripts/analyze-provider-artifact.ts --kind expedia .tmp\expedia-retry-artifact-bundle.json
npx tsx scripts/analyze-provider-artifact.ts --kind hotel .tmp\hotel-retry-artifact-bundle.json
npx tsx scripts/analyze-provider-artifact.ts --kind restaurant .tmp\restaurant-artifact-bundle.json
```

The CLI reuses the existing Expedia, hotel, and restaurant artifact analyzers.
It only reads an existing local JSON bundle and prints paste-ready Markdown.
It does not read the database, start workers, open providers, call OpenAI, or
click anything.

Validation from this branch worktree:

- `npx vitest run lib/__tests__/analyze-provider-artifact-cli.test.ts lib/__tests__/analyze-expedia-retry-artifact-cli.test.ts lib/__tests__/restaurant-artifact-analysis.test.ts lib/__tests__/debug-artifacts.test.ts`:
  pass, 51/51. Note: literal `lib/__tests__/*artifact*.test.ts` did not
  expand under PowerShell/Vitest 4 and exited with no matching files; the
  explicit artifact test file list is the equivalent runnable form in this
  environment.
- `npx tsx scripts/analyze-provider-artifact.ts --kind restaurant lib/runtime-forensics/__fixtures__/restaurant-artifact-analysis/resy-modal-disabled-details-api-failed.json`:
  pass; printed restaurant artifact Markdown with
  `resy_modal_disabled_details_api_failed`.
- `npm run build:mcp`: pass; needed in the clean worktree before the requested
  TypeScript command could resolve the local MCP workspace package.
- `npx tsc --noEmit --pretty false`: pass after `npm run build:mcp`.
- `npm run check-drift`: pass.
- `git diff --check`: pass.

No live provider was run for this CLI pack. No OpenAI live call, payment, CVV,
OTP/CAPTCHA/login bypass, or final confirmation path was exercised.

## Flight Live Readiness Pack v2

Agent2 branch:

- `codex/flight-live-readiness-pack-v2`
- Base: latest `origin/codex/integrated-preview-20260504 @ 0c7efca`
- Scope: Expedia/flight no-live readiness and artifact-driven runtime closure
  only.

Previous branch review:

- Reviewed `codex/flight-controlled-runtime-closure @ f58ab84` against latest
  integrated tip.
- `f58ab84` was not yet in integrated, so its no-live prompt/source-marker
  guard was ported into this branch and expanded.
- No provider selector/runtime patch was made.

Inspected:

- Expedia flight runtime path:
  `lib/booking-autopilot/providers/expedia.ts`
- Expedia flight executor handoff path:
  `lib/booking-autopilot/stagehand-executor.ts`
- Expedia retry analyzer:
  `lib/runtime-forensics/expedia-retry-analysis.ts`
- Expedia retry fixtures:
  `lib/runtime-forensics/__fixtures__/expedia-retry-analysis/*.json`

Added:

- Pure no-live readiness validator:
  `lib/runtime-forensics/expedia-flight-live-readiness.ts`
- No-live controlled retry preflight test:
  `lib/__tests__/expedia-controlled-retry-preflight.test.ts`
- Expedia artifact template updates:
  `docs/50-product-areas/EXPEDIA_RETRY_ARTIFACT_TEMPLATE.json`
- Runtime-forensics classifier/report tests for OpenAI Responses API 500 as a
  non-provider model/env transient while preserving Expedia provider signals.
- Runbook checklist for exact prompt:
  `帮我订一个6月1号从奥兰多飞 Nashville 的机票，一个人`

Preflight guard coverage:

- Required env names `POSTGRES_URL` and `OPENAI_API_KEY` are checked by name
  only; values are intentionally not printed.
- If present, `USE_WORKER_FOR` must include `flight`.
- `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID` must be present together or
  absent together.
- Exact prompt and Expedia start URL must match the controlled retry.
- Normalized params must include `origin=MCO`, `dest=BNA`,
  `date=2026-06-01`, and `passengers=1`.
- Source marker must be present at `steps[0].body.__source` or
  `step.__source` before a worker start.
- Hard stops cover payment submission, CVV, OTP, CAPTCHA, login bypass, and
  final booking confirmation.
- Expected artifact paths cover `codex-worker.log`,
  `worker/.debug-screenshots/flight-rpa-*`,
  `.debug-screenshots/live/<retry-job-id>/*.json`, and
  `benchmark/runs/<retry-run-id>.json`.
- Card-scan fallback signals classify through the existing Expedia retry
  analyzer.
- Checkout/manual-review evidence wins over diagnostic fallback evidence.
- OpenAI Responses API 500 classifies as model/env transient, not provider
  selector drift, while provider-specific Expedia signals remain visible.
- Expedia/provider 503 still classifies as provider/network, not model/env.

Validation from the branch worktree:

- `npx vitest run lib/__tests__/expedia-controlled-retry-preflight.test.ts lib/__tests__/expedia-retry-analysis.test.ts lib/__tests__/expedia-flight-card-match.test.ts lib/__tests__/runtime-forensics-classifier.test.ts lib/__tests__/runtime-forensics-report.test.ts`:
  pass, 140/140.
- `npm run build:mcp`: pass; needed in the clean worktree before the requested
  TypeScript command could resolve the local MCP workspace package.
- `npx tsc --noEmit --pretty false`: pass after `npm run build:mcp`.
- `npm run check-drift`: pass.
- `git diff --check`: pass.

No live provider was run for this readiness pack. No OpenAI live call, payment,
CVV, OTP/CAPTCHA/login bypass, or final confirmation path was exercised. If
founder later approves one retry, DB row plus worker log plus screenshots plus
benchmark artifact remain the source of truth before any selector/runtime
patch.

## Expedia Flight Runtime Closure

Agent branch:

- `codex/flight-runtime-closure`
- Base: `origin/codex/integrated-preview-20260504 @ cad9885`
- Worktree: `C:\Users\Gzw19\onegent-flight-runtime-closure`

Scope:

- Expedia flight runtime only.
- No restaurant/hotel provider logic touched.
- No live provider run, OpenAI live call, payment/CVV, OTP/CAPTCHA/login bypass,
  or final booking confirmation.

Runtime changes:

- Hardened Expedia flight card evidence capture in
  `lib/booking-autopilot/providers/expedia.ts` and worker mirror.
- Candidate traces now include structured airline/time/route/price/flight-number
  evidence where available, with text fallback when the flight number is hidden.
- If coordinate click on the matched card does not open the fare modal, runtime
  retries the same target via DOM rescan and then Playwright locator fallback,
  logging candidate evidence for both paths.
- Added login/OTP/CAPTCHA safety-boundary detection before card scan and before
  final checkout classification. It stops for manual intervention and does not
  bypass auth or verification.
- Expedia retry analyzer now recognizes `login_or_otp_boundary`.

No-live preflight:

- Added `scripts/preflight-expedia-controlled-flight.ts`.
- It only accepts the exact MCO -> BNA 2026-06-01 controlled task and refuses
  broad-run flags such as `--all`, `--provider`, `--kind`, or `--live`.
- It checks env names without printing values, exact prompt/start URL,
  hard-stop coverage, and expected artifact paths.

Validation:

- `npx vitest run lib/__tests__/expedia-flight-card-match.test.ts lib/__tests__/expedia-retry-analysis.test.ts lib/__tests__/expedia-controlled-retry-preflight.test.ts lib/__tests__/preflight-expedia-controlled-flight-cli.test.ts`:
  pass, 30/30.
- `npx vitest run lib/__tests__/expedia-flight-card-match.test.ts lib/__tests__/expedia-retry-analysis.test.ts lib/__tests__/expedia-controlled-retry-preflight.test.ts lib/__tests__/preflight-expedia-controlled-flight-cli.test.ts lib/__tests__/runtime-forensics-classifier.test.ts lib/__tests__/runtime-forensics-report.test.ts`:
  pass, 152/152.
- `npm run build:mcp`: pass; needed before TypeScript in the clean worktree.
- `npx tsc --noEmit --pretty false`: pass.
- `npm run check-drift`: pass.
- `git diff --check`: pass.
- `npm run gate:phase1 -- --allow-known-drift`: pass, 9/9.
- `npx tsx scripts/preflight-expedia-controlled-flight.ts --confirm-one-controlled-retry --prompt "帮我订一个6月1号从奥兰多飞 Nashville 的机票，一个人" --start-url "https://www.expedia.com/Flights-Search?trip=oneway&leg1=from:MCO,to:BNA,departure:2026-06-01TANYT&passengers=adults:1&options=cabinclass:coach&mode=search"`:
  pass with placeholder env names and no env values printed.

## Flight Live Closure Final

Agent branch:

- `codex/flight-live-closure-final`
- Base: `origin/codex/integrated-preview-20260504 @ bcd2895`
- Scope: Expedia flight provider/runtime and runtime-forensics only.

Controlled live evidence:

- Exactly one founder-authorized Expedia MCO -> BNA retry was run on
  2026-05-04 America/Chicago / 2026-05-05 UTC.
- Job id: `2c5065b2-c5e2-4822-83f1-125af645d3cd`.
- Session id: `codex-flight-live-closure-final-20260504-203055`.
- Source marker: `lib/core/execution-local-c2110aa34d`.
- Params: `origin=MCO`, `dest=BNA`, `date=2026-06-01`,
  `passengers=1`, `cabin_class=economy`, `targetAirline=Southwest`,
  `targetDepartureTime=08:50`, `targetFlightNumber=WN 3084`,
  `targetPrice=152`.
- Handoff URL matched the exact Expedia one-way search URL from the runbook.
- Outcome: failed before fare modal, checkout, or manual-review boundary.
- Hard stops: no payment, CVV/security-code, OTP/CAPTCHA/login bypass, or
  final booking/purchase confirmation occurred.

Source-of-truth artifacts:

- DB/API row snapshot:
  `C:\Users\Gzw19\onegent-integrated-20260504\.tmp\flight-live-closure-final-final-job-api.json`
- Worker log:
  `C:\Users\Gzw19\onegent-integrated-20260504\codex-worker.log`
- Worker screenshot directories:
  `C:\Users\Gzw19\onegent-integrated-20260504\worker\.debug-screenshots\flight-rpa-1777944673127`,
  `...\flight-rpa-1777944711935`,
  `...\flight-rpa-1777944747504`
- Live snapshots:
  `C:\Users\Gzw19\onegent-integrated-20260504\.debug-screenshots\live\2c5065b2-c5e2-4822-83f1-125af645d3cd\*.json`
- Sanitized provider closure artifact:
  `C:\Users\Gzw19\onegent-integrated-20260504\.tmp\flight-live-closure-final-evidence-bundle.json`

Failure class:

- Provider closure report classified the sanitized bundle as
  `selector_drift`, provider state `fallback_attempted_no_match`.
- This is not routing/job shape: source marker, scenario, params, start URL,
  and worker flight routing were correct, and the worker entered
  `bookExpediaFlightProgrammatic`.
- The exact runtime fault was the locator fallback calling
  `item.evaluate(...)` after the primary DOM scan failed. In the live worker
  locator shape, `item.evaluate` was not available, so the run aborted with
  `item.evaluate is not a function`.
- Latest screenshot also showed a visible Southwest `$152` card at `9:55pm`,
  not the target `08:50` / `WN 3084` hint. The runtime should not select a
  price-only wrong-time fallback card.

Patch:

- Expedia flight locator fallback now reads candidate text by capability:
  `evaluate` when available, then `aria-label`, text/innerText, and nearby
  ancestor text. This keeps candidate evidence available when Stagehand locator
  wrappers do not expose `evaluate`.
- Expedia flight fallback matching no longer treats price alone as sufficient
  when a target departure time is present. It requires flight number evidence
  or a nearby target time before selecting a fallback candidate.
- Worker mirror was updated with the same Expedia flight runtime changes.
- Expedia retry analyzer now ignores hard-stop checklist notes such as
  "no OTP/CAPTCHA/login bypass" when classifying observed provider boundary
  signals, so safety checklist text does not mask selector/runtime failures.

Validation:

- `npx tsx scripts/preflight-expedia-controlled-flight.ts --confirm-one-controlled-retry --prompt <exact controlled prompt> --start-url <exact Expedia URL>`:
  pass; env names only, values omitted.
- `npx tsx scripts/provider-closure.ts preflight --kind flight`: pass.
- `npx tsx scripts/provider-closure.ts report --kind flight --artifact .tmp\flight-live-closure-final-evidence-bundle.json --markdown`:
  pass; outcome `selector_drift`, provider state `fallback_attempted_no_match`.
- `npx vitest run lib/__tests__/expedia-retry-analysis.test.ts lib/__tests__/expedia-flight-card-match.test.ts`:
  pass, 23/23.
- `npx vitest run lib/__tests__/expedia-flight-card-match.test.ts lib/__tests__/expedia-retry-analysis.test.ts lib/__tests__/expedia-controlled-retry-preflight.test.ts lib/__tests__/preflight-expedia-controlled-flight-cli.test.ts lib/__tests__/runtime-forensics-classifier.test.ts lib/__tests__/runtime-forensics-report.test.ts lib/__tests__/provider-closure-analysis.test.ts lib/__tests__/provider-closure-cli.test.ts`:
  pass, 166/166.
- `npx tsc --noEmit --pretty false`: pass.
- `npm run check-drift`: pass.
- `git diff --check`: pass.
- `npm run gate:phase1 -- --allow-known-drift`: pass, 9/9.

Next live retry guidance:

- Do not rerun live from this branch without a new explicit founder approval.
- If approved, run only the single Expedia MCO -> BNA controlled retry from the
  runbook. Do not run a broad flight suite.
- The next retry should either reach a safe checkout/manual-review/login/OTP
  boundary, classify no availability/provider degradation, or produce candidate
  evidence without the `item.evaluate` crash.
