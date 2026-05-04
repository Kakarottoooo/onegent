# Phase Status - single-source overview

> For: founder, Codex, Claude, and future agents.
> Last updated: 2026-05-04.
> Read after: `docs/INDEX.md`, `docs/00-start-here/PROJECT_SUMMARY.md`,
> and `docs/10-coordination/HUDDLE.md`.

## TL;DR

Do not enter Phase 2 yet. Stabilize Phase 0, Phase 1, and Phase 1.5 first.

| Phase | Status | Current gate |
| --- | --- | --- |
| Phase 0A - Restaurant provider closure | In flight, about 85% | Resy still needs a probe-selected live fill/OTP/safe-handoff run. |
| Phase 0B - Restaurant v1 coverage | Gated | Start after 0A proves at least one real fill/OTP or safe handoff path. |
| Phase 1 - First paying user path | Demo-freeze passed | Full Phase 1 gate with smoke and autonomous founder E2E passes 12/12; manual founder walkthrough remains the human acceptance gate. |
| Phase 1.5 - QA and polish | Demo-freeze passed | Quality gate, dev workbenches, production build, and production route probe are passing. |
| Phase 2 - Vertical expansion | Frozen, under audit | Old hotel/flight paths exist, but need current artifact/live-safe revalidation before demo promises. |

## Current Verified State

- Integrated preview branch: `codex/integrated-preview-20260504`.
- Runtime/debug branch: `codex/openai-chat-model-env`.
- Expedia fix branch: `codex/expedia-flight-card-fallback`.
- 2026-05-04 latest Phase 1/1.5 demo-freeze check:
  - `npm run gate:phase1 -- --allow-known-drift --include-smoke --include-e2e`
    passed with 12 pass, 0 fail, 0 skipped, 0 known-existing drift.
  - `npm run smoke:phase1` passed all 6 routes under a controlled dev server.
  - `npm run e2e:founder` passed all 15 autonomous probes.
  - Fixed the profile PATCH payment-field guard so unauthenticated
    `card_number` / `cvv` payloads return HTTP 400 before auth/DB work.
  - Local demo mode now treats missing Clerk config as anonymous for optional
    booking-job/profile paths instead of logging Clerk middleware 500s.
  - `npm run build` passed, and production `next start` route probe returned
    200 for `/`, `/tasks`, `/dev`, `/dev/demo-readiness`,
    `/dev/demo-control-room`, `/dev/runtime-forensics`,
    `/dev/phase1-quality-gates`, `/dev/founder-e2e`,
    `/dev/restaurant-readiness`, `/dev/resy-run-analysis`,
    `/developers/docs/api/v1`, `/pricing`, and `/permissions`.
- 2026-05-04 Expedia test merge:
  - Agent2's no-live Expedia visible-card-shape regression is merged into
    integrated preview.
  - `npm run check-drift` now passes without a known-drift exception.
  - `npm run gate:phase1 -- --allow-known-drift` passed with 9/9 checks and no
    known-existing drift.
- 2026-05-04 integrated preview verification:
  - `npm run build` passed end-to-end after production build cleanup. The build
    uses `next build --webpack` because the local Windows worktree uses a
    `node_modules` junction that currently trips Turbopack.
  - `npx tsc --noEmit --pretty false` passed.
  - `npm run gate:phase1 -- --allow-known-drift` passed, 9/9 required checks.
  - `/dev`, `/dev/phase1-quality-gates`, `/dev/founder-e2e`,
    `/dev/restaurant-readiness`, `/dev/resy-run-analysis`,
    `/dev/resy-probe-runs`, and `/dev/debug-artifacts` all returned 200 on
    local dogfood.
  - `/dev/runtime-forensics` and `/api/dev/runtime-forensics` returned 200 after
    runtime-forensics integration. Empty artifact state renders cleanly.
  - `/dev/demo-control-room` is integrated as the founder-facing pre-demo
    control room. It is read-only and links Phase 1 gates, runtime forensics,
    hard stops, and Phase 2/Expedia evidence.
  - `/dev/demo-readiness` is integrated as the compact Track C read-only
    readiness sidecar. It summarizes gate/founder/smoke/runtime evidence,
    hard stops, route order, and useful docs links, and points back to
    `/dev/demo-control-room` for the full script.

## Phase 0A - Restaurant Provider Closure

Goal: one restaurant provider flow reaches an accepted safe outcome:
`ready_for_confirmation`, `safe_handoff`, `OTP/login required`, or a correct
no-availability classification. The system must never submit final booking,
payment, OTP, CAPTCHA, or account-sensitive actions automatically.

