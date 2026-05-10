# Multi-Agent Conflict Protocol

> Last updated: 2026-05-10
> Owner: Codex (Track A) reviews; Claude (Track B) and sidecar agents follow.
> Read order: read `AGENTS.md` first. This file is the long-form
> merge-conflict-avoidance contract for parallel external-agent work.

For a 3-minute boiled-down version that every new agent should read
before this one, see
`docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md`. The contract is
the cold-start checklist; this protocol is the long-form legal text
that the contract references.

This document exists because the project now has multiple coding agents
(Codex Track A, Claude Track B, Phase 2 sidecar Agent2, Track C demo
readiness sidecar Agent3, plus future agents) shipping work in parallel
into the same integration branch. Without this protocol,
agents repeatedly:

- base their branch on a stale integration commit, then collide with
  newly merged work;
- edit the same coordination file (`HUDDLE.md`) at the same time,
  producing avoidable merge conflicts;
- expand scope into other agents' ownership zones (provider/runtime
  vs. dashboards vs. demo runbooks);
- re-implement what a peer agent already shipped because they did not
  read coordination state.

Following this protocol is mandatory for any agent that wants its branch landed
without a Codex-side rewrite.

## 0. External-Agent Dispatch Model

The default Onegent multi-agent model is external and founder-mediated:

1. Codex writes the prompts for Goal, Claude, Agent2, Agent3, or another named
   side agent.
2. The founder pastes each prompt into that external agent.
3. The external agent reports back with branch, commit, base, worktree, changed
   files, validation, evidence, deferred work, and safety notes.
4. The founder pastes that report back into Codex.
5. Codex performs intake, validation, merge/cherry-pick, HUDDLE updates, and
   the next prompt issuance.

Codex should not spawn internal subagents for this process unless the founder
explicitly asks for internal Codex subagents in the current thread. Requests to
"give Agent2/Agent3/Claude/Goal a prompt" mean: write a copy-paste prompt for
the founder to distribute externally.

## 1. Branch Freshness Rule

**Always base a new branch on the latest pushed integration head named in the
current Codex prompt, not an older commit.**

Procedure when starting any new task:

1. `git fetch origin`.
2. `git --no-pager log --oneline -5 origin/codex/stage0-capture-mvp`
   (or the current integration branch named by Codex).
3. Create the new branch from that latest tip:
   `git checkout -b <agent>/<topic> origin/codex/stage0-capture-mvp`.
4. Record the base SHA you started from in your branch's first
   coordination entry (e.g. in `docs/10-coordination/<agent>.md` or in
   the first commit message). Codex uses that SHA when deciding between
   cherry-pick and merge.

Forbidden:

- Basing on a previous Claude/Agent2/Agent3 sidecar branch head.
- Basing on a "what I had locally yesterday" commit.
- Skipping `git fetch origin` before branching.

When the founder says "the integrated preview head moved" or Codex
posts a new sidecar integration entry to HUDDLE, abandon any unpushed
work on the old base, restart from the new tip, and cherry-pick or
re-apply your in-progress diff. Force-pushing your branch over a stale
base is acceptable on your own `<agent>/*` branch; never on an
integration trunk.

## 2. Ownership Map

Each path below has exactly one owning track. Other tracks may *read*
those paths but must not *write* without explicit handoff from the
owner. Crossing a boundary requires an explicit `[delegated by codex]`
or `[delegated by user]` tag in the commit message.

### Track A - Codex (provider/runtime/security)

- `lib/booking-autopilot/**`
- `lib/core/**`
- `lib/execution-v2/**`
- `worker/src/**`
- `app/api/v1/**`
- `app/api/booking-jobs/**`
- Provider modules for Resy, OpenTable, Expedia, Booking.com, Hotels.com,
  activities.
- Benchmark fixtures, live runners, provider safety policies.
- `lib/db.ts` and any schema changes.
- Auth, Clerk wiring, Stripe, security middleware.
- Final review and merge into the active Stage 0 integration branch.

### Track B - Claude (dashboards/observability/docs/tests)

- `app/dev/**`
- `app/api/dev/**`
- `components/**`
- `lib/agent/nlu-v2/**`
- `lib/profile-gap-*`
- `lib/founder-e2e/**`
- `lib/quality-gate/**`
- `lib/runtime-forensics/**`
- `lib/demo-control-room/**`
- `scripts/run-founder-e2e.ts`
- `scripts/run-phase1-quality-gate.ts`
- Phase 1/1.5 docs under `docs/90-archive/phase1-demo/` (except acceptance-pack docs
  owned by Track C).
