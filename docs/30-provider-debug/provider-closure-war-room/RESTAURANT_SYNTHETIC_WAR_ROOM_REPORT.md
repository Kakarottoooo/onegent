# Provider Closure War Room Report

- **Vertical**: `restaurant`
- **Verdict**: `live_closed_safe_boundary` (Live attempt reached a safe closure boundary)
- **Provider outcome**: `safe_handoff`
- **Provider state**: `safe_manual_review_reached`
- **Runtime class**: `checkout_reached_manual_review`
- **Job id**: `fixture-war-room-restaurant-safe_boundary`
- **Provider**: `opentable`
- **Status**: `ready_for_confirmation`
- **Live marker**: `present`
- **Synthetic**: `yes`

## Exact Terminal State

Provider outcome `safe_handoff`, provider analyzer state
`safe_manual_review_reached`, runtime class
`checkout_reached_manual_review`.

## Evidence Files

- Worker log: `codex-worker.log#fixture-war-room-restaurant-safe_boundary`
- Screenshot: `worker/.debug-screenshots/opentable-safe_boundary/01-terminal.jpg`
- Live snapshot: `.debug-screenshots/live/fixture-war-room-restaurant-safe_boundary/terminal-snapshot.json`

## What Happened

The synthetic restaurant bundle normalized DB row, worker log excerpt,
screenshot manifest, and live snapshot path into one
`ProviderClosureEvidence` object. The analyzer reached the safe manual-review
boundary.

## Root Cause

The attempt reached an accepted safe boundary: safe handoff before final
confirmation.

## Next Single Action

Record this artifact as a no-live regression report. Do not claim restaurant
live readiness from this synthetic fixture.

## Regression Checklist

- Keep the artifact bundle PII- and secret-free.
- Verify DB row, worker log excerpt, screenshot paths, and live snapshot paths agree.
- Run the restaurant artifact and war-room tests before any patch handoff.
- Add real post-attempt evidence before a demo claim.

## Demo Readiness

- **Can claim this vertical**: `no`
- **Reason**: Cannot claim from a synthetic no-live fixture.
