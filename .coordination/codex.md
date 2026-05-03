# Codex - coordination state

> **Branch**: `codex/openai-chat-model-env`
> **Last updated**: 2026-05-03 17:21 UTC
> **Last commit**: `9dba4dd`
>
> Claude reads this at session start. I write to it before each push.
> See `CLAUDE.md` section "coordination protocol".
> Claude's parallel file lives at
> `origin/claude/festive-pare-f27273:.coordination/claude.md`.

## Currently doing

Idle after shipping the fourth OpenTable guest-form fix. Waiting for a fresh founder E2E retry after dev + worker restart.

Latest shipped fix:
- `78c87a9 fix(opentable): classify phone gate before country wrapper text`
- Root cause from founder retry: `formType` saw the phone field, but coordinate target discovery returned "target not found" because the stricter classifier could reject the real phone input when nearby country/code wrapper text was included in the haystack.
- Fix: classify direct phone-like input attributes before rejecting country/code wrapper text, mirror the same rule in verification/state/fallback paths, and add visible-input diagnostics for the next retry if target discovery still fails.
- Verification: `npx vitest run lib/__tests__/opentable-provider-policy.test.ts`, `npx tsc --noEmit --pretty false`, and `npx tsx scripts/check-drift.ts` all passed. No live retry from Codex yet.

Previous shipped fix:
- `7591b03 fix(opentable): type into phone gate with compatible input APIs`
- Root cause from founder log: OpenTable's phone-only gate reached the form, but DOM value assignment did not stick, and the raw worker page does not expose full Playwright locator APIs.
- Fix: keep the DOM setter path, then fall back to Stagehand-compatible CDP input (`click`, `keyPress`, `type`) by locating visible diner-field coordinates. Phone gate now tries raw digit typing after direct fill fails; generic first/last/email/phone fallback uses the same compatible input path. Worker mirror is byte-identical.
- Verification: `npx vitest run lib/__tests__/opentable-provider-policy.test.ts`, `npx tsc --noEmit --pretty false`, and `npx tsx scripts/check-drift.ts` all passed. No live retry from Codex yet.

Previous shipped fix:
- `09f8023 fix(opentable): avoid locator fallback on guest form`
- Root cause from founder log: the fallback path called `page.getByPlaceholder`, but the provider raw page in this worker path does not expose the full Playwright locator API. That throw was then converted into a ready handoff because `reachedGuestForm=true`.
- Fix: replace locator fallback with DOM `page.evaluate` filling, and make OpenTable guest-form errors in the executor return `error` instead of `paused_payment`.
- Verification: `npx vitest run lib/__tests__/opentable-provider-policy.test.ts`, `npx tsc --noEmit --pretty false`, and `npx tsx scripts/check-drift.ts` all passed. No live retry from Codex yet.

Previous shipped fix:
- `f1f3665 fix(opentable): fill phone gate and stop before final submit`
- OpenTable still uses the legacy Stagehand + local Playwright programmatic provider, not Computer Use.
- Root cause: OpenTable's native phone verification gate was being switched to the flaky email path, then the blank form was misreported as a payment/CVC-ready handoff.
- Fix: fill phone directly when a profile phone exists, keep email fallback only when no phone exists, stop before the final `Complete reservation` click, keep local browser sessions open for 60 minutes, and replace visible CVC copy in the task UI with generic review/confirm wording.
- Regression: `lib/__tests__/opentable-provider-policy.test.ts` locks the phone-first path and final-submit skip policy.
- Verification: `npx vitest run lib/__tests__/opentable-provider-policy.test.ts`, `npx tsc --noEmit --pretty false`, and `npx tsx scripts/check-drift.ts` all passed. No live retry from Codex yet.

Historical context below:

Fixing a second OpenTable false-positive ready state from the Sirrah founder E2E run.

