# Onegent Docs Index

Last updated: 2026-05-04

This is the entrypoint for any new Codex, Claude, or other coding-agent session.
Do not start by reading every markdown file. Read the smallest set that matches
the task.

## Start Here

Read these first, in order:

1. `docs/00-start-here/PROJECT_SUMMARY.md` - short current project overview.
2. `docs/00-start-here/PHASE_STATUS.md` - phase completion, blockers, owners.
3. `docs/10-coordination/README.md` - how Codex/Claude coordinate.
4. `docs/10-coordination/HUDDLE.md` - short shared working memory.
5. `docs/10-coordination/codex.md`, `docs/10-coordination/claude.md`, and
   `docs/10-coordination/phase2.md` - current agent-specific state.

Then read the task-specific section below.

## Task-Specific Reading

| Task | Read |
|---|---|
| Project overview or onboarding | `docs/00-start-here/` |
| Current phase / what to do next | `docs/00-start-here/PHASE_STATUS.md` |
| Codex/Claude handoff | `docs/10-coordination/README.md`, then `docs/10-coordination/*.md` |
| Restaurant Phase 0 / Resy / OpenTable | `docs/20-phase0-restaurant/` |
| Provider runtime bug, logs, screenshots | `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` |
| Computer Use / executor architecture | `docs/30-provider-debug/EXECUTOR_V2_PIVOT.md` |
| Phase 1 founder test / task UI | `docs/40-phase1/` |
| NLU, decision room, trip packaging, Phase 2 revival, social feed | `docs/50-product-areas/` |
| API, OAuth, ChatGPT apps, Claude MCP | `docs/60-api-integrations/` |
| Old plans, audits, full historical summaries | `docs/90-archive/` |

## Expedia Debug Quick Path

For the current Expedia / flight-card DOM scan work, read this exact sequence:

1. `docs/INDEX.md`
2. `docs/00-start-here/PROJECT_SUMMARY.md`
3. `docs/00-start-here/PHASE_STATUS.md`
4. `docs/10-coordination/codex.md`
5. `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`

Then inspect runtime evidence:

- DB fields: `booking_jobs.steps[0].error`, `decisionLog`, `params`.
- Worker log: `codex-worker.log` in the active e2e worktree.
- Debug screenshots: `worker/.debug-screenshots/`.

## Phase 2 Revival Quick Path

For hotel/flight revival work, read:

1. `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md`
2. `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
3. `docs/10-coordination/phase2.md`
4. `docs/10-coordination/HUDDLE.md`

Do not run broad live suites. Start with Expedia flight, then Booking.com
hotel, then Hotels.com only after fresh artifacts exist.

## Maintenance Rules

When a task finishes, update only the relevant layer:

- Phase or blocker changed: update `docs/00-start-here/PHASE_STATUS.md`.
- Agent handoff changed: update `docs/10-coordination/codex.md` or `docs/10-coordination/claude.md`.
- Long-term decision changed: update `docs/10-coordination/STRATEGIC_LEDGER.md`.
- Provider debugging lesson learned: update `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`.
- Restaurant benchmark/runbook changed: update `docs/20-phase0-restaurant/`.
- Founder E2E or Phase 1 UX changed: update `docs/40-phase1/`.
- A plan is completed and no longer active: move it to `docs/90-archive/completed-plans/`.

Do not add new root-level markdown files unless they are repo-level agent or
release entrypoints (`AGENTS.md`, `CLAUDE.md`, `README.md`, `CHANGELOG.md`).

## Current Canonical Files

| Purpose | Canonical file |
|---|---|
| Project summary | `docs/00-start-here/PROJECT_SUMMARY.md` |
| Phase status | `docs/00-start-here/PHASE_STATUS.md` |
| Full historical project summary | `docs/90-archive/history/PROJECT_SUMMARY_FULL_2026-05-03.md` |
| Provider runtime debug | `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` |
| Restaurant handoff | `docs/20-phase0-restaurant/RESTAURANT_PHASE0_HANDOFF.md` |
| R-003 live runbook | `docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md` |
| Phase 1 founder E2E | `docs/40-phase1/PHASE_1_FOUNDER_E2E.md` |
| Coordination | `docs/10-coordination/` |
