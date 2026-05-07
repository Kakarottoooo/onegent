# Codex - coordination state

> **Branch**: `codex/integrated-preview-20260504`
> **Last updated**: 2026-05-07
> **Last commit**: this pass - Ticketmaster activity dogfood closure record
>
> Claude reads this at session start. I write to it before each push.
> See `CLAUDE.md` section "coordination protocol".
> Claude's parallel file lives at
> `origin/claude/festive-pare-f27273:docs/10-coordination/claude.md`.

## Currently doing

Completed in latest pass:
- Recorded founder-confirmed Ticketmaster activity dogfood closure:
  - request family: Broadway / The Lion King in New York on May 30;
  - latest traced job `46028ee4-c644-4df7-bee5-7bcb7d2713f9`;
  - runtime path was existing v1 `ticketmaster-rpa` through the local
    Stagehand/Playwright stack, not Browser Harness;
  - worker evidence showed session cookies injected, `May 30, 2026 @ 2:00 PM`
    parsed, calendar view opened, May 30 2:00 PM selected, right-side
    `Find Tickets` clicked from the main Ticketmaster page, and the provider
    event page reached;
  - founder confirmed the path is now closed for initial dogfood. Remaining
    polish: suppress/ignore external ad tabs, make the seat-selection
    checkpoint explicit, and recover stale `running/loading` jobs if the local
    browser/CDP session closes.
- Updated `PHASE_STATUS.md` and `BUG_INBOX.md` with the Activity/Ticketmaster
  status and clarified that Browser Harness remains a separate v2 spike/design
  lane.

Previous completed pass:
- Recorded founder dogfood OpenTable closure for Phase 0A:
  - request: "book Sirrah in New York next Thursday at 8pm for 1 person";
  - job `3bbe2ac4-c4cd-409f-8c11-6a83d2f81485`, session
    `6a5946f9-48ae-487c-a443-ccc78c6327f2`;
  - DB: `booking_jobs.status=done`,
    `steps[0].status=awaiting_confirmation`, OpenTable `/booking/details`
    `handoff_url`, params Sirrah / New York / `2026-05-14` / `20:00` / 1;
  - logs: agent log ids `2782`-`2785`; final message
    "Reservation form filled for Sirrah. Open the link to confirm.";
  - founder screenshot: Sirrah Thu May 14 8:00 PM, 1 person, phone filled,
    final `Complete reservation` visible but not clicked.
- Verdict: accepted `safe_handoff` / `ready_for_confirmation`. No payment,
  CVV/card data, OTP/SMS code entry, CAPTCHA/login bypass, or final
  confirmation. Phase 0A is now closed via OpenTable; Resy remains a
  provider/network/IP follow-up lane, not the Phase 0A blocker.
- Updated `PHASE_STATUS.md`, `PROJECT_SUMMARY.md`,
  `PHASE_CLOSURE_EVIDENCE_PACK.md`, `PROVIDER_CLOSURE_ACCEPTANCE.md`,
  `LIVE_CLOSURE_EVIDENCE_PROTOCOL.md`, provider-closure room manifest, and
  tests/phase-closure evidence logic.

Previous completed pass:
- Integrated Claude `claude/r030-infra-db-transient-fix @ 34ef0c5` as
  `350a93a`.
- Actual blocker addressed:
  - the Phase 0 Resy benchmark runner now retries transient API/DB polling
    failures with bounded backoff;
  - exhausted Neon/DB polling failures classify as `F-INFRA-DB-TRANSIENT` /
    `model_env_transient`, not Resy no-availability;
  - benchmark reports preserve task id, job id, screenshot directory,
    last-known stage, safety status, DB-terminal availability, and absorbed
    poll retry count even when terminal DB fields are unavailable;
  - new artifact-only stuck-job audit module detects DB-transient orphan
    patterns without mutating DB;
  - runtime/operator forensics classify Neon `ConnectTimeoutError` and related
    fetch/DB errors as infra transient.
- Verified targeted retry/audit/forensics/docs tests 167/167,
  `npx tsc --noEmit --pretty false`, strict `npm run check-drift` with no
  drift, and `npm run gate:phase1 -- --allow-known-drift` 9/9
  (`phase1-quality-gate-2026-05-05T04-38-38-846Z.json`).
- Safety boundary preserved during Codex integration: no live provider/OpenAI/
  browser automation, worker start, DB mutation, env value handling, payment,
  verification handling, or final confirmation.
- Founder operating rule for future agent prompts: the prompt itself may
  authorize up to two controlled attempts for one exact case; attempt 2 is not
  a blind retry and requires evidence-driven root-cause/fix first.

Previous completed pass:
- Integrated Agent3 `codex/hotel-closure-solve-next @ 2f962d2` as `f863a82`.
- Actual blocker addressed:
  - generated hotel tasks now use a structured Booking.com manual-review
    prompt with exact hotel/date/adult/room evidence;
  - Booking.com runtime detects no-payment/manual-review intent without
    relying on the old `stop before payment` regex;
  - both normal checkout and independent payment-gate paths skip Booking.com
    card-field fill when manual-review/no-payment intent is active;
  - exact Booking.com stay params are logged before listing/room selection;
  - optional member/sign-in promos are dismissed only through safe close
    controls, while login/verification/CAPTCHA prompts remain hard stops.
- Verified `npx vitest run lib/__tests__/booking-com-hotel-runtime.test.ts
  lib/__tests__/hotel-live-readiness.test.ts
  lib/__tests__/hotel-retry-analysis.test.ts
  lib/__tests__/hotel-task-builder.test.ts` 34/34,
  `npx tsc --noEmit --pretty false`, strict `npm run check-drift`,
  `git diff --check`, and `npm run gate:phase1 -- --allow-known-drift` 9/9
  (`phase1-quality-gate-2026-05-05T04-02-34-398Z.json`).
