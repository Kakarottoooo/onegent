# Phase Status - single-source overview

> For: founder, Codex, Claude, and future agents.
> Last updated: 2026-05-07.
> Read after: `docs/INDEX.md`, `docs/00-start-here/PROJECT_SUMMARY.md`,
> and `docs/10-coordination/HUDDLE.md`.

## TL;DR

Do not enter Phase 2 yet. Stabilize Phase 0, Phase 1, and Phase 1.5 first.

| Phase | Status | Current gate |
| --- | --- | --- |
| Phase 0A - Restaurant provider closure | Closed via OpenTable safe handoff | Sirrah OpenTable live run reached final review with phone filled and stopped before `Complete reservation`. |
| Phase 0B - Restaurant v1 coverage | Entry gate met | Broaden OpenTable-first restaurant fixtures; keep Resy as provider/network follow-up, not a Phase 0A blocker. |
| Phase 1 - First paying user path | Demo-freeze passed | Full Phase 1 gate with smoke and autonomous founder E2E passes 12/12; manual founder walkthrough remains the human acceptance gate. |
| Phase 1.5 - QA and polish | Demo-freeze passed | Quality gate, dev workbenches, production build, and production route probe are passing. |
| Phase 2 - Vertical expansion | Initial dogfood closure reached for hotel, flight, and activity | Expedia flight, Booking.com hotel, and Ticketmaster activity have reached usable review/continue boundaries in founder dogfood; broaden with benchmark coverage before demo promises. |

## Current Verified State

- Integrated preview branch: `codex/integrated-preview-20260504` (canonical;
  contains all merged Phase 0/1/1.5 work plus Phase 2 audit/runbooks).
- 2026-05-04 provider closure integration:
  - Integrated Agent2 `codex/flight-runtime-closure`, Agent3
    `codex/hotel-runtime-closure`, Goal `codex/goal-provider-closure-harness`,
    and Claude `claude/provider-closure-operator-room`.
  - Expedia flight now has card-click/runtime hardening, candidate evidence,
    and exact-task preflight tooling for the MCO -> BNA controlled retry.
  - Booking.com hotel now has runtime boundary classification and safer
    payment-boundary behavior for controlled hotel closure attempts.
  - Shared `scripts/provider-closure.ts` and `/dev/provider-closure` provide a
    no-live preflight/analyze/operator cockpit for restaurant, flight, and
    hotel closure work.
  - Latest quick gate:
    `npm run gate:phase1 -- --allow-known-drift` passed 9/9 at
    `phase1-quality-gate-2026-05-05T01-13-12-289Z.json`, and
    `npm run build` passed with `/dev/provider-closure` registered.
- 2026-05-04 runtime closure integration:
  - A follow-up founder-approved R-030 controlled live run found the remaining
    Resy blocker in recovery/selector logic, not payment/OTP/final-submit
    logic. The stored step had the exact Charlie Bird venue URL, but recovery
    launched a duplicate Resy city-search fallback and the slot detector
    accepted a bare time filter control. Integrated fixes now prevent duplicate
    Resy fallback, preserve exact Resy venue URLs in fallback, reject bare
    time controls without availability context, and classify listing stalls as
    DOM/data failures instead of true no availability.
  - Resy R-030 controlled live investigation is closed for this pass. The
    follow-up patch is merged into integrated preview: OpenAI Responses API 5xx
    is classified as `model_or_env_blocked`, Resy slugs/stage detection are
    current, Resy time-preserving deep links are hardened, and the slot
    detector no longer treats the top time filter as a bookable slot.
  - Agent2 flight, Agent3 hotel, Goal evidence bridge, and Claude operator
    failure taxonomy no-live packs are integrated. Current synthetic artifact
    corpus is 31 fixtures: restaurant 10, Expedia 8, hotel 13.
  - Latest quick gate:
    `npm run gate:phase1 -- --allow-known-drift` passed 9/9 at
    `phase1-quality-gate-2026-05-05T01-02-45-537Z.json`.
