# HUDDLE - Shared Working Memory

> Last writer: claude
> Last updated: 2026-05-05
> Cap: 2000 words. Trim oldest Live activity first.

This file is the short-term shared memory for Codex, Claude, and future coding
agents. Read it after `docs/10-coordination/README.md`. Keep it current but
small.

## Inbox for Codex

- Continue provider/runtime/live debugging only after checking
  `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`.
- Do not stage unrelated dirty provider files when doing docs-only work.
- Review sidecar branches from pushed commits only. If an agent updates
  `docs/10-coordination/phase2.md`, `track-c.md`, or `claude.md`, the founder
  only needs to send branch + commit hash unless direction is blocked.

## Inbox for Claude

- Base new Track C UI/docs/tooling branches on the latest
  `origin/codex/integrated-preview-20260504`, not older integration commits.
- Use `docs/INDEX.md` as the root docs map.
- Large UI/dashboard/testing tasks should live under `docs/40-phase1/`,
  `docs/50-product-areas/`, or dedicated app/lib code areas, not root docs.
- If a branch adds a new operational dashboard or QA runner, update
  `docs/00-start-here/PHASE_STATUS.md` and the closest runbook.

## Active Locks

- None.

## Live Activity

- 2026-05-05 claude: opened `claude/r030-infra-db-transient-fix` from
  `1978cc7` to fix the no-live infra blocker that the 2026-05-05 03:55
  R-030 retry surfaced. A single transient Neon `ConnectTimeoutError`
  during runner polling produced bare `failed_unknown` + `500` and left
  job `9b87e947-e783-434a-b36a-054a461053f8` stuck in `running/pending`.
  Patches: (a) `scripts/run-phase0-resy-benchmark.ts` adds
  `withTransientRetry` (4 attempts, exponential backoff 500ms / 1500ms /
  4500ms) wrapping `getTravelTask` + `getTimeline`; runner now survives a
  single 5xx blip and only bails after retry exhaustion. (b) Adds
  `F-INFRA-DB-TRANSIENT` benchmark taxonomy ranked above generic 5xx so
  Neon blip cannot misclassify as Resy `no_availability`. (c) Enriches
  `CaseResult` with `screenshotDir` (derived from job id),
  `lastKnownStage`, `errorClass`, `safetyStatus`, `dbTerminalAvailable`,
  `pollRetriesAbsorbed`. Hoists task id + job id from create response so
  they survive even when polling fails. (d) Adds Neon DB signals to
  `lib/runtime-forensics/classifier.ts` `model_or_env_blocked` and
  `lib/operator-failure-taxonomy/categories.ts` `model_env_transient`.
  (e) New no-live `lib/runtime-forensics/stuck-job-audit.ts` (pure
  artifact-only module, never mutates DB) scans
  `benchmark/runs/phase0-resy-*.json` for the DB-transient pattern and
  produces operator markdown. (f) `PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` §
  6.5 documents the manual cleanup procedure (read-only audit + screenshot
  safety check + DB read-only confirm + exact UPDATE template gated on
  founder approval). Tests: 33 new (retry + classifier + stuck-job audit
  + safety helpers); 146 existing tests still green. tsc clean,
  `gate:phase1 --allow-known-drift` 8/0/0/1 exit 0, drift = same
  known-existing dry-run only. No provider/runtime patch in
  `lib/booking-autopilot`, `lib/core`, `lib/execution-v2`, `worker/src`,
  or `app/api`. No DB mutation. No `.env` / OPENAI_API_KEY handling. No
  live retry. After this lands, prepare but do not run the next R-030
  attempt; founder must explicitly say "yes, run exactly one R-030
  controlled retry".
- 2026-05-05 codex: integrated Agent3
  `codex/hotel-closure-solve-next @ 2f962d2` as `f863a82` on top of the
  current integrated preview. This solves the next Booking.com no-payment /
  manual-review runtime blocker: generated hotel tasks now carry a structured
  manual-review prompt, Booking.com runtime detects the safer no-payment
  intent without depending on the old `stop before payment` regex, both normal
  checkout and independent payment-gate paths skip Booking.com card-field fill
  under that intent, exact stay params are logged for evidence, and optional
  member/sign-in promos are dismissed only with safe close controls. Verified
  hotel targeted tests 34/34, `tsc`, strict `check-drift`, `git diff --check`,
  and Phase 1 gate 9/9
  (`phase1-quality-gate-2026-05-05T04-02-34-398Z.json`). No live
  provider/OpenAI/browser automation, worker start, DB mutation, payment,
  CVV/security-code, OTP/CAPTCHA/login handling, or final confirmation was
  performed during Codex integration. Hotel is not closure-complete until a
  new explicitly founder-approved single controlled Booking.com retry reaches
  a safe handoff boundary or yields actionable current evidence.
