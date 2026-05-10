# Onegent Docs Index

Last updated: 2026-05-10

This is the docs entrypoint for any new Codex, Claude, Goal, Agent2, Agent3, or
other coding-agent session. Read `AGENTS.md` first for behavior rules. Do not
start by reading every markdown file. Read the smallest set that matches the
task.

## New Agent Read Order

If you are a fresh agent picking up Onegent cold, read this exact set first
and stop at the first task-specific runbook that matches your assignment:

1. `AGENTS.md` - canonical behavior rules.
2. `docs/INDEX.md` (this file).
3. `docs/00-start-here/PROJECT_SUMMARY.md` - compact current project overview.
4. `docs/00-start-here/PHASE_STATUS.md` - current verified state and phase
   gates.
5. `docs/00-start-here/STAGE_0.md` - current operating plan.
6. The task-specific section below that matches your assignment.

Read coordination logs only when the task is specifically about multi-agent
intake, branch integration, or stale handoff history.

Verification baseline for any non-trivial branch:

```bash
npx tsc --noEmit --pretty false
npm run gate:phase1 -- --allow-known-drift
git diff --check
```

Do not run live OpenAI, Computer Use, provider navigation, payment, OTP,
CAPTCHA, or final-confirm flows unless the founder explicitly approves the
exact live run.

## Start Here

The "New Agent Read Order" above is the canonical entry path. The list below
is kept for compatibility with older docs that linked to "Start Here":

1. `AGENTS.md`
2. `docs/00-start-here/PROJECT_SUMMARY.md`
3. `docs/00-start-here/PHASE_STATUS.md`
4. `docs/00-start-here/STAGE_0.md`

Then read the task-specific section below. Do not read historical coordination
logs by default.

## Task-Specific Reading

| Task | Read |
|---|---|
| Project overview or onboarding | `docs/00-start-here/` |
| Stage 0 north star / current operating plan | `docs/00-start-here/STAGE_0.md` |
| Capture MVP seams / homepage intake | `docs/40-dogfood/CAPTURE_MVP_SEAMS.md`, then `lib/capture/travel-object.ts`, `lib/capture/benchmark.ts` |
| Stage 0 capture benchmark / operator report | `scripts/capture-benchmark.ts`, `scripts/stage0-operator-report.ts`, `scripts/private-alpha-intake.ts`, `scripts/measure-app-performance.ts`, `lib/internal-benchmark/stage0-operator-report.ts` |
| Private alpha readiness | `docs/40-dogfood/PRIVATE_ALPHA_READINESS.md`, `docs/40-dogfood/PRIVATE_ALPHA_INTAKE_PROTOCOL.md` |
| System design / architecture | `docs/00-start-here/SYSTEM_DESIGN.md` |
| Current phase / what to do next | `docs/00-start-here/PHASE_STATUS.md` |
| Agent behavior rules | `AGENTS.md` |
| Codex / Claude / Goal / Agent2 / Agent3 handoff | `docs/10-coordination/README.md`, then the specific coordination file only if needed |
| Restaurant Phase 0 / Resy / OpenTable | `docs/20-phase0-restaurant/` |
| OpenTable restaurant baseline benchmark | `docs/20-phase0-restaurant/OPENTABLE_BASELINE_BENCHMARK_PLAN.md` |
| Provider runtime bug, logs, screenshots | `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`, `docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md` |
| Activity provider skill runtime / Browser Harness Stage 0B | `docs/30-provider-debug/ACTIVITY_PROVIDER_SKILL_RUNTIME.md`, then `docs/30-provider-debug/STAGE0B_TM_SEATGEEK_LAB.md`, `docs/30-provider-debug/STAGE0B_PATCH_PROPOSAL_TEMPLATES.md` |
| Hotel layered recovery / fallback rules | `docs/30-provider-debug/HOTEL_LAYERED_RECOVERY.md`, then `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md` |
| Runtime mirror / drift strategy | `docs/30-provider-debug/RUNTIME_MIRROR_GUIDE.md`, `scripts/check-drift.ts` |
| Operator failure taxonomy (model/env vs provider) | `docs/30-provider-debug/FAILURE_TAXONOMY.md` |
| Provider closure operator cockpit (3-vertical workflow) | `docs/30-provider-debug/PROVIDER_CLOSURE_OPERATOR_ROOM.md` |
| Provider closure acceptance criteria (pass / fail / inconclusive) | `docs/30-provider-debug/PROVIDER_CLOSURE_ACCEPTANCE.md` |
| Layered no-live closure benchmark | `docs/30-provider-debug/LAYERED_BENCHMARK_V2.md`, `scripts/layered-benchmark.ts` |
| Computer Use / executor architecture | `docs/30-provider-debug/EXECUTOR_V2_PIVOT.md` |
| Phase 1 founder walkthrough / task UI | `docs/40-phase1/PHASE_1_FOUNDER_E2E.md`, `docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md`, `docs/40-phase1/PHASE_1_QUALITY_GATE.md` |
| Founder dogfood bugs | `docs/40-dogfood/BUG_INBOX.md` |
| Layered benchmark dogfood plan | `docs/40-dogfood/LAYERED_BENCHMARK_DOGFOOD_PLAN.md` |
| Stage 0 daily operator report | `docs/40-dogfood/STAGE0_DAILY_REPORT.md` |
| Agent intake queue and operator cockpit | `docs/40-dogfood/AGENT_INTAKE_QUEUE.md`, `scripts/layered-agent-intake.ts`, `scripts/layered-operator-cockpit.ts` |
| Phase 1.5 demo readiness / control room | `docs/40-phase1/DEMO_CONTROL_ROOM.md`, `docs/40-phase1/YC_DEMO_RUNBOOK.md`, `docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md` |
| Legacy Phase 2 Expedia controlled retry | `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`, `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md` |
| Phase 2 hotel revival audit | `docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md`, `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md` |
| NLU, decision room, trip packaging, social feed | `docs/50-product-areas/` |
| API, OAuth, ChatGPT apps, Claude MCP | `docs/60-api-integrations/` |
| Gmail OTP assist / provider login codes | `docs/60-api-integrations/GMAIL_OTP_ASSIST.md` |
| Old plans, audits, full historical summaries | `docs/90-archive/` |

