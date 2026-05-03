# Codex - coordination state

> **Branch**: `master`
> **Last updated**: 2026-05-03 05:27 UTC
> **Last commit**: this commit
>
> Claude reads this at session start. I write to it before each push.
> See `CLAUDE.md` section "coordination protocol".
> Claude's parallel file lives at
> `origin/claude/festive-pare-f27273:.coordination/claude.md`.

## Currently doing

Finished review of Claude `e098252` / `2f5a2b2` and shipped the Track A contract fixes it needed.

What this commit changes:
- Mirrors Q11(a) into `benchmark/restaurant-resy-phase0.json`: R-003 now accepts `no_availability_correct` in addition to `ready_for_confirmation` and `safe_handoff`.
- Adds `missing`, `profileGap`, and `profileGapScenario` to `needs_profile_data` task `state_changed` event data. This unblocks Claude's `/tasks/[taskId]` `deriveProfileGapState(data)` helper, which reads `state_changed.data.missing`.

Review notes for Claude's `/tasks/[taskId]` real API wire:
- `credentials: "include"` is correct for cookie-auth `/api/v1/*` routes.
- `/api/v1/travel-tasks/:id/continue` body `{ profile: payload.values }` matches Track A's parser.
- `POST /api/v1/execution-jobs/:jobId/cancel` with no body is correct.
- 5s polling is acceptable for Phase 1 founder testing; revisit after real traffic or when adding hidden-tab pausing.
- Owner checks intentionally avoid leaking other users' tasks. Current route behavior can be rendered as sign-in/not-found UI without exposing ownership.

No live OpenAI / Computer Use / benchmark run was executed in this commit.

## Blocking on Claude

(none)

## Recently shipped (Track A, last 5-10 commits on master)

| Commit | Subject | Notes for Claude |
|---|---|---|
| `this commit` | `[handoff] fix(tasks): expose profile gaps and mirror R-003 expectation` | Unblocks `/tasks/[taskId]` ProfileGapCard derivation from task events; mirrors Q11(a) in the Resy Phase 0 fixture. No live calls. |
| `48c80b2` | `[handoff] feat(api): allow cookie-auth travel task reads and profile patch` | Unblocks browser-cookie reads for travel task facade, timeline/snapshots SSE, ProfileGapCard `{ profile }` resume, and user-owned job drill-down/cancel. |
| `2cbddfc` | `[handoff] fix(computer-use): trust no-availability and stop visual time ladders` | Second R-003 live smoke proved exact venue repair works; this stops CU time-ladder token burn after a no-availability signal and rewrites explicit time params for legacy fallback. |
| `d79364f` | `[handoff] chore(benchmark): require suite confirmation for live spend` | Multi-case live benchmark runs require both `--live-openai` and `--confirm-suite`; accidental live runs are capped to one selected case. |
| `a0ce2ee` | `[handoff] fix(computer-use): keep Resy benchmark on exact venue page` | Adds exact venue timing to R-003 start URL and repairs accidental Resy `/search` drift back to the exact venue page. |
| `1bcb076` | `[coord] add codex state file; adopt coordination protocol` | Coordination handshake complete; Codex updates this file for cross-track state. |

## Open questions for Claude

(none)

## Hold rules I'm respecting

- Do not touch Track B branch files directly on `claude/festive-pare-f27273`.
- Keep Claude-owned bulk UI/docs/tests work on Claude branch; Codex reviews contracts and merges/fixes core conflicts.
- Avoid live OpenAI / Computer Use runs unless explicitly needed and guarded by `--live-openai` (and `--confirm-suite` for suites).
- Preserve dirty user/Claude worktree changes; stage only Track A files for the current commit.

## Track A file ownership

- `lib/core/execution/**`
- `lib/execution-v2/**`
- `worker/src/**`
- `app/api/v1/**`
- `app/api/booking-jobs/[id]/start/route.ts`
- `scripts/run-phase0-resy-benchmark.ts`
- `benchmark/PHASE0_REPORT_CONTRACT.md`
- `benchmark/restaurant-resy-phase0.json`
- `benchmark/fixtures/**`
- `lib/benchmark/phase0-report.ts`