Completed:

- OpenTable can reach checkout/contact boundaries and stop before final submit.
- Resy probe-first protocol exists and is represented in dev dashboards.
- Restaurant readiness surfaces exist:
  - `docs/20-phase0-restaurant/RESY_AVAILABILITY_PROBE_PROTOCOL.md`
  - `docs/20-phase0-restaurant/RESY_LIVE_DEBUG_PLAYBOOK.md`
  - `docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md`
  - `/dev/restaurant-readiness`
  - `/dev/resy-probe-runs`
  - `/dev/resy-run-analysis`

Still open:

- Resy has not closed a live fill/OTP path. Do not blind-run the same case.
- Before any Resy live spend, use the probe/readiness flow to pick one case
  with real target-window availability.
- Treat repeated Resy API 500s or desktop/mobile network differences as
  provider/network/session degradation, not automatically as provider code bugs.

## Phase 0B - Restaurant v1 Coverage

Goal: broaden from one proven restaurant flow to repeatable Restaurant v1
coverage across Resy/OpenTable fixtures.

Entry gate:

- At least one readiness-recommended Resy case reaches fill/OTP/safe handoff,
  or OpenTable provides an equivalent safe contact/confirmation boundary.

Do not start broad fixture burn until that entry gate is met.

## Phase 1 - First Paying User Path

Goal: founder can complete the user-facing flow from chat to task page to safe
provider handoff/confirmation boundary, with profile gap handling and cookie
auth working.

Completed:

- Profile gap handling is wired into homepage chat and task flow.
- Cookie-auth API/proxy path exists.
- Founder E2E checklist and runner exist.
- Phase 1 smoke and quality-gate suites exist.

Still open:

- Founder manual E2E walkthrough remains the final acceptance check.
- OTP resume remains conditional and should only be built when a real Phase 0
  flow proves it is needed.

Primary docs:

- `docs/40-phase1/PHASE_1_FOUNDER_E2E.md`
- `docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md`
- `docs/40-phase1/PHASE_1_QUALITY_GATE.md`

## Phase 1.5 - Quality Gate And Polish

Goal: keep Phase 1 shippable while polishing the issues found during founder
dogfood.

Current state:

- `npm run gate:phase1 -- --allow-known-drift` is the canonical quick verdict.
- `/dev/phase1-quality-gates` reads the latest gate reports.
- `/dev/founder-e2e` is client-safe after import-boundary fixes.
- `/dev/runtime-forensics` is a read-only artifact-based triage workbench for
  provider/runtime failures.
- `/dev/demo-control-room` is a read-only founder demo control room for
  pre-demo status, hard stops, recovery phrases, and Phase 2 posture.
- `/dev/demo-readiness` is a compact read-only Track C supplement for
  build/gate/demo readiness, hard stops, route order, and useful doc links.
- The 2026-05-04 integrated preview dogfood passed all listed dev pages.

When a task lands:

- Update `docs/10-coordination/HUDDLE.md` for short-term handoff.
- Update `docs/10-coordination/codex.md` or `docs/10-coordination/claude.md`
  for agent-specific state.
- Update the closest phase/runbook doc only if the durable operating procedure
  changed.

## Expedia / Flight Runtime Status

The earlier legacy-shape worker error is considered fixed. The latest reproduced
flight failure had a valid `__source` marker and correct Expedia params, but the
provider DOM scan failed while the target Southwest card was visible.

Current fix branch:

- `codex/expedia-flight-card-fallback`
- Merged into `codex/integrated-preview-20260504` on 2026-05-04.
- Adds a visible-text locator fallback when the bulk Expedia flight-card DOM
  scan throws.
- Verified after merge with targeted Vitest, TypeScript, drift check, and Phase
  1 quality gate.

Next step:

- If the founder approves a controlled provider runtime check, retry the same
  MCO to BNA Expedia task and inspect DB, worker log, and screenshots before
  making any further provider changes.
- Phase 2 revival audit lives at
  `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md`.

## Phase 2 - Frozen

Do not expand vertical scope or add new live provider work until Phase 0,
Phase 1, and Phase 1.5 are stable enough to dogfood without repeated handoff
confusion.

Allowed while frozen:

- Fix runtime bugs exposed by current founder tasks.
- Improve observability and debug workbenches for existing restaurant/flight
  flows.
- Clean documentation structure and coordination state.

Not allowed while frozen:

- New provider verticals.
- Payment automation.
- OTP/CAPTCHA/login bypass.
- Final booking confirmation automation.