- 2026-05-05 OpenTable restaurant live closure:
  - Founder dogfood request: "book Sirrah in New York next Thursday at 8pm
    for 1 person".
  - Job `3bbe2ac4-c4cd-409f-8c11-6a83d2f81485`, session
    `6a5946f9-48ae-487c-a443-ccc78c6327f2`.
  - DB terminal state: `booking_jobs.status=done`,
    `steps[0].status=awaiting_confirmation`, request params Sirrah / New York
    / `2026-05-14` / `20:00` / 1 person.
  - Agent logs ids `2782`-`2785`; final message:
    "Reservation form filled for Sirrah. Open the link to confirm.";
    details `type=job_paused_payment`, `status=paused_payment`.
  - Provider state: OpenTable booking details page showed Sirrah, Thu May 14,
    8:00 PM, 1 person, phone filled, and final `Complete reservation` visible
    but not clicked.
  - Safety: no final reservation click, no payment/CVV/card data, no
    OTP/SMS code entry, no CAPTCHA/login bypass, no account-sensitive action.
  - Verdict: accepted `safe_handoff` / `ready_for_confirmation`. Phase 0A is
    closed via OpenTable; Resy remains a provider/network/IP-limited follow-up
    lane, not the Phase 0A gate.
- 2026-05-07 Ticketmaster activity dogfood closure:
  - Founder dogfood request: "book The Lion King / Broadway in New York on
    May 30".
  - Latest traced job: `46028ee4-c644-4df7-bee5-7bcb7d2713f9`.
  - Runtime path used the existing v1 Ticketmaster provider runtime
    (`ticketmaster-rpa`) through the local Stagehand/Playwright stack, not
    Browser Harness. Browser Harness remains a separate v2 spike/design lane.
  - Evidence from worker/app logs: session cookies were injected, target
    `May 30, 2026 @ 2:00 PM` was parsed, calendar view opened, the May 30
    2:00 PM slot was selected, the right-side `Find Tickets` drawer action was
    clicked from the main Ticketmaster page, and the provider event page was
    reached.
  - Founder confirmed the Ticketmaster path is now closed for initial dogfood.
    Remaining hardening is product/runtime polish: suppress or ignore external
    ad tabs, make the seat-selection checkpoint explicit in the task UI, and
    recover stale `running/loading` jobs if the local browser/CDP session closes.
- 2026-05-08 Stage 0B Ticketmaster Forge lab:
  - The 20-case Ticketmaster Forge Browser Harness lab has a reviewed summary:
    13 safe outcomes, 7 provider-degraded pages, 0 unsafe boundary violations,
    0 wrong-target signals, and 0 remaining `skill_patch_needed` runs.
  - Locale artist pages such as Ticketmaster CA Kacey Musgraves now extract
    real event candidates from `/event/` "Event Info" links and ask the user to
    choose. Ticketmaster `/category/*` Browse 404 pages are classified as
    provider degradation rather than selector drift.
  - Raw `.stage0b-evidence/` screenshots, JSONL, and result files stay local;
    only reviewed rules, tests, and generated summary docs enter git.
- 2026-05-09 Stage 0B SeatGeek Forge lab:
  - The 10-case SeatGeek Browser Harness lab has a reviewed summary after
    no-live runner hardening: 7 safe outcomes, 3 provider-degraded pages,
    0 unsafe boundary violations, 0 wrong-target signals, and 0 remaining
    `skill_patch_needed` runs.
  - The reviewed hardening covered SeatGeek's "How many tickets?" quantity
    modal as a seat-selection hard stop and SeatGeek homepage/listing event
    cards as candidate evidence.
  - Combined Ticketmaster + SeatGeek controlled lab evidence is now 30 runs:
    20 safe outcomes, 10 provider-degraded, 0 unsafe, 0 wrong-target, and
    0 patch-needed. Raw `.stage0b-evidence/` remains local.
