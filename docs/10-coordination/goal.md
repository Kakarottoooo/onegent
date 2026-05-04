# Goal Handoff - Phase 2 No-Live Revival

Last updated: 2026-05-04

Branch: `codex/goal-phase2-no-live-revival`

Base: latest `origin/codex/integrated-preview-20260504`

## Current State

This branch builds a no-live Phase 2 vertical revival package for flights and
hotels. It does not expand runtime authority and does not run live providers.

Expedia flight already had a no-live retry analyzer and controlled retry
runbook. This branch keeps that path and adds the shared artifact wrapper.

Booking.com and Hotels.com now have no-live hotel artifact analysis coverage:
synthetic fixtures, deterministic classifications, tests, and a controlled
retry runbook. Hotel remains artifact-ready, not live-ready.

## Changed Files

Code and tests:

- `lib/runtime-forensics/hotel-retry-analysis.ts`
- `lib/runtime-forensics/index.ts`
- `lib/runtime-forensics/__fixtures__/hotel-retry-analysis/*.json`
- `lib/__tests__/hotel-retry-analysis.test.ts`
- `scripts/analyze-phase2-artifact.ts`

Docs:

- `docs/50-product-areas/PHASE2_READINESS_MATRIX.md`
- `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`
- `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`
- `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md`
- `docs/10-coordination/phase2.md`
- `docs/10-coordination/HUDDLE.md`
- `docs/10-coordination/goal.md`
- `docs/INDEX.md`

## Validation

Latest local results after rebasing onto latest
`origin/codex/integrated-preview-20260504`:

- `npx vitest run lib/__tests__/docs-static-guard.test.ts lib/__tests__/hotel-retry-analysis.test.ts lib/__tests__/expedia-retry-analysis.test.ts lib/__tests__/analyze-expedia-retry-artifact-cli.test.ts`: pass, 33/33.
- `npx tsx scripts/analyze-phase2-artifact.ts hotel lib/runtime-forensics/__fixtures__/hotel-retry-analysis/booking-room-selection-drift.json`: pass.
- `npx tsc --noEmit --pretty false`: pass.
- `npm run check-drift`: pass.
- `git diff --check`: pass.
- Forbidden-path audit: pass.

## Risks

- Hotel live readiness is still unproven. The analyzer classifies evidence; it
  does not prove Booking.com or Hotels.com can currently reach a safe boundary.
- Synthetic hotel fixtures are intentionally no-live examples. They must not be
  treated as real provider evidence.
- The next hotel patch should not be made unless a real artifact bundle shows
  `room_selection_drift` or another patchable class with screenshots.
- `safety_boundary_violation` is a stop condition, not a fix-forward signal.

## Next Human Approval Points

Human approval is required before:

- Any Expedia live controlled retry.
- Any Booking.com or Hotels.com live controlled retry.
- Any retry loop, broad hotel/flight suite, cron, dashboard button, or provider
  automation batch.
- Any payment, CVV, OTP, CAPTCHA, login-sensitive, or final-confirmation action.

If approval is granted later, collect DB fields, bounded worker log excerpts,
screenshot paths, and live snapshot paths before patching.
