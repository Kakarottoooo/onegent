# New Agent Startup Contract

> Last updated: 2026-05-04
> Read this BEFORE you read anything else.
> Read time: 3 minutes. Re-reading: free.

This is the one-page contract every new coding agent (Codex, Claude,
Agent2 Phase 2 sidecar, Agent3 Track C demo readiness sidecar, Goal
branches, plus any future agent) signs implicitly the moment they
open a branch on Onegent. Violating any rule here forces a Codex-side
rewrite at integration time, delays the merge train, and risks a
silent regression that nobody catches until the next demo.

For the long-form contract, read
`docs/10-coordination/MULTI_AGENT_PROTOCOL.md` after this file. This
contract is the boiled-down checklist; the protocol is the legal text.

## 1. Canonical Branch and Worktree

There is exactly one canonical integrated trunk:

- **Branch**: `codex/integrated-preview-20260504`.
- **Worktree (founder + Codex integrator)**:
  `C:\Users\Gzw19\onegent-integrated-20260504`.
- **Older worktrees** (`C:\Users\Gzw19\onegent`,
  `C:\Users\Gzw19\onegent-e2e-20260503`, ad-hoc branch worktrees) are
  treated as stale unless the founder explicitly says otherwise.

Always start a new branch from the latest pushed tip of the canonical
trunk. Never base on a peer agent's branch head. Never base on a
"what I had locally yesterday" commit.

```bash
git fetch origin
git --no-pager log --oneline -5 origin/codex/integrated-preview-20260504
git checkout -b <agent>/<topic> origin/codex/integrated-preview-20260504
```

Record the base SHA you started from in your first commit message or
in your own coordination file. Codex uses that SHA when deciding
between cherry-pick and merge.

## 2. Who Edits HUDDLE vs Track Files

The fastest way to create avoidable merge conflicts is to have every
agent edit `docs/10-coordination/HUDDLE.md` from a parallel branch.
The discipline is:

- **Side agents do NOT edit `HUDDLE.md` directly.** "Side agents" means
  Agent2 (Phase 2 sidecar), Agent3 (Track C demo readiness sidecar),
  Goal branches, and any ad-hoc Claude topic branch that is not
  itself the active integrator. They write to their own track file:
  - Codex -> `docs/10-coordination/codex.md`.
  - Claude -> `docs/10-coordination/claude.md`.
  - Phase 2 sidecar -> `docs/10-coordination/phase2.md`.
  - Track C demo readiness -> `docs/10-coordination/track-c.md`.
  - Goal branches -> `docs/10-coordination/goal.md` (or extend their
    own scoped goal file).
- **Track A and Track B may edit HUDDLE** but only when they are the
  agent currently driving the integration step or completing a major
  task on the canonical trunk. One prepend per push. Trim oldest first
  if over the 2000-word cap. Never delete the `Inbox` or `Active Locks`
  sections.
- **If you have a critical update that must appear in HUDDLE before
  integration**, write a `### Proposed HUDDLE entry` block in your own
  track file. Codex (or the integrating agent) copies it during
  cherry-pick.

If a task spec says "do not edit HUDDLE", treat that as binding even
if your own coordination file's history shows past HUDDLE edits.

## 3. Stale Branch and Cherry-Pick Rules

Codex is the integrator for `codex/integrated-preview-*`. The default
landing strategy is **cherry-pick**, not merge:

- If your branch is fresh (based on the current preview tip and
  contains no `[coord]` noise), Codex may merge it directly.
- If your branch was based on an older preview head, contains stale
  `[coord]` commits, or includes tangential drift, Codex cherry-picks
  the feature/doc commits and drops the stale `[coord]` layer.
- `[coord]`-tagged commits are pre-integration metadata. Codex strips
  them during cherry-pick and writes a single fresh HUDDLE Live
  Activity entry summarizing what landed.
- Multiple sidecars may land in one batch ("second sidecar batch",
  "fourth sidecar batch", and so on). When this happens, the HUDDLE
  Live Activity entry mentions every branch and SHA that landed plus
  the unified verification numbers.
- If the founder says "the integrated preview head moved" or you see
  a new sidecar integration entry in HUDDLE, abandon any unpushed work
  on the old base. Restart from the new tip and re-apply your in-flight
  diff. Force-push your own `<agent>/<topic>` branch with
  `--force-with-lease` if needed; never force-push a trunk.

After you push your branch, do not modify it unless the founder or
Codex asks for a fix. If you must, force-push with `--force-with-lease`
and report the new SHA back.

## 4. Forbidden Paths

The following paths are forbidden to all non-Track-A agents,
regardless of branch goal:

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

Crossing a boundary without an explicit `[delegated by codex]` or
`[delegated by user]` tag in the commit message is a violation.

## 5. Safety Hard Stops

The following capabilities are forbidden from any branch except an
explicit founder-approved live run:

