# Coordination Huddle Pointer

Last updated: 2026-05-10

This file used to hold live rolling coordination state. It is now intentionally
short so new agents do not confuse old huddle entries for current instructions.

The previous HUDDLE log was archived at:

```text
docs/90-archive/coordination/HUDDLE-legacy-2026-05-10.md
```

## Current Rule

Do not use HUDDLE as the main rule source. Durable behavior rules live in
`AGENTS.md`. Current product state lives in:

- `docs/00-start-here/PROJECT_SUMMARY.md`
- `docs/00-start-here/PHASE_STATUS.md`
- `docs/00-start-here/STAGE_0.md`
- `docs/40-dogfood/STAGE0_DAILY_REPORT.md`

## When To Edit This File

Only edit this file if a current multi-agent task explicitly needs a tiny shared
coordination pointer that cannot live in the branch report, `AGENTS.md`, or the
current project summary.

Do not paste long logs, branch histories, provider evidence, screenshots,
benchmark output, or completed plans here. Archive those under
`docs/90-archive/` or keep them as generated local artifacts when they should
not enter git.
