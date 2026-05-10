# Codex Coordination State

Last updated: 2026-05-10

This file is now a short coordination pointer, not the canonical Codex rule
source. Durable agent behavior rules live in `AGENTS.md`.

The previous long Codex coordination log was archived at:

```text
docs/90-archive/coordination/codex-legacy-2026-05-10.md
```

## Current Role

Codex owns integration, merge review, shared architecture, task workspace,
critical-path product patches, validation, and next-task dispatch.

For non-trivial work:

1. Read `AGENTS.md`.
2. Read `docs/INDEX.md`.
3. Read only the task-specific source files or runbooks.
4. Verify the current branch/base from git, not from old coordination logs.

## Active Operating Plan

Stage 0 remains the active product plan:

```text
Capture -> Travel Object -> Task -> Decision -> Execution -> Evidence -> Modify
```

Use these current entrypoints instead of this file for project state:

- `docs/00-start-here/STAGE_0.md`
- `docs/00-start-here/PROJECT_SUMMARY.md`
- `docs/00-start-here/PHASE_STATUS.md`
- `docs/40-dogfood/STAGE0_DAILY_REPORT.md`

## Multi-Agent Intake

External agents return reports to the founder, then the founder pastes them
back to Codex. Codex fast-triages returned branches as:

- `ready_to_merge`
- `needs_followup`
- `reject`

Reports should include branch, commit, base, worktree, changed files,
validation, evidence, deferred work, and safety notes. See `AGENTS.md` for the
full prompt and report contract.

## Write Policy

Do not append long work logs here. If a coordination detail is durable and
behavioral, move it to `AGENTS.md`. If it is project status, update
`PROJECT_SUMMARY.md`, `PHASE_STATUS.md`, or the generated Stage 0 daily report.
If it is historical, archive it under `docs/90-archive/`.
