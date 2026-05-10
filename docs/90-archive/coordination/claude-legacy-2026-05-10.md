# Claude - coordination state

> Branch context: working on
> `claude/r030-infra-db-transient-fix`, based on
> `codex/integrated-preview-20260504 @ 1978cc7`.
> Integrated preview now includes provider closure final integration
> (`c33b429`), provider closure war room (`7597b12`), Claude operator
> failure taxonomy (`a7ed628`), 2026-05-05 R-030 evidence packaging
> (`1ebd09a`), Expedia flight closure final (`25d29fb` + `42ff52a`),
> hotel booking safety hardening (`f863a82` + `7916ff1`), and the
> coordination commit (`1978cc7`). The cockpit `/dev/provider-closure`
> mirrors the 8-state closure partition.
>
> The current branch fixes the no-live infra blocker that the
> 2026-05-05 03:55 R-030 retry surfaced: a transient Neon
> `ConnectTimeoutError` during runner polling produced a bare
> `failed_unknown` + `500 Internal Server Error` and left the DB row
> stuck in `running/pending`. The fix adds bounded retry/backoff to
> the runner polling layer, classifies Neon transients as
> `F-INFRA-DB-TRANSIENT` / `model_env_transient` (not Resy
> `no_availability`), enriches the benchmark report with task id /
> job id / screenshot dir / last known stage / safety status / DB
> availability flag / poll-retries-absorbed even when DB terminal is
> lost, ships a no-live `lib/runtime-forensics/stuck-job-audit.ts`
> for artifact-side detection, and documents an exact manual cleanup
> SQL procedure under `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
> section 6.5 (founder approval required, audit run first, cleanup
> not executed by code).
>
> No live OpenAI / Computer Use / browser / worker / DB mutation /
> .env handling in this branch.
>
> Last updated: 2026-05-05.
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
   - Phase 1/QA: `docs/90-archive/phase1-demo/PHASE_1_FOUNDER_E2E.md`,
     `docs/90-archive/phase1-demo/PHASE_1_QUALITY_GATE.md`,
     `docs/90-archive/phase1-demo/AUTONOMOUS_FOUNDER_E2E.md`
   - Restaurant/Resy: `docs/90-archive/phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md`,
     `docs/90-archive/phase0-restaurant/RESY_LIVE_DEBUG_PLAYBOOK.md`,
     `docs/90-archive/phase0-restaurant/RESY_AVAILABILITY_PROBE_PROTOCOL.md`

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
- `app/dev/demo-control-room/refresh-button.tsx` �?only mutating action
  on the page is `router.refresh()`.
- 68 vitest cases (17 phase2-status + 31 loader + 20 script).
- `docs/90-archive/phase1-demo/DEMO_CONTROL_ROOM.md` operator runbook.
- `docs/90-archive/phase1-demo/YC_DEMO_RUNBOOK.md` (Track C) cross-linked.

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
  `docs/90-archive/phase2-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`.
- Phase 0B: gated behind restaurant provider stability.
- Phase 1: demo-freeze passed on integrated preview. Phase 1 gate with
  smoke + autonomous founder e2e is 12/12, production build is clean,
  and production route probe is 13/13. Remaining work is the manual
  founder walkthrough (`docs/90-archive/phase1-demo/PHASE_1_FOUNDER_E2E.md`) for the
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
| `claude/live-transient-failure-operator-polish` | merged via cherry-pick (`a7ed628`) | Add `lib/operator-failure-taxonomy/` pure module + `docs/30-provider-debug/FAILURE_TAXONOMY.md` separating model/env transient (e.g. R-030 OpenAI Responses API 500 on 2026-05-04) from provider/network degraded vs provider logic vs safe boundary. Cross-link from `docs/90-archive/phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md` and `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`. Add `lib/__tests__/operator-failure-taxonomy.test.ts` (16 cases including R-030 worked-example evidence ids) and `lib/__tests__/docs-static-operator-pages.test.ts` (5 cases) auto-discovering every `app/dev/**/*.tsx` page and forbidding run/retry/live mutating buttons + `onClick` handlers + booking-jobs/v1 mutation fetches. |
| `claude/provider-closure-operator-room` | merged via cherry-pick (`1700725`) | Add read-only `/dev/provider-closure` cockpit composing `lib/provider-closure-room/` (3-lane manifest + artifact-graceful loader) with `lib/operator-failure-taxonomy/` and the live closure evidence protocol. Three vertical lanes (restaurant / flight / hotel) each show closure posture, last known blocker, evidence required, primary runbook + supporting references, safe hard stops, what to inspect after run, no-live CLI commands, taxonomy classes, and a source-of-truth reminder. New `docs/30-provider-debug/PROVIDER_CLOSURE_OPERATOR_ROOM.md` operator usage doc; cross-linked from `LIVE_CLOSURE_EVIDENCE_PROTOCOL.md` and `docs/INDEX.md`. Loader probes `app/dev/live-operator-checklist/page.tsx` via filesystem (no hard import) so the cockpit builds even before the unmerged sidecar lands. Static guards in `docs-static-operator-pages.test.ts` lock no run/retry/live/start/resume/execute/submit verbs as button labels or onClick handlers, no mutating fetch, no `<form>`, no hard import of `lib/live-operator-checklist/`, and the explicit "No live run is authorized by this page" disclaimer. |
| `claude/provider-closure-acceptance-final` | merged via cherry-pick (`c33b429`) | Add canonical `docs/30-provider-debug/PROVIDER_CLOSURE_ACCEPTANCE.md` with per-vertical closure pass / fail / inconclusive criteria mapped onto the 8-state taxonomy from `lib/provider-closure/schema.ts`. Extend `lib/provider-closure-room/lanes.ts` with `liveVerified: false`, `safeTerminalStates`, `failureTerminalStates`, `inconclusiveTerminalStates`, and `nextSingleAllowedAction` fields per lane. Polish `/dev/provider-closure` with a NOT LIVE VERIFIED banner per lane, a Next single allowed action block, and a Closure acceptance criteria block (3-column pass / fail / inconclusive). New `lib/__tests__/provider-closure-acceptance.test.ts` (17 cases) enforces: every provider has runbook + hard stops + evidence list + safe terminal states + nextSingleAllowedAction; the 8-state taxonomy is partitioned without overlap or omission; nextSingleAllowedAction never advertises mutating verb phrases and starts with an inspection-style verb; every lane stays `liveVerified: false` until acceptance doc records evidence; the acceptance doc has the canonical "tooling passing != closure passing" warning, per-vertical Closure passes/fails/Inconclusive triplet, Next single allowed action sections, Verified live closure sections (currently "None"), 8-state taxonomy verbatim, cross-links, ASCII-only, < 400 lines; and a Phase 2 over-claim guard that scans `docs/**/*.md` for `live verified` / `live-verified` and requires a denial / negation / scope marker in a 5-line window. Cross-links from `LIVE_CLOSURE_EVIDENCE_PROTOCOL.md`, `PROVIDER_CLOSURE_OPERATOR_ROOM.md`, `docs/INDEX.md`, and `docs/00-start-here/PHASE_STATUS.md`. |
| `claude/r030-2026-05-05-evidence-packaging` | merged via cherry-pick (`1ebd09a`) | No-live evidence packaging for the 2026-05-05 02:08 R-030 retry. The retry stayed inside safety bounds (browser opened the exact Resy venue URL, `decisionLog=null`, no payment / CVV / OTP / SMS / phone-verification / CAPTCHA / login bypass / final confirmation touched) but failed in 9 seconds with OpenAI Responses API 403 `model_not_found`. Founder confirmed the intended OpenAI project has `gpt-5.5` access and budget, so this is tracked as a Claude worktree runtime env/project mismatch, not global model access loss. Classification `model_env_transient` / `F-INFRA-MODEL-ACCESS`; closure outcome **inconclusive** (not pass, not fail). The `422abe0` Resy recovery patches remain unvalidated because none of them executed. Evidence: task `caa90661-ceb1-4753-aedc-be6282322a62`, job `f66f9e63-d2d0-43fe-940b-8fc0329ca5ef`, report `benchmark/runs/phase0-resy-2026-05-05T02-08-50-530Z.json`, DB `__source = lib/core/execution-local-c2110aa34d`, DB `handoff_url = exact Charlie Bird venue URL with date=2026-05-08&seats=2&time=2000`. Updates: `docs/90-archive/phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md` adds the 2026-05-05 worked example alongside 2026-05-04. `lib/operator-failure-taxonomy/categories.ts` `WORKED_EXAMPLES` adds `R030_OPENAI_403_MODEL_NOT_FOUND` alongside the existing R-030 OpenAI 500. `docs/30-provider-debug/FAILURE_TAXONOMY.md` mirrors the new worked example. `docs/30-provider-debug/PROVIDER_CLOSURE_ACCEPTANCE.md` Restaurant Verified-live-closure section adds an "Inconclusive datapoints" sub-list; the `liveVerified: false` lock stays. **No provider/runtime patch.** No retry. The next safe step is to install/verify the intended `gpt-5.5`-enabled runtime env for the worktree and pass a no-provider model-access preflight, then explicitly approve exactly one new R-030 attempt. |
| `claude/r030-infra-db-transient-fix` | merged via cherry-pick (`350a93a`) | No-live infra fix for the 2026-05-05 03:55 R-030 retry blocker. That retry passed model-access preflight, opened the exact Resy venue URL, ran ~2 minutes of Computer Use actions (16 screenshots), then a single transient Neon `ConnectTimeoutError` mid-poll caused the runner to bail with `failed_unknown` + `500 Internal Server Error: Internal Server Error` while the in-process executor's terminal DB write was lost; job `9b87e947-e783-434a-b36a-054a461053f8` is left `running/pending`. Fix: (1) `scripts/run-phase0-resy-benchmark.ts` adds `withTransientRetry` (4 attempts, exponential backoff 500ms/1500ms/4500ms) wrapping `getTravelTask` + `getTimeline`; runner now survives a single 5xx blip and only bails after retry exhaustion. (2) Adds `F-INFRA-DB-TRANSIENT` benchmark taxonomy code matching `connecttimeouterror` / `neondberror` / `error connecting to database` / `fetch failed`, ranked above generic 5xx so a Neon blip cannot misclassify as Resy `no_availability`. (3) Enriches `CaseResult` with `screenshotDir` (derived from job id), `lastKnownStage`, `errorClass`, `safetyStatus` (`inside_safety_bounds` / `safety_violation_detected` / `unknown`), `dbTerminalAvailable`, `pollRetriesAbsorbed`. Hoists task id + job id from create response so they survive even when polling fails completely. (4) Adds Neon DB signals to `lib/runtime-forensics/classifier.ts` (`model_or_env_blocked` bucket) and `lib/operator-failure-taxonomy/categories.ts` (`model_env_transient`). (5) New no-live `lib/runtime-forensics/stuck-job-audit.ts` (pure module, fs read-only) scans `benchmark/runs/phase0-resy-*.json` for the DB-transient pattern, returns paste-ready operator markdown; never mutates DB. (6) `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` § 6.5 documents the manual cleanup procedure (read-only audit + screenshot safety check + DB read-only confirm + exact UPDATE template gated on founder approval; cleanup is NOT executed by code). Tests: `lib/__tests__/phase0-resy-benchmark-retry.test.ts` (20 cases) covers transient detection / retry survival / DB-transient classification / DB-transient does NOT misclassify as `F-AVAIL-NONE`; `lib/__tests__/stuck-job-audit.test.ts` (13 cases) covers pattern detection / markdown rendering / fs integration / never advertises live actions. **No provider/runtime patch in lib/booking-autopilot, lib/core, lib/execution-v2, worker/src, or app/api.** No DB mutation. No `.env` / OPENAI_API_KEY handling. No live retry. Future R-030 prompts can follow the founder's prompt-as-authorization rule: up to two controlled attempts for one exact case, with attempt 2 only after evidence-driven root-cause/fix. |

## Current Claude Inbox

- Do not start new provider/runtime work.
- Demo-freeze passed; new docs/UI work for Track B should reflect that
  the integrated preview now ships with `/dev/demo-control-room`,
  `/dev/demo-readiness`, runtime-forensics UX v2, the live closure
  evidence protocol, the operator failure taxonomy, and the provider
  closure operator room (`/dev/provider-closure`).
- If assigned UI/docs/tooling, first check `docs/INDEX.md` and avoid adding
  new root markdown files.
- If adding a dashboard or runner, update the closest runbook plus
  `docs/00-start-here/PHASE_STATUS.md` if phase status changes.
- If touching docs generated before the reorg, fix old root-path links to the
  new `docs/<category>/` paths.
- Do not duplicate Agent3's `lib/__tests__/docs-static-guard.test.ts`
  invariants; extend it with post-freeze guards instead.
- Operator dev pages must keep the strictest no-action-button rule:
  no run / retry / live / start / resume / execute / submit verbs as
  button labels or onClick handlers; only Refresh + copy + links.

## Blocking On Codex

- Provider/runtime debugging remains Codex-owned. Source of truth is DB job
  state, `codex-worker.log`, and `worker/.debug-screenshots/**`, not the task UI
  alone.
- Resy live closure remains Codex-owned and should not be retried blindly.
- DB integration for runtime forensics remains Codex-owned if/when it is added.
