# Runtime Mirror Guide

Last updated: 2026-05-06

Onegent currently carries provider runtime code in two places:

- `lib/booking-autopilot/**` for the in-process app path.
- `worker/src/booking-autopilot/**` for the long-running worker path.

This is deliberate for now, but it is expensive. Provider fixes must either
land in both strict mirrors or be isolated in shared pure helpers that both
paths import. Do not make broad provider runtime rewrites during app/product
quality work.

## Strict Mirror Contract

`npm run check-drift` runs `scripts/check-drift.ts`, which compares strict
mirror pairs and ignores only the documented worker-specific adapters.

When touching runtime code:

1. Identify whether the file is in a strict mirror pair.
2. Make the smallest provider fix in the app path.
3. Mirror the exact worker change when required.
4. Run `npm run check-drift`.
5. Add or update a focused provider/runtime test for the changed behavior.

When not touching runtime code:

1. Do not modify `lib/booking-autopilot/**` or `worker/src/booking-autopilot/**`.
2. Do not use `--allow-known-drift` as a way to hide new app/product changes.
3. If `check-drift` fails from unrelated existing runtime edits, stop and report
   the pair instead of syncing someone else's work.

## High-Risk Bulky Areas

| Area | Why it is bulky | Safer next cut |
| --- | --- | --- |
| Provider selector files | Provider DOMs change often and files carry large fallback branches. | Extract pure classification and URL-shape helpers with tests before changing live selectors. |
| Stagehand executor | Shared orchestration, screenshots, and failure classification meet in one file. | Keep provider-specific decisions in provider modules and add static guards around unsafe boundaries. |
| Final outcome classification | Safety labels affect payment, OTP, CAPTCHA, login, and final-confirm stops. | Only change with explicit evidence fixtures and negative safety tests. |
| Worker DB/log adapters | Worker path is intentionally not byte-identical in a few adapters. | Document adapter exceptions in `scripts/check-drift.ts` and keep strict pairs narrow. |

## Preferred Diet Pattern

- Extract pure helpers only when the same logic is duplicated in both mirrors.
- Keep helper inputs as plain data, not Playwright pages or provider sessions.
- Add tests under `lib/__tests__/**` that do not start workers, browsers, or
  providers.
- Leave live behavior unchanged until a controlled provider QA task explicitly
  authorizes a single attempt.

## Current Product-Quality Pass

This pass intentionally does not touch the provider runtime mirrors. The concrete
guard is documentation plus a static test that keeps this guide linked from the
system design and docs index, so future agents have a clear route before editing
runtime mirrors.