Current local test finding:
- A fresh Buvette task reached OpenTable, but OpenTable returned a visible `Sirrah` result because the review text mentioned Buvette. The worker clicked the 8:00 PM slot and landed on `Sirrah` booking details. This is a severe wrong-venue risk.
- The earlier stale failed UI issue is fixed in API/DB for the new job; this new issue is not stale UI, it is target selection.
- I patched `lib/booking-autopilot/stagehand-executor.ts` and the worker mirror to:
  - derive a restaurant target from the OpenTable `term` query when hotel-name extraction is not enough,
  - match venue names by distinctive words rather than a brittle prefix,
  - scan OpenTable search result titles before clicking any time slot,
  - refuse unrelated result-card slots when the requested venue title is absent,
  - re-use the same restaurant target in post-click booking-details validation.
- Verification: `npx tsc --noEmit --pretty false` passed; `npx tsx scripts/check-drift.ts` passed. No live retry from Codex yet.
- Screenshot rail bug: live snapshot JSON includes both `url` (the browser page URL) and `imageBase64` (the screenshot). The UI normalizer treated `url` as `<img src>`, so it rendered a broken image. Patched `components/task-timeline/use-snapshots.ts` to prefer `imageBase64` as a `data:image/jpeg;base64,...` source and use `title` as the fallback label.
- Verification after snapshot fix: `npx tsc --noEmit --pretty false` passed; `npx tsx scripts/check-drift.ts` passed. Local `.debug-screenshots/live/...` entries have non-empty `imageBase64`.

Do not click "Complete reservation" in the existing Sirrah browser tab. After this patch, Buvette should either match an exact Buvette result or safely no-availability/fallback; it should not continue into Sirrah.

Current local fix:
- Sirrah reached OpenTable checkout, but visible diner fields were still empty. The worker reported `Ready for payment` because `reachedGuestForm=true` converted the throw into `paused_payment`.
- Patched OpenTable guest fill to:
  - run Playwright locator fallbacks for first/last/email/phone after the DOM evaluate pass,
  - read visible diner fields from the DOM after fill/audit,
  - throw `opentable_guest_form_incomplete:<fields>` when any visible diner field remains empty.
- Patched the executor catch path so `opentable_guest_form_incomplete` is not converted into `paused_payment`.
- Verification: `npx tsc --noEmit --pretty false` passed; `npx tsx scripts/check-drift.ts` passed. No live retry from Codex yet.
- Second guard: user still saw blank email while task reported `Ready for payment`. Added executor-level OpenTable ready-handoff blocker immediately before the restaurant branch returns. It scans visible diner inputs on `/booking/details`; if email/phone/name fields are empty, it returns `error` with manual instructions and keeps the browser open instead of `paused_payment`.
- Verification after second guard: `npx tsc --noEmit --pretty false` passed; `npx tsx scripts/check-drift.ts` passed. No live retry from Codex yet.

Previous local test context:

- `smoke:phase1` passes 6/6.
- Homepage chat parse was failing before NLU routing because the configured OpenAI project does not have `gpt-4o-mini` access.
- I added an `OPENAI_CHAT_MODEL` override in `lib/openai.ts` and set local `.env.local` to `OPENAI_CHAT_MODEL=gpt-5.5` in the detached E2E worktree.
- Follow-up local test exposed gpt-5.5 Chat Completions compatibility issues: use `max_completion_tokens` instead of `max_tokens`, and omit custom `temperature` because this model only accepts the default.
- Worker deps were missing in the detached E2E worktree; `npm install` has been run under `worker/` so `npm run dev` can start there.
- No live R-003 / Computer Use run was executed.

What I just shipped:
- Founder E2E Buvette run created job `a6bec491-ec98-45cf-a191-e71b4281c5a8` and reached an OpenTable `paused_payment` handoff URL. The card still rendered failed because `worker/src/index.ts` preserved `step.error` when mapping a later successful/awaiting result. I patched worker + in-process core mapping to clear stale errors for success/awaiting/no-availability statuses and only keep errors for actual error/captcha/login/profile-gap states.
- Verification: `npx tsc --noEmit --pretty false` passed; `npx vitest run lib/core/__tests__/integration.test.ts worker/src/core/__tests__/integration.test.ts` passed 22/22. Worker-only `npm run --prefix worker typecheck` still has pre-existing mirror alias/type errors unrelated to this patch.
- Merged `origin/claude/phase-1-e2e-smoke` into master as `f9dd0ba`.
- Added no-token `npm run smoke:phase1` harness for 6 Phase 1 demo/dev surfaces.
- Added a doc note for Codex detached worktrees: Turbopack can panic on symlinked `node_modules`; use `npx next dev --webpack` for smoke verification in that environment.
- No live OpenAI / Computer Use / benchmark run was executed.

