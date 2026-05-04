# Claude - coordination state

> Branch context: working on `claude/demo-control-room`, based on
> `codex/integrated-preview-20260504 @ 5e6a246`.
> Last updated: 2026-05-04.
> Canonical path: `docs/10-coordination/claude.md`.

## Currently Doing

`claude/demo-control-room` — read-only Demo Control Room dashboard at
`/dev/demo-control-room`. Founder-facing landing that aggregates the
existing Phase 1 / Phase 1.5 / Phase 2 evidence into one screen for
demo prep.

Scope (read-only, no provider/runtime/worker/DB touched):

- `lib/demo-control-room/phase2-status.ts` — single structured
  source for the 3 Phase 2 verticals (Expedia / Booking.com /
  Hotels.com) + their "candidate, not live-verified" / "needs fresh
  artifacts" copy. Page and audit doc both reference this.
- `lib/demo-control-room/loader.ts` — pulls latest Phase 1
  quality-gate verdict + latest founder-e2e verdict via the existing
  `lib/quality-gate/loader.ts` + `lib/founder-e2e/loader.ts`. Extracts
  the smoke check from the gate's `checks[]` when present (smoke does
  not write its own artifact).
- `lib/demo-control-room/script.ts` — deterministic safe demo script
  + hard stops + recovery phrases + markdown export. Pure; covered
  by tests.
- `app/dev/demo-control-room/page.tsx` — server component composing
  the three loader outputs + a small client `RefreshButton`
  subcomponent that calls `router.refresh()`.
- `app/dev/page.tsx` — adds a "Demo Control Room" card pointing to
  the new route as the founder entry point.
- `docs/40-phase1/DEMO_CONTROL_ROOM.md` — operator runbook for the
  dashboard (what it reads, how to extend, safety boundary).
- `docs/40-phase1/PHASE_1_FOUNDER_E2E.md` — gains a "Pre-demo: Demo
  Control Room" pointer.

Hard rules (verified per commit):

- No `lib/booking-autopilot/**`, `lib/core/**`, `lib/execution-v2/**`,
  `worker/src/**`, `app/api/v1/**`, `app/api/booking-jobs/**`.
- No provider modules.
- No `lib/db.ts`, no schema changes.
- No live OpenAI / Computer Use / payment / OTP / CAPTCHA path.
- No retry / run / mutating buttons added — only `router.refresh()`
  to re-render the read-only view.
- Only consumes existing `benchmark/runs/*.json` artifacts and docs;
  never invokes a runner.

Codex reads this at session start. Claude should update it before pushing work
that changes Track B status, handoff rules, or UI/docs/tooling ownership.

## Agent Quickstart

Read in this order when picking up Onegent cold:

1. `docs/INDEX.md`
2. `docs/00-start-here/PROJECT_SUMMARY.md`
3. `docs/00-start-here/PHASE_STATUS.md`
4. `docs/10-coordination/HUDDLE.md`
5. `docs/10-coordination/codex.md`
6. `docs/10-coordination/claude.md`
7. Task-specific runbook:
   - Provider/runtime: `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
   - Phase 1/QA: `docs/40-phase1/PHASE_1_FOUNDER_E2E.md`,
     `docs/40-phase1/PHASE_1_QUALITY_GATE.md`,
     `docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md`
   - Restaurant/Resy: `docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md`,
     `docs/20-phase0-restaurant/RESY_LIVE_DEBUG_PLAYBOOK.md`,
     `docs/20-phase0-restaurant/RESY_AVAILABILITY_PROBE_PROTOCOL.md`

Default verification for integrated preview:

```bash
npm run gate:phase1 -- --allow-known-drift
```

Do not run live OpenAI, Computer Use, provider navigation, payment, OTP,
CAPTCHA, or final-confirm flows unless the user explicitly approves the exact
live run.

## Product Context

Onegent is a consumer travel-booking automation product. The user chats in
natural language, the NLU produces an intent, the commit pipeline creates a
booking job, and provider automation drives public booking sites only up to
safe handoff boundaries. Final confirmation, payment, OTP, and CAPTCHA remain
human-controlled.

Architecture nouns to keep in working memory:

- Next.js app and API routes in `app/**`.
- Neon Postgres shared by app and worker.
- Clerk auth.
- Railway/local worker in `worker/src/**`.
- Stripe for billing, with payment automation forbidden.
- Stagehand/Playwright/Computer Use provider automation.

Sharp corner: `lib/booking-autopilot/**` and
`worker/src/booking-autopilot/**` are intentional mirrors. Provider/runtime
changes must be mirrored and checked with `npm run check-drift`.

## Track Split

Codex owns Track A:

- `lib/booking-autopilot/**`
- `lib/core/**`
- `lib/execution-v2/**`
- `worker/src/**`
- `app/api/v1/**`
- `app/api/booking-jobs/**`
- provider modules for Resy, OpenTable, Expedia, Booking, hotels, activities
- benchmark fixtures, live runners, provider safety policies

Claude owns Track B unless told otherwise:

- `app/dev/**`
- `app/api/dev/**`
- `components/**`
- `lib/agent/nlu-v2/**`
- `lib/profile-gap-*`
- `lib/founder-e2e/**`
- `lib/quality-gate/**`
- `lib/runtime-forensics/**`
- `scripts/run-founder-e2e.ts`
- `scripts/run-phase1-quality-gate.ts`
- dashboards, observability, docs, and focused tests

Claude should not touch Track A provider/runtime files while Codex is debugging
Expedia, Resy, or OpenTable.

## Current Integrated Preview State

Integrated preview branch: `codex/integrated-preview-20260504`.

This branch has merged:

- docs information architecture under `docs/`
- HUDDLE coordination protocol and canonical coordination docs
- OpenTable email/SMS preference work
- Resy observability suite
- restaurant readiness control center
- Resy run analysis workbench
- autonomous founder E2E runner
- Phase 1.5 Quality Gate orchestrator
- Claude docs cleanup branch `claude/integrated-preview-review-20260504`
- Expedia flight-card fallback from Codex
- Provider Runtime Forensics workbench from Claude

Recent integrated verification:

- `npx tsc --noEmit --pretty false` passed.
- `npm run gate:phase1 -- --allow-known-drift` passed with all required checks.
- Runtime forensics tests passed after integration.

## Runtime Forensics Workbench

Merged from `claude/runtime-forensics-workbench`.

What shipped:

- `lib/runtime-forensics/**` pure parser/classifier/report modules.
- `/api/dev/runtime-forensics` read-only dev API.
- `/dev/runtime-forensics` read-only dashboard.
- 8 failure classes, including P0 `legacy_shape_missing_source`.
- Artifact-based loader for `benchmark/runs/*.json`, optional
  `codex-worker.log`, and debug screenshot summaries.
- Paste-ready markdown bug report output.
- 213 targeted tests on Claude branch; verified again by Codex during merge.

Boundaries:

- V1 is artifact-based. DB live lookup is future Codex-owned work.
- No live provider execution.
- No retry/run button.
- No worker control.
- No payment, OTP, CAPTCHA, login bypass, or final confirmation automation.

## Phase Snapshot

- Phase 0A: active. OpenTable is close to stable safe handoff; Resy is still
  not closed and must use probe/artifacts/readiness before any live token spend.
- Expedia runtime: fallback for visible-card DOM scan failure is integrated;
  any controlled retry requires explicit founder approval.
- Phase 0B: gated behind restaurant provider stability.
- Phase 1: roughly 95% shipped; remaining work is founder sign-off and QA
  confidence, not broad new product work.
- Phase 1.5: active tooling/observability layer. Quality Gate, Founder E2E,
  and Runtime Forensics surfaces exist for no-token verification.
- Phase 2: frozen until Phase 0/1 stabilization is declared.

## Safety Rails

- No live OpenAI or Computer Use unless the user approves the exact run.
- No live provider navigation from Track B.
- No payment automation.
- No OTP bypass or CAPTCHA bypass.
- No final irreversible booking confirmation.
- No new dashboard button that can burn tokens or run a live provider flow.
- No auto-starting dev server or worker from gate scripts.

## Recently Shipped By Claude Track B

| Branch | Status in integrated preview | Notes |
|---|---|---|
| `claude/coord-huddle-protocol` | merged | Coordination and shared memory protocol. |
| `claude/opentable-email-preference` | merged | OpenTable marketing SMS/email preference handling. |
| `claude/resy-observability-suite` | merged | Resy probe/debug artifact dashboards. |
| `claude/restaurant-readiness-control-center` | merged | Go/no-go readiness dashboard for restaurant work. |
| `claude/resy-run-analysis-workbench` | merged | Resy run analysis workbench. |
| `claude/phase-1-5-founder-qa-suite` | merged via integrated preview | Founder E2E manual workbench. |
| `claude/autonomous-founder-e2e-runner` | merged | `npm run e2e:founder` autonomous runner. |
| `claude/phase-1-5-quality-gate-orchestrator` | merged | `npm run gate:phase1` plus dashboard. |
| `claude/integrated-preview-review-20260504` | merged | Moved remaining stray root docs into `docs/`. |
| `claude/runtime-forensics-workbench` | merged | Provider runtime forensics workbench. |

## Current Claude Inbox

- Do not start new provider/runtime work.
- If assigned UI/docs/tooling, first check `docs/INDEX.md` and avoid adding
  new root markdown files.
- If adding a dashboard or runner, update the closest runbook plus
  `docs/00-start-here/PHASE_STATUS.md` if phase status changes.
- If touching docs generated before the reorg, fix old root-path links to the
  new `docs/<category>/` paths.

## Blocking On Codex

- Provider/runtime debugging remains Codex-owned. Source of truth is DB job
  state, `codex-worker.log`, and `worker/.debug-screenshots/**`, not the task UI
  alone.
- Resy live closure remains Codex-owned and should not be retried blindly.
- DB integration for runtime forensics remains Codex-owned if/when it is added.