- 2026-05-05 codex: integrated Agent2
  `codex/flight-closure-solve-next @ 204cc4e` as `61e2eba` on top of the
  current integrated preview. This solves the next Expedia selector/runtime
  blocker from the prior controlled MCO -> BNA retry: hidden/cross-airline
  price-only fallback can no longer select the wrong target-time card, correct
  target-time Southwest cards remain selectable when flight number text is
  partial/hidden, member-price/sign-in promo overlays are dismissed only by
  safe close/escape behavior, and locator fallback no longer depends on
  `evaluate`/relative ancestor support. The runtime forensics analyzer now
  treats OpenAI 403 `model_not_found` as local runtime env/project mismatch,
  not Expedia provider evidence. Verified Expedia targeted tests 29/29,
  `tsc`, strict `check-drift`, and Phase 1 gate 9/9
  (`phase1-quality-gate-2026-05-05T03-53-34-308Z.json`). No live
  provider/OpenAI/browser automation, worker start, DB mutation, payment,
  CVV/security-code, OTP/CAPTCHA/login handling, or final confirmation was
  performed during Codex integration. Flight is not closure-complete until a
  new explicitly founder-approved single controlled retry reaches a safe
  handoff boundary or yields actionable current evidence.
- 2026-05-05 codex: integrated Goal
  `codex/goal-phase-closure-evidence-pack @ 9b43a65` as `aa034b3`, then
  applied a Codex integration correction to avoid stale model-access wording.
  The new no-live phase closure evidence pack adds
  `docs/00-start-here/PHASE_CLOSURE_EVIDENCE_PACK.md`,
  `lib/phase-closure-evidence/**`, and `scripts/phase-closure-evidence.ts`.
  It keeps Phase 0A blocked on unvalidated Resy provider-path closure, Phase
  1/1.5 demo-freeze passed but not phase-closed without explicit human
  acceptance, and Phase 2 frozen/not live verified. Integration correction:
  the 2026-05-05 R-030 403 is now described as a Claude worktree runtime
  env/project mismatch because the founder confirmed the intended OpenAI
  project has `gpt-5.5` access and budget; it is still
  `model_env_transient` / `F-INFRA-MODEL-ACCESS`, not a Resy provider
  regression. Verified phase-closure/docs tests 28/28, phase-closure CLI JSON,
  `tsc`, strict `check-drift`, `git diff --check`, and Phase 1 gate 9/9
  (`phase1-quality-gate-2026-05-05T03-45-44-658Z.json`). No live
  provider/OpenAI/browser automation, worker start, DB mutation, payment,
  OTP/CAPTCHA/login handling, or final confirmation was performed.
- 2026-05-05 codex: integrated Claude
  `claude/r030-2026-05-05-evidence-packaging @ 1f2ec0f` as `1ebd09a` on top
  of the current integrated preview. This packages the 2026-05-05 R-030 retry
  as an inconclusive `model_env_transient` / `F-INFRA-MODEL-ACCESS` worked
  example: OpenAI Responses API 403 `model_not_found` for `gpt-5.5`, exact
  Resy venue URL preserved, `decisionLog=null`, no provider decision/fallback
  executed, and the `422abe0` Resy recovery patches remain unvalidated.
  Verified targeted operator/closure/docs tests 65/65, `tsc`, strict
  `check-drift`, `git diff --check`, and Phase 1 gate 9/9
  (`phase1-quality-gate-2026-05-05T03-19-28-446Z.json`). No retry, no env/key
  handling, no provider/runtime/worker/db patch, no payment, CVV,
  OTP/CAPTCHA/login/verification handling, or final confirmation was performed
  during integration.
