# Coordination README

Last updated: 2026-05-04

This folder is the shared state layer for Codex, Claude, and future agents.

## Multi-Agent Conflict Protocol

Before opening any new branch that touches shared docs, tests, or
coordination state, read
`docs/10-coordination/MULTI_AGENT_PROTOCOL.md`. It is the canonical
contract that controls:

- branch freshness (always base on the latest pushed integrated preview);
- ownership map across Track A (Codex), Track B (Claude), Track C (demo
  readiness sidecar), and Phase 2 sidecar (Agent2);
- HUDDLE edit discipline (side agents do not edit HUDDLE directly);
- goal-branch behavior (one topic, short lifetime, branch + commit hash
  reporting);
- the cherry-pick / merge train policy used by Codex during integration;
- forbidden paths and forbidden capabilities (no live providers, no
  payment automation, no OTP / CAPTCHA / login bypass).

Following the protocol is mandatory for any branch that wants to land
in `codex/integrated-preview-*` without a Codex-side rewrite.

## Read Order

1. `docs/10-coordination/README.md`
2. `docs/10-coordination/MULTI_AGENT_PROTOCOL.md`
3. `docs/10-coordination/HUDDLE.md`
4. `docs/10-coordination/codex.md`
5. `docs/10-coordination/claude.md`
6. `docs/10-coordination/phase2.md`
7. `docs/10-coordination/track-c.md` when demo-readiness work is active
8. `docs/10-coordination/STRATEGIC_LEDGER.md`

If `.coordination/*.md` exists, treat it as a compatibility pointer only. The
canonical files are in this folder.

## Write Rules

- Codex updates `docs/10-coordination/codex.md`.
- Claude updates `docs/10-coordination/claude.md`.
- Phase 2 sidecar agents update `docs/10-coordination/phase2.md`.
- Demo readiness sidecar agents update `docs/10-coordination/track-c.md`.
- HUDDLE edits follow the discipline in
  `docs/10-coordination/MULTI_AGENT_PROTOCOL.md` (side agents do not edit
  HUDDLE directly; one prepend per push; keep it under 2000 words).
- Cross-agent long-term decisions go in
  `docs/10-coordination/STRATEGIC_LEDGER.md`.
- Keep coordination entries short. Link to the relevant runbook instead of
  duplicating it.
- Update coordination in the same commit as the task when possible.

## What Belongs Here

Belongs here:

- What each agent is doing now.
- What each agent is blocking on.
- Which branch/commit contains a handoff.
- What another agent should read next.
- Persistent strategic decisions that should not be relitigated.

Does not belong here:

- Full project history.
- Long provider logs.
- Detailed implementation plans after they are completed.
- Screenshots or generated benchmark output.
