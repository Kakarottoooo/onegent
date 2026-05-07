# Agent Intake Queue

Last updated: 2026-05-07

The agent intake queue is a no-live metadata triage tool for returned side-agent
branches. It helps Codex keep new agents moving while merge validation happens
in the background.

It does not fetch branch diffs, merge code, run providers, start Browser
Harness, call OpenAI, or inspect secrets. It reads a static JSON or Markdown
list of returned branch reports and classifies each branch as:

- `ready_to_merge`: metadata is clean enough for normal Codex merge validation.
- `needs_followup`: the returning agent should add validation or evidence.
- `reject`: the branch violates base, artifact, or claim rules and should not
  enter the merge train.

## Returned Branch Report

Each report should include:

```json
{
  "branch": "codex/example",
  "commit": "abc1234",
  "base": {
    "branch": "origin/codex/goal-core-reliability-long-run",
    "commit": "0e85721",
    "containsRequiredCommit": true
  },
  "changedFiles": ["docs/40-dogfood/EXAMPLE.md", "scripts/example.ts"],
  "artifacts": [],
  "validations": [
    { "name": "targeted_vitest", "status": "pass" },
    { "name": "tsc", "status": "pass" },
    { "name": "check_drift", "status": "pass" },
    { "name": "gate_phase1", "status": "pass" },
    { "name": "git_diff_check", "status": "pass" }
  ],
  "claims": {
    "runtimeClosure": false,
    "liveVerified": false,
    "docsOnly": false
  }
}
```

Markdown queues are also accepted:

```markdown
## codex/example
- branch: codex/example
- commit: abc1234
- baseBranch: origin/codex/goal-core-reliability-long-run
- baseCommit: 0e85721
- baseContainsRequiredCommit: true
- changedFiles: docs/40-dogfood/EXAMPLE.md, scripts/example.ts
- artifacts: none
- validations: targeted_vitest=pass, tsc=pass, check_drift=pass, gate_phase1=pass, git_diff_check=pass
- docsOnly: false
- runtimeClosure: false
```

## Command

```bash
npx tsx scripts/layered-agent-intake.ts --input agent-returns.json --required-base-commit 0e85721 --json
```

Markdown output is the default:

```bash
npx tsx scripts/layered-agent-intake.ts --input agent-returns.md --required-base-commit 0e85721
```

Use `--fail-on-reject` when the command should fail only on hard rejects. Use
`--fail-on-followup` when CI or a local gate should fail on either rejects or
follow-up items.

## Classification Rules

Reject:

- wrong base branch or reported base that does not contain the required commit;
- `.env*`, `.tmp/`, logs, screenshots, `benchmark/runs/`, or other local
  artifacts in changed files or artifact metadata;
- docs-only branch claiming runtime closure or live verification.

Needs follow-up:

- missing required validation;
- runtime mirror paths under `lib/booking-autopilot/**` or
  `worker/src/booking-autopilot/**` without a passing `check_drift`.

Ready to merge:

- required base metadata is present;
- no forbidden artifacts are reported;
- required validation is reported as passing;
- no docs-only runtime closure claim is made.

## Parallel Agent Flow

Codex can start independent next tasks while merge validation runs when:

1. The new task does not depend on an unmerged shared schema, runtime contract,
   or read model.
2. The returning branch has a `ready_to_merge` or clearly isolated
   `needs_followup` intake result.
3. The merge train owner keeps integration order explicit.

Codex should pause new dependent agents when a returned branch introduces a
schema or runtime contract that later agents must build against. This keeps
throughput high without making each side branch guess about unmerged contracts.
