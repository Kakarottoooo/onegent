# Claude - coordination state

> Branch context: working on `claude/live-transient-failure-operator-polish`,
> based on `codex/integrated-preview-20260504 @ 0c7efca`.
> Integrated preview now includes Claude Track B branches through
> `codex/integrated-preview-20260504` post Phase 1/1.5 demo-freeze pass
> plus the second/third/fourth sidecar batches (Phase 2 hotel audit +
> retry analysis pack, Track C demo acceptance + freeze checker, Claude
> multi-agent conflict protocol, Claude new-agent startup contract,
> Goal Phase 0 restaurant artifact pack + artifact corpus).
> Last updated: 2026-05-04.
> Canonical path: `docs/10-coordination/claude.md`.

Codex reads this at session start. Claude should update it before pushing work
that changes Track B status, handoff rules, or UI/docs/tooling ownership.

## Agent Quickstart

Read in this order when picking up Onegent cold:

1. `docs/INDEX.md`
2. `docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md` (3-minute
   cold-start checklist; canonical branch/worktree, HUDDLE discipline,
   stale branch / cherry-pick rules, forbidden paths, safety hard stops,
   validation levels, how to report results)
3. `docs/00-start-here/PROJECT_SUMMARY.md`
4. `docs/00-start-here/PHASE_STATUS.md`
5. `docs/10-coordination/MULTI_AGENT_PROTOCOL.md` (long-form contract;
   read after the startup contract)
6. `docs/10-coordination/HUDDLE.md`
7. `docs/10-coordination/codex.md`
8. `docs/10-coordination/claude.md`
9. Task-specific runbook:
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
- Runtime Forensics UX v2 (URL filters, fixtures, recommendation engine,
  examples toggle, sortable headers, signal-by-source detail panel)
- Demo Control Room (`/dev/demo-control-room`) and YC Demo Runbook
- Track C Demo Readiness sidecar (`/dev/demo-readiness`,
  `lib/demo-evidence/**`)
- Phase 2 Expedia controlled retry runbook + retry analysis pack
- Phase 1/1.5 demo-freeze closure: payment-field guard on profile PATCH,
  optional Clerk anonymous fallback for non-prod paths, PWA icons

Recent integrated verification (2026-05-04 demo-freeze pass):

- `npx tsc --noEmit --pretty false` passed.
- `npm run gate:phase1 -- --allow-known-drift --include-smoke --include-e2e`
  passed 12/12 with 0 fail, 0 skipped, 0 known-existing drift.
- `npm run smoke:phase1` passed all 6 routes.
- `npm run e2e:founder` passed all 15 autonomous probes.
- `npm run build` passed end-to-end (webpack, due to local Windows
  worktree `node_modules` junction tripping Turbopack).
- Production `next start` route probe returned 200 for 13/13 demo routes
  including `/dev/demo-control-room`, `/dev/demo-readiness`,
  `/dev/runtime-forensics`, `/dev/phase1-quality-gates`,
  `/dev/founder-e2e`, `/`, `/tasks`, `/pricing`, `/permissions`,
  `/developers/docs/api/v1`, `/dev`, `/dev/restaurant-readiness`, and
  `/dev/resy-run-analysis`.

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
- 377 targeted runtime-forensics tests on the integrated preview after the
  UX v2 cherry-pick (URL filters, fixtures, recommendation engine, signal
  grouping, sortable headers); verified by Codex during integration.

Boundaries:

- V1 is artifact-based. DB live lookup is future Codex-owned work.
- No live provider execution.
- No retry/run button.
- No worker control.
- No payment, OTP, CAPTCHA, login bypass, or final confirmation automation.

## Demo Control Room

Merged from `claude/demo-control-room` via Codex cherry-pick.

What shipped:

- `lib/demo-control-room/**` pure modules: `phase2-status` (single source
  of truth for Phase 2 vertical posture), `loader` (composes
  `lib/quality-gate/loader` and `lib/founder-e2e/loader`, extracts the
  `smoke:phase1` check from the latest gate `checks[]`), and `script`
  (deterministic safe demo script with markdown export).
- `/dev/demo-control-room` read-only RSC page surfacing Phase 1 gate /
  founder-e2e / smoke verdicts, Phase 2 vertical posture, runtime
  forensics quick-link, and the safe demo script.
- `app/dev/demo-control-room/refresh-button.tsx` — only mutating action
  on the page is `router.refresh()`.
- 68 vitest cases (17 phase2-status + 31 loader + 20 script).
- `docs/40-phase1/DEMO_CONTROL_ROOM.md` operator runbook.
- `docs/40-phase1/YC_DEMO_RUNBOOK.md` (Track C) cross-linked.

Boundaries:

- Read-only V1; never invokes a runner, no DB queries, no new dev API.
- No retry / re-run / accept buttons. Re-runs happen from a shell.
- ASCII-only copy. No live OpenAI / Computer Use / payment / OTP /
  CAPTCHA / final-confirm path.

## Phase Snapshot

