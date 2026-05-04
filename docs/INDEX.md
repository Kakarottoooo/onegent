# Onegent Docs Index

Last updated: 2026-05-04

This is the entrypoint for any new Codex, Claude, or other coding-agent session.
Do not start by reading every markdown file. Read the smallest set that matches
the task.

## New Agent Read Order

If you are a fresh agent picking up Onegent cold, read this exact set first
and stop at the first task-specific runbook that matches your assignment:

1. `docs/INDEX.md` (this file).
2. `docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md` - the one-page
   contract every coding agent signs implicitly when opening a branch.
   Read this BEFORE you read PROJECT_SUMMARY or PHASE_STATUS.
3. `docs/00-start-here/PROJECT_SUMMARY.md` - short current project overview.
4. `docs/00-start-here/PHASE_STATUS.md` - phase status, blockers, owners,
   and current verified verdict numbers.
5. `docs/10-coordination/README.md` - how Codex/Claude coordinate.
6. `docs/10-coordination/MULTI_AGENT_PROTOCOL.md` - long-form
   merge-conflict-avoidance contract. Mandatory before opening any new
   branch that touches shared docs, tests, or coordination state.
7. `docs/10-coordination/HUDDLE.md` - short shared working memory; latest
   activity + active locks + inboxes for codex / claude / track-c.
8. `docs/10-coordination/codex.md`, `docs/10-coordination/claude.md`,
   `docs/10-coordination/phase2.md`, and `docs/10-coordination/track-c.md` -
   current agent-specific state.
9. The task-specific section below that matches your assignment.

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

1. `docs/00-start-here/PROJECT_SUMMARY.md`
2. `docs/00-start-here/PHASE_STATUS.md`
3. `docs/10-coordination/README.md`
4. `docs/10-coordination/HUDDLE.md`
5. `docs/10-coordination/codex.md`, `docs/10-coordination/claude.md`,
   `docs/10-coordination/phase2.md`, `docs/10-coordination/track-c.md`

Then read the task-specific section below.

## Task-Specific Reading

| Task | Read |
|---|---|
| Project overview or onboarding | `docs/00-start-here/` |
| Current phase / what to do next | `docs/00-start-here/PHASE_STATUS.md` |
| Codex / Claude / Track C handoff | `docs/10-coordination/README.md`, then `docs/10-coordination/*.md` |
| Restaurant Phase 0 / Resy / OpenTable | `docs/20-phase0-restaurant/` |
| Provider runtime bug, logs, screenshots | `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`, `docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md` |
| Computer Use / executor architecture | `docs/30-provider-debug/EXECUTOR_V2_PIVOT.md` |
| Phase 1 founder walkthrough / task UI | `docs/40-phase1/PHASE_1_FOUNDER_E2E.md`, `docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md`, `docs/40-phase1/PHASE_1_QUALITY_GATE.md` |
| Phase 1.5 demo readiness / control room | `docs/40-phase1/DEMO_CONTROL_ROOM.md`, `docs/40-phase1/YC_DEMO_RUNBOOK.md`, `docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md` |
| Phase 2 Expedia controlled retry | `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`, `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md`, `docs/10-coordination/phase2.md` |
| Phase 2 hotel revival audit | `docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md`, `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md` |
| NLU, decision room, trip packaging, social feed | `docs/50-product-areas/` |
| API, OAuth, ChatGPT apps, Claude MCP | `docs/60-api-integrations/` |
| Old plans, audits, full historical summaries | `docs/90-archive/` |

## Phase 1 / 1.5 Demo Freeze Quick Path

After the 2026-05-04 demo-freeze pass, a new agent who needs to operate or
extend the demo surfaces should read this exact sequence:

1. `docs/INDEX.md`
2. `docs/00-start-here/PHASE_STATUS.md`
3. `docs/10-coordination/HUDDLE.md`
4. `docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md`
5. `docs/40-phase1/DEMO_CONTROL_ROOM.md`
6. `docs/40-phase1/YC_DEMO_RUNBOOK.md`
7. `docs/40-phase1/PHASE_1_FOUNDER_E2E.md`

Then verify the live integrated-preview state by opening these read-only
dev surfaces (no run / retry / live buttons exist):

- `/dev/demo-readiness` - compact go/no-go.
- `/dev/demo-control-room` - full evidence cockpit + safe demo script.
- `/dev/phase1-quality-gates` - latest quality gate verdict.
- `/dev/founder-e2e` - latest founder E2E verdict.
- `/dev/runtime-forensics` - failure classification when artifacts exist.