- Safety boundary preserved during Codex integration: no live provider/OpenAI/
  browser automation, worker start, DB mutation, payment, CVV/security-code,
  OTP/CAPTCHA/login handling, or final confirmation.
- Hotel closure is still not complete. A new single controlled Booking.com
  retry is now technically justified after explicit founder approval; it must
  either reach a safe manual-review handoff or produce current actionable
  evidence without retry loops.

Previous completed pass:
- Integrated Agent2 `codex/flight-closure-solve-next @ 204cc4e` as
  `61e2eba`.
- Actual blocker addressed:
  - Expedia flight card selection no longer allows hidden/cross-airline
    price-only fallback to select a wrong-time card;
  - correct target-time Southwest cards remain eligible when flight number text
    is partial/hidden;
  - member-price/sign-in promo overlays are dismissed only by safe close/escape
    behavior, without clicking sign-in or bypassing auth;
  - locator fallback handles missing `evaluate` and unsupported relative
    ancestor locators;
  - Expedia retry forensics classifies OpenAI 403 `model_not_found` as local
    runtime env/project mismatch, not Expedia runtime evidence.
- Verified `npx vitest run lib/__tests__/expedia-flight-card-match.test.ts
  lib/__tests__/expedia-retry-analysis.test.ts` 29/29,
  `npx tsc --noEmit --pretty false`, strict `npm run check-drift`, and
  `npm run gate:phase1 -- --allow-known-drift` 9/9
  (`phase1-quality-gate-2026-05-05T03-53-34-308Z.json`).
- Safety boundary preserved during Codex integration: no live provider/OpenAI/
  browser automation, worker start, DB mutation, payment, CVV/security-code,
  OTP/CAPTCHA/login handling, or final confirmation.
- Flight closure is still not complete. A new single controlled Expedia retry
  is now technically justified after explicit founder approval; it must either
  reach checkout/manual-review safe handoff or produce current actionable
  candidate evidence without retry loops.

Previous completed pass:
- Integrated Goal `codex/goal-phase-closure-evidence-pack @ 9b43a65` as
  `aa034b3`, with a Codex follow-up wording correction in this integration
  worktree.
- New integrated capability:
  - `docs/00-start-here/PHASE_CLOSURE_EVIDENCE_PACK.md`;
  - `lib/phase-closure-evidence/**`;
  - `scripts/phase-closure-evidence.ts`.
- The pack reports Phase 0A blocked on unvalidated Resy provider-path closure,
  Phase 1/1.5 demo-freeze passed but not phase-closed without explicit human
  acceptance, and Phase 2 frozen/not live verified.
- Integration correction: the 2026-05-05 R-030 403 is now described as a
  Claude worktree runtime env/project mismatch, because the founder confirmed
  the intended OpenAI project has `gpt-5.5` access and budget. It remains
  `model_env_transient` / `F-INFRA-MODEL-ACCESS`, not a Resy provider
  regression and not validation of `422abe0`.
- Verified targeted phase-closure/docs tests 28/28,
  `npx tsx scripts/phase-closure-evidence.ts --json`,
  `npx tsc --noEmit --pretty false`, strict `npm run check-drift`,
  `git diff --check`, and `npm run gate:phase1 -- --allow-known-drift` 9/9
  (`phase1-quality-gate-2026-05-05T03-45-44-658Z.json`).
- Safety boundary preserved: no live provider/OpenAI/browser automation,
  worker start, DB mutation, payment, OTP/CAPTCHA/login handling, or final
  confirmation.

Previous completed pass:
- Integrated Claude `claude/r030-2026-05-05-evidence-packaging @ 1f2ec0f` as
  `1ebd09a`.
- This records the 2026-05-05 R-030 retry as an inconclusive
  `model_env_transient` / `F-INFRA-MODEL-ACCESS` worked example:
  - OpenAI Responses API 403 `model_not_found` for `gpt-5.5`;
  - DB source marker and exact Charlie Bird Resy venue URL were correct;
  - `decisionLog=null`, so no provider strategy, fallback, or slot detection
    executed;
  - the `422abe0` Resy recovery patches remain unvalidated by this run.
- Verified targeted operator/closure/docs tests 65/65,
  `npx tsc --noEmit --pretty false`, strict `npm run check-drift`,
  `git diff --check`, and `npm run gate:phase1 -- --allow-known-drift` 9/9
  (`phase1-quality-gate-2026-05-05T03-19-28-446Z.json`).
- Safety boundary preserved during Codex integration: no retry, no env/key
  handling, no provider/runtime/worker/db patch, no payment, CVV/security-code,
  OTP/CAPTCHA/login/verification handling, or final confirmation.

Previous completed pass:
- Integrated Agent2 `codex/flight-live-closure-final @ fa7afc3` on top of the
  current provider-closure final preview as `25d29fb`.
- Source branch outcome:
  - exactly one founder-authorized Expedia MCO -> BNA retry was run by Agent2;
  - it failed before checkout/manual review with provider/runtime selector
    drift, not routing/job-shape failure;
  - no payment, CVV/security-code, OTP/CAPTCHA/login bypass, or final
    confirmation occurred.
- Patch integrated:
  - Expedia flight locator fallback now reads candidate text by capability
    (`evaluate` when available, then attributes/text/ancestor text);
  - price-only wrong-time fallback selection is blocked when a target departure
    time is present;
  - worker provider mirror is byte-aligned;
  - Expedia retry analyzer ignores hard-stop checklist notes when detecting
    observed login/OTP/CAPTCHA boundaries.
- Verified `npx vitest run` for Expedia/runtime/provider-closure targeted tests
  166/166, `npx tsc --noEmit --pretty false`, strict `npm run check-drift`,
  `git diff --check`, and `npm run gate:phase1 -- --allow-known-drift` 9/9
  (`phase1-quality-gate-2026-05-05T02-16-00-971Z.json`).
