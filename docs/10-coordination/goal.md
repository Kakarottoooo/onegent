# Goal Handoff - Provider Closure War Room

Last updated: 2026-05-04

Branch: `codex/goal-provider-closure-war-room`

Base: `origin/codex/integrated-preview-20260504` at
`bcd289501f48e9065e4acbefd2f08aaddc7ec382`.

## Current State

This branch adds a no-live Provider Closure War Room on top of the existing
provider-closure harness. It converts restaurant, Expedia flight, and
Booking.com hotel evidence bundles into a normalized
`ProviderClosureEvidence` object, a war-room verdict, root-cause summary, next
single safe action, regression checklist, and demo-readiness verdict.

The work is additive. It does not change provider runtime implementation,
worker code, core execution, execution-v2, API routes, DB schema, payment
automation, account-verification handling, human-verification handling, login
bypass logic, or final-confirmation behavior.

## What Is New

- `lib/provider-closure/war-room.ts`
  - war-room schema and normalized evidence object;
  - artifact ingestion for wrapper bundles and legacy analyzer bundles;
  - screenshot manifest support;
  - evidence freshness and minimum-evidence checks;
  - unsafe/disallowed boundary detection;
  - verdict engine:
    `live_closed_safe_boundary`,
    `live_blocked_provider_or_network`,
    `live_blocked_selector_or_dom`,
    `live_blocked_model_or_env`, `not_live_verified`, and
    `unsafe_or_disallowed_boundary`;
  - markdown report, summary, preflight, and demo-verdict formatters.
- `lib/provider-closure/war-room-fixtures.ts`
  - synthetic no-live fixtures for all major terminal verdicts across
    restaurant, flight, and hotel;
  - stale-evidence fixture for freshness regression coverage.
- `scripts/provider-closure-war-room.ts`
  - `preflight --vertical restaurant|flight|hotel`;
  - `analyze --vertical ... --bundle <path>`;
  - `analyze --vertical ... --bundle <path> --markdown`;
  - `summarize --all`;
  - `demo-verdict`.
- Synthetic war-room reports:
  - `docs/30-provider-debug/provider-closure-war-room/RESTAURANT_SYNTHETIC_WAR_ROOM_REPORT.md`
  - `docs/30-provider-debug/provider-closure-war-room/FLIGHT_SYNTHETIC_WAR_ROOM_REPORT.md`
  - `docs/30-provider-debug/provider-closure-war-room/HOTEL_SYNTHETIC_WAR_ROOM_REPORT.md`
- Docs now point operators from the live closure protocol and controlled
  retry runbooks into the war-room CLI for post-attempt evidence handling.

## Changed Files

- `docs/10-coordination/goal.md`
- `docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md`
- `docs/30-provider-debug/PROVIDER_CLOSURE_OPERATOR_ROOM.md`
- `docs/30-provider-debug/provider-closure-war-room/FLIGHT_SYNTHETIC_WAR_ROOM_REPORT.md`
- `docs/30-provider-debug/provider-closure-war-room/HOTEL_SYNTHETIC_WAR_ROOM_REPORT.md`
- `docs/30-provider-debug/provider-closure-war-room/RESTAURANT_SYNTHETIC_WAR_ROOM_REPORT.md`
- `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`
- `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`
- `lib/__tests__/provider-closure-war-room-static.test.ts`
- `lib/__tests__/provider-closure-war-room.test.ts`
- `lib/provider-closure/index.ts`
- `lib/provider-closure/war-room-fixtures.ts`
- `lib/provider-closure/war-room.ts`
- `scripts/provider-closure-war-room.ts`

## Validation

Current local validation:

- War-room focused tests:
  `npx vitest run lib/__tests__/provider-closure-war-room.test.ts` passed,
  10 tests.
- War-room + static tests:
  `npx vitest run lib/__tests__/provider-closure-war-room.test.ts lib/__tests__/provider-closure-war-room-static.test.ts`
  passed, 2 files / 16 tests.
- Targeted provider-closure/runtime-forensics tests:
  `npx vitest run lib/__tests__/provider-closure-schema.test.ts lib/__tests__/provider-closure-analysis.test.ts lib/__tests__/provider-closure-cli.test.ts lib/__tests__/provider-closure-static.test.ts lib/__tests__/provider-closure-war-room.test.ts lib/__tests__/provider-closure-war-room-static.test.ts lib/__tests__/restaurant-artifact-analysis.test.ts lib/__tests__/expedia-retry-analysis.test.ts lib/__tests__/hotel-retry-analysis.test.ts lib/__tests__/runtime-forensics-classifier.test.ts lib/__tests__/analyze-provider-artifact-cli.test.ts`
  passed, 11 files / 176 tests.
- CLI smoke:
  - `npx tsx scripts/provider-closure-war-room.ts preflight --vertical restaurant`: pass.
  - `npx tsx scripts/provider-closure-war-room.ts preflight --vertical flight`: pass.
  - `npx tsx scripts/provider-closure-war-room.ts preflight --vertical hotel`: pass.
  - `npx tsx scripts/provider-closure-war-room.ts analyze --vertical flight --bundle lib/runtime-forensics/__fixtures__/expedia-retry-analysis/checkout-manual-review-reached.json --markdown`: pass.
  - `npx tsx scripts/provider-closure-war-room.ts summarize --all`: pass.
  - `npx tsx scripts/provider-closure-war-room.ts demo-verdict`: pass.
- `npx tsc --noEmit --pretty false`: pass.
- `npm run check-drift`: pass.
- `npm run gate:phase1 -- --allow-known-drift`: pass, 9/9.
- `git diff --cached --check`: pass.
- Forbidden-path audit: pass, 14 staged files and no forbidden paths touched.

## Safety Notes

This is offline evidence tooling only. It reads local JSON objects and bundled
synthetic fixtures. It does not start providers, call OpenAI, open browser
automation, write booking state, read or print secrets, submit payment, enter
CVV/CVC/security-code values, bypass account verification, bypass human
verification, bypass login, or click final booking/reserve/purchase
confirmation.

## Next Human Approval Points

Human approval is required before any real provider attempt, OpenAI live call,
browser automation against providers, retry loop, broad provider suite,
payment/CVV/security-code entry, account-verification handling,
human-verification handling, login-sensitive action, or final
booking/reserve/purchase confirmation action.