- 2026-05-05 codex: integrated Agent2
  `codex/flight-live-closure-final @ fa7afc3` on top of the current
  provider-closure final preview as `25d29fb`. The source branch ran exactly
  one founder-authorized Expedia MCO -> BNA controlled retry and stopped safely
  before checkout/manual review; evidence classified the result as
  `selector_drift` because the locator fallback hit `item.evaluate is not a
  function`. The patch hardens Expedia flight locator fallback text collection
  without requiring `evaluate`, prevents price-only wrong-time fallback
  selection, mirrors the provider change into the worker, and updates Expedia
  retry analysis so hard-stop checklist notes do not mask selector/runtime
  failures. Verified targeted Expedia/runtime/provider-closure tests 166/166,
  `tsc`, strict `check-drift`, `git diff --check`, and Phase 1 gate 9/9
  (`phase1-quality-gate-2026-05-05T02-16-00-971Z.json`). `npm run build` was
  not rerun in this integration pass because the same local C: disk `ENOSPC`
  blocker remains. No live provider/OpenAI/browser automation, payment,
  CVV/security-code, OTP/CAPTCHA/login bypass, or final confirmation was
  performed by codex during integration.
- 2026-05-05 codex: integrated the provider closure acceptance/final batch on
  a clean worktree from `origin/codex/integrated-preview-20260504 @ bcd2895`.
  Cherry-picked Claude `claude/provider-closure-acceptance-final @ ed46abc`
  as `c33b429`, Agent3 `codex/hotel-live-closure-final @ 12b5a0e` as
  `7916ff1`, and Goal `codex/goal-provider-closure-war-room @ 29ebdc6` as
  `7597b12`. This adds the canonical provider closure acceptance doc and
  locked `liveVerified: false` lane criteria, hardens Booking.com generated
  tasks/start prompts to stop at manual-review boundaries with `rooms=1`
  preserved, and adds the no-live provider closure war-room CLI/library with
  synthetic reports. Verified targeted provider-closure/operator/docs/hotel
  tests 124/124, `tsc`, strict `check-drift`, `git diff --check`, and Phase 1
  gate 9/9 (`phase1-quality-gate-2026-05-05T02-07-16-988Z.json`). `npm run
  build` was attempted but blocked by local disk exhaustion (`ENOSPC`, C: had
  about 15 MB free while webpack cache wrote); no build-code failure was
  observed. No live provider/OpenAI/browser automation, payment, CVV,
  OTP/CAPTCHA/login/verification handling, or final confirmation was performed.
- 2026-05-04 codex: integrated the latest provider runtime closure batch on
  top of the Resy R-030 root-cause fix. Cherry-picked Agent2
  `codex/flight-runtime-closure @ e151f9f` as `d2629f1`, Agent3
  `codex/hotel-runtime-closure @ 3e22fb0` as `b6451fa`, Goal
  `codex/goal-provider-closure-harness @ 6a5890c` as `adeecfa`, and Claude
  `claude/provider-closure-operator-room @ 51d9726` as `1700725`. This adds
  Expedia flight card-click hardening and exact-task preflight, Booking.com
  hotel runtime boundary classification, a shared no-live provider closure CLI,
  and `/dev/provider-closure` as the three-lane operator cockpit. Verified
  targeted tests 138/138, `tsc`, `check-drift`, Phase 1 gate 9/9
  (`phase1-quality-gate-2026-05-05T01-13-12-289Z.json`), and `npm run build`.
  No live provider/OpenAI call, payment, CVV, OTP/CAPTCHA/login bypass, final
  confirmation, or extra live retry was performed during this integration.
- 2026-05-04 codex: ran a founder-approved single controlled Resy R-030 live
  closure attempt on integrated preview. The run stayed inside safety bounds
  and stopped before payment, CVV, OTP/CAPTCHA/login bypass, or final
  confirmation. Evidence: task `63ff8d7c-3629-4245-a948-2b7e1d5e15ff`, job
  `e6674a7c-444a-4807-9acc-4983cd3e27f4`, report
  `benchmark/runs/phase0-resy-2026-05-05T00-44-47-385Z.json`, screenshots under
  `.debug-screenshots/live/e6674a7c-444a-4807-9acc-4983cd3e27f4`. Root cause:
  the stored step had the exact Charlie Bird Resy venue URL, but recovery
  treated the failed Resy primary as if OpenTable had failed and launched a
  duplicate Resy city-search fallback; the fallback then clicked a bare
  `DIV "8:00 PM"` time control and the benchmark classified the listing stall
  as `no_availability_correct`. Patched no-live root causes: recovery now skips
  duplicate Resy fallback when the primary request already targets Resy, Resy
  fallback preserves exact venue URLs when present, Resy slot detection rejects
  bare time controls without availability context, and Phase 0 benchmark
  taxonomy reports auth/backend and listing-stall failures separately from true
  no availability. Verified focused tests 34/34, R-030 dry-run exact URL,
  `tsc`, `check-drift`, `git diff --check`, and Phase 1 gate 9/9
  (`phase1-quality-gate-2026-05-05T01-02-45-537Z.json`). No extra live retry
  after the patch.