- 2026-05-09 Stage 0B StubHub Forge lab:
  - The 10-case StubHub Browser Harness lab ran from founder-provided URLs
    covering performer, category, geography, exact event, and checkout shapes.
  - Canonical result: 5 provider-listing/user-choice outcomes, 4
    seat-selection hard stops, 1 payment/checkout hard stop, 0 provider
    degraded pages, 0 unsafe boundary violations, 0 wrong-target signals, and
    0 remaining `skill_patch_needed` runs.
  - Combined Ticketmaster + SeatGeek + StubHub controlled lab evidence is now
    40 runs: 30 safe outcomes including the explicit payment/checkout hard stop,
    10 provider-degraded pages, 0 unsafe, 0 wrong-target, and 0 patch-needed.
    Raw `.stage0b-evidence/` remains local.
- 2026-05-09 Stage 0B Eventbrite Forge lab:
  - The 10-case Eventbrite Browser Harness lab ran from live public URLs
    covering exact event, city/category listing, and online directory shapes.
  - Canonical result: 6 exact-event-ready outcomes, 3
    provider-listing/user-choice outcomes, 1 single-candidate-ready outcome,
    0 provider-degraded pages, 0 unsafe boundary violations, 0 wrong-target
    signals, and 0 remaining `skill_patch_needed` runs.
  - Combined Ticketmaster + SeatGeek + StubHub + Eventbrite controlled lab
    evidence is now 50 runs: 40 safe outcomes, 10 provider-degraded pages,
    0 unsafe, 0 wrong-target, and 0 patch-needed. Raw `.stage0b-evidence/`
    remains local.
- Historical side branches now folded into integrated preview:
  `codex/openai-chat-model-env` (runtime/debug),
  `codex/expedia-flight-card-fallback` (Expedia visible-card fallback),
  `codex/phase2-expedia-retry-analysis-pack`,
  `codex/phase2-expedia-artifact-cli`,
  `codex/phase2-hotel-artifact-audit`,
  `codex/flight-live-readiness-pack-v2`,
  `codex/hotel-live-readiness-pack-v2`,
  `codex/goal-runtime-closure-consolidation`,
  `claude/live-transient-failure-operator-polish`,
  `codex/track-c-demo-readiness`,
  `codex/track-c-demo-readiness-v2`,
  `codex/track-c-demo-acceptance-pack`.
- 2026-05-04 latest Phase 1/1.5 demo-freeze check:
  - `npm run gate:phase1 -- --allow-known-drift --include-smoke --include-e2e`
    passed with 12 pass, 0 fail, 0 skipped, 0 known-existing drift.
  - `npm run smoke:phase1` passed all 6 routes under a controlled dev server.
  - `npm run e2e:founder` passed all 15 autonomous probes.
  - Fixed the profile PATCH payment-field guard so unauthenticated
    `card_number` / `cvv` payloads return HTTP 400 before auth/DB work.
  - Local demo mode now treats missing Clerk config as anonymous for optional
    booking-job/profile paths instead of logging Clerk middleware 500s.
  - `npm run build` passed, and production `next start` route probe returned
    200 for `/`, `/tasks`, `/dev`, `/dev/demo-readiness`,
    `/dev/demo-control-room`, `/dev/runtime-forensics`,
    `/dev/phase1-quality-gates`, `/dev/founder-e2e`,
    `/dev/restaurant-readiness`, `/dev/resy-run-analysis`,
    `/developers/docs/api/v1`, `/pricing`, and `/permissions`.
- 2026-05-04 Expedia test merge:
  - Agent2's no-live Expedia visible-card-shape regression is merged into
    integrated preview.
  - `npm run check-drift` now passes without a known-drift exception.
  - `npm run gate:phase1 -- --allow-known-drift` passed with 9/9 checks and no
    known-existing drift.