Verification from the merge:
- `npx tsc --noEmit --pretty false` passed.
- `npm run check-drift` passed.
- `npx vitest run lib/__tests__/profile-gap-decision.test.ts lib/__tests__/profile-gap-on-save.test.ts components/profile-gap components/benchmark components/task-timeline lib/agent/nlu-v2` passed: 350/356, 6 skipped.
- `npm run smoke:phase1` first correctly failed with dev server unreachable when no server was running.
- `npx next dev --webpack` + `npm run smoke:phase1` passed all 6 routes.

Latest no-token preflight (2026-05-03 12:30-12:37 UTC):
- Re-ran `npx tsc --noEmit --pretty false`: passed.
- Re-ran `npm run check-drift`: passed.
- Re-ran targeted Vitest suite above: 350/356, 6 skipped.
- Re-ran `npx next dev --webpack` + `npm run smoke:phase1`: 6/6 routes passed.
- Ran `npx tsx scripts/run-phase0-resy-benchmark.ts --dry-run --case R-003`: payload validated, no API call.
- Ran `npx tsx scripts/run-phase0-resy-benchmark.ts --case R-003`: refused before task creation because `--live-openai` / `ONEGENT_ALLOW_LIVE_OPENAI=1` was absent.
- Observed local env keys only: `OPENAI_API_KEY` present, `OPENAI_COMPUTER_USE_MODEL=gpt-5.5`, `USE_WORKER_FOR=restaurant,hotel,flight,activity`.

R-003 live command when user explicitly authorizes token spend:
1. Terminal A: `npx next dev --webpack` from repo root in this detached Codex worktree (`npm run dev` can Turbopack-panic on symlinked `node_modules` here).
2. Terminal B: `cd worker; npm run dev` with worker env loaded/copied from root `.env.local`; local worker is required because `USE_WORKER_FOR` includes `restaurant`.
3. Terminal C: `npx tsx scripts/run-phase0-resy-benchmark.ts --case R-003 --live-openai --allow-failures`.
4. Do not pass `--confirm-suite` for single-case R-003. Multi-case live runs require both `--live-openai` and `--confirm-suite`.

What I just merged from Claude:
- `origin/claude/founder-e2e-polish` merged into master as `3043a29`.
- Added quick/full founder E2E paths, stop conditions, stronger bug template, and R-003 runbook references in `PHASE_1_FOUNDER_E2E.md`.
- Merge preserved Codex-owned `R003_LIVE_SMOKE_RUNBOOK.md`, `PHASE_STATUS.md`, and `.coordination/codex.md` corrections.
- Verification after founder E2E polish merge: `npx tsc --noEmit --pretty false` passed. No live calls.
- `origin/claude/phase-status-docs` merged into master as `d0d5d32`.
- Added `PHASE_STATUS.md`, `UI_MIGRATION_MAP.md`, `R003_LIVE_SMOKE_RUNBOOK.md`, and refreshed `PHASE_1_PLAN.md`.
- Codex corrected the runbook after review: removed single-case `--confirm-suite`, removed unsupported `--output`, replaced Browserbase assumptions with current local Next + local worker + local Playwright path, and fixed Resy fixture count wording.
- Verification after docs merge: `npx tsc --noEmit --pretty false` passed. No live calls.

## Blocking on Claude

(none)

## Recently shipped (Track A, last 5-10 commits on master)

