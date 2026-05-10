# Coordination README

Last updated: 2026-05-10

This folder is the shared state layer for Codex, Claude, Goal, Agent2, Agent3,
and future external agents. It is not the canonical behavior rule source.
Durable agent behavior rules live in `AGENTS.md`.

## Multi-Agent Protocol

Before opening any branch that touches shared docs, tests, or coordination
state, read `AGENTS.md` first, then read
`docs/10-coordination/MULTI_AGENT_PROTOCOL.md` only if the task needs the
long-form merge-conflict protocol. That protocol controls:

- branch freshness (always base on the latest pushed integrated preview);
- ownership map across Track A (Codex), Track B (Claude), Track C (demo
  readiness sidecar), and Phase 2 sidecar (Agent2);
- HUDDLE edit discipline (side agents do not edit HUDDLE directly);
- goal-branch behavior (one topic, short lifetime, branch + commit hash
  reporting);
- the cherry-pick / merge train policy used by Codex during integration;
- forbidden paths and forbidden capabilities (no live providers, no
  payment automation, no OTP / CAPTCHA / login bypass).

The old `codex/integrated-preview-*` examples in historical docs may be stale.
Always verify the current integration branch and base commit from git before
dispatching or starting work.

## Read Order

Use the shortest useful read path:

1. `AGENTS.md` for durable behavior rules.
2. `docs/INDEX.md` for task-specific docs.
3. `docs/10-coordination/MULTI_AGENT_PROTOCOL.md` only when opening or
   integrating parallel-agent work.
4. `docs/10-coordination/HUDDLE.md` only when recent coordination state is
   needed.
5. `docs/10-coordination/STRATEGIC_LEDGER.md` only before reopening a durable
   product or architecture decision.

If `.coordination/*.md` exists, treat it as a compatibility pointer only. The
canonical files are in this folder.

## Write Rules

- Put durable behavior rules in `AGENTS.md`, not in per-agent logs.
- Put durable project state in `docs/00-start-here/PROJECT_SUMMARY.md`,
  `docs/00-start-here/PHASE_STATUS.md`, or `docs/00-start-here/STAGE_0.md`.
- Put generated Stage 0 status in `docs/40-dogfood/STAGE0_DAILY_REPORT.md`
  and regenerate it from the operator CLI.
- Put cross-agent long-term decisions in
  `docs/10-coordination/STRATEGIC_LEDGER.md`.
- Keep per-agent coordination files short. Use them as pointers, not work logs.
- Side agents do not edit `HUDDLE.md` directly unless a current prompt
  explicitly delegates that action.
- Archive long historical coordination logs under `docs/90-archive/`.

## What Belongs Here

Belongs here:

- What each agent is doing now.
- What each agent is blocking on.
- Which branch/commit contains a handoff.
- What another agent should read next.
- Current multi-agent intake checklist and merge gates for active shared
  provider/runtime pushes.
- Persistent strategic decisions that should not be relitigated.

Does not belong here:

- Full project history.
- Long provider logs.
- Detailed implementation plans after they are completed.
- Screenshots or generated benchmark output.
- Broad docs-only output that does not close a product, runtime, benchmark,
  evidence, or performance gap.
