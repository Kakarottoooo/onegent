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