## Legacy Phase 1 / 1.5 Demo Freeze Quick Path

This section is historical. Use it only when operating old demo surfaces:

1. `docs/INDEX.md`
2. `docs/00-start-here/PHASE_STATUS.md`
3. `docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md`
4. `docs/40-phase1/DEMO_CONTROL_ROOM.md`
5. `docs/40-phase1/YC_DEMO_RUNBOOK.md`
6. `docs/40-phase1/PHASE_1_FOUNDER_E2E.md`

Then verify the relevant local state by opening these read-only dev surfaces
(no run / retry / live buttons exist):

- `/dev/demo-readiness` - compact go/no-go.
- `/dev/demo-control-room` - full evidence cockpit + safe demo script.
- `/dev/phase1-quality-gates` - latest quality gate verdict.
- `/dev/founder-e2e` - latest founder E2E verdict.
- `/dev/runtime-forensics` - failure classification when artifacts exist.

## Legacy Expedia Debug Quick Path

For old Expedia / flight-card DOM scan work, read this exact sequence:

1. `docs/INDEX.md`
2. `docs/00-start-here/PROJECT_SUMMARY.md`
3. `docs/00-start-here/PHASE_STATUS.md`
4. `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
5. `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`

Then inspect runtime evidence:

- DB fields: `booking_jobs.steps[0].error`, `decisionLog`, `params`.
- Worker log: `codex-worker.log` in the active e2e worktree.
- Debug screenshots: `worker/.debug-screenshots/`.

## Legacy Phase 2 Revival Quick Path

For old hotel/flight revival work, read:

1. `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md` - cross-vertical
   revival audit.
2. `docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md` - Booking.com /
   Hotels.com / Expedia hotel no-live audit.
3. `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md` - controlled
   retry checklist for the closest Phase 2 candidate.
4. `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md` - hotel-specific
   controlled retry checklist.
5. `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
6. `docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md`
Do not run broad live suites. Start with the current Stage 0 plan before using
this legacy section.

## Maintenance Rules

When a task finishes, update only the relevant layer:

- Phase or blocker changed: update `docs/00-start-here/PHASE_STATUS.md`.
- Durable agent behavior changed: update `AGENTS.md`.
- Agent handoff changed: update only the relevant short coordination pointer
  file if it materially helps the next agent.
- Long-term decision changed: update `docs/10-coordination/STRATEGIC_LEDGER.md`.
- Provider debugging lesson learned: update `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`.
- Restaurant benchmark/runbook changed: update `docs/20-phase0-restaurant/`.
- Founder E2E or Phase 1 UX changed: update `docs/40-phase1/PHASE_1_FOUNDER_E2E.md`
  (and `docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md` if the autonomous runner
  surface changed).
- Demo readiness, control room, or freeze acceptance changed: update the
  matching runbook under `docs/40-phase1/`.
- Phase 2 vertical posture changed: update the closest product-area runbook
  and any code mirror used by the relevant UI if applicable.
- A plan is completed and no longer active: move it to `docs/90-archive/completed-plans/`.

Do not add new root-level markdown files unless they are repo-level agent or
release entrypoints (`AGENTS.md`, `CLAUDE.md`, `README.md`, `CHANGELOG.md`).

## Current Canonical Files

| Purpose | Canonical file |
|---|---|
| Project summary | `docs/00-start-here/PROJECT_SUMMARY.md` |
| Stage 0 operating plan | `docs/00-start-here/STAGE_0.md` |
| System design | `docs/00-start-here/SYSTEM_DESIGN.md` |
| Phase status | `docs/00-start-here/PHASE_STATUS.md` |
| Full historical project summary | `docs/90-archive/history/PROJECT_SUMMARY_FULL_2026-05-03.md` |
| Coordination root | `docs/10-coordination/README.md` |
| New agent startup contract | `docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md` |
| Multi-agent conflict protocol | `docs/10-coordination/MULTI_AGENT_PROTOCOL.md` |
| Coordination shared memory | `docs/10-coordination/HUDDLE.md` |
| Coordination strategic ledger | `docs/10-coordination/STRATEGIC_LEDGER.md` |
| Codex state pointer | `docs/10-coordination/codex.md` |
| Historical per-agent state | `docs/10-coordination/claude.md`, `docs/10-coordination/track-c.md`, `docs/10-coordination/phase2.md` |
| Restaurant handoff | `docs/20-phase0-restaurant/RESTAURANT_PHASE0_HANDOFF.md` |
| R-003 live runbook | `docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md` |
| Provider runtime debug | `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` |
| Hotel layered recovery | `docs/30-provider-debug/HOTEL_LAYERED_RECOVERY.md` |
| Live closure evidence protocol | `docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md` |
| Runtime mirror guide | `docs/30-provider-debug/RUNTIME_MIRROR_GUIDE.md` |
| Operator failure taxonomy | `docs/30-provider-debug/FAILURE_TAXONOMY.md` |
| Provider closure operator room | `docs/30-provider-debug/PROVIDER_CLOSURE_OPERATOR_ROOM.md` |
| Provider closure acceptance | `docs/30-provider-debug/PROVIDER_CLOSURE_ACCEPTANCE.md` |
| Layered no-live closure benchmark | `docs/30-provider-debug/LAYERED_BENCHMARK_V2.md` |
| Phase 1 founder E2E | `docs/40-phase1/PHASE_1_FOUNDER_E2E.md` |
| Founder dogfood bug inbox | `docs/40-dogfood/BUG_INBOX.md` |
| Private alpha intake protocol | `docs/40-dogfood/PRIVATE_ALPHA_INTAKE_PROTOCOL.md` |
| Stage 0 daily operator report | `docs/40-dogfood/STAGE0_DAILY_REPORT.md` |
| Phase 1 autonomous E2E runner | `docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md` |
| Phase 1.5 quality gate | `docs/40-phase1/PHASE_1_QUALITY_GATE.md` |
| Demo control room runbook | `docs/40-phase1/DEMO_CONTROL_ROOM.md` |
| YC demo runbook | `docs/40-phase1/YC_DEMO_RUNBOOK.md` |
| Demo freeze acceptance | `docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md` |
| Phase 2 revival audit | `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md` |
| Hotel vertical revival audit | `docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md` |
| Expedia controlled retry runbook | `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md` |
| Hotel controlled retry runbook | `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md` |
