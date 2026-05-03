# Codex - coordination state

> **Branch**: `master`
> **Last updated**: 2026-05-03 02:05 UTC
> **Last commit**: `620444a`
>
> Claude reads this at session start. I write to it before each push.
> See `CLAUDE.md` section "coordination protocol".
> Claude's parallel file lives at
> `origin/claude/festive-pare-f27273:.coordination/claude.md`.

## Currently doing

Idle on Phase 0 execution until `.env.local` is switched to a rotated
OpenAI project key with GA Computer Use (`gpt-5.5`) access, or until we
explicitly decide to run legacy baseline.

Phase 0 R-003 smoke is blocked on OpenAI project access to
`gpt-5.5`, not on Resy DOM or task orchestration. Master typecheck and
drift checks passed after migrating the Computer Use adapter to the GA
Responses API shape (`model: gpt-5.5`, `tools: [{ type: "computer" }]`).

Current local R-003 report:
`benchmark/runs/phase0-resy-2026-05-03T02-00-32-703Z.json`

Result summary:
- task: `e985e044-8a81-46e9-bbd4-505e929f0ace`
- job: `1093397b-87e9-46bf-ae8b-7efb2406428f`
- outcome: `failed_with_clear_reason`
- taxonomy: `F-INFRA-MODEL-ACCESS`
- terminal reason: current OpenAI project cannot access `gpt-5.5`
- model-list check: current `.env.local` key only sees `gpt-5.4*`, not
  `gpt-5.5`; user screenshots show a different project/key has the needed
  model allow-list

Next Track A step after this commit:
- User should revoke the API key pasted in chat, create a fresh key in the
  project that lists `gpt-5.5`, update `.env.local`, then rerun R-003.
- If that key still 403s, inspect project model allow-list/budget/service tier
  in the OpenAI dashboard before debugging Resy.

## Blocking on Claude

(none)

## Recently shipped (Track A, last 5-10 commits on master)

| Commit | Subject | Notes for Claude |
|---|---|---|
| `620444a` | `[handoff] fix(executor): migrate Computer Use adapter to GA gpt-5.5 tool` | Replaces deprecated `computer-use-preview` tool shape with GA `gpt-5.5` + `type: "computer"` in lib/worker mirrors. R-003 still reports `F-INFRA-MODEL-ACCESS` because current `.env.local` key is from a project without `gpt-5.5` access. |
| `38558db` | `[coord] update codex state after claude benchmark validator` | Records Claude's validator/taxonomy alignment and keeps Phase 0 blocked on OpenAI project model access. |
| `f2b7dae` | `[handoff] feat(benchmark): route phase0 resy through computer use` | Adds `clientMetadata.preferredExecutor`, makes R-003 auto-mint a local benchmark API key, aligns OpenAI Computer Use request shape with official Responses API docs, and fixes benchmark taxonomy for model/API access failures. R-003 now reports `F-INFRA-MODEL-ACCESS`. |
| `1bcb076` | `[coord] add codex state file; adopt coordination protocol` | Coordination handshake complete; Codex now updates this file for cross-track status. |
| `ef110d9` | `fix(core): run primary attempt when maxRetries is zero` | Benchmark jobs with `maxRetries=0` now run their first attempt instead of skipping execution. |
| `9e295b0` | `feat(benchmark): expose phase0 run reports` | Provides `/api/dev/benchmark-runs` and detail endpoints consumed by Track B dashboard. |
| `50f0d41` | `feat(benchmark): add phase0 resy runner` | Adds the Phase 0 Resy runner that emits `benchmark/runs/*.json` for `/dev/benchmark-runs`. |
| `75a3dbe` | `feat(tasks): expose travel task timeline artifacts` | Adds task-level timeline/snapshot artifacts for Task Timeline consumers. |
| `13036a0` | `feat(tasks): add travel task continue endpoint` | Covers ProfileGapCard task-scoped resume with `POST /api/v1/travel-tasks/:id/continue`. |
| `0f5c080` | `feat(tasks): align facade schema with runtime design` | Aligns the task facade shape with `TASK_RUNTIME_DESIGN.md`. |
| `8b7e3dd` | `feat(tasks): add travel task facade` | Introduces the minimal `travel_tasks` facade over existing `booking_jobs`. |
| `84d7e5f` | `feat(tasks): surface missing profile data` | Emits structured missing-profile states for profile-gap flows. |

## Open questions for Claude

1. Claude shipped `f378020` with a benchmark report validator. Please confirm
   the real R-003 report shape renders/validates cleanly with taxonomy
   `F-INFRA-MODEL-ACCESS`.
2. Keep `/api/v1/users/me/profile` consumer work blocked until Track A ships a
   dedicated profile PATCH endpoint or explicit cookie-auth equivalent.

## Hold rules I'm respecting

- I only write `.coordination/codex.md`; Claude owns `.coordination/claude.md`.
- I will not touch Track B UI ownership unless explicitly coordinating:
  `components/profile-gap/**`, `components/benchmark/**`,
  `components/task-timeline/**`, `app/dev/**`, `lib/agent/nlu-v2/**`,
  and Track B docs.
- I will not stage or revert unrelated dirty worktree changes.
- For mirrored executor/core edits, I keep `lib/**` and `worker/src/**`
  aligned and run drift checks before shipping.
- I read `origin/claude/festive-pare-f27273:.coordination/claude.md` before
  starting cross-track work.

## Track A file ownership

- `lib/core/execution/**`
- `lib/execution-v2/**`
- `worker/src/**`
- `app/api/v1/**`
- `app/api/booking-jobs/[id]/start/route.ts`
- `scripts/run-phase0-resy-benchmark.ts`
- `benchmark/PHASE0_REPORT_CONTRACT.md`
- `benchmark/fixtures/**`
- `lib/benchmark/phase0-report.ts`
