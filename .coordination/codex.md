# Codex - coordination state

> **Branch**: `master`
> **Last updated**: 2026-05-03 03:41 UTC
> **Last commit**: `pending`
>
> Claude reads this at session start. I write to it before each push.
> See `CLAUDE.md` section "coordination protocol".
> Claude's parallel file lives at
> `origin/claude/festive-pare-f27273:.coordination/claude.md`.

## Currently doing

Idle after shipping the Phase 0 runner/facade hardening and live OpenAI spend
guard.

Consumed Claude `097741a`:
- R-003 fixture now accepts `safe_handoff` + `F-PROVIDER-OTP`.
- Runner maps `task.state === "awaiting_otp"` to `safe_handoff`.
- Resy Phase 0 universally accepts `safe_handoff` + `F-PROVIDER-OTP`.

Also fixed a v1 runtime race discovered during R-003: `/api/v1/travel-tasks`
and `/api/v1/execution-jobs` create an in-process fire-and-forget job, but the
row was inserted as `pending`, so the local worker could claim/fail the same
row before the in-process executor finished. `createJob` now supports
`initialStatus`, and both v1 in-process callers create rows as `running`.

Added a cost guard to `scripts/run-phase0-resy-benchmark.ts`: live benchmark
runs now require `--live-openai` or `ONEGENT_ALLOW_LIVE_OPENAI=1`. `--dry-run`
remains free and was verified. This prevents accidental Computer Use spend
while we harden code locally.

Added a second spend guard after the user restored OpenAI credits: live mode
can run only one selected case by default. Multi-case live runs now require
`--confirm-suite` in addition to `--live-openai`.

No live OpenAI call was run after adding the guard. Verification:
- `npx tsc --noEmit --pretty false` passed.
- `npm run check-drift` passed.
- `npx tsx scripts/run-phase0-resy-benchmark.ts --case R-003 --dry-run`
  passed and did not call the API.
- `npx tsx scripts/run-phase0-resy-benchmark.ts --case R-003 --allow-failures`
  refused to run live without `--live-openai`.

Latest local R-003 after the race fix:
`benchmark/runs/phase0-resy-2026-05-03T03-25-03-604Z.json`

Result summary:
- task: `4c08a2a5-7a1a-42aa-a2e6-373a13520ebf`
- job: `8b94d30c-ba21-4676-84b8-a4116f5697d5`
- worker race: fixed (job source is local core marker; no legacy-shape fail)
- current blocker: OpenAI Responses API 429 `insufficient_quota`
- taxonomy: `F-INFRA-PROVIDER-QUOTA`
- note for user: project model access is now present, but billing/quota is
  still blocking Computer Use calls

## Blocking on Claude

(none)

## Recently shipped (Track A, last 5-10 commits on master)

| Commit | Subject | Notes for Claude |
|---|---|---|
| `pending` | `[handoff] chore(benchmark): require suite confirmation for live spend` | Adds `--confirm-suite` guard so accidental `--live-openai` cannot run multiple Computer Use cases. |
| `pending` | `[handoff] fix(phase0): align R-003 OTP handoff and prevent worker race` | Mirrors Claude `097741a` runner/fixture rule; creates v1 in-process jobs as `running` to keep worker from stealing them; adds `--live-openai` spend guard; R-003 now blocked only by OpenAI 429 insufficient_quota. |
| `bd72f56` | `[coord] update codex state after R-003 reaches OTP` | Records that GA Computer Use/model access is unblocked. R-003 reached `awaiting_otp` / `F-PROVIDER-OTP`; Gmail connector token was expired at that time. |
| `620444a` | `[handoff] fix(executor): migrate Computer Use adapter to GA gpt-5.5 tool` | Replaces deprecated `computer-use-preview` tool shape with GA `gpt-5.5` + `type: "computer"` in lib/worker mirrors. |
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

1. Keep `/api/v1/users/me/profile` consumer work blocked until Track A ships a
   dedicated profile PATCH endpoint or explicit cookie-auth equivalent.
2. If Track B updates benchmark expectations, R-003 currently produces
   `F-PROVIDER-OTP` safely after real Computer Use execution.

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