## Expedia Debug Quick Path

For the current Expedia / flight-card DOM scan work, read this exact sequence:

1. `docs/INDEX.md`
2. `docs/00-start-here/PROJECT_SUMMARY.md`
3. `docs/00-start-here/PHASE_STATUS.md`
4. `docs/10-coordination/codex.md`
5. `docs/10-coordination/phase2.md`
6. `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
7. `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`

Then inspect runtime evidence:

- DB fields: `booking_jobs.steps[0].error`, `decisionLog`, `params`.
- Worker log: `codex-worker.log` in the active e2e worktree.
- Debug screenshots: `worker/.debug-screenshots/`.

## Phase 2 Revival Quick Path

For hotel/flight revival work, read:

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
7. `docs/10-coordination/phase2.md`
8. `docs/10-coordination/HUDDLE.md`

Do not run broad live suites. Start with Expedia flight, then Booking.com
hotel, then Hotels.com only after fresh artifacts exist.

## Maintenance Rules

When a task finishes, update only the relevant layer:

- Phase or blocker changed: update `docs/00-start-here/PHASE_STATUS.md`.
- Agent handoff changed: update `docs/10-coordination/codex.md`,
  `docs/10-coordination/claude.md`, or `docs/10-coordination/track-c.md`.
- Long-term decision changed: update `docs/10-coordination/STRATEGIC_LEDGER.md`.
- Provider debugging lesson learned: update `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`.
- Restaurant benchmark/runbook changed: update `docs/20-phase0-restaurant/`.
- Founder E2E or Phase 1 UX changed: update `docs/40-phase1/PHASE_1_FOUNDER_E2E.md`
  (and `docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md` if the autonomous runner
  surface changed).
- Demo readiness, control room, or freeze acceptance changed: update the
  matching runbook under `docs/40-phase1/` and `docs/10-coordination/track-c.md`.
- Phase 2 vertical posture changed: update
  `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md`,
  `docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md`,
  `docs/10-coordination/phase2.md`, and the `phase2-status.ts` mirror used
  by `/dev/demo-control-room` if applicable.
- A plan is completed and no longer active: move it to `docs/90-archive/completed-plans/`.

Do not add new root-level markdown files unless they are repo-level agent or
release entrypoints (`AGENTS.md`, `CLAUDE.md`, `README.md`, `CHANGELOG.md`).

## Current Canonical Files

| Purpose | Canonical file |
|---|---|
| Project summary | `docs/00-start-here/PROJECT_SUMMARY.md` |
| Phase status | `docs/00-start-here/PHASE_STATUS.md` |
| Full historical project summary | `docs/90-archive/history/PROJECT_SUMMARY_FULL_2026-05-03.md` |
| Coordination root | `docs/10-coordination/README.md` |
| New agent startup contract | `docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md` |
| Multi-agent conflict protocol | `docs/10-coordination/MULTI_AGENT_PROTOCOL.md` |
| Coordination shared memory | `docs/10-coordination/HUDDLE.md` |
| Coordination strategic ledger | `docs/10-coordination/STRATEGIC_LEDGER.md` |
| Codex state | `docs/10-coordination/codex.md` |
| Claude state | `docs/10-coordination/claude.md` |
| Track C state | `docs/10-coordination/track-c.md` |
| Phase 2 sidecar state | `docs/10-coordination/phase2.md` |
| Restaurant handoff | `docs/20-phase0-restaurant/RESTAURANT_PHASE0_HANDOFF.md` |
| R-003 live runbook | `docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md` |
| Provider runtime debug | `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` |
| Live closure evidence protocol | `docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md` |
| Phase 1 founder E2E | `docs/40-phase1/PHASE_1_FOUNDER_E2E.md` |
| Phase 1 autonomous E2E runner | `docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md` |
| Phase 1.5 quality gate | `docs/40-phase1/PHASE_1_QUALITY_GATE.md` |
| Demo control room runbook | `docs/40-phase1/DEMO_CONTROL_ROOM.md` |
| YC demo runbook | `docs/40-phase1/YC_DEMO_RUNBOOK.md` |
| Demo freeze acceptance | `docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md` |
| Phase 2 revival audit | `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md` |
| Hotel vertical revival audit | `docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md` |
| Expedia controlled retry runbook | `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md` |
| Hotel controlled retry runbook | `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md` |
