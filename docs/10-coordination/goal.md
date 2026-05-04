# Goal Handoff - Runtime Closure Consolidation

Last updated: 2026-05-04

Branch: `codex/goal-runtime-closure-consolidation`

Base: `origin/codex/integrated-preview-20260504` at
`0c7efcad9cc0e45d358e2db647c422854e949c70`.

## Current State

This branch is a no-live consolidation package for closing Phase 0 restaurant,
Phase 2 Expedia flight, and Phase 2 hotel from already-collected evidence. It
adds reviewable docs, artifact templates, fixture/test coverage, and one
classifier clarification for OpenAI Responses API 5xx failures.

No provider runtime, worker, core, execution-v2, booking-job API, v1 API,
database, schema, live-run, retry, or dashboard control path is changed.

## Merge Plan

Safe cherry-picks kept:

- `f331ccc` from `codex/goal-live-artifact-bridge`, kept as local commit
  `b8cfd8a`: no-live artifact bridge doc, template script, and template tests.
- `f58ab84` from `codex/flight-controlled-runtime-closure`, kept as local
  commit `53663b7`: Expedia controlled retry preflight test and runbook
  additions. The stale `docs/10-coordination/phase2.md` hunk was dropped.
- `10192569` from `codex/hotel-controlled-runtime-closure`, kept as local
  commit `2ca8dfb`: hotel analyzer fixture, retry-analysis logic/test
  hardening, and hotel runbook additions.

Intentionally skipped or kept separate:

- `fbd701a` from `claude/live-operator-control-surface`: skipped direct
  cherry-pick because it adds a broader `app/dev` UI surface and
  `lib/live-operator-checklist/**`. This consolidation does not need a new UI,
  and the no-mutation operator safety expectations are mirrored in
  `LIVE_CLOSURE_EVIDENCE_PROTOCOL.md` plus static docs tests.

Overlap handled manually:

- `docs/10-coordination/goal.md` from the artifact-bridge branch was replaced
  with this consolidation handoff.
- Expedia `docs/10-coordination/phase2.md` edits were dropped as coordination
  overlap with integrated preview.
- `docs/50-product-areas/ARTIFACT_CORPUS_INVENTORY.md` and its test were
  refreshed for the new hotel room-selection manual-review fixture.

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

## Validation

Current results:

- Targeted vitest for closure docs/static/runtime-forensics/artifact modules:
  pass, 12 files / 165 tests.
- `npx tsx scripts/create-artifact-bundle-template.ts --kind restaurant`:
  pass.
- `npx tsx scripts/create-artifact-bundle-template.ts --kind expedia`: pass.
- `npx tsx scripts/create-artifact-bundle-template.ts --kind hotel`: pass.
- `npx tsx scripts/list-artifact-fixtures.ts`: pass, 28 fixtures.
- `npx tsc --noEmit --pretty false`: pass.
- `npm run check-drift`: pass.
- `git diff --check`: pass.
- Forbidden-path audit: pass.

## Next Human Approval Points

Human approval is required before any live restaurant, Expedia flight,
Booking.com hotel, Hotels.com hotel, or other provider attempt; any OpenAI live
call; any browser automation against providers; any retry loop or broad live
suite; any payment, CVV/CVC/security-code, OTP/CAPTCHA, login-bypass, phone
verification, or final booking/reserve/purchase confirmation action; or any
UI control that runs, retries, or resumes a live provider flow.