- `npm run build` was not rerun in this pass because the local C: disk `ENOSPC`
  blocker remains from the previous integration attempt.
- Safety boundary preserved during Codex integration: no live provider/OpenAI/
  browser automation, payment, CVV/security-code, OTP/CAPTCHA/login bypass, or
  final confirmation.

Previous completed pass:
- Integrated three pushed provider-closure final branches on a clean worktree
  from `origin/codex/integrated-preview-20260504 @ bcd2895`:
  - Claude `claude/provider-closure-acceptance-final @ ed46abc` -> `c33b429`;
  - Agent3 `codex/hotel-live-closure-final @ 12b5a0e` -> `7916ff1`;
  - Goal `codex/goal-provider-closure-war-room @ 29ebdc6` -> `7597b12`.
- New integrated capabilities:
  - canonical provider closure acceptance doc plus `/dev/provider-closure`
    lane criteria with `liveVerified: false` locked until evidence is recorded;
  - Booking.com generated task/start prompt no longer asks to fill payment
    information, stops at manual review, and preserves `rooms`;
  - no-live provider closure war-room analyzer/CLI, fixtures, synthetic reports,
    and demo-readiness verdict output.
- Verified targeted provider-closure/operator/docs/hotel tests 124/124,
  `npx tsc --noEmit --pretty false`, strict `npm run check-drift`,
  `git diff --check`, and `npm run gate:phase1 -- --allow-known-drift` 9/9
  (`phase1-quality-gate-2026-05-05T02-07-16-988Z.json`).
- `npm run build` was attempted but blocked by local disk exhaustion
  (`ENOSPC`; C: had about 15 MB free while webpack cache wrote). This matches
  Agent3's build blocker and did not expose a code/build type failure before
  the disk write failed.
- Safety boundary preserved: no live provider/OpenAI/browser automation,
  payment, CVV/security-code, OTP/CAPTCHA/login/verification handling, or final
  confirmation during this integration.

Previous completed pass:
- Integrated four pushed no-live provider closure branches on top of the Resy
  R-030 root-cause patch:
  - Agent2 `codex/flight-runtime-closure @ e151f9f` -> `d2629f1`;
  - Agent3 `codex/hotel-runtime-closure @ 3e22fb0` -> `b6451fa`;
  - Goal `codex/goal-provider-closure-harness @ 6a5890c` -> `adeecfa`;
  - Claude `claude/provider-closure-operator-room @ 51d9726` -> `1700725`.
- New integrated capabilities:
  - Expedia flight runtime closure hardening, visible-card evidence, click
    retry ladder, exact-task preflight CLI;
  - Booking.com hotel runtime boundary classification and safer stop-before-
    payment behavior;
  - shared provider closure schema/preflight/analyze/report CLI;
  - `/dev/provider-closure` operator cockpit linking restaurant, flight, and
    hotel closure evidence.
- Verified targeted closure/runtime tests 138/138, `npx tsc --noEmit --pretty
  false`, `npm run check-drift`, `npm run gate:phase1 -- --allow-known-drift`
  9/9 (`phase1-quality-gate-2026-05-05T01-13-12-289Z.json`), and
  `npm run build`.
- Safety boundary preserved: no live provider/OpenAI call, payment, CVV,
  OTP/CAPTCHA/login bypass, final confirmation, or extra live retry during this
  integration.

Previous completed pass:
- Ran a founder-approved single controlled Resy R-030 live closure attempt:
  task `63ff8d7c-3629-4245-a948-2b7e1d5e15ff`, job
  `e6674a7c-444a-4807-9acc-4983cd3e27f4`, report
  `benchmark/runs/phase0-resy-2026-05-05T00-44-47-385Z.json`.
- The live run stayed inside the safety boundary but did not close Resy. It
  exposed a deterministic runtime/recovery bug: the persisted step contained
  the exact Resy venue URL, but recovery launched a duplicate Resy city-search
  fallback after the failed Resy primary, then clicked a bare `DIV "8:00 PM"`
  time control and let the benchmark call the listing stall
  `no_availability_correct`.
- Patched:
  - recovery skips duplicate Resy fallback when primary already targets Resy;
  - Resy fallback reuses exact Resy venue URLs when present;
  - Resy slot detection rejects bare time controls without availability
    context;
  - Phase 0 benchmark taxonomy separates auth/backend failures and
    listing/date-selection stalls from true no availability;
  - Next route helper export moved off the route surface so route type
    validation stays clean.
- Verified:
  - focused Resy/recovery/benchmark tests pass, 34/34;
  - R-030 dry-run still emits exact Charlie Bird venue URL;
  - `npx tsc --noEmit --pretty false` pass;
  - `npm run check-drift` pass;
  - `git diff --check` pass;
  - `npm run gate:phase1 -- --allow-known-drift` pass, 9/9, run
    `phase1-quality-gate-2026-05-05T01-02-45-537Z.json`.
- Safety boundary preserved: no payment, CVV, OTP/CAPTCHA/login bypass, final
  confirmation, or extra live retry after the patch.

Previous completed pass:
- Integrated the latest no-live runtime closure sidecar batch after the Resy
  R-030 patch, without branch-head merging older bases.
- Cherry-picked Agent2 `codex/flight-live-readiness-pack-v2 @ d4d42a8` as
  `5aabb36`.
- Cherry-picked Agent3 `codex/hotel-live-readiness-pack-v2 @ c2021bb` as
  `084a1d6`.
- Cherry-picked Goal `codex/goal-runtime-closure-consolidation @ d42c8dc` as
  `bd5d15b`.
- Cherry-picked Goal bridge commit `b8cfd8a` as `bb641b7`.
- Cherry-picked Claude `claude/live-transient-failure-operator-polish @
  3e8dc3f` as `a7ed628`.