- Coordination edits to `docs/10-coordination/claude.md`.
- Focused vitest tests under `lib/__tests__/` for Track B modules.

### Track C - Demo readiness sidecar

- `app/dev/demo-readiness/**`
- `lib/demo-evidence/**`
- `docs/90-archive/phase1-demo/DEMO_FREEZE_ACCEPTANCE.md`
- `docs/90-archive/phase1-demo/YC_DEMO_RUNBOOK.md`
- Coordination edits to `docs/10-coordination/track-c.md`.
- Light read-only polish on existing demo dev pages without adding
  run/retry/live controls.

### Phase 2 sidecar - Agent2 (no-live audits + analyzers)

- `docs/90-archive/phase2-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md`
- `docs/90-archive/phase2-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md`
- `docs/90-archive/phase2-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`
- `docs/90-archive/phase2-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`
- `docs/90-archive/phase2-product-areas/EXPEDIA_RETRY_ARTIFACT_TEMPLATE.json`
- `lib/runtime-forensics/expedia-retry-analysis.ts` and its fixtures.
- `scripts/analyze-expedia-retry-artifact.ts` and similar pure analyzers.
- `lib/__tests__/expedia-retry-analysis.test.ts` and similar.
- Coordination edits to `docs/10-coordination/phase2.md`.

### Shared (any agent may edit, but with extra care)

- `docs/INDEX.md`
- `docs/00-start-here/PROJECT_SUMMARY.md`
- `docs/00-start-here/PHASE_STATUS.md`
- `docs/10-coordination/README.md`
- `docs/10-coordination/MULTI_AGENT_PROTOCOL.md` (this file)
- `docs/10-coordination/STRATEGIC_LEDGER.md`
- `lib/__tests__/docs-static-*.test.ts` (the docs static guard suite).

Any agent editing a shared file must first check the current prompt and, when
needed, `docs/10-coordination/HUDDLE.md` for recent peer state. Avoid
re-asserting decisions another agent just landed.

## 3. HUDDLE Edit Discipline

`docs/10-coordination/HUDDLE.md` is intentionally lightweight, and is
the most conflict-prone file in the repo because every agent wants to
prepend an entry. The rule is:

- **Side agents do not edit HUDDLE directly** unless the current prompt
  explicitly delegates that action. They report through the founder or their
  own short coordination pointer and let Codex own integration notes.
- **Track A and Track B may edit HUDDLE** only when a current task explicitly
  needs fresh shared coordination state.
- **One HUDDLE prepend per push.** Do not chain multiple HUDDLE edits
  inside a single branch unless every entry corresponds to a separate
  shipped step. Do not reorder old entries.
- **Trim oldest first if over the 2000-word cap.** Never delete `Inbox`
  or `Active Locks` sections to make room.
- **Bump `Last writer` and `Last updated` exactly once per push.**
- **Do not edit HUDDLE on a branch that you do not intend to push to
  origin.** Local-only HUDDLE edits create later merge churn.

If a side agent has a critical update that must be visible in HUDDLE
before its branch is integrated, write the candidate HUDDLE diff into
your own coordination file under a clearly labelled
`### Proposed HUDDLE entry` block. Codex (or the integrating agent)
can copy that block onto HUDDLE during cherry-pick.

## 4. Goal Branch Behavior

A "goal branch" is any `<agent>/<topic>` branch that ships a single
narrow goal, then hands off. The expected shape:

- One topic per branch. Do not combine "fix Phase 1 footer" with
  "rewrite the runtime forensics filter".
- Branch name encodes both agent and topic: `claude/demo-control-room`,
  `codex/expedia-flight-card-fallback`, `codex/track-c-demo-readiness`.
- Branch starts from the latest integrated preview tip (see Rule 1).
- Branch lifetime is short: typically minutes to hours, not days. If
  the work cannot land in one push, split it.
- Last commit on the branch is either:
  - a feature/doc commit if the branch is ready for cherry-pick, or
  - a `[coord]`-tagged commit that updates only the agent's own
    coordination file. `[coord]` commits are stripped during cherry-pick
    and never carry production code.
- The push report to the founder includes only the branch name and the
  commit hash. Long pasted reports are reserved for branches that are
  unpushed or need a design decision.

Goal branches do not:

