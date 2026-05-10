# Agent Intake Checklist

Last updated: 2026-05-10

Use this checklist when Goal, Claude, Agent2, or Agent3 returns a branch. It is
a merge-control document, not a run authorization. Do not start provider
workflows from this checklist.

## Current Base Rule

The current base is not hardcoded here. Codex must verify the latest pushed
integration branch before dispatch and before intake:

```powershell
git fetch origin
git --no-pager log --oneline -5 origin/codex/stage0-capture-mvp
```

If the returned branch started from an older base than the prompt requested,
classify it as `needs_followup` or `reject` unless the diff is trivially safe to
cherry-pick.

## Why Use Side Agents

Use side agents for throughput, not code volume. A side-agent task must close a
named product, runtime, benchmark, evidence, task-workspace, or performance gap.
Docs-only closure claims are low value unless the founder explicitly asked for
that document.

Contribution types:

- `runtime_fix`
- `benchmark_fixture`
- `read_model_perf`
- `task_workspace_ux`
- `evidence_contract`
- `lab_fixture`

Avoid broad abstraction, duplicate wrappers, vertical-specific schema forks,
app-shell bloat, or provider hacks without evidence.

## Fast Intake Triage

| Verdict | Meaning | Action |
| --- | --- | --- |
| `ready_to_merge` | Scope matches, tests reported, no forbidden files, no obvious conflict | Add to merge train and issue the next independent task if available |
| `needs_followup` | Useful work, but stale base, missing tests, missing evidence, or small scope issue | Send one focused follow-up prompt |
| `reject` | Wrong scope, unsafe artifact, unrelated churn, architecture drift, or forbidden path | Do not merge; request clean rebuild |

## Required Report Fields

```text
Branch:
Commit:
Base:
Worktree:
Changed files:
What changed:
Validation:
Evidence:
Deferred:
Safety:
```

## Intake Checks

1. Base commit matches the dispatched prompt or is safely cherry-pickable.
2. Changed files match the assigned surface.
3. No `.env*`, `.tmp/`, logs, screenshots, browser profiles, cookies, secrets,
   or local evidence artifacts are committed.
4. No live provider, OpenAI, worker, payment, login, OTP, CAPTCHA, or final
   confirmation flow was run unless the founder approved that exact run.
5. Runtime mirror changes are byte-aligned and verified with `npm run
   check-drift`.
6. App or route changes include `npm run build`.
7. The branch improves a named product or reliability metric.
8. The branch is small enough to revert without losing unrelated work.

## Validation Baseline

```powershell
npx tsc --noEmit --pretty false
npm run check-drift
npm run gate:phase1 -- --allow-known-drift
git diff --check
```

Add targeted tests and any task-specific CLI gates from the prompt.
