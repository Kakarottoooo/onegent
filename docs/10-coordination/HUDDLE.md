# HUDDLE - Shared Working Memory

> Last writer: track-c
> Last updated: 2026-05-04
> Cap: 2000 words. Trim oldest Live activity first.

This file is the short-term shared memory for Codex, Claude, and future coding
agents. Read it after `docs/10-coordination/README.md`. Keep it current but
small.

## Inbox for Codex

- Continue provider/runtime/live debugging only after checking
  `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`.
- Do not stage unrelated dirty provider files when doing docs-only work.

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

- 2026-05-04 codex: fixed `/dev/demo-control-room` production-preview 404 by
  removing the page's production-only dev gate. The page is read-only and safe
  for the integrated preview. Cleaned the new Demo Control Room ASCII fallback
  text so old mojibake does not leave `-?` or cramped `-text` artifacts. Verified
  demo-control-room tests 68/68, root `tsc`, `git diff --check`,
  `npm run build`, and production `next start` route probe 12/12 including
  `/dev/demo-control-room`.
- 2026-05-04 track-c: created sidecar branch
  `codex/track-c-demo-readiness` from
  `origin/codex/integrated-preview-20260504 @ ac34190`. Scope is UI/docs/tests
  only. Added `docs/10-coordination/track-c.md`,
  `docs/40-phase1/YC_DEMO_RUNBOOK.md`, `lib/demo-evidence/**`,
  `/dev/demo-readiness`, and docs/static guards. No provider/runtime/core/live
  files touched; no live provider, OpenAI token, payment, OTP, CAPTCHA, or
  final confirmation run.
- 2026-05-04 codex: cherry-picked Claude runtime-forensics UX v2 and Demo
  Control Room into integrated preview, skipping stale Claude coord commits.
  Added URL filters, static fixtures, recommended evidence, examples toggle,
  `/dev/runtime-forensics` UX v2, and `/dev/demo-control-room`. Fixed follow-up
  integration issues: cleaned new Demo Control Room files to ASCII, linked the
  Expedia controlled retry runbook, and changed runtime-forensics client imports
  so webpack does not pull `node:fs` into the client bundle. Verified
  runtime-forensics tests 377/377, demo-control-room tests 68/68, Phase 1 gate
  9/9, and `npm run build`.
- 2026-05-04 codex: cherry-picked Agent2 Phase 2 evidence and Expedia
  forensics commits into integrated preview:
  `0eef0d3`, `5499949`, `24def46`. Added
  `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`, expanded
  `docs/10-coordination/phase2.md`, and taught runtime-forensics to preserve
  Expedia card-scan/fallback diagnostics without overriding checkout reached
  classification. Verified Expedia/docs tests, runtime-forensics tests 219/219,
  `check-drift`, and Phase 1 gate 9/9.
- 2026-05-04 codex: cleared production build blockers on integrated preview.
  `npm run build` now passes end-to-end using webpack. Fixes included moving
  `deriveRole` out of a Next route module, moving `/permissions` settings tabs
  into `app/account/_components/SettingsTabs.tsx`, removing OG route helper
  exports, updating developer docs to the docs-reorg paths, and making
  Clerk-dependent middleware/developer/pricing UI safe when Clerk env is absent. Verified
  `npm run build`, `npx tsc --noEmit --pretty false`, decision-room tests
  13/13, and Phase 1 gate 9/9.
- 2026-05-04 codex: reviewed and cherry-picked Agent2
  `ef159c7 test(expedia): cover visible flight card shape` into integrated
  preview as `d4eb8c7`. Added `docs/10-coordination/phase2.md` as the Phase 2
  sidecar coordination file. Verified Expedia/flight/cend-adapter tests 64/64,
  `check-drift`, `tsc`, and Phase 1 gate 9/9 all pass. Reviewed Claude
  `runtime-forensics-ux-polish-v2`: branch is now based on `fc91d44`, but has a
  blocking Next route helper export in `/api/dev/runtime-forensics`; do not merge
  until Claude removes it.
- 2026-05-04 codex: resumed Phase 1 demo trunk. Fixed autonomous founder runner
  CJS/top-level-await break, updated stale Phase 1 smoke copy assertions, added
  non-production no-DB fallback for `GET/DELETE /api/booking-jobs`, and generated
  missing PWA icons (`/icon-192.png`, `/icon-512.png`). Verified full Phase 1
  gate with smoke+e2e: 11 pass, 0 fail, 1 known-existing drift; dogfood passed
  `/dev`, `/dev/phase1-quality-gates`, `/dev/founder-e2e`,
  `/dev/runtime-forensics`, `/dev/benchmark-runs`, and `/tasks?view=history`.
- 2026-05-04 codex: completed no-live Phase 2 revival audit for hotel/flight.
  Current finding: Expedia flight is the only plausible tonight demo-adjacent
  Phase 2 candidate; Booking.com hotel and Hotels.com need fresh artifacts
  before live promises. Added
  `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md`. Fixed stale
  cend-adapter test assertion, repaired a Next route export issue in
  `/api/dev/runtime-forensics`, and verified tsc, core/flight tests 82/82,
  runtime-forensics tests 213/213, and Phase 1 gate with known drift allowed.
- 2026-05-04 codex: reviewed and integrated
  `claude/runtime-forensics-workbench @ d5a2d00` via cherry-pick, because the
  branch was based before the latest Expedia/docs integrated commits. Preserved
  current Expedia fallback and docs IA, resolved `claude.md`, and verified
  runtime-forensics tests 213/213, root `tsc`, Phase 1 gate 9/9, and local
  `/dev/runtime-forensics` + `/api/dev/runtime-forensics` dogfood on port 3001.
- 2026-05-04 codex: merged `codex/expedia-flight-card-fallback` into
  `codex/integrated-preview-20260504`. Resolved docs-reorg conflicts by keeping
  `.coordination/codex.md` as a stub and the canonical provider notes in
  `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`. Verified targeted
  Expedia Vitest 17/17, root `tsc`, strict drift, and Phase 1 gate 9/9.
- 2026-05-04 codex: took ownership of local dev server on port 3001 for
  integrated preview dogfood. Fixed client/server import-boundary crashes in
  `/dev/founder-e2e`, `/dev/restaurant-readiness`, `/dev/resy-run-analysis`,
  and `/dev/resy-probe-runs`. Verified `/dev`, all six target dev pages, root
  `tsc`, and `npm run gate:phase1 -- --allow-known-drift` pass.
- 2026-05-04 codex: shipped Expedia fallback fix on
  `codex/expedia-flight-card-fallback`. The legacy-shape worker error was not
  present in the latest DB evidence; the active bug was Expedia flight-card DOM
  scan failure while the target Southwest card was visible.
- 2026-05-04 codex: merged
  `origin/claude/integrated-preview-review-20260504` into
  `codex/integrated-preview-20260504`; it only moved stray root docs into
  `docs/`.
- 2026-05-04 codex: resolved R2/R3 docs cleanup by merging the root
  `STRATEGIC_LEDGER.md` content into
  `docs/10-coordination/STRATEGIC_LEDGER.md`, deleting the root copy, and
  refreshing `docs/10-coordination/claude.md` for integrated preview status.
- 2026-05-04 codex: reorganizing project documentation under `docs/` so new
  sessions can onboard without reading every root markdown file.
- 2026-05-04 codex: root `.coordination/*.md` converted to compatibility stubs;
  canonical coordination files are in `docs/10-coordination/`.
- 2026-05-04 codex: provider runtime debug source of truth is
  `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`.

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