- Resolved integration conflicts by preserving current Resy runtime fixes,
  current artifact corpus counts, and stricter OpenAI Responses API 5xx
  classification.
- Verified targeted runtime/flight/hotel/artifact/operator tests 209/209,
  artifact bundle templates, fixture inventory, `tsc`, `check-drift`,
  `git diff --check`, and Phase 1 gate 9/9
  (`phase1-quality-gate-2026-05-05T00-13-50-528Z.json`).

Previous completed pass:
- Ran founder-approved Resy R-030 live benchmark twice:
  - first run failed before provider with OpenAI Responses API 500
    (`req_ce42a48137424a938a7893b131416d28`);
  - retry reached Resy/Charlie Bird safely, but returned
    `no_availability_correct` while probe evidence had matching slots.
- Evidence:
  - report `benchmark/runs/phase0-resy-2026-05-04T19-29-48-731Z.json`;
  - job `6288fad7-da82-4cbc-b237-6139710a1ef4`;
  - snapshots under `.debug-screenshots/live/6288fad7-da82-4cbc-b237-6139710a1ef4`;
  - local extracted PNGs under `.tmp/r030-live-screenshots`.
- Fixed no-live issues exposed by the run:
  - classify OpenAI Responses API 5xx as `model_or_env_blocked`;
  - reject Resy's top time filter as a slot candidate;
  - use current Resy slugs for New York/Nashville;
  - detect hyphenated Resy city/detail URLs;
  - preserve `time=HHMM` in Resy detail, search, and fallback links.
- Synced `lib/booking-autopilot` and `lib/core` changes to worker mirrors.
- Verified:
  - Resy/deeplink/forensics targeted tests pass, 144/144.
  - Restaurant/debug targeted tests pass, 72/72.
  - `npx tsc --noEmit --pretty false` pass.
  - `npm run check-drift` pass.
  - `git diff --check` pass.
  - `npm run gate:phase1 -- --allow-known-drift` pass, 9/9, run
    `phase1-quality-gate-2026-05-04T19-52-46-820Z.json`.
- Safety boundary preserved: no payment, CVV, OTP/CAPTCHA/login bypass, final
  confirmation, or extra live retry after the patch.

Previous completed pass:
- Cherry-picked Goal `codex/goal-artifact-corpus-consolidation @ bb238b7` as
  `ee5a3d7`.
- Added:
  - `docs/50-product-areas/ARTIFACT_CORPUS_INVENTORY.md`
  - `scripts/list-artifact-fixtures.ts`
  - `lib/__tests__/artifact-fixture-corpus.test.ts`
- Current no-live fixture corpus count: 27 total fixtures, split as
  restaurant 10, Expedia 8, hotel 9.
- Verified:
  - Forbidden-path audit pass.
  - Corpus/artifact tests pass, 98/98.
  - `npx tsx scripts/list-artifact-fixtures.ts` pass, 27 fixtures.
  - `npx tsc --noEmit --pretty false` pass.
  - `npm run check-drift` pass.
  - `git diff --check` pass.
  - `npm run gate:phase1 -- --allow-known-drift` pass, 9/9, run
    `phase1-quality-gate-2026-05-04T18-42-51-926Z.json`.
  - Full `npm run gate:phase1 -- --allow-known-drift --include-smoke --include-e2e`
    pass, 12/12, run
    `phase1-quality-gate-2026-05-04T18-44-11-060Z.json`.
  - `npx tsx scripts/check-demo-freeze.ts` pass with verdict `ready`.
  - Production `next start` probe returned 200 for 13/13 demo routes:
    `/`, `/tasks`, `/dev`, `/dev/demo-readiness`, `/dev/demo-control-room`,
    `/dev/runtime-forensics`, `/dev/phase1-quality-gates`, `/dev/founder-e2e`,
    `/dev/restaurant-readiness`, `/dev/resy-run-analysis`,
    `/developers/docs/api/v1`, `/pricing`, and `/permissions`.

Previous completed pass:
- Cherry-picked Agent2 `codex/phase2-unified-artifact-cli @ 0082e6e` as
  `eb49aed`, adding `scripts/analyze-provider-artifact.ts` and shared tests for
  routing no-live Expedia, hotel, and restaurant artifact bundle analysis.
- Cherry-picked Agent3 `codex/track-c-demo-freeze-hardening @ 3ad48ed` as
  `3ad87bf`, hardening active demo docs and static guards around the no-live
  demo safety boundary.
- Cherry-picked Claude `claude/new-agent-startup-contract @ e5edba8` as
  `8a4c5bd`, adding
  `docs/10-coordination/NEW_AGENT_STARTUP_CONTRACT.md` and wiring it into the
  multi-agent protocol/docs index.
- Verified:
  - Forbidden-path audit pass for all three branches.
  - Artifact analyzer/CLI tests pass, 49/49.
  - Docs/demo static guards pass, 24/24.
  - Unified restaurant CLI fixture output pass.
  - `npx tsx scripts/check-demo-freeze.ts` pass with verdict `ready`.
  - `npx tsc --noEmit --pretty false` pass.
  - `npm run check-drift` pass.
  - `git diff --check` pass.
  - `npm run gate:phase1 -- --allow-known-drift` pass, 9/9, run
    `phase1-quality-gate-2026-05-04T18-31-28-191Z.json`.
  - Full `npm run gate:phase1 -- --allow-known-drift --include-smoke --include-e2e`
    pass, 12/12, run
    `phase1-quality-gate-2026-05-04T18-34-31-750Z.json`.
  - `npm run build` pass.
  - Production `next start` probe returned 200 for 13/13 demo routes:
    `/`, `/tasks`, `/dev`, `/dev/demo-readiness`, `/dev/demo-control-room`,
    `/dev/runtime-forensics`, `/dev/phase1-quality-gates`, `/dev/founder-e2e`,
    `/dev/restaurant-readiness`, `/dev/resy-run-analysis`,
    `/developers/docs/api/v1`, `/pricing`, and `/permissions`.

