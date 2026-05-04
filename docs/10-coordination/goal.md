# Goal Handoff - Live Artifact Bridge

Last updated: 2026-05-04

Branch: `codex/goal-live-artifact-bridge`

Base: `origin/codex/integrated-preview-20260504` at
`0c7efcad9cc0e45d358e2db647c422854e949c70`.

## Current State

This branch adds a no-live artifact bridge that turns already-collected
post-live evidence into the normalized bundle shape consumed by the current
restaurant, Expedia, and hotel artifact analyzers.

No provider runtime, worker, core, API, database, schema, live-run, retry, or
dashboard control path is changed.

## Changed Files

- `docs/50-product-areas/LIVE_ARTIFACT_BRIDGE.md`
- `docs/10-coordination/goal.md`
- `lib/__tests__/artifact-bundle-template.test.ts`
- `scripts/create-artifact-bundle-template.ts`

## Bridge Behavior

`scripts/create-artifact-bundle-template.ts` prints synthetic templates for:

- `restaurant`
- `expedia`
- `hotel`

Each template includes placeholders for job id, task id, provider, scenario,
status, params, step error, decisionLog, workerLogExcerpt, workerLogPath,
screenshotPaths, liveSnapshotPaths, and notes.

Fresh templates include `synthetic: true` and classify as
`insufficient_evidence` in the current domain analyzer until an operator
replaces placeholders with already-collected evidence.

## Validation

Current results:

- Targeted artifact/template/analyzer tests: pass, 5 files / 62 tests.
- `npx tsx scripts/create-artifact-bundle-template.ts --kind restaurant`: pass.
- `npx tsx scripts/create-artifact-bundle-template.ts --kind expedia`: pass.
- `npx tsx scripts/create-artifact-bundle-template.ts --kind hotel`: pass.
- `npx tsc --noEmit --pretty false`: pass.
- `npm run check-drift`: pass.
- `git diff --check`: pass.
- Forbidden-path audit against working diff: pass.

## Safety Notes

No live provider run was performed. No OpenAI live call was performed. No
browser automation, payment, CVV, OTP/CAPTCHA/login bypass, or final
confirmation path was exercised. `docs/10-coordination/HUDDLE.md` was not
edited.

## Next Human Approval Points

Human approval is required before:

- any live restaurant, Expedia, Booking.com, Hotels.com, or other provider run;
- any OpenAI live call;
- any browser automation against providers;
- any retry loop, broad provider suite, or live dashboard control;
- any action involving payment submission, CVV, OTP, CAPTCHA, login-sensitive
  checks, phone verification, or final booking/reserve/purchase confirmation.