- 2026-05-04 integrated preview verification:
  - `npm run build` passed end-to-end after production build cleanup. The build
    uses `next build --webpack` because the local Windows worktree uses a
    `node_modules` junction that currently trips Turbopack.
  - `npx tsc --noEmit --pretty false` passed.
  - `npm run gate:phase1 -- --allow-known-drift` passed, 9/9 required checks.
  - `/dev`, `/dev/phase1-quality-gates`, `/dev/founder-e2e`,
    `/dev/restaurant-readiness`, `/dev/resy-run-analysis`,
    `/dev/resy-probe-runs`, and `/dev/debug-artifacts` all returned 200 on
    local dogfood.
  - `/dev/runtime-forensics` and `/api/dev/runtime-forensics` returned 200 after
    runtime-forensics integration. Empty artifact state renders cleanly.
  - `/dev/demo-control-room` is integrated as the founder-facing pre-demo
    control room. It is read-only and links Phase 1 gates, runtime forensics,
    hard stops, and Phase 2/Expedia evidence.
  - `/dev/demo-readiness` is integrated as the compact Track C read-only
    readiness sidecar. It summarizes gate/founder/smoke/runtime evidence,
    hard stops, route order, and useful docs links, and points back to
    `/dev/demo-control-room` for the full script.

## Phase 0A - Restaurant Provider Closure

Goal: one restaurant provider flow reaches an accepted safe outcome:
`ready_for_confirmation`, `safe_handoff`, `OTP/login required`, or a correct
no-availability classification. The system must never submit final booking,
payment, OTP, CAPTCHA, or account-sensitive actions automatically.

Completed:

- OpenTable Sirrah live dogfood reached final review / ready-for-confirmation
  with phone filled, then stopped before `Complete reservation`
  (`job=3bbe2ac4-c4cd-409f-8c11-6a83d2f81485`).
- OpenTable can reach checkout/contact boundaries and stop before final submit.
- Resy probe-first protocol exists and is represented in dev dashboards.
- Restaurant readiness surfaces exist:
  - `docs/90-archive/phase0-restaurant/RESY_AVAILABILITY_PROBE_PROTOCOL.md`
  - `docs/90-archive/phase0-restaurant/RESY_LIVE_DEBUG_PLAYBOOK.md`
  - `docs/90-archive/phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md`
  - `/dev/restaurant-readiness`
  - `/dev/resy-probe-runs`
  - `/dev/resy-run-analysis`

Still open / non-blocking follow-up:

- Resy has not closed a live fill/OTP path. Based on founder local testing,
  Resy availability can differ by Wi-Fi/IP versus mobile data, so treat Resy
  as a provider/network follow-up lane rather than the Phase 0A gate.
- The next Resy live action, if needed, should be a single controlled retry of
  a probe-selected case after network conditions are known-good, with the same
  hard stops and fresh artifact capture.
- Before any Resy live spend, use the probe/readiness flow to pick one case
  with real target-window availability.
- Treat repeated Resy API 500s or desktop/mobile network differences as
  provider/network/session degradation, not automatically as provider code bugs.

## Phase 0B - Restaurant v1 Coverage

Goal: broaden from one proven restaurant flow to repeatable Restaurant v1
coverage across Resy/OpenTable fixtures.

Entry gate:

- At least one readiness-recommended Resy case reaches fill/OTP/safe handoff,
  or OpenTable provides an equivalent safe contact/confirmation boundary.

Entry gate is met by the 2026-05-05 Sirrah OpenTable safe handoff. Phase 0B
can now broaden OpenTable-first restaurant fixtures while keeping the same hard
stops and treating Resy as a non-blocking follow-up lane.

## Phase 1 - First Paying User Path

Goal: founder can complete the user-facing flow from chat to task page to safe
provider handoff/confirmation boundary, with profile gap handling and cookie
auth working.

Completed:

- Profile gap handling is wired into homepage chat and task flow.
- Cookie-auth API/proxy path exists.
- Founder E2E checklist and runner exist.
- Phase 1 smoke and quality-gate suites exist.

Still open:

- Founder manual E2E walkthrough remains the final acceptance check.
- OTP resume remains conditional and should only be built when a real Phase 0
  flow proves it is needed.

Primary docs:

