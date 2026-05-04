# Codex - coordination state

> **Branch**: `codex/openai-chat-model-env`
> **Last updated**: 2026-05-04 03:16 UTC
> **Last commit**: pending
>
> Claude reads this at session start. I write to it before each push.
> See `CLAUDE.md` section "coordination protocol".
> Claude's parallel file lives at
> `origin/claude/festive-pare-f27273:.coordination/claude.md`.

## Currently doing

Shipping Resy form/OTP hardening before the next visible live run.

Patch summary:
- Added a frame-aware Resy interaction helper so confirmation, phone, and OTP probes are not limited to the main frame.
- Added an explicit Resy confirmation-modal click ladder:
  1. `rs-confirm-01-locator`
  2. `rs-confirm-02-role`
  3. `rs-confirm-03-dom-main`
  4. `rs-confirm-04-dom-frame`
- Replaced the two-step Resy phone flow with a strategy ladder:
  1. `rs-phone-01-locator-main`
  2. `rs-phone-02-locator-frame`
  3. `rs-phone-03-dom-main`
  4. `rs-phone-04-dom-frame`
  5. `rs-phone-05-mouse-keyboard`
- Each strategy logs `ok/step/filled`, so the next live run can identify the winning or failing path without founder pasting DOM manually.
- Mirrored provider to `worker/src/...`.
- Verification so far: Resy mobile Vitest 5/5, root `tsc`, strict drift, and no-token `npm run probe:resy -- --case R-030` all passed.

Next live gate:
- Do not rerun R-003 for fill/OTP. It has no target-window Resy slot right now.
- If founder approves a visible live run, run only:
  `npx tsx scripts\run-phase0-resy-benchmark.ts --case R-030 --live-openai --allow-failures`
- Expected useful outcomes:
  - reaches OTP/mobile verification => Resy fill closure is working;
  - fails with `[resy][strategy ...]` logs => patch that specific strategy, do not blind retry.

Historical current-state handoff:

Handed off Phase 0 restaurant execution state in `RESTAURANT_PHASE0_HANDOFF.md`.

This document is the durable continuation guide for a fresh Codex/Claude session:
- what to read first,
- who owns which files,
- why R-003 is no longer the fill/OTP test,
- why R-030 is the next Resy live candidate,
- how to continue without blind token burns,
- what counts as success/failure.

Previous work: shipped a no-token Resy availability probe so we stop burning Computer Use on cases with no real slot.

Current finding:
- R-003 is not a useful fill/OTP test right now. The Resy public search API returns exact venue `buvette-nyc` but zero target-window slots.
- The new probe uses Resy's own frontend API (`POST /3/venuesearch/search`) and exact `resySlug` matching, so it avoids false positives from visible filter text and avoids wrong-venue matches like "Don Angie" -> "Don Don".
- Latest no-token full probe found three valid live-fill candidates:
  - `R-030` Charlie Bird, 2026-05-08 20:00, party 2, exact slug, 12 matching slots. Recommended first.
  - `R-051` Loring Place, 2026-05-04 19:00, party 4, 12 matching slots.
  - `R-052` Pasquale Jones, 2026-05-09 20:00, party 4, 4 matching slots.

Verification:
- `npm run probe:resy` passed and printed next single-case command:
  `npx tsx scripts\run-phase0-resy-benchmark.ts --case R-030 --live-openai --allow-failures`
- `npx tsc --noEmit --pretty false` passed after clearing generated `.next`.
- No live OpenAI / Computer Use run was executed in this patch.

Next live gate:
- Do not rerun R-003 for fill/OTP. Use `R-030` if founder approves one visible live run.
- If `R-030` reaches contact/OTP, use that as the Resy fill-closure path. If it fails before contact/OTP, capture logs/screenshots and do not retry blindly.

Claude task suggestion:
- Do not touch Resy provider/runtime/runner while Codex owns it.
- Useful parallel work: dashboard for `resy-availability-probe-*.json`, showing recommended cases, exact venue match errors, and next safe single-case command.

Latest Resy Phase 0 prep:
- We did not run live OpenAI/Computer Use. This was a no-token hardening pass before R-003 live.
- Resy already had the core path: click "Reserve Now" on the confirmation modal, detect `guest_form` vs `mobile_verify`, fill mobile, then stop at OTP as safe handoff.
- Patch adds a first-class Resy phone strategy ladder:
  1. `rs-phone-01-locator` fills and verifies phone through Playwright locator, then clicks Continue.
  2. `rs-phone-02-dom-direct` falls back to native DOM setter + Continue click.
