# Goal Handoff - Phase 0 Restaurant No-Live Artifact Pack

Last updated: 2026-05-04

Branch: `codex/goal-phase0-restaurant-artifact-pack`

Base: latest `origin/codex/integrated-preview-20260504`

## Current State

This branch adds a no-live restaurant artifact analysis package for Phase 0
closure work. It does not implement restaurant provider runtime, does not touch
provider/core/worker/API code, does not run live providers, and does not call
OpenAI.

The package classifies operator-assembled Resy/OpenTable evidence bundles from
DB/log/screenshot metadata so future fixes can be based on artifacts instead of
task-card summaries.

## Changed Files

Code and tests:

- `lib/runtime-forensics/restaurant-artifact-analysis.ts`
- `lib/runtime-forensics/index.ts`
- `lib/runtime-forensics/__fixtures__/restaurant-artifact-analysis/*.json`
- `lib/__tests__/restaurant-artifact-analysis.test.ts`
- `scripts/analyze-restaurant-artifact.ts`

Docs:

- `docs/20-phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md`
- `docs/20-phase0-restaurant/RESTAURANT_PHASE0_HANDOFF.md`
- `docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md`
- `docs/20-phase0-restaurant/RESY_LIVE_DEBUG_PLAYBOOK.md`
- `docs/10-coordination/goal.md`

## Covered Classes

- `resy_modal_disabled_details_api_failed`
- `resy_otp_login_boundary`
- `resy_no_availability`
- `opentable_phone_otp_handoff`
- `opentable_form_incomplete`
- `provider_network_degraded`
- `safe_manual_review_reached`
- `insufficient_evidence`

## Validation

Current results:

- `npx vitest run lib/__tests__/restaurant-artifact-analysis.test.ts`: pass, 19/19.
- `npx tsx scripts/analyze-restaurant-artifact.ts lib/runtime-forensics/__fixtures__/restaurant-artifact-analysis/resy-modal-disabled-details-api-failed.json`: pass.
- `npx tsc --noEmit --pretty false`: pass.
- `npm run check-drift`: pass.
- `git diff --check`: pass.
- Forbidden-path audit: pass.

## Safety Notes

No live provider run was performed. No OpenAI live call was performed. No
payment, CVV, OTP/CAPTCHA/login bypass, or final confirmation path was
exercised.

## Next Human Approval Points

Human approval is required before:

- Any Resy live case.
- Any OpenTable live case.
- Any OpenAI live call.
- Any broad restaurant suite, retry loop, cron, dashboard button, or
  live-provider automation batch.
- Any action involving payment submission, CVV, OTP, CAPTCHA, login-sensitive
  checks, or final booking/reserve/purchase confirmation.

If a future restaurant run is approved, collect the DB row, bounded worker log
excerpt, provider screenshot paths, and live snapshot paths before deciding
whether a provider patch is justified.
