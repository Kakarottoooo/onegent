# Agent Intake Queue

Last updated: 2026-05-07

The agent intake queue is a no-live coordination report for returned side-agent
branches. It reduces Codex merge bottlenecks by separating metadata triage from
full merge validation.

It does not fetch branch diffs, merge code, run providers, start Browser
Harness, call OpenAI, inspect secrets, or touch checkout flows. It reads a
static JSON or Markdown list of returned branch reports and classifies each
branch as:

- `ready_to_merge`: metadata is clean enough for normal Codex merge validation.
- `needs_followup`: the returning agent should add evidence, rebase, or
  validation.
- `reject`: the branch violates base, artifact, supersession, task-kind, or
  claim rules and should not enter the merge train.

## Task Kinds

Every returned task must declare exactly one task kind:

- `runtime_fix`
- `benchmark_fixture`
- `read_model_perf`
- `task_workspace_ux`
- `docs_contract`

These categories keep side-agent work reviewable. If a branch cannot fit one
of them, split it before returning it.

## Dependency Edges

The intake schema supports four dependency edges:

- `independent`: branch can be reviewed from the accepted base without waiting
  for another unmerged branch.
- `depends_on_shared_schema`: branch needs a shared contract branch before
  merge, such as the Layered Benchmark V2 schema.
- `supersedes`: branch replaces an older returned branch that should leave the
  merge train.
- `requires_rebase_before_merge`: branch is otherwise useful but must be
  rebased before Codex validates it.

Example JSON:

```json
{
  "branch": "codex/example",
  "commit": "abc1234",
  "base": {
    "branch": "origin/codex/goal-core-reliability-long-run",
    "commit": "232fabd",
    "containsRequiredCommit": true
  },
  "taskKind": "benchmark_fixture",
  "mergeState": "unmerged",
  "changedFiles": ["lib/internal-benchmark/example.ts"],
  "artifacts": [],
  "validations": [
    { "name": "targeted_vitest", "status": "pass" },
    { "name": "tsc", "status": "pass" },
    { "name": "check_drift", "status": "pass" },
    { "name": "gate_phase1", "status": "pass" },
    { "name": "git_diff_check", "status": "pass" }
  ],
  "dependencyEdges": [
    {
      "type": "depends_on_shared_schema",
      "targetBranch": "codex/layered-benchmark-v2",
      "requiredState": "merged",
      "reason": "Fixture adapter should wait for the shared schema."
    }
  ],
  "claims": {
    "runtimeClosure": false,
    "liveVerified": false,
    "docsOnly": false
  }
}
```

The sample four-agent queue lives at:

```text
lib/internal-benchmark/__fixtures__/agent-intake/four-agent-queue.json
```

It models:

- Goal shared benchmark branch.
- Claude activity branch.
- Agent2 flight branch.
- Agent3 hotel branch.

## Command

JSON output:

```bash
npx tsx scripts/layered-agent-intake.ts --input lib/internal-benchmark/__fixtures__/agent-intake/four-agent-queue.json --required-base-commit 232fabd --json
```

Markdown output:

```bash
npx tsx scripts/layered-agent-intake.ts --input lib/internal-benchmark/__fixtures__/agent-intake/four-agent-queue.json --required-base-commit 232fabd
```

Useful flags:

- `--required-base-branch <branch>`
- `--required-base-commit <sha>`
- `--recommended-base <branch-or-sha>`
- `--merged-branches branch-a,branch-b`
- `--fail-on-reject`
- `--fail-on-followup`

## Next Task Recommendation

Every report includes:

```text
can_start_next_task: true|false
reason: ...
recommended_base: ...
conflict_risk: low|medium|high
```

Use it this way:

- If `can_start_next_task` is `true`, Codex can start independent work from
  `recommended_base` while merge validation runs.
- If `conflict_risk` is `medium`, restrict the next task to independent work
  and do not base it on follow-up branches.
- If `can_start_next_task` is `false`, the waiting task depends on an unmerged
  shared contract. Merge or explicitly mark that dependency ready before
  launching dependent agents.

## Rolling Merge Train

The rolling merge train is:

```text
accepted base
-> side agents branch into isolated worktrees
-> each agent returns branch + commit + metadata + validation
-> intake queue classifies returned branches
-> Codex starts independent next tasks while merge validation runs
-> Codex pauses only tasks that depend on unmerged shared contracts
-> Codex integrates in dependency order
```

Agents can start independent work before previous branches are merged. Agents
must wait only when they depend on an unmerged shared schema, runtime contract,
or read model.

The intake queue is not merge automation. It is a cheap filter that tells Codex
which branches should enter full validation, which should go back for follow-up,
and which should be kept out of the merge train.