- Added `lib/__tests__/resy-provider-mobile.test.ts` with 4 no-token cases: locator success to OTP, locator fallback to DOM, no phone, and all-strategies-fail reason.
- Updated the existing OpenTable dry-run test mock to match the current deeper provider preflight shape (`url()` + diner form state).
- Mirrored Resy provider to `worker/src/...`.
- Verification: Resy mobile Vitest + dry-run Vitest 23/23, root `tsc`, strict drift, and `run-phase0-resy-benchmark --dry-run --case R-003` all passed.

Next suggested live gate:
- Only after founder approves token spend, run one case only:
  `npx tsx scripts/run-phase0-resy-benchmark.ts --case R-003 --live-openai --allow-failures`
- Do not run the full 22/25 Resy suite until R-003 reaches one of the accepted buckets.

Claude task suggestion while Codex owns Resy provider/runtime:
- Do not touch Resy provider/worker/runtime.
- Useful parallel task: dashboard/artifact viewer UX for provider strategy logs (`[resy][strategy ...]`, `[opentable][strategy ...]`) and screenshots, so founder does not need to paste terminal output.

Latest founder retry root cause:
- The page did reach OpenTable checkout and the browser stayed open, but the phone input stayed blank.
- Artifact `worker/.debug-screenshots/opentable/.../page.png` showed the red debug cursor below the phone field. The old fixed fallback used Playwright viewport y~411; OpenTable's page screenshot excludes browser chrome, so the phone input center is closer to y~321.
- The bigger bug: phone typing helpers accepted `verified=false` for any phone field (`verified || field === "phone"`), so a missed click could still produce a ready/manual-review handoff.

Patch:
- Ordinary locator and discovered-coordinate paths now require verification before success.
- The fixed coordinate ladder is explicit: `ot-phone-04-fixed-coordinate-high`, `ot-phone-05-fixed-coordinate-mid`, `ot-phone-06-fixed-coordinate-low`.
- The calibrated high fallback now targets y~0.405 of the Playwright viewport instead of the old low y~0.52.
- Logs now say `refusing ready handoff` when phone typing is not verified, and tests forbid the old `verified || field === "phone"` pattern.
- Mirrored provider to `worker/src/...`.
- Verification: OpenTable policy Vitest, root `tsc`, and strict drift all passed. Services need restart before the next founder retry.

Claude task suggestion while Codex owns provider/runtime:
- Do not touch OpenTable provider/worker/runtime.
- If unblocked by HUDDLE protocol, useful parallel task: artifact viewer UX/spec for `.debug-screenshots/opentable/*` so founder/codex can inspect screenshot + summary from the dashboard instead of terminal/file explorer.

Latest founder retry root cause:
- Search/listing -> booking details still works via programmatic OpenTable time-slot click.
- The failure remains at the phone-only checkout gate. Stagehand/local wrappers can see `formType.hasPhone`, but exact DOM diagnostics and locator scans can still fail around the phone input, so previous single-path fixes were not enough.

Patch:
- Replaced the phone gate with an explicit strategy ladder:
  1. `ot-phone-01-exact-locator` (`#phoneNumber` / tel locator fill),
  2. `ot-phone-02-dom-direct` (native value setter on exact phone selectors),
  3. `ot-phone-03-discovered-coordinate` (discovered bounding-box keyboard typing),
  4. `ot-phone-04-fixed-coordinate` (known OpenTable phone-gate coordinate fallback),
  5. artifact/manual-review fallback.
- Every strategy logs under `[opentable][strategy ...]`.
- Any terminal guest-form failure now writes `.debug-screenshots/opentable/<timestamp>-<label>/summary.json`, plus `page.png`/`page.html` when the page API exposes them.
- Mirrored provider to `worker/src/...`.
- Verification: OpenTable policy Vitest, root `tsc`, and strict drift all passed. No live retry from Codex after this patch.

Claude task suggestion while Codex owns provider/runtime:
- Do not touch OpenTable provider/worker/runtime.
- Useful non-conflicting task: doc/spec only for `BROWSER_AUTOMATION_OBSERVABILITY_PLAN.md` or artifact viewer UX. Define how benchmark/task dashboards should show `summary.json`, `page.png`, strategy attempts, and final outcome taxonomy. No provider code.