- Phase 0A: active. OpenTable is close to stable safe handoff; Resy is still
  not closed and must use probe/artifacts/readiness before any live token spend.
- Expedia runtime: fallback for visible-card DOM scan failure is integrated;
  any controlled retry requires explicit founder approval per
  `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`.
- Phase 0B: gated behind restaurant provider stability.
- Phase 1: demo-freeze passed on integrated preview. Phase 1 gate with
  smoke + autonomous founder e2e is 12/12, production build is clean,
  and production route probe is 13/13. Remaining work is the manual
  founder walkthrough (`docs/40-phase1/PHASE_1_FOUNDER_E2E.md`) for the
  human acceptance signature.
- Phase 1.5: demo-freeze passed. Quality Gate, Founder E2E, Runtime
  Forensics, Demo Control Room, and Track C Demo Readiness are all
  read-only and integrated.
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
| `claude/runtime-forensics-ux-polish-v2` | merged via cherry-pick | URL multi-select filters, sortable headers, fixtures (`?examples=1`), recommendation engine, signal-by-source detail panel. |
| `claude/demo-control-room` | merged via cherry-pick | Read-only `/dev/demo-control-room` aggregating gate/founder-e2e/smoke verdicts plus Phase 2 posture and safe demo script. |
| `claude/phase1-doc-cleanup-after-freeze` | merged via cherry-pick (`db0aef8`) | Phase 1/1.5 docs refresh after demo-freeze pass; dropped stale 95% claim and 213-test count, extended `docs-static-guard` with post-freeze invariants. |
| `claude/docs-ia-post-freeze-index` | merged via cherry-pick (`9b83153`) | Refresh `docs/INDEX.md` with new-agent read order + post-freeze quick path + Phase 2 hotel paths, refresh `PROJECT_SUMMARY` worktree/phase snapshot, refresh `PHASE_STATUS` integrated-preview branch list, extend docs static guards with INDEX read-order + canonical path invariants. |
| `claude/multi-agent-conflict-protocol` | merged via cherry-pick (`7e66950`) | Add `docs/10-coordination/MULTI_AGENT_PROTOCOL.md` (branch freshness rule, ownership map, HUDDLE discipline, goal-branch behavior, cherry-pick policy, forbidden paths). Split the docs static guard into focused files while preserving current demo/Phase 2/IA invariants. Update `docs/10-coordination/README.md` to point at the protocol. |
| `claude/new-agent-startup-contract` | merged via cherry-pick (`8a4c5bd`) | Add `docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md` as the 3-minute cold-start checklist for any coding agent. Cross-link from `docs/INDEX.md` and `docs/10-coordination/MULTI_AGENT_PROTOCOL.md`. Extend `lib/__tests__/docs-static-core.test.ts` with required-docs entry + new it block locking the contract's sections, key terms, and cross-links. |
| `claude/live-operator-control-surface` | pushed, awaiting cherry-pick (`fbd701a`) | Add read-only `/dev/live-operator-checklist` page powered by pure `lib/live-operator-checklist/` (per-provider hard stops + evidence + analyzer + runbook links for restaurant / Expedia / hotel). 17 unit tests + new docs-static-core guard locking the page is read-only with no action buttons. |
| `claude/live-transient-failure-operator-polish` | active | Add `lib/operator-failure-taxonomy/` pure module + `docs/30-provider-debug/FAILURE_TAXONOMY.md` separating model/env transient (e.g. R-030 OpenAI Responses API 500 on 2026-05-04) from provider/network degraded vs provider logic vs safe boundary. Cross-link from `docs/20-phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md` and `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`. Add `lib/__tests__/operator-failure-taxonomy.test.ts` (16 cases including R-030 worked-example evidence ids) and `lib/__tests__/docs-static-operator-pages.test.ts` (5 cases) auto-discovering every `app/dev/**/*.tsx` page and forbidding run/retry/live mutating buttons + `onClick` handlers + booking-jobs/v1 mutation fetches. |

## Current Claude Inbox

- Do not start new provider/runtime work.
- Demo-freeze passed; new docs/UI work for Track B should reflect that
  the integrated preview now ships with `/dev/demo-control-room`,
  `/dev/demo-readiness`, and runtime-forensics UX v2.
- If assigned UI/docs/tooling, first check `docs/INDEX.md` and avoid adding
  new root markdown files.
- If adding a dashboard or runner, update the closest runbook plus
  `docs/00-start-here/PHASE_STATUS.md` if phase status changes.
- If touching docs generated before the reorg, fix old root-path links to the
  new `docs/<category>/` paths.
- Do not duplicate Agent3's `lib/__tests__/docs-static-guard.test.ts`
  invariants; extend it with post-freeze guards instead.

## Blocking On Codex

- Provider/runtime debugging remains Codex-owned. Source of truth is DB job
  state, `codex-worker.log`, and `worker/.debug-screenshots/**`, not the task UI
  alone.
- Resy live closure remains Codex-owned and should not be retried blindly.
- DB integration for runtime forensics remains Codex-owned if/when it is added.