Previous completed pass:
- Cherry-picked Goal `codex/goal-phase0-restaurant-artifact-pack @ 6691bf9` as
  `c1f41a6`, adding a pure no-live restaurant artifact analyzer for
  Resy/OpenTable evidence bundles.
- Added:
  - `lib/runtime-forensics/restaurant-artifact-analysis.ts`
  - `scripts/analyze-restaurant-artifact.ts`
  - synthetic restaurant artifact fixtures under
    `lib/runtime-forensics/__fixtures__/restaurant-artifact-analysis/`
  - `docs/20-phase0-restaurant/RESTAURANT_ARTIFACT_ANALYSIS.md`
  - restaurant runbook links/updates.
- Verified:
  - Forbidden-path audit pass.
  - `npx vitest run lib/__tests__/restaurant-artifact-analysis.test.ts` pass,
    19/19.
  - `npx tsx scripts/analyze-restaurant-artifact.ts lib/runtime-forensics/__fixtures__/restaurant-artifact-analysis/resy-modal-disabled-details-api-failed.json`
    pass.
  - `npm run gate:phase1 -- --allow-known-drift` pass, 9/9, run
    `phase1-quality-gate-2026-05-04T18-13-37-295Z.json`.
  - `npm run build` pass.
  - `git diff --check` pass.

Previous completed pass:
- Cherry-picked Agent2 `codex/phase2-goal-hotel-analyzer-port @ ee8f9d5` as
  `30892a3`, recording the hotel analyzer port verification in Phase 2
  coordination docs.
- Cherry-picked Agent3 `codex/track-c-demo-freeze-checker @ cb499a3` as
  `5334000`, adding the no-live demo freeze checker script and preserving the
  existing YC operator card/runbook docs.
- Cherry-picked Claude `claude/multi-agent-conflict-protocol @ bbccf87` as
  `7e66950`, adding `docs/10-coordination/MULTI_AGENT_PROTOCOL.md` and
  splitting the docs static guard tests by domain.
- Resolved shared-doc conflicts by preserving current integrated history,
  porting new invariants into the split docs static guard tests, and avoiding
  stale branch-head merges.
- Verified:
  - Demo freeze/docs guard tests pass, 24/24.
  - Hotel/Expedia/runtime-forensics analyzer tests pass, 75/75.
  - `npx tsc --noEmit --pretty false` pass.
  - `npm run check-drift` pass.
  - `git diff --check` pass.
  - Full `npm run gate:phase1 -- --allow-known-drift --include-smoke --include-e2e`
    pass, 12/12, run
    `phase1-quality-gate-2026-05-04T18-02-09-646Z.json`.
  - `npx tsx scripts/check-demo-freeze.ts` pass with verdict `ready`.
  - `npm run build` pass.
  - Production `next start` probe returned 200 for 13/13 demo routes:
    `/`, `/tasks`, `/dev`, `/dev/demo-readiness`, `/dev/demo-control-room`,
    `/dev/runtime-forensics`, `/dev/phase1-quality-gates`, `/dev/founder-e2e`,
    `/dev/restaurant-readiness`, `/dev/resy-run-analysis`,
    `/developers/docs/api/v1`, `/pricing`, and `/permissions`.

Previous completed pass:
- Cherry-picked Agent2 `codex/phase2-goal-review-pack @ 3de606d` as
  `45efc1c`, adding `docs/10-coordination/phase2-goal-review.md`.
- Cherry-picked Goal `codex/goal-phase2-no-live-consolidation-v2 @ 6bfe5a2`
  as `98473e9`, adding only the reduced no-live hotel analyzer pack and
  `docs/10-coordination/goal.md`.
- Cherry-picked Agent3 `codex/track-c-demo-operator-pack @ 6dd005e` as
  `2d56e6f`, adding `docs/40-phase1/YC_DEMO_OPERATOR_CARD.md` and demo docs
  guards.
- Cherry-picked Claude `claude/docs-ia-post-freeze-index @ b1ddda2` as
  `9b83153`, refreshing docs IA and post-freeze summary docs.
- Verified:
  - Hotel/Expedia/runtime-forensics analyzer tests pass, 75/75.
  - Demo evidence/static guard tests pass, 22/22.
  - `npx tsc --noEmit --pretty false` pass.
  - `npm run check-drift` pass.
  - `git diff --check` pass.
  - `npm run gate:phase1 -- --allow-known-drift` pass, 9/9, run
    `phase1-quality-gate-2026-05-04T17-37-20-323Z.json`.
  - `npm run build` pass.
  - Production `next start` probe returned 200 for 13/13 demo routes:
    `/`, `/tasks`, `/dev`, `/dev/demo-readiness`, `/dev/demo-control-room`,
    `/dev/runtime-forensics`, `/dev/phase1-quality-gates`, `/dev/founder-e2e`,
    `/dev/restaurant-readiness`, `/dev/resy-run-analysis`,
    `/developers/docs/api/v1`, `/pricing`, and `/permissions`.

Previous completed pass:
- Cherry-picked Agent2 `codex/phase2-hotel-artifact-audit @ 354b4f3` as
  `0bdccf8`, adding hotel no-live audit/runbook docs plus a synthetic
  Booking.com hotel runtime-forensics fixture.
- Cherry-picked Agent3 `codex/track-c-demo-acceptance-pack @ da0dbd6` as
  `eb807f4`, adding the demo freeze acceptance runbook and read-only
  `/dev/demo-readiness` Phase 2 posture copy.
- Cherry-picked Claude `claude/phase1-doc-cleanup-after-freeze @ d5805e1`
  as `db0aef8`, refreshing Phase 1 post-freeze docs and static guards.