- Live OpenAI calls.
- Live Computer Use sessions.
- Provider navigation that touches a real account or a real booking.
- Payment automation (entering CVV, card numbers, billing details).
- OTP, CAPTCHA, login, or phone verification automation.
- Final booking, final purchase, final reservation, or any irreversible
  confirmation click.

If a task appears to require any of the above, stop. Explain the
boundary in your reply. Ask the founder for explicit, scoped approval.
Do not approximate the boundary with a synthetic mock that pretends to
be live; that is worse than not shipping the feature.

If a live flow approved for a controlled retry hits one of the hard
stops mid-flight, the agent stops there and the human completes the
account, verification, payment, or final action manually. The
classification then comes from DB rows, worker logs, and screenshots
via `/dev/runtime-forensics` and the analyzer scripts. No patches go
in based on the task UI alone.

## 6. Required Validation Levels

Every push from a coding agent must pass at least the **Level 1**
baseline. Tasks that touch shared docs or shared tests must pass
**Level 2**. Tasks that touch a Track B dashboard, dev API, or
observability surface must pass **Level 3**.

### Level 1 - Baseline (every branch)

```bash
npx tsc --noEmit --pretty false
git diff --check
```

Plus any narrow vitest file the change touches.

### Level 2 - Shared docs and tests

```bash
npx tsc --noEmit --pretty false
npx vitest run lib/__tests__/docs-static-*.test.ts
npm run gate:phase1 -- --allow-known-drift
git diff --check
```

`gate:phase1 -- --allow-known-drift` exits 0 with `8/0/0/1` (8 pass,
0 fail, 0 skipped, 1 known-existing drift) on the current trunk; that
is the canonical "needs polish" passing state. A new fail or a new
skipped check is a regression that blocks integration.

### Level 3 - Dashboards, dev API, observability

Add the surface-specific suite. Examples:

```bash
npx vitest run lib/__tests__/runtime-forensics-*.test.ts \
              lib/__tests__/demo-control-room-*.test.ts \
              lib/__tests__/demo-evidence.test.ts \
              lib/__tests__/founder-e2e*.test.ts \
              lib/__tests__/quality-gate-*.test.ts
```

If you change a server component or route, also run a local dev probe
of the affected page and confirm 200 on the canonical demo route list
in `docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md`.

### Forbidden during validation

- Do not start a live OpenAI call to "verify" a feature.
- Do not start a live provider/Computer Use/Browserbase session.
- Do not start a live worker that touches a real Neon row.
- Do not run `npm run gate:phase1 -- --include-smoke --include-e2e` on
  a side-agent branch unless the task explicitly calls for it. Codex
  runs the full gate during integration.

## 7. How to Report Results

When your branch is ready for integration, report **only** the branch
name, the commit hash, and a one-line validation summary. No prose
report. No diff dumps. No screenshots. The protocol assumes Codex
will read the pushed branch and decide cherry-pick vs merge.

The standard report:

```text
Branch: <agent>/<topic>
Commit: <full sha>
Validation: tsc clean, docs-static N/N pass, gate:phase1 8/0/0/1 exit 0,
            git diff --check clean.
```

When to send a longer report:

- The branch is not pushed (rare; only if the founder explicitly asks
  to review unpushed work).
- The branch needs a design decision before integration (e.g. ownership
  conflict, ambiguous scope, founder approval needed for a hard stop).
- A peer agent's last entry contradicts your plan and you stopped to
  confirm.

When to update which doc:

- Your own track file (`codex.md`, `claude.md`, `phase2.md`,
  `track-c.md`, or `goal.md`): every push.
- `docs/10-coordination/HUDDLE.md`: only if you are the integrator
  for this push (see section 2). One prepend per push.
- `docs/00-start-here/PHASE_STATUS.md`: only if a phase, blocker, or
  verified verdict number changed.
- `docs/00-start-here/PROJECT_SUMMARY.md`: only if the project's
  active worktree, branch, or phase snapshot moved.
- `docs/INDEX.md`: only if a canonical file moved or a new
  task-specific runbook was added.
- `docs/10-coordination/STRATEGIC_LEDGER.md`: only for cross-agent,
  long-term decisions that should not be relitigated.

If your branch added a new dashboard or a new QA runner, also update
the closest runbook under `docs/40-phase1/` or `docs/50-product-areas/`
and the matching cell in `docs/00-start-here/PHASE_STATUS.md`.

## 8. When in Doubt

Re-read these, in order:

1. `docs/10-coordination/HUDDLE.md` (latest peer state).
2. `docs/10-coordination/MULTI_AGENT_PROTOCOL.md` (long-form contract).
3. `docs/10-coordination/codex.md` and the relevant sidecar file
   (ownership detail).
4. `docs/10-coordination/STRATEGIC_LEDGER.md` (locked decisions).

If a peer agent's last entry contradicts your plan, stop and ask the
founder before pushing. The cost of asking is one round trip. The
cost of an avoidable merge conflict on `codex/integrated-preview-*`
is a Codex-side rewrite, a delayed integration, and a stale
coordination entry that no one trusts later.
