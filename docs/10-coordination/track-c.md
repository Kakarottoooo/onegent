# Track C - demo readiness sidecar

> Last writer: track-c
> Last updated: 2026-05-04
> Branch: `codex/track-c-demo-readiness`

## Scope

Track C is a UI/docs/test sidecar on top of
`origin/codex/integrated-preview-20260504`.

Allowed:

- demo readiness docs
- read-only evidence helpers
- `/dev/demo-readiness`
- static guard tests for docs/build-sensitive paths
- coordination updates

Not allowed:

- provider/runtime/core/live automation
- `lib/booking-autopilot/**`
- `worker/src/**`
- `lib/core/**`
- `lib/execution-v2/**`
- `app/api/v1/**`
- `app/api/booking-jobs/**`
- Resy/Expedia live runs
- payment, OTP, CAPTCHA, or final confirmation

## Current Work

- Added `docs/40-phase1/YC_DEMO_RUNBOOK.md`.
- Added `lib/demo-evidence/**` read-only artifact aggregation.
- Added compact `/dev/demo-readiness` that links to the existing Demo Control
  Room instead of duplicating it.
- Added docs/static guard tests for developer docs markdown paths and Phase 1
  runbook existence.

## Conflict Notes

Possible overlap with Claude is limited to `/dev/demo-control-room` and
`lib/demo-control-room/**`. Track C intentionally does not edit those files.
It consumes their Phase 2 structured status and links back to the existing
control room.

## Verification

Target verification before handoff:

- `npx tsc --noEmit --pretty false`
- relevant Vitest for demo evidence and docs guards
- `npm run gate:phase1 -- --allow-known-drift`
- `npm run build` because app/dev route code changed
- `git diff --check`
