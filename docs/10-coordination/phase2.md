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

## Latest Expedia Evidence

Agent2 audited the latest Expedia MCO to BNA failure and found:

- Job shape and runtime routing were valid.
- `source=lib/core/execution-local-*`.
- `scenario=flight`.
- Params included MCO/BNA, Southwest, 08:50, WN 3084, and `$152`.
- Latest artifact/log was from before the integrated fallback fix.
- Failure class was Expedia flight-card DOM scan / provider selector layer.
- It was not routing, job shape, profile gating, or UI copy.

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

Prepare, but do not run, the controlled Expedia retry checklist:

1. Exact user prompt and expected search params.
2. DB fields to inspect after the run:
   - `booking_jobs.steps[0].error`
   - `decisionLog`
   - `params`
   - source marker / scenario
3. Worker log grep targets:
   - Expedia card scan
   - visible-text fallback
   - checkout/safe-boundary detection
4. Screenshot directories to inspect:
   - `worker/.debug-screenshots/`
5. Success criteria:
   - gets past card scan into checkout or a safe provider boundary.
6. Failure criteria:
   - same DOM scan failure after fallback
   - provider/network block
   - profile gating
   - login/OTP/CAPTCHA/payment/final-confirmation boundary

Do not run live provider flows without explicit founder approval.