- Avoided merging stale branch heads for Claude/Agent3; resolved coordination
  conflicts by keeping current integrated history plus the new sidecar entries.
- Verified:
  - Runtime-forensics fixture/classifier tests pass, 122/122.
  - Demo evidence/static guard tests pass, 18/18.
  - `npx tsc --noEmit --pretty false` pass.
  - `npm run check-drift` pass.
  - `git diff --check` pass.
  - `npm run build` pass.
  - Full `npm run gate:phase1 -- --allow-known-drift --include-smoke --include-e2e`
    pass, 12/12, run
    `phase1-quality-gate-2026-05-04T17-17-47-721Z.json`.
  - Production `next start` probe returned 200 for 13/13 demo routes:
    `/`, `/tasks`, `/dev`, `/dev/demo-readiness`, `/dev/demo-control-room`,
    `/dev/runtime-forensics`, `/dev/phase1-quality-gates`, `/dev/founder-e2e`,
    `/dev/restaurant-readiness`, `/dev/resy-run-analysis`,
    `/developers/docs/api/v1`, `/pricing`, and `/permissions`.

Previous completed pass:
- Cherry-picked Agent2 `codex/phase2-expedia-artifact-cli @ 4c04936` as
  `465ec79`, adding:
  - `scripts/analyze-expedia-retry-artifact.ts`
  - `docs/50-product-areas/EXPEDIA_RETRY_ARTIFACT_TEMPLATE.json`
  - CLI helper tests for artifact-bundle analysis.
- Cherry-picked Agent3 `codex/track-c-demo-readiness-v2 @ fd7d231` as
  `07d3fc4`, adding:
  - `formatDemoReadinessMarkdown()`
  - read-only markdown export on `/dev/demo-readiness`
  - stronger demo hard-stop tests and YC runbook ordering.
- Avoided merging either branch head because both were based behind `4d6d991`
  and would have reverted the optional Clerk/profile payment-field fixes.
- Verified:
  - Expedia artifact CLI/analyzer tests pass, 17/17.
  - Demo evidence/static guard tests pass, 15/15.
  - `npx tsc --noEmit --pretty false` pass.
  - `npm run check-drift` pass.
  - `git diff --check` pass.
  - `npm run build` pass.
  - Full `npm run gate:phase1 -- --allow-known-drift --include-smoke --include-e2e`
    pass, 12/12, run
    `phase1-quality-gate-2026-05-04T16-58-20-533Z.json`.
  - Production `next start` probe returned 200 for 13/13 demo routes:
    `/`, `/tasks`, `/dev`, `/dev/demo-readiness`, `/dev/demo-control-room`,
    `/dev/runtime-forensics`, `/dev/phase1-quality-gates`, `/dev/founder-e2e`,
    `/dev/restaurant-readiness`, `/dev/resy-run-analysis`,
    `/developers/docs/api/v1`, `/pricing`, and `/permissions`.

Previous completed pass:
- Closed the Phase 1/1.5 demo-freeze gate on integrated preview.
- Fixed the final P0 from the full gate:
  - `/api/v1/users/me/profile` now rejects payment fields before auth/DB work.
  - The denylist includes `card_number`, `card_expiry`, `card_name`,
    `billing_address`, `cvv`, `cvc`, `card_cvv`, `card_cvc`, and
    `security_code`.
  - Missing Clerk config is treated as anonymous for optional booking-job and
    profile routes, preventing local demo stderr noise from `auth()` when the
    no-op proxy is active.
- Verified:
  - `npx vitest run lib/__tests__/optional-clerk-user.test.ts lib/__tests__/profile-patch.test.ts lib/__tests__/booking-jobs-db-errors.test.ts lib/__tests__/founder-e2e-runner.test.ts lib/__tests__/founder-e2e.test.ts`
    pass, 144/144.
  - `npx tsc --noEmit --pretty false` pass.
  - Full `npm run gate:phase1 -- --allow-known-drift --include-smoke --include-e2e`
    pass, 12/12.
  - `npm run build` pass.
  - Production `next start` probe returned 200 for 13/13 demo routes:
    `/`, `/tasks`, `/dev`, `/dev/demo-readiness`, `/dev/demo-control-room`,
    `/dev/runtime-forensics`, `/dev/phase1-quality-gates`, `/dev/founder-e2e`,
    `/dev/restaurant-readiness`, `/dev/resy-run-analysis`,
    `/developers/docs/api/v1`, `/pricing`, and `/permissions`.

Previous completed pass:
- Selectively integrated Agent3 `codex/track-c-demo-readiness @ f3c44b3` onto
  latest integrated preview. Kept:
  - `app/dev/demo-readiness/page.tsx`
  - `lib/demo-evidence/**`
  - `lib/__tests__/demo-evidence.test.ts`
  - `/dev` landing card for Demo Readiness
  - small docs index/status/coordination updates
- Skipped duplicate `YC_DEMO_RUNBOOK.md`, duplicate `track-c.md`, and duplicate
  static guard test content that already landed in `82ec398`.
- Removed the production-only page gate from `/dev/demo-readiness`; this is a
  read-only demo route and must work in production preview like
  `/dev/demo-control-room`.
- Verified:
  - `npx vitest run lib/__tests__/demo-evidence.test.ts lib/__tests__/docs-static-guard.test.ts`
    pass, 11/11.
  - `npx tsc --noEmit --pretty false` pass.
  - `npm run gate:phase1 -- --allow-known-drift` pass, 9/9.
  - `npm run build` pass.
  - production `next start` probe returned 200 for `/dev`,
    `/dev/demo-readiness`, `/dev/demo-control-room`, `/dev/runtime-forensics`,
    `/dev/phase1-quality-gates`, `/dev/founder-e2e`, `/tasks`, and `/`.

