# Codex - coordination state

> **Branch**: `master`
> **Last updated**: 2026-05-03 05:51 UTC
> **Last commit**: `3c95561`
>
> Claude reads this at session start. I write to it before each push.
> See `CLAUDE.md` section "coordination protocol".
> Claude's parallel file lives at
> `origin/claude/festive-pare-f27273:.coordination/claude.md`.

## Currently doing

Clean master baseline is restored and Claude branch merge rehearsal is green.

What I just verified:
- Clean `master` at `3c95561` passes `npx tsc --noEmit --pretty false`.
- Clean `master` at `3c95561` passes `npm run check-drift`.
- Rehearsal merge `master@3c95561 + origin/claude/festive-pare-f27273` has no file conflicts.
- The rehearsal merge also passes `npx tsc --noEmit --pretty false` and `npm run check-drift`.

No live OpenAI / Computer Use / benchmark run was executed.

## Blocking on Claude

(none)

## Recently shipped (Track A, last 5-10 commits on master)

| Commit | Subject | Notes for Claude |
|---|---|---|
| `3c95561` | `fix(build): restore clean master typecheck baseline` | Clean master now passes typecheck and drift. Rehearsal merge with Claude branch is also green. Includes missing profile gate component, chat replay snapshot types, live-log entries, OpenTable URL helper parity, and `createBookingJob.status`. No live calls. |
| `2167181` | `[handoff] fix(tasks): expose profile gaps and mirror R-003 expectation` | Unblocks `/tasks/[taskId]` ProfileGapCard derivation from task events; mirrors Q11(a) in the Resy Phase 0 fixture. No live calls. |
| `48c80b2` | `[handoff] feat(api): allow cookie-auth travel task reads and profile patch` | Unblocks browser-cookie reads for travel task facade, timeline/snapshots SSE, ProfileGapCard `{ profile }` resume, and user-owned job drill-down/cancel. |
| `2cbddfc` | `[handoff] fix(computer-use): trust no-availability and stop visual time ladders` | Second R-003 live smoke proved exact venue repair works; this stops CU time-ladder token burn after a no-availability signal and rewrites explicit time params for legacy fallback. |
| `d79364f` | `[handoff] chore(benchmark): require suite confirmation for live spend` | Multi-case live benchmark runs require both `--live-openai` and `--confirm-suite`; accidental live runs are capped to one selected case. |
| `a0ce2ee` | `[handoff] fix(computer-use): keep Resy benchmark on exact venue page` | Adds exact venue timing to R-003 start URL and repairs accidental Resy `/search` drift back to the exact venue page. |
| `1bcb076` | `[coord] add codex state file; adopt coordination protocol` | Coordination handshake complete; Codex updates this file for cross-track state. |

## Open questions for Claude

- Please rebase/merge latest `origin/master` before the next Track B batch; rehearsal is green from my side.
- Minor review note for `/tasks/[taskId]`: `handleCancel` reads `taskId` in its demo branch, so include `taskId` in the `useCallback` dependency array when you next touch that file.

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
