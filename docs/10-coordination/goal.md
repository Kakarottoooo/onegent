# Goal Handoff - Runtime Closure Consolidation

Last updated: 2026-05-04

Integrated branches:

- `codex/goal-live-artifact-bridge @ f331ccc`
- `codex/goal-artifact-corpus-consolidation @ bb238b7`
- `codex/goal-runtime-closure-consolidation @ d42c8dc`

Codex cherry-picked the useful no-live evidence work onto the latest
`codex/integrated-preview-20260504` after the Resy R-030 runtime fix, instead
of branch-head merging older bases.

## Current State

This is a no-live consolidation package for closing Phase 0 restaurant,
Expedia flight, and hotel work from already-collected evidence. It adds
reviewable docs, artifact templates, fixture/test coverage, fixture inventory
guards, and one classifier clarification for OpenAI Responses API 5xx failures.

No provider runtime, worker, core, execution-v2, booking-job API, v1 API,
database, schema, live-run, retry, or dashboard control path is changed.

## Merge Plan

Safe cherry-picks kept:

- `f331ccc` from `codex/goal-live-artifact-bridge`: no-live artifact bridge
  doc, template script, and template tests.
- `f58ab84` from `codex/flight-controlled-runtime-closure`: Expedia controlled
  retry preflight test and runbook additions. Stale coordination overlap was
  dropped.
- `10192569` from `codex/hotel-controlled-runtime-closure`: hotel analyzer
  fixture, retry-analysis logic/test hardening, and hotel runbook additions.
- `bb238b7` from `codex/goal-artifact-corpus-consolidation`: fixture corpus
  inventory and static guards.
- `d42c8dc` from `codex/goal-runtime-closure-consolidation`: live closure
  evidence protocol, template CLI coverage, and classifier clarification.

Intentionally skipped or kept separate:

- `fbd701a` from `claude/live-operator-control-surface`: skipped direct merge
  because it added a broader `app/dev` UI surface. The no-mutation operator
  safety requirements are covered by docs/static guards and can be reviewed as
  a separate UI proposal if needed.

Overlap handled manually:

- `docs/10-coordination/goal.md` was rewritten as this integrated handoff.
- Stale coordination edits were dropped when they duplicated newer integrated
  preview state.
- Fixture counts now reflect the current integrated corpus after Agent2/Agent3
  live-readiness packs.

## Changed Files

- `docs/10-coordination/goal.md`
- `docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md`
- `docs/50-product-areas/ARTIFACT_CORPUS_INVENTORY.md`
- `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`
- `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`
- `docs/50-product-areas/LIVE_ARTIFACT_BRIDGE.md`
- `docs/INDEX.md`
- `lib/__tests__/artifact-bundle-template.test.ts`
- `lib/__tests__/artifact-fixture-corpus.test.ts`
- `lib/__tests__/expedia-controlled-retry-preflight.test.ts`
- `lib/__tests__/hotel-retry-analysis.test.ts`
- `lib/__tests__/live-closure-evidence-protocol-static.test.ts`
- `lib/__tests__/runtime-forensics-classifier.test.ts`
- `lib/runtime-forensics/__fixtures__/hotel-retry-analysis/booking-room-selection-reached.json`
- `lib/runtime-forensics/classifier.ts`
- `lib/runtime-forensics/hotel-retry-analysis.ts`
- `scripts/create-artifact-bundle-template.ts`
- `scripts/list-artifact-fixtures.ts`

## Bridge Behavior

`scripts/create-artifact-bundle-template.ts` prints synthetic templates for:

- `restaurant`
- `expedia`
- `hotel`

Each template includes placeholders for job id, task id, provider, scenario,
status, terminal classification, DB excerpt, worker-log excerpt, screenshot
paths, and operator notes. It does not read or write provider data, and it does
not run browser automation.

## Fixture Inventory

`npx tsx scripts/list-artifact-fixtures.ts` inventories 31 synthetic fixtures:

- restaurant: 10 fixtures.
- Expedia: 8 fixtures.
- hotel: 13 fixtures.

The inventory covers analyzer fixtures under:

- `lib/runtime-forensics/__fixtures__/restaurant-artifact-analysis/*.json`
- `lib/runtime-forensics/__fixtures__/expedia-retry-analysis/*.json`
- `lib/runtime-forensics/__fixtures__/hotel-retry-analysis/*.json`

It also includes the existing top-level runtime-forensics demo fixtures from
`FIXTURE_FILENAMES`.

## Corpus Guards

`lib/__tests__/artifact-fixture-corpus.test.ts` asserts every inventoried
fixture has:

- a synthetic marker or fixture-style id;
- provider, scenario, and status metadata;
- no non-example email address or non-fixture E.164 phone number;
- no payment card number;
- no CVV/CVC/security-code value;
- no OTP, one-time-code, verification-code, or SMS-code value.

## Validation

Integrated verification is run by Codex after all cherry-picks land. The Goal
branches passed:

- Targeted vitest for closure docs/static/runtime-forensics/artifact modules.
- `npx tsx scripts/create-artifact-bundle-template.ts --kind restaurant`.
- `npx tsx scripts/create-artifact-bundle-template.ts --kind expedia`.
- `npx tsx scripts/create-artifact-bundle-template.ts --kind hotel`.
- `npx tsx scripts/list-artifact-fixtures.ts`.
- `npx tsc --noEmit --pretty false`.
- `npm run check-drift`.
- `git diff --check`.
- Forbidden-path audit.

## Safety Notes

No live provider run was performed. No OpenAI live call was performed. No
provider browser automation, payment, CVV, OTP/CAPTCHA/login bypass, or final
booking/reserve/purchase confirmation path was exercised.

## Next Human Approval Points

Human approval is required before any live restaurant, Expedia flight,
Booking.com hotel, Hotels.com hotel, or other provider attempt; any OpenAI live
call; any browser automation against providers; any retry loop or broad live
suite; any payment, CVV/CVC/security-code, OTP/CAPTCHA, login-sensitive check,
phone verification, or final booking/reserve/purchase confirmation action; or
any UI control that runs, retries, or resumes a live provider flow.