Previous completed pass:
- Integrated Agent2 `codex/phase2-expedia-retry-analysis-pack @ 005e638` onto
  current integrated preview as `687c0b3` instead of merging its older
  `400a716` base. The pack adds:
  - `lib/runtime-forensics/expedia-retry-analysis.ts`
  - 5 synthetic no-live Expedia retry fixtures
  - `lib/__tests__/expedia-retry-analysis.test.ts`
  - runbook instructions for classifying a future founder-approved controlled
    Expedia retry from DB/log/screenshot artifact bundles.
- Added Track C YC demo readiness pack directly because the sidecar had not
  completed the implementation yet:
  - `docs/40-phase1/YC_DEMO_RUNBOOK.md`
  - `docs/10-coordination/track-c.md`
  - `lib/__tests__/docs-static-guard.test.ts`
  - `/dev/demo-control-room` links to the YC runbook and states Phase 2 is not
    live verified.
- Verified:
  - targeted Vitest 80/80 for Expedia retry analysis, docs static guard, and
    Demo Control Room modules.
  - `npx tsc --noEmit --pretty false` pass.
  - `npm run gate:phase1 -- --allow-known-drift` pass, 9/9.
  - `npm run build` pass.
  - `git diff --check` pass, with only CRLF normalization warnings.

Previous completed pass:
- Fixed `/dev/demo-control-room` returning 404 under `next start` production
  preview by removing the page's production-only dev gate. The dashboard is
  read-only: it only reads existing Phase 1/Founder E2E/Phase 2 artifacts and
  exposes a manual `router.refresh()` button.
- Cleaned Demo Control Room ASCII fallback text after mojibake cleanup so
  `-?` and cramped `-text` artifacts do not remain in docs, comments, or demo
  script copy.
- Verified:
  - demo-control-room tests 68/68.
  - `npx tsc --noEmit --pretty false` pass.
  - `git diff --check` pass, with only CRLF normalization warnings.
  - `npm run build` pass.
  - production `next start` probe 12/12 routes returned 200, including
    `/dev/demo-control-room`, `/dev/runtime-forensics`,
    `/dev/phase1-quality-gates`, `/dev/founder-e2e`,
    `/dev/restaurant-readiness`, `/dev/resy-run-analysis`, `/tasks`,
    `/pricing`, `/permissions`, and `/developers/docs/api/v1`.

Previous completed pass:
- Reviewed and cherry-picked Claude UI/dev-tooling branches:
  - `claude/runtime-forensics-ux-polish-v2` feature/doc commits, excluding
    stale `[coord]` commit.
  - `claude/demo-control-room` feature/doc commits, excluding stale `[coord]`
    commits.
- Added:
  - runtime-forensics URL state, fixtures, examples toggle, recommendation
    engine, and dashboard UX v2;
  - `/dev/demo-control-room`, `lib/demo-control-room/**`, and
    `docs/40-phase1/DEMO_CONTROL_ROOM.md`.
- Integration fixes after review:
  - new Demo Control Room files are ASCII-clean;
  - Demo Control Room links Agent2's Expedia controlled retry runbook;
  - runtime-forensics client page imports only client-safe modules, so webpack
    no longer pulls `node:fs` from `loader.ts`.
- Verified:
  - runtime-forensics tests 377/377.
  - demo-control-room tests 68/68.
  - `npm run gate:phase1 -- --allow-known-drift` pass, 9/9.
  - `npm run build` pass.

Previous completed pass:
- Reviewed and cherry-picked Agent2 sidecar branches:
  - `0eef0d3 docs(phase2): add Expedia controlled retry evidence`
  - `5499949 test(forensics): classify Expedia card-scan signals`
  - `24def46 test(forensics): render Expedia card-scan report signals`
- Added/merged:
  - `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`
  - richer `docs/10-coordination/phase2.md`
  - Expedia card-scan/fallback runtime-forensics diagnostic patterns and report
    tests.
- Verified:
  - Expedia evidence tests 7/7.
  - Runtime-forensics tests 219/219.
  - `npm run check-drift` pass.
  - `npm run gate:phase1 -- --allow-known-drift` pass, 9/9.

Earlier completed:
- Made the standard production build pass in the integrated worktree:
  - pinned `package.json` build script to `next build --webpack` because
    Turbopack panics on the Windows worktree `node_modules` junction;
  - moved `deriveRole` from `app/api/decision-session/[id]/route.ts` into
    `lib/decision-session/role.ts`;
  - moved account settings tab exports out of `app/permissions/page.tsx` into
    `app/account/_components/SettingsTabs.tsx`;
  - removed unsupported `size`/`contentType` exports from OG route modules;
  - pointed developer docs pages at `docs/60-api-integrations/**` after docs
    reorg;
  - guarded Clerk-dependent middleware and developer/pricing client UI for
    environments where Clerk is intentionally disabled.
- Verified:
  - `npm run build` pass, including MCP prebuild and SW postbuild.
  - `npx tsc --noEmit --pretty false` pass.
  - `npx vitest run lib/__tests__/decision-room.test.ts` pass, 13/13.
  - `npm run gate:phase1 -- --allow-known-drift` pass, 9/9, no known drift.

Earlier completed:
- Reviewed Agent2 `ef159c7 test(expedia): cover visible flight card shape`.
- Cherry-picked it into integrated preview as `d4eb8c7`.
- Added `docs/10-coordination/phase2.md` as the Phase 2 sidecar coordination
  channel so the sidecar agent does not rely on founder copy/paste for state.
- Verified after merge:
  - Expedia / flight / cend-adapter targeted Vitest 64/64 pass.
  - `npm run check-drift` pass.
  - `npx tsc --noEmit --pretty false` pass.
  - `npm run gate:phase1 -- --allow-known-drift` pass, 9/9, no known drift.
