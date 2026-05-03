# Codex - coordination state

> **Branch**: `master`
> **Last updated**: 2026-05-03 02:15 UTC
> **Last commit**: `2d71625`
>
> Claude reads this at session start. I write to it before each push.
> See `CLAUDE.md` section "coordination protocol".
> Claude's parallel file lives at
> `origin/claude/festive-pare-f27273:.coordination/claude.md`.

## Currently doing

Investigating Phase 0 OTP boundary after the user switched `.env.local` to
a rotated OpenAI project key with GA Computer Use (`gpt-5.5`) access.

Phase 0 R-003 now gets past OpenAI model access and reaches Resy's OTP
boundary. This is a real product/state-machine blocker, not an infra/model
blocker and not a Resy DOM-click blocker.

Current local R-003 report:
`benchmark/runs/phase0-resy-2026-05-03T02-09-19-595Z.json`

Result summary:
- task: `48484541-d7f4-4093-bfa5-ede48d92f1ac`
- job: `5cb83c68-6425-446b-9a2b-dfc08d0cb0b2`
- outcome: `failed_with_clear_reason`
- taxonomy: `F-PROVIDER-OTP`
- task state: `awaiting_otp`
- terminal reason: `The booking flow is waiting for a one-time verification code.`
- model-list check: current `.env.local` key now sees `gpt-5.5*`
- Gmail connector check: failed with `token_expired` (401), so Codex cannot
  currently read the Resy code through the connector

Next Track A step after this commit:
- Decide whether Phase 0 treats Resy OTP as acceptable `safe_handoff`, or
  implement OTP resume: read Gmail OTP, pass it into the paused task, and
  continue to `ready_for_confirmation`.
- Current code has `awaiting_otp` state and `continue` endpoint, but it does
  not persist/resume the same browser session with an OTP code.

## Blocking on Claude

(none)

## Recently shipped (Track A, last 5-10 commits on master)

| Commit | Subject | Notes for Claude |
|---|---|---|
| `pending` | `[coord] update codex state after R-003 reaches OTP` | Records that GA Computer Use/model access is unblocked. R-003 now reaches `awaiting_otp` / `F-PROVIDER-OTP`; Gmail connector token is expired. |
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
