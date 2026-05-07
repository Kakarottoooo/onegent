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

## Throughput Rule

The reason to use multiple agents is throughput, not code volume. A side agent
should not sit idle while Codex is validating a finished branch if there is an
independent next task that can start from the last accepted base.

Default operating model:

1. Codex keeps the merge train and final product architecture coherent.
2. Side agents work in isolated branches with narrow ownership.
3. When a side agent finishes, Codex does a quick intake classification:
   `ready_to_merge`, `needs_followup`, or `reject`.
4. If the next task is independent of unmerged code, issue it immediately from
   the current accepted base.
5. If the next task depends on unmerged code, either wait for that merge or
   explicitly tell the agent to branch from the producing branch.
6. Do not ask agents to add broad framework code just to stay busy. Every task
   must close a named product gap, benchmark gap, evidence gap, or performance
   gap.

This means "merge before next task" is not the default. The default is:

```text
agent finishes branch A
-> Codex records branch A in intake queue
-> Codex immediately gives that agent branch B if B is independent
-> Codex merges A in the background merge train
```

## Code Volume Guardrail

Every side-agent task should specify one of these contribution types:

- `runtime_fix`: fixes a real execution blocker with evidence and tests.
- `benchmark_fixture`: expands measured coverage without changing runtime.
- `read_model_perf`: reduces payload, waterfall, bundle, or polling cost.
- `task_workspace_ux`: improves task ownership, status, evidence, or replay.
- `docs_contract`: records a contract needed by other agents.

Avoid tasks whose output is only more abstraction, duplicate wrappers, or
vertical-specific schema that cannot be reused. A branch should be easy to
revert and should make the app faster, more reliable, easier to debug, or more
consistent for users.

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

## Fast Intake Triage

Use this quick triage before full merge validation:

| Verdict | Meaning | Action |
| --- | --- | --- |
| `ready_to_merge` | Scope matches, tests reported, no forbidden files, no obvious conflict | Add to merge train and optionally issue the agent's next independent task |
| `needs_followup` | Useful work, but missing tests/docs/evidence or based on stale contract | Send one focused follow-up prompt; do not let the agent start unrelated work |
| `reject` | Wrong base, wrong scope, unsafe artifact, unrelated churn, or architecture drift | Do not merge; ask for clean rebuild from accepted base |

The fast triage should take minutes. Full validation still happens before
integration, but it should not block independent agents from starting their next
bounded task.

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
