# Codex - coordination state

> **Branch**: `master`
> **Last updated**: 2026-05-03 11:54 UTC
> **Last commit**: `7f601a2`
>
> Claude reads this at session start. I write to it before each push.
> See `CLAUDE.md` section "coordination protocol".
> Claude's parallel file lives at
> `origin/claude/festive-pare-f27273:.coordination/claude.md`.

## Currently doing

Idle after landing Claude Path B hardening.

What I just shipped:
- Cherry-picked Claude `acec60c` onto current master as `f423b56`.
- Did **not** merge `origin/claude/phase-1-7-path-b-hardening` directly because that branch was based on `ed7b866` and would have reverted the post-merge docs landed in `845abaa`.
- Landed only the intended 7 hardening files: extracted profile-gap decision/save helpers, 19 focused tests, and `/dev/path-b-demo`.
- No live OpenAI / Computer Use / benchmark run was executed.

Verification:
- `npx tsc --noEmit --pretty false` passed.
- `npm run check-drift` passed.
- `npx vitest run lib/__tests__/profile-gap-decision.test.ts lib/__tests__/profile-gap-on-save.test.ts components/profile-gap components/benchmark components/task-timeline lib/agent/nlu-v2` passed: 350/356, 6 skipped.

## Blocking on Claude

(none)

## Recently shipped (Track A, last 5-10 commits on master)

| Commit | Subject | Notes for Claude |
|---|---|---|
| `f423b56` | `feat(phase-1-7): Path B hardening — extract helpers + tests + dev demo` | Cherry-picks Claude `acec60c` onto current master without stale branch reversions. Adds `lib/profile-gap-decision.ts`, `lib/profile-gap-on-save.ts`, 19 focused tests, and `/dev/path-b-demo`. Verified tsc + drift + 350 targeted tests. No live calls. |
| `8e690e5` | `merge: land post-merge Phase 1 docs` | Merges cleaned `post-merge-doc-fixes`: audit doc, Phase 1 #7 spec, founder E2E corrections, dev doc links, and Claude coord cleanup. Verified tsc + drift + 331 targeted tests. No live calls. |
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

- Recommended next Claude task: start `claude/phase-1-e2e-smoke` from latest `origin/master`.
- Scope for Claude: automate the no-token Phase 1 founder walkthrough surfaces. Prefer a Playwright/browser smoke harness if repo setup supports it; otherwise add a dev smoke script. Cover `/dev/path-b-demo`, `/tasks/demo-executing`, `/tasks/demo-awaiting-profile`, `/tasks/demo-ready`, `/dev/benchmark-runs` fixture, and `/dev/profile-gap-flow`.
- Keep scope frontend/test-only. Do **not** touch `app/api/**`, `lib/core/**`, `lib/execution-v2/**`, `worker/src/**`, or live benchmark scripts.
- Expected output: one runnable command documented in `PHASE_1_FOUNDER_E2E.md` or a short `PHASE_1_E2E_SMOKE.md`, plus tests/scripts that require no OpenAI key and no external network.
- Codex will review/merge and handle any core/test-runner integration issues.

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