- Reach across ownership boundaries without an explicit handoff tag.
- Modify `lib/db.ts`, schema, or any provider runtime file from a
  Track B/C/Agent2 branch.
- Add live OpenAI / Computer Use / payment / OTP / CAPTCHA / final-
  confirm code paths.
- Add new top-level markdown files outside the existing `docs/<n>-...`
  buckets.

## 5. Merge Train and Cherry-Pick Policy

Codex is the integrator for the active Stage 0 integration branch. The default
landing strategy is cherry-pick when a branch is stale or noisy, and direct
merge only when it is freshly based and clean:

- **Cherry-pick** when the branch was based on an older preview head,
  contains stale `[coord]` commits, or includes tangential drift.
  Cherry-pick keeps the integration history linear and skips
  the stale coord layer.
- **Merge** is only used when the branch is freshly based on the
  current preview tip and contains no `[coord]` noise that needs to be
  dropped.
- **`[coord]` commits are stripped** during cherry-pick. Their content
  is intended to be pre-integration metadata. After integration, Codex
  writes a single fresh HUDDLE Live Activity entry summarizing what
  landed.
- **Multiple sidecars in one batch**: Codex may integrate several sidecar
  branches in a single push. When this happens, the summary mentions every
  branch and SHA that landed, plus unified verification numbers when relevant.

What an agent must do to make integration easy:

1. Push the branch to origin.
2. Report what shipped, the verification commands run, and any handoff notes.
3. Do not edit HUDDLE if you are a side agent (see Rule 3).
4. Report only branch + commit hash to the founder unless blocked.
5. Do not modify the branch after pushing unless the founder or Codex
   asks for a fix; if you must, force-push with `--force-with-lease`
   and re-report the new SHA.

What Codex does on integration:

1. `git fetch origin` and verify the branch base.
2. Decide between cherry-pick and merge.
3. Resolve any conflicts in shared files (INDEX, PROJECT_SUMMARY,
   PHASE_STATUS, HUDDLE) by keeping the most recent integrated state
   plus the new contribution.
4. Run the verification baseline:

   ```bash
   npx tsc --noEmit --pretty false
   npm run check-drift
   npm run gate:phase1 -- --allow-known-drift --include-smoke --include-e2e
   npm run build
   git diff --check
   ```

5. Update only the compact coordination/status files that actually changed.
6. Push the new integration head.
7. If a sidecar branch needs to be re-based, report back through the founder or
   a short coordination pointer rather than rewriting its branch directly.

## 6. Forbidden Paths

The following paths are forbidden to all non-Track-A agents, regardless
of branch goal:

- `lib/booking-autopilot/**`
- `lib/core/**`
- `lib/execution-v2/**`
- `worker/src/**`
- `app/api/v1/**`
- `app/api/booking-jobs/**`
- `lib/db.ts`
- Any `*.sql` migration or schema file.
- Any provider module under `lib/booking-autopilot/providers/**` or
  `worker/src/booking-autopilot/providers/**`.
- `scripts/run-phase0-resy-benchmark.ts`
- `scripts/probe-resy-availability.ts`
- Any script that initiates a live OpenAI, Computer Use, or provider
  navigation session.

The following capabilities are forbidden from any branch except an
explicit founder-approved live run:

- Live OpenAI calls.
- Live Computer Use sessions.
- Provider navigation that touches a real account or a real booking.
- Payment automation (entering CVV, card numbers, billing details).
- OTP, CAPTCHA, login, or phone verification automation.
- Final booking, final purchase, final reservation, or any irreversible
  confirmation click.

If an agent encounters a task that appears to require any of the above,
the correct response is to stop, explain the boundary, and ask the
founder for explicit, scoped approval. Do not approximate the boundary
with a synthetic mock that pretends to be live.

## 7. When in Doubt

- Re-read `AGENTS.md` for durable behavior rules.
- Re-read `docs/10-coordination/HUDDLE.md` only if latest peer state is needed.
- Re-read the relevant sidecar coordination pointer only if ownership detail is
  still unclear.
- Re-read `docs/10-coordination/STRATEGIC_LEDGER.md` before reopening
  any decision that has been locked there.
- If a peer agent's last entry contradicts your plan, stop and ask the
  founder before pushing.

The cost of asking is one round trip. The cost of an avoidable merge
conflict on the integration branch is a Codex-side rewrite plus
a delayed integration plus a stale coordination entry that no one
trusts later.
