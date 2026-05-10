# Onegent Docs Index

Last updated: 2026-05-10

This is the repo documentation entrypoint. Read `AGENTS.md` first for behavior
rules. Do not start by reading every markdown file. Most historical plans now
live under `docs/90-archive/`.

## New Agent Read Order

For current project state, read only:

1. `AGENTS.md`
2. `docs/00-start-here/PHASE_STATUS.md`
3. `docs/00-start-here/PROJECT_SUMMARY.md`
4. `docs/40-dogfood/STAGE0_DAILY_REPORT.md`

For implementation work, add only the task-specific source files or runbook
below.

## Current Active Docs

| Need | Read |
|---|---|
| Current phase, blockers, nearest goal | `docs/00-start-here/PHASE_STATUS.md` |
| Compact product/project overview | `docs/00-start-here/PROJECT_SUMMARY.md` |
| Stage 0 operating plan | `docs/00-start-here/STAGE_0.md` |
| System map | `docs/00-start-here/SYSTEM_DESIGN.md` |
| Capture MVP / homepage intake | `docs/40-dogfood/CAPTURE_MVP_SEAMS.md` |
| Private alpha intake | `docs/40-dogfood/PRIVATE_ALPHA_INTAKE_PROTOCOL.md` |
| Stage 0 operator report | `docs/40-dogfood/STAGE0_DAILY_REPORT.md` |
| Founder dogfood bug inbox | `docs/40-dogfood/BUG_INBOX.md` |
| Activity provider skill runtime | `docs/30-provider-debug/ACTIVITY_PROVIDER_SKILL_RUNTIME.md` |
| Activity skill lab and patch proposals | `docs/30-provider-debug/ACTIVITY_SKILL_LAB_RUNBOOK.md` |
| Provider runtime debugging | `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` |
| Provider evidence, taxonomy, closure, and cockpit rules | `docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md` |
| Layered no-live benchmark | `docs/30-provider-debug/LAYERED_BENCHMARK_V2.md` |
| Runtime mirror / drift | `docs/30-provider-debug/RUNTIME_MIRROR_GUIDE.md` |
| Ticketmaster recovery notes | `docs/30-provider-debug/TICKETMASTER_LAYERED_RECOVERY.md` |
| Expedia analyzer notes | `docs/30-provider-debug/EXPEDIA_LAYERED_RECOVERY.md` |
| Hotel analyzer notes | `docs/30-provider-debug/HOTEL_LAYERED_RECOVERY.md` |
| API v1 docs | `docs/60-api-integrations/api-v1.md` |
| OAuth docs | `docs/60-api-integrations/oauth.md` |
| ChatGPT app integration | `docs/60-api-integrations/chatgpt-apps.md` |
| Claude MCP integration | `docs/60-api-integrations/claude-mcp.md` |
| Gmail OTP assist | `docs/60-api-integrations/GMAIL_OTP_ASSIST.md` |

## Coordination Docs

Coordination docs are not default reading. Use them only for multi-agent branch
intake, merge queues, or stale handoff recovery.

| Need | Read |
|---|---|
| Coordination root | `docs/10-coordination/README.md` |
| New agent startup checklist | `docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md` |
| Multi-agent protocol | `docs/10-coordination/MULTI_AGENT_PROTOCOL.md` |
| Agent intake checklist | `docs/10-coordination/LAYERED_AGENT_INTAKE_CHECKLIST.md` |
| Durable decisions | `docs/10-coordination/STRATEGIC_LEDGER.md` |
| Shared working memory pointer | `docs/10-coordination/HUDDLE.md` |
| Short handoff pointers | `docs/10-coordination/codex.md`, `docs/10-coordination/claude.md`, `docs/10-coordination/goal.md`, `docs/10-coordination/phase2.md`, `docs/10-coordination/track-c.md` |

## Archived History

Historical docs are kept for audit and recovery, not default reading.

| Archive | Contains |
|---|---|
| `docs/90-archive/phase0-restaurant/` | old restaurant Phase 0 benchmark and Resy/OpenTable runbooks |
| `docs/90-archive/phase1-demo/` | old Phase 1 / demo / YC runbooks |
| `docs/90-archive/phase2-product-areas/` | old Phase 2, hotel/flight retry, NLU, trip/social plans |
| `docs/90-archive/start-here-history/` | old feature map and phase closure evidence pack |
| `docs/90-archive/old-provider-plans/` | old Browser Farm and Executor V2 planning docs |
| `docs/90-archive/coordination/` | old long coordination logs |
| `docs/90-archive/history/` | long historical project summaries |

## Maintenance Rules

- Keep the default read path at four files or fewer.
- Do not add legacy quick paths back to this file.
- When a plan is completed or no longer part of the current Stage 0/Stage 0B
  loop, move it to `docs/90-archive/`.
- Add new docs only when they are durable context, a real runbook, or a
  generated report that materially helps execution.
- Prefer code, tests, runtime evidence, benchmark output, and product behavior
  over more documentation.