| Commit | Subject | Notes for Claude |
|---|---|---|
| `78c87a9` | `fix(opentable): classify phone gate before country wrapper text` | Founder retry showed `formType` saw phone but coordinate target discovery found none. Phone classification now prefers direct phone-like attributes before excluding country/code wrapper text, and logs visible input candidates if target discovery still fails. Verified provider test + tsc + drift. |
| `7591b03` | `fix(opentable): type into phone gate with compatible input APIs` | Founder log showed DOM value assignment did not fill OpenTable's phone-only gate. Adds Stagehand-compatible coordinate click + keyPress/type fallback for diner fields, mirrored to worker, with provider policy regression coverage. Verified provider test + tsc + drift. |
| `09f8023` | `fix(opentable): avoid locator fallback on guest form` | Founder log showed `page.getByPlaceholder is not a function`. Replaced OpenTable locator fallback with DOM-evaluate filling and blocked OpenTable guest-form errors from becoming `paused_payment`. Verified provider policy test + tsc + drift. |
| `f1f3665` | `fix(opentable): fill phone gate and stop before final submit` | OpenTable founder E2E fix: fill the native phone verification gate directly when phone exists, only use email fallback without phone, never auto-click final `Complete reservation`, keep local review browser/session open 60 minutes, and add no-live policy regression test. Verified provider test + tsc + drift. |
| `24e146e` | `fix(opentable): block ready status when diner fields are blank` | Adds an executor-level OpenTable guard before restaurant checkout returns. Visible empty diner fields now force manual/error handoff and keep the browser open, preventing false `Ready for payment` when email/phone are blank. Verified tsc + drift. |
| `521fbc3` | `fix(opentable): verify diner fields before ready handoff` | Founder E2E found Sirrah checkout showed blank phone/email but UI reported ready. OpenTable now locator-fallback fills visible diner fields and throws `opentable_guest_form_incomplete` if any remain empty; executor no longer converts that error to paused_payment. Verified tsc + drift. |
| `85c90e3` | `fix(timeline): render local snapshot image payloads` | Snapshot endpoint returns page `url` plus screenshot `imageBase64`; UI was using `url` as image src. Now prefers base64 data URL and uses `title` for label. Verified tsc + drift. |
| `6956a43` | `fix(opentable): refuse unrelated search-result slots` | Founder E2E found Buvette -> Sirrah wrong-venue risk. OpenTable now title-scopes restaurant result cards before slot clicks and reuses the restaurant target for booking-details validation. Verified tsc + drift. No live retry from Codex. |
| `72c80c5` | `fix(tasks): clear stale step errors after core success` | Founder E2E Buvette reached `paused_payment` but UI showed failed because stale `step.error` survived result mapping. Worker + in-process core mapping now clears stale errors for success/awaiting/no-availability statuses. Verified root tsc + 22 core integration tests. No live Computer Use run from Codex. |
| `3043a29` | `merge: land founder E2E polish` | Merges Claude `founder-e2e-polish`: quick/full walkthrough split, stop conditions, stronger bug template, and R-003 reference. Verified tsc. No live calls. |
| `88e7ecd` | `fix(docs): align R-003 runbook with current runner` | Corrects Claude's phase docs after review: single-case R-003 uses `--case R-003 --live-openai --allow-failures`, no `--confirm-suite`, no unsupported `--output`, current path is local Next + local worker + local Playwright, and Resy fixture wording reflects observed rows rather than invented 25-case completeness. |
| `d0d5d32` | `merge: land phase status docs` | Merges Claude `phase-status-docs` and Codex-reviewed Phase 0/1 status docs. Codex follow-up corrected R-003 runbook commands and current local-worker assumptions before push. |
| `2bedc91` | `[coord] sha fix-up cd34997` | Coordination sha fix after Phase 1 no-token smoke landing. |
| `cd34997` | `[coord] report Phase 1 smoke landing` | Documents merge verification and Turbopack symlink workaround. |
| `f9dd0ba` | `merge: land Phase 1 no-token smoke` | Merges Claude `phase-1-e2e-smoke`: `scripts/smoke-phase1.mjs`, `npm run smoke:phase1`, `PHASE_1_E2E_SMOKE.md`, and founder E2E preflight docs. Verified tsc + drift + 350 targeted tests + smoke 6/6 using webpack dev server in Codex symlinked worktree. No live calls. |
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

- Founder E2E polish is landed. Do not run live from Claude.
- Next Track B task, if user asks for more before live smoke: wait, or only fix typos/clarity in docs. Do not start Phase 2 vertical implementation.
- R-003 live remains Codex-owned and requires explicit user approval.

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
