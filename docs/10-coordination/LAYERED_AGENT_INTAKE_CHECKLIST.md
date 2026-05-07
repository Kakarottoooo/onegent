# Layered Agent Intake Checklist

Last updated: 2026-05-07

Use this checklist when Goal, Claude, Agent2, or Agent3 returns a layered
benchmark / recovery branch. It is a merge-control document, not a run
authorization. Do not start provider workflows from this checklist.

## Current Integration Base

Canonical base for this round:

```text
origin/codex/goal-core-reliability-long-run @ 8e91f39
```

Main founder/Codex dogfood worktree:

```text
C:\Users\Gzw19\onegent-provider-closure-integration-20260505
```

Port `3000` stays reserved for founder/Codex dogfood. Side agents should use
their assigned isolated worktrees and ports only when a dev server is truly
needed.

## Expected Agent Branches

| Agent | Scope | Expected worktree | Expected branch |
| --- | --- | --- | --- |
| Goal | Shared Layered Benchmark V2 infrastructure | `C:\Users\Gzw19\onegent-layered-benchmark-v2` | `codex/layered-benchmark-v2` |
| Claude | Activity / Ticketmaster layered recovery | `C:\Users\Gzw19\onegent-activity-layered-recovery` | `claude/activity-layered-recovery` |
| Agent2 | Flight / Expedia layered recovery | `C:\Users\Gzw19\onegent-flight-layered-recovery` | `codex/flight-layered-recovery` |
| Agent3 | Hotel layered recovery | `C:\Users\Gzw19\onegent-hotel-layered-recovery` | `codex/hotel-layered-recovery` |

Restaurant/OpenTable baseline ownership remains with Codex for this round.

## Intake Gate

Before cherry-picking or merging a returned branch, verify:

1. The branch base is `8e91f39` or a descendant of the current accepted
   integration head.
2. The branch is in the expected isolated worktree.
3. The agent reports a pushed commit hash.
4. `git status --short` shows no staged local artifacts, `.env*`, `.tmp/`,
   logs, screenshots, browser profiles, or local debug files.
5. The changed file set matches the assigned scope.
6. The branch did not run external provider workflows unless a later founder
   message explicitly authorized that exact run.
7. The branch did not introduce direct hardcoded task links when a shared
   helper already exists.
8. Runtime mirror changes, if any, are byte-aligned or have a documented
   reason accepted by `npm run check-drift`.

## Preferred Merge Order

1. Goal: shared schema / runner / benchmark report contracts.
2. Claude: activity recovery rules and tests.
3. Agent2: flight recovery rules and tests.
4. Agent3: hotel recovery rules and tests.
5. Codex: restaurant/OpenTable baseline and cross-lane docs reconciliation.

Reason: vertical branches should adapt to the shared contract rather than each
inventing their own benchmark shape.

## Required Validation Per Branch

Minimum per-branch validation:

```powershell
npx tsc --noEmit --pretty false
npm run check-drift
npm run gate:phase1 -- --allow-known-drift
git diff --check
```

Also require the branch-specific targeted tests listed in the agent's final
report. If app or route surfaces changed, require `npm run build`.

## Review Questions

Ask these before merge:

- What exact failure class or workflow gap did this branch close?
- Does it improve L1 direct pass, L2 recovery, or evidence quality?
- Does it add deterministic no-live coverage, or only docs?
- Does it keep Browser Harness as L2 design/recovery input rather than
  silently replacing the v1 provider runtime?
- Does the output have a machine-readable artifact shape for future benchmark
  runs?
- Is the branch small enough to revert without losing unrelated work?

## Reject Or Send Back If

- The branch changes unrelated provider runtime.
- It commits `.tmp/`, logs, screenshots, `.env*`, cookies, browser profiles, or
  secret-bearing data.
- It repeats a vertical-specific benchmark schema instead of using or preparing
  for the shared Layered Benchmark V2 schema.
- It classifies weak provider evidence as true no availability.
- It marks a provider boundary as success without a task/status/evidence
  contract.
- It leaves task workspace links hardcoded outside shared helpers.
- It changes worker mirror paths without drift verification.

## Final Integration Report Shape

When Codex lands a branch, record:

```text
Agent:
Branch:
Commit:
Integration commit:
Changed files:
Validation:
What improved:
Deferred:
Safety:
```

Keep HUDDLE updates short. Put long details in the closest vertical or
benchmark runbook.
