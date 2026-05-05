# Goal Handoff - Provider Closure Harness

Last updated: 2026-05-04

Branch: `codex/goal-provider-closure-harness`

Base: `origin/codex/integrated-preview-20260504` at
`cad98856ce25f3d01db058b19729ce0dd18f109c`.

## Current State

This branch adds a no-live provider closure harness for restaurant, Expedia
flight, and hotel runtime evidence. It sits above the existing restaurant,
Expedia retry, hotel retry, and runtime-forensics analyzers and turns one
local artifact bundle into a normalized closure outcome, exact next step, and
Markdown report.

No provider runtime, worker, core, execution-v2, API, database, schema,
browser automation, OpenAI call, live retry, or dashboard control path is
changed.

## What Is New

- `lib/provider-closure/**`
  - typed closure artifact schema;
  - kind normalization for `restaurant`, `flight` / `expedia-flight`, and
    `hotel`;
  - safety guard for real PII, payment-card values, CVV/CVC/security-code
    values, OTP/code values, and CAPTCHA secret values;
  - integration with the existing domain analyzers and runtime-forensics
    classifier;
  - terminal taxonomy:
    `safe_handoff`, `login_otp_boundary`, `no_availability`,
    `provider_degraded`, `selector_drift`, `model_env_transient`,
    `unsafe_blocked`, and `insufficient_evidence`.
- `scripts/provider-closure.ts`
  - `preflight --kind restaurant|flight|hotel`;
  - `analyze --kind ... --artifact <path>`;
  - `report --kind ... --artifact <path> --markdown`.
- Synthetic generated reports:
  - `docs/30-provider-debug/provider-closure-reports/RESTAURANT_SYNTHETIC_CLOSURE_REPORT.md`
  - `docs/30-provider-debug/provider-closure-reports/FLIGHT_SYNTHETIC_CLOSURE_REPORT.md`
  - `docs/30-provider-debug/provider-closure-reports/HOTEL_SYNTHETIC_CLOSURE_REPORT.md`
- `docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md` now points
  operators to the unified harness and normalized terminal taxonomy.

## Changed Files

- `docs/10-coordination/goal.md`
- `docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md`
- `docs/30-provider-debug/provider-closure-reports/FLIGHT_SYNTHETIC_CLOSURE_REPORT.md`
- `docs/30-provider-debug/provider-closure-reports/HOTEL_SYNTHETIC_CLOSURE_REPORT.md`
- `docs/30-provider-debug/provider-closure-reports/RESTAURANT_SYNTHETIC_CLOSURE_REPORT.md`
- `lib/__tests__/provider-closure-analysis.test.ts`
- `lib/__tests__/provider-closure-cli.test.ts`
- `lib/__tests__/provider-closure-schema.test.ts`
- `lib/__tests__/provider-closure-static.test.ts`
- `lib/provider-closure/analyze.ts`
- `lib/provider-closure/index.ts`
- `lib/provider-closure/preflight.ts`
- `lib/provider-closure/report.ts`
- `lib/provider-closure/safety.ts`
- `lib/provider-closure/schema.ts`
- `scripts/provider-closure.ts`

## Validation

Current results:

- Provider closure tests:
  `npx vitest run lib/__tests__/provider-closure-schema.test.ts lib/__tests__/provider-closure-analysis.test.ts lib/__tests__/provider-closure-cli.test.ts lib/__tests__/provider-closure-static.test.ts`
  passed, 4 files / 19 tests.
- Relevant analyzer/runtime tests:
  `npx vitest run lib/__tests__/provider-closure-schema.test.ts lib/__tests__/provider-closure-analysis.test.ts lib/__tests__/provider-closure-cli.test.ts lib/__tests__/provider-closure-static.test.ts lib/__tests__/restaurant-artifact-analysis.test.ts lib/__tests__/expedia-retry-analysis.test.ts lib/__tests__/hotel-retry-analysis.test.ts lib/__tests__/runtime-forensics-classifier.test.ts lib/__tests__/analyze-provider-artifact-cli.test.ts`
  passed, 9 files / 158 tests.
- CLI smoke:
  - `npx tsx scripts/provider-closure.ts preflight --kind restaurant`: pass.
  - `npx tsx scripts/provider-closure.ts preflight --kind flight`: pass.
  - `npx tsx scripts/provider-closure.ts preflight --kind hotel`: pass.
  - `npx tsx scripts/provider-closure.ts analyze --kind flight --artifact lib/runtime-forensics/__fixtures__/expedia-retry-analysis/checkout-manual-review-reached.json`:
    pass.
- `npx tsc --noEmit --pretty false`: pass.
- `npm run check-drift`: pass.
- `git diff --check`: pass.
- `npm run gate:phase1 -- --allow-known-drift`: pass, 9/9.
- Forbidden-path audit: pass.

## Safety Notes

This work is offline evidence analysis only. It does not run providers, call
OpenAI, open browser automation, read or print secrets, submit payment, enter
CVV/CVC/security-code values, bypass OTP/CAPTCHA/login/phone verification, or
click final booking/reserve/purchase confirmation.

## Next Human Approval Points

Human approval is required before any live restaurant, Expedia flight,
Booking.com hotel, Hotels.com hotel, or other provider attempt; any OpenAI live
call; any browser automation against providers; any retry loop or broad live
suite; any payment, CVV/CVC/security-code, OTP/CAPTCHA, login-sensitive check,
phone verification, or final booking/reserve/purchase confirmation action; or
any UI control that runs, retries, or resumes a live provider flow.
