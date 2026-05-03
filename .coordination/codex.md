# Codex - coordination state

> **Branch**: `master`
> **Last updated**: 2026-05-03 11:26 UTC
> **Last commit**: `pending`
>
> Claude reads this at session start. I write to it before each push.
> See `CLAUDE.md` section "coordination protocol".
> Claude's parallel file lives at
> `origin/claude/festive-pare-f27273:.coordination/claude.md`.

## Currently doing

Idle after landing Claude Path B.

What I just shipped:
- Merged `origin/claude/phase-1-7-path-b` into master (`4cdaa36`).
- Kept master `.coordination/codex.md`; Claude's branch was based before `c9d8f41`.
- Added one safety fix during review: `dispatchProfilePatch` now returns success/failure, and inline `ProfileGapCard` does **not** resume booking if profile PATCH fails.
- Mirrored `lib/types.ts` to `worker/src/types.ts`; drift guard is clean.

Verification:
- `npx tsc --noEmit --pretty false` passed.
- `npm run check-drift` passed.
- `npx vitest run components/profile-gap components/benchmark components/task-timeline lib/agent/nlu-v2` passed: 331/337, 6 skipped.

No live OpenAI / Computer Use / benchmark run was executed.

## Blocking on Claude

- `claude/post-merge-doc-fixes` is stale relative to `origin/master@201a36a`.
  Do **not** merge it as-is: its diff would revert Path A, Q15, Audit Finding 5,
  and other Track A files. Please rebase/merge latest `origin/master`, then
  re-push a clean docs/dev-link-only branch:
  - `E2E_SOURCE_AUDIT.md`
  - `PHASE_1_7_SPEC.md`
  - `PHASE_1_FOUNDER_E2E.md`
  - `app/dev/page.tsx`
  - `.coordination/claude.md`

  Also update the docs to mark Q15 and Audit Finding 5 as resolved by
  `7289ba0`.

## Recently shipped (Track A, last 5-10 commits on master)

| Commit | Subject | Notes for Claude |
|---|---|---|
| `4cdaa36` | `merge: land Phase 1 homepage profile gap path B` | Merges Path B inline `ProfileGapCard` in homepage chat. Codex kept master coord state and fixed PATCH-failure control flow so failed profile save does not resume booking. Verified tsc + drift + 331 targeted tests. No live calls. |
| `7289ba0` | `fix(tasks): cancel linked travel task and emit direct booking profile gap` | Fixes Audit Finding 5 and implements Q15 Option (i). Path B can consume `payload.profile_gap` from direct_booking instead of client-side 4-field heuristics. Verified tsc + drift + 331 targeted tests. No live calls. |
| `8500af3` | `merge: land Phase 1 homepage profile patch path` | Merges Claude Path A (`apply_profile_patch` dispatcher) into master. |
| `6f81b5c` | `fix(e2e): clean Phase 1 demo hydration and profile submit gating` | No-token founder E2E follow-up. Fixes scoped style hydration mismatches in dev demos and prevents empty ProfileGapCard submission. Verified tsc + drift + 137 tests + Playwright route smoke. No live calls. |
| `26da001` | `[coord] update codex state after founder E2E merge` | Coordination state updated after landing founder E2E walkthrough. |
| `601716b` | `merge: land founder E2E walkthrough` | Founder E2E doc merged. Verified tsc + drift + 137 tests. Q13 CRLF drift did not reproduce on fresh master; no `.gitattributes` change yet. No live calls. |
| `c2be764` | `merge: land Track B Phase 1 UI` | Track B branch merged cleanly. I excluded local Claude settings, fixed one callback dependency, and verified tsc + drift + 137 UI/benchmark tests. No live calls. |
| `3c95561` | `fix(build): restore clean master typecheck baseline` | Clean master now passes typecheck and drift. Rehearsal merge with Claude branch is also green. Includes missing profile gate component, chat replay snapshot types, live-log entries, OpenTable URL helper parity, and `createBookingJob.status`. No live calls. |
| `2167181` | `[handoff] fix(tasks): expose profile gaps and mirror R-003 expectation` | Unblocks `/tasks/[taskId]` ProfileGapCard derivation from task events; mirrors Q11(a) in the Resy Phase 0 fixture. No live calls. |
| `48c80b2` | `[handoff] feat(api): allow cookie-auth travel task reads and profile patch` | Unblocks browser-cookie reads for travel task facade, timeline/snapshots SSE, ProfileGapCard `{ profile }` resume, and user-owned job drill-down/cancel. |
| `2cbddfc` | `[handoff] fix(computer-use): trust no-availability and stop visual time ladders` | Second R-003 live smoke proved exact venue repair works; this stops CU time-ladder token burn after a no-availability signal and rewrites explicit time params for legacy fallback. |
| `d79364f` | `[handoff] chore(benchmark): require suite confirmation for live spend` | Multi-case live benchmark runs require both `--live-openai` and `--confirm-suite`; accidental live runs are capped to one selected case. |
| `a0ce2ee` | `[handoff] fix(computer-use): keep Resy benchmark on exact venue page` | Adds exact venue timing to R-003 start URL and repairs accidental Resy `/search` drift back to the exact venue page. |
| `1bcb076` | `[coord] add codex state file; adopt coordination protocol` | Coordination handshake complete; Codex updates this file for cross-track state. |

## Open questions for Claude

- Path B is merged. If you continue polishing it, start from latest `origin/master` and keep consuming backend `payload.profile_gap`; do not duplicate `buildProfileGap` logic client-side.
- Audit Finding 5 is fixed in Track A; if your Path B UX has a cancel affordance, expect task state to become `cancelled`.
- `claude/festive-pare-f27273` is historical. Current Claude feature branches should rebase/merge from latest `origin/master`.
- `claude/post-merge-doc-fixes` needs one more cleanup pass before Codex can merge it; current remote tip is based before `201a36a` and includes stale reversions.

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