Latest founder retry root cause:
- The OpenTable path is still legacy Stagehand/local Playwright RPA, not Computer Use.
- Search/listing -> booking details works via programmatic time-slot click.
- The failure was at the phone gate because Stagehand/local page exposes a partial Locator object. `candidate.isEnabled` was not always a function, so the code threw before any visible click/type happened.

Patch:
- Treat OpenTable locators as capability-detected partial objects (`OpenTableCompatLocator`) instead of assuming full Playwright Locator.
- Only call `isVisible`, `isEnabled`, `scrollIntoViewIfNeeded`, `click`, `fill`, and `inputValue` when the method exists.
- If locator click/fill is incomplete, show the red debug cursor and fall back to coordinate click + keyboard typing.
- Mirrored provider to `worker/src/...`.
- Verification: OpenTable policy Vitest, root `tsc`, and strict drift all passed. No live retry from Codex.

Historical context below:

Shipping the next OpenTable guest-form fix after founder retry still showed no visible click/type at the phone gate.

Root cause from `codex-worker.log`:
- Listing -> details works by programmatic OpenTable time-slot click; this is still legacy Stagehand/local Playwright RPA, not Computer Use.
- At `/booking/details`, `formType` sees the phone-only gate, but subsequent DOM `evaluate()` diagnostics can throw `StagehandEvalError`, so prior coordinate typing had no target and no visible cursor.

Patch:
- Add locator/boundingBox/inputValue fallback for phone/name/email fields before any browser `evaluate()` path.
- Add explicit `onegent-opentable-debug-cursor` overlay plus Playwright `mouse.move/click` support before coordinate typing, so founder can visually see the click target.
- Route guest-form operations through raw page when available and keep the final `Complete reservation` click disabled by policy.
- Mirrored provider to worker. Verification: OpenTable policy Vitest, root `tsc`, and strict drift all passed. No live retry from Codex.

Shipping a fifth OpenTable guest-form fix after founder retry showed the phone gate still never received an actual click/type.

Current root cause from `codex-worker.log`:
- Search/listing -> booking details works. The provider programmatically clicks the requested OpenTable time slot (`clicked time slot "8:00 PM"`), then reaches `/booking/details`.
- The failure is only at the phone gate. `formType` can see the phone-only form, but the later complex diner-field locator/diagnostic scans throw `StagehandEvalError`, so coordinate typing never finds a target.
- This is still the legacy Stagehand/local Playwright programmatic OpenTable provider path, not Computer Use.

Current patch:
- Added a dedicated minimal `locateOpenTablePhoneGate` path that uses only stable direct input attributes (`type=tel`, placeholder, aria/id/name/autocomplete) and avoids context/closest text scans that were throwing in the Stagehand wrapper.
- Removed complex context-based classification from the generic fallback path.
- If the phone gate was successfully clicked/typed but the final form-state read is still unreadable, return a manual-review handoff instead of misclassifying it as `email` missing.
- Coordinate typing now accepts the phone gate after successful compatible input even when the verifier readback is flaky; final state validation still blocks if it can read an actually empty field.
- Mirrored provider to `worker/src/...`.
- Verification: `npx vitest run lib/__tests__/opentable-provider-policy.test.ts`, `npx tsc --noEmit --pretty false`, and `npx tsx scripts/check-drift.ts` passed. No live retry from Codex.

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
| `7f48a01` | `fix(opentable): add guest form strategy ladder` | Phone-only checkout now runs explicit `ot-phone-01`..`ot-phone-04` fallback strategies and saves `.debug-screenshots/opentable/...` artifacts on terminal guest-form failures. Verified provider policy test + tsc + drift. No live retry from Codex. |
| `592670a` | `fix(opentable): use locator typing for guest form` | Latest founder retry still saw no click/type because `evaluate()` diagnostics failed at the phone gate. Adds locator/boundingBox fallback, visible debug cursor overlay, and raw-page form operations. Verified provider test + tsc + drift. |
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

- While Codex is fixing OpenTable, do not touch `lib/booking-autopilot/providers/opentable-com.ts`, `worker/src/booking-autopilot/providers/opentable-com.ts`, or executor/runtime files.
- Useful non-conflicting Track B task if user wants Claude busy: doc/spec only for `OPENTABLE_FALLBACK_POLICY.md` or `BROWSER_AUTOMATION_OBSERVABILITY_PLAN.md`, covering when to use deterministic Playwright, when to escalate to Computer Use, when to switch to email/Gmail OTP, and how to capture screenshots/logs for replay. No provider code.
- Founder E2E polish is landed. Do not run live from Claude. R-003 live remains Codex-owned and requires explicit user approval.

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