- 2026-05-04 codex: integrated latest no-live runtime closure sidecar batch
  after the Resy R-030 patch. Cherry-picked Agent2
  `codex/flight-live-readiness-pack-v2 @ d4d42a8` as `5aabb36`, Agent3
  `codex/hotel-live-readiness-pack-v2 @ c2021bb` as `084a1d6`, Goal
  `codex/goal-runtime-closure-consolidation @ d42c8dc` as `bd5d15b`, Goal
  bridge commit `b8cfd8a` as `bb641b7`, and Claude
  `claude/live-transient-failure-operator-polish @ 3e8dc3f` as `a7ed628`.
  Resolved conflicts by preserving current Resy runtime fixes, current
  31-fixture corpus counts, and the stricter OpenAI Responses API 5xx
  classification. Verified targeted runtime/flight/hotel/artifact/operator
  tests 209/209, artifact bundle templates for restaurant/Expedia/hotel,
  fixture inventory 31, `tsc`, `check-drift`, `git diff --check`, and Phase 1
  gate 9/9 (`phase1-quality-gate-2026-05-05T00-13-50-528Z.json`). No live
  provider/OpenAI run, payment, CVV, OTP/CAPTCHA/login bypass, final
  confirmation, or live retry was performed.
- 2026-05-04 codex: ran founder-approved controlled Resy R-030 live closure
  on integrated preview. First run failed before provider with OpenAI Responses
  API 500 (`req_ce42a48137424a938a7893b131416d28`), now classified as
  `model_or_env_blocked`. Retry reached Resy/Charlie Bird safely but ended
  `no_availability_correct` even though the public probe had matching slots;
  screenshots showed the venue page loaded with date/time/party controls but no
  visible slot cards, plus a fallback handoff to a city search URL. Patched
  no-live root causes before any further live attempt: Resy slot detection no
  longer treats the top `Time 8:00 PM` filter as a slot, Resy city slugs now use
  `new-york-ny`/`nashville-tn`, hyphenated Resy URLs are stage-detected, Resy
  deep links preserve `time=HHMM`, and Resy fallback URLs keep time. Verified
  Resy/forensics tests 144/144, restaurant/debug tests 72/72, `tsc`,
  `check-drift`, `git diff --check`, and Phase 1 gate 9/9. No payment, CVV,
  OTP/CAPTCHA/login bypass, final confirmation, or extra live retry after the
  patch.
- 2026-05-04 codex: integrated Goal
  `codex/goal-artifact-corpus-consolidation @ bb238b7` as `ee5a3d7`.
  Added no-live artifact corpus inventory, fixture listing script, and corpus
  guard tests for restaurant, Expedia, hotel, and runtime-forensics fixtures.
  Verified corpus/artifact tests 98/98, fixture listing script output
  27 fixtures (restaurant 10, Expedia 8, hotel 9), forbidden-path audit,
  `tsc`, `check-drift`, `git diff --check`, Phase 1 gate 9/9, full Phase 1
  gate with smoke+e2e 12/12
  (`phase1-quality-gate-2026-05-04T18-44-11-060Z.json`), demo freeze checker
  `ready`, and production route probe 13/13. No live provider/OpenAI calls,
  payment, OTP, CAPTCHA, login bypass, final confirmation, or forbidden paths.
- (Earlier 2026-05-04 entries trimmed per HUDDLE 2000-word cap. Full
  context preserved in `docs/10-coordination/claude.md` Recently
  Shipped table and `docs/10-coordination/codex.md` ack history.)

## Hot Decisions

- Phase 2 remains frozen until Phase 0/1 are stable.
- External provider execution must stop before final confirmation, payment, OTP,
  CAPTCHA, or irreversible account-sensitive actions.
- Debugging provider runtime requires DB evidence, worker logs, and screenshots;
  task cards alone are not enough.
- New root markdown files are discouraged. Put docs under the appropriate
  `docs/<category>/` folder.
- Next route/page modules must not export helper functions or shared UI. Move
  helpers/components into `lib/**` or `_components/**`; production build catches
  violations that ordinary `tsc` can miss before `.next/types` exists.
