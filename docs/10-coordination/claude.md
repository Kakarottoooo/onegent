# Claude Coordination Pointer

Last updated: 2026-05-10

This file is now a short pointer for Claude-related coordination. It is not the
canonical rule source. Durable behavior rules live in `AGENTS.md`.

The previous long Claude coordination log was archived at:

```text
docs/90-archive/coordination/claude-legacy-2026-05-10.md
```

## Current Use

Use this file only when a current Claude branch needs a compact handoff pointer.
Do not append long logs, project history, validation dumps, or docs-only status
reports here.

Claude tasks should normally be bounded, no-live, and product-relevant:

- adversarial review;
- capture/NLU/activity hardening;
- precise no-live bug discovery;
- activity provider skill/runtime critique;
- focused tests or fixtures that close a named Stage 0 gap.

Every Claude prompt should name the latest verified base branch and commit,
allowed paths, forbidden paths, validation commands, and the standard returned
report shape from `AGENTS.md`.

## Where To Look Instead

- Agent behavior rules: `AGENTS.md`
- Current product state: `docs/00-start-here/PROJECT_SUMMARY.md`
- Current phase gates: `docs/00-start-here/PHASE_STATUS.md`
- Stage 0 north star: `docs/00-start-here/STAGE_0.md`
- Multi-agent protocol: `docs/10-coordination/MULTI_AGENT_PROTOCOL.md`