- `docs/90-archive/phase1-demo/PHASE_1_FOUNDER_E2E.md`
- `docs/90-archive/phase1-demo/AUTONOMOUS_FOUNDER_E2E.md`
- `docs/90-archive/phase1-demo/PHASE_1_QUALITY_GATE.md`
- `docs/90-archive/phase1-demo/DEMO_CONTROL_ROOM.md`
- `docs/90-archive/phase1-demo/YC_DEMO_RUNBOOK.md`
- `docs/90-archive/phase1-demo/DEMO_FREEZE_ACCEPTANCE.md`

## Phase 1.5 - Quality Gate And Polish

Goal: keep Phase 1 shippable while polishing the issues found during founder
dogfood.

Current state:

- `npm run gate:phase1 -- --allow-known-drift` is the canonical quick verdict.
- `/dev/phase1-quality-gates` reads the latest gate reports.
- `/dev/founder-e2e` is client-safe after import-boundary fixes.
- `/dev/runtime-forensics` is a read-only artifact-based triage workbench for
  provider/runtime failures.
- `/dev/demo-control-room` is a read-only founder demo control room for
  pre-demo status, hard stops, recovery phrases, and Phase 2 posture.
- `/dev/demo-readiness` is a compact read-only Track C supplement for
  build/gate/demo readiness, hard stops, route order, and useful doc links.
- The 2026-05-04 integrated preview dogfood passed all listed dev pages.

When a task lands:

- Update `docs/10-coordination/HUDDLE.md` for short-term handoff.
- Update `docs/10-coordination/codex.md` or `docs/10-coordination/claude.md`
  for agent-specific state.
- Update the closest phase/runbook doc only if the durable operating procedure
  changed.

## Expedia / Flight Runtime Status

The earlier legacy-shape worker error is considered fixed. The latest reproduced
flight failure had a valid `__source` marker and correct Expedia params, but the
provider DOM scan failed while the target Southwest card was visible.

Current fix branch:

- `codex/expedia-flight-card-fallback`
- Merged into `codex/integrated-preview-20260504` on 2026-05-04.
- Adds a visible-text locator fallback when the bulk Expedia flight-card DOM
  scan throws.
- Verified after merge with targeted Vitest, TypeScript, drift check, and Phase
  1 quality gate.

Next step:

- If the founder approves a controlled provider runtime check, retry the same
  MCO to BNA Expedia task and inspect DB, worker log, and screenshots before
  making any further provider changes.
- Phase 2 revival audit lives at
  `docs/90-archive/phase2-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md`.
- Hotel-specific no-live audit lives at
  `docs/90-archive/phase2-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md`.
- Controlled retry checklists:
  `docs/90-archive/phase2-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md` and
  `docs/90-archive/phase2-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`.

## Provider Closure Acceptance

The canonical pass / fail / inconclusive criteria for restaurant, flight, and
hotel provider closure live in
`docs/30-provider-debug/PROVIDER_CLOSURE_ACCEPTANCE.md`. Read this doc before
declaring a closure attempt is closure-pass; tooling passing is not provider
closure passing. Until the acceptance doc records verified live closure for a
lane, that lane in `lib/provider-closure-room/lanes.ts` stays
`liveVerified: false`. Restaurant/OpenTable now has accepted Sirrah evidence;
flight and hotel remain not live verified. The cockpit at `/dev/provider-closure` mirrors the
acceptance partition; the operator failure taxonomy at
`docs/30-provider-debug/FAILURE_TAXONOMY.md` is the 4-class signal layer that
feeds the 8-state outcome partition.

## Phase 2 - Frozen

Do not expand vertical scope or add new live provider work until Phase 0,
Phase 1, and Phase 1.5 are stable enough to dogfood without repeated handoff
confusion.

Allowed while frozen:

- Fix runtime bugs exposed by current founder tasks.
- Improve observability and debug workbenches for existing restaurant/flight
  flows.
- Clean documentation structure and coordination state.

Not allowed while frozen:

- New provider verticals.
- Payment automation.
- OTP/CAPTCHA/login bypass.
- Final booking confirmation automation.