- Reviewed `origin/claude/runtime-forensics-ux-polish-v2`:
  - It is now based on `fc91d44`, so the previous stale-base blocker is fixed.
  - In a hydrated review worktree, `tsc` passed, runtime-forensics tests 371/371
    passed, and Phase 1 gate exited 0.
  - Still blocked from merge because
    `app/api/dev/runtime-forensics/route.ts` re-exports helper functions from a
    Next route module. Remove the route export before merge.

Previously completed:
- Fixed `npm run e2e:founder` under current tsx/CJS execution by moving
  Playwright lazy import into the async runner path.
- Updated stale `npm run smoke:phase1` text assertions to match current demo
  surfaces while keeping route coverage intact.
- Added non-production no-DB fallback for `GET/DELETE /api/booking-jobs`.
  Without `POSTGRES_URL`, local demo now returns empty lists instead of noisy
  Postgres config 500s. `POST /api/booking-jobs` still requires a real DB.
- Generated missing PWA manifest icons and aligned `scripts/generate-icons.mjs`
  with the current Onegent ring/horizon mark.
- Verified:
  - `npm run gate:phase1 -- --allow-known-drift --include-smoke --include-e2e`
    passed with 11 pass, 0 fail, 1 known-existing drift.
  - `npm run smoke:phase1` passed all 6 routes.
  - `npm run e2e:founder` passed all 15 autonomous probes.
  - `/dev`, `/dev/phase1-quality-gates`, `/dev/founder-e2e`,
    `/dev/runtime-forensics`, `/dev/benchmark-runs`, and `/tasks?view=history`
    dogfood passed on local port 3000.

Earlier completed in this pass:

Completed in this pass:
- Merged `origin/claude/integrated-preview-review-20260504` into the
  integrated preview branch. The Claude branch only moved stray root markdown
  files into the `docs/` hierarchy.
- Resolved R2 by merging the fuller root `STRATEGIC_LEDGER.md` into
  `docs/10-coordination/STRATEGIC_LEDGER.md`, updating old paths, and deleting
  the root copy.
- Resolved R3 by replacing stale `docs/10-coordination/claude.md` content with
  an integrated-preview status file that includes the Agent Quickstart,
  Track A/Track B split, current merged Claude branches, and safety rails.
- Fixed integrated preview dev-page crashes caused by client components
  importing server-only filesystem modules:
  - `app/dev/founder-e2e/page.tsx`
  - `app/dev/restaurant-readiness/page.tsx`
  - `app/dev/resy-run-analysis/page.tsx`
  - `app/dev/resy-probe-runs/page.tsx`
- Rewrote mojibaked `docs/00-start-here/PHASE_STATUS.md` as a short ASCII
  status overview.
- Verified local dogfood on `http://127.0.0.1:3001`:
  - `/dev`
  - `/dev/phase1-quality-gates`
  - `/dev/founder-e2e`
  - `/dev/restaurant-readiness`
  - `/dev/resy-run-analysis`
  - `/dev/resy-probe-runs`
  - `/dev/debug-artifacts`
- Verified `npx tsc --noEmit --pretty false`.
- Verified `npm run gate:phase1 -- --allow-known-drift` with 9/9 required
  checks passing.

Provider-runtime side branch:
- Created and pushed `codex/expedia-flight-card-fallback` from
  `origin/codex/openai-chat-model-env`.
- DB evidence showed the latest Expedia flight job had a valid `__source`
  marker and correct params. The active failure was not the legacy-shape worker
  bug; it was Expedia flight-card DOM scan failure while the target Southwest
  card was visible in screenshots.
- The Expedia branch adds a visible-text locator fallback when the bulk card
  scan throws, with targeted Vitest, TypeScript, and drift checks passing.
- Reviewed and integrated `claude/runtime-forensics-workbench @ d5a2d00` via
  cherry-pick, because the branch was based before current Expedia/docs commits.
  Preserved current integrated state and added:
  - `lib/runtime-forensics/**`
  - `/api/dev/runtime-forensics`
  - `/dev/runtime-forensics`
  - runtime forensics tests
  - playbook "where to look" guidance

Next:
- Expedia fallback is merged into integrated preview and verified.
- Runtime forensics is merged into integrated preview and verified.
- Phase 2 revival audit is documented in
  `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md`.
- Runtime-forensics route no longer exports test helpers from a Next route
  module; import helpers from `lib/runtime-forensics` instead.
- If founder approves a controlled runtime check later, retry the same MCO to
  BNA Expedia task and inspect DB/logs/screenshots before making any further
  provider changes.
- Do not run live provider tasks without explicit founder approval.

Historical current-state handoff below:

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

Handed off Phase 0 restaurant execution state in `docs/20-phase0-restaurant/RESTAURANT_PHASE0_HANDOFF.md`.

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
- Added quick/full founder E2E paths, stop conditions, stronger bug template, and R-003 runbook references in `docs/40-phase1/PHASE_1_FOUNDER_E2E.md`.
- Merge preserved Codex-owned `docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md`, `docs/00-start-here/PHASE_STATUS.md`, and `docs/10-coordination/codex.md` corrections.
- Verification after founder E2E polish merge: `npx tsc --noEmit --pretty false` passed. No live calls.
- `origin/claude/phase-status-docs` merged into master as `d0d5d32`.
- Added `docs/00-start-here/PHASE_STATUS.md`, `docs/40-phase1/UI_MIGRATION_MAP.md`, `docs/20-phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md`, and refreshed `docs/40-phase1/PHASE_1_PLAN.md`.
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
| `f9dd0ba` | `merge: land Phase 1 no-token smoke` | Merges Claude `phase-1-e2e-smoke`: `scripts/smoke-phase1.mjs`, `npm run smoke:phase1`, `docs/40-phase1/PHASE_1_E2E_SMOKE.md`, and founder E2E preflight docs. Verified tsc + drift + 350 targeted tests + smoke 6/6 using webpack dev server in Codex symlinked worktree. No live calls. |
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
