# Strategic Ledger

Last updated: 2026-05-04

This is the long-lived decision layer for Onegent. Short-term progress belongs
in `docs/10-coordination/HUDDLE.md`, `docs/10-coordination/codex.md`, or
`docs/10-coordination/claude.md`.

Append new decisions instead of silently rewriting old ones. If a decision is
reversed, add a later entry that explicitly supersedes the older one.

## Documentation And Coordination

- 2026-05-04 Docs are organized under `docs/` by purpose. Root markdown should
  stay limited to repo-level entrypoints (`AGENTS.md`, `CLAUDE.md`,
  `README.md`, `CHANGELOG.md`).
- 2026-05-04 New agents start with `docs/INDEX.md`, not with full-codebase
  reading.
- 2026-05-04 Canonical coordination files live in `docs/10-coordination/`.
  Root `.coordination/*` files are compatibility stubs only.
- 2026-05-03 HUDDLE protocol adopted: shared short-term working memory in
  `docs/10-coordination/HUDDLE.md`; read at session start and update before
  push when coordination state changes.
- 2026-05-03 Coordination protocol uses
  `docs/10-coordination/{codex,claude}.md` for per-agent state and file
  ownership.

## Team And Ownership

- 2026-05-03 Role allocation: Codex owns Track A runtime/provider/core/debug
  work; Claude owns Track B UI/dashboard/docs/tests/observability work unless
  explicitly delegated otherwise.
- 2026-05-03 Codex/Claude allocation target is roughly Codex 30-40% and Claude
  60-70%, with Codex reviewing risk surfaces and merges.
- 2026-05-03 R-003 runbook commands and Phase 0A/0B definitions are Codex
  domain; Claude must not modify those execution details.
- 2026-05-03 Every substantial task starts with a rough fastest-time estimate
  and ends with coordination docs updated when state changed.

## Provider Runtime Doctrine

- 2026-05-04 Provider runtime bugs are debugged from DB evidence, worker logs,
  and debug screenshots; task-card UI logs are not enough.
- 2026-05-03 Safe provider stopping points are review, confirmation handoff,
  OTP handoff, payment handoff, or correct no-availability. Do not automate
  payment, OTP, CAPTCHA, or final irreversible confirmation.
- 2026-05-03 No blind live provider runs. Use no-token probes and explicit
  approval before burning model tokens.
- 2026-05-03 Do not introduce third-party browser-agent tools such as MultiOn,
  Skyvern, or browser-use for provider execution.
- 2026-05-02 Computer Use is the default executor direction for Phase 0
  provider hardening. See `docs/90-archive/old-provider-plans/EXECUTOR_V2_PIVOT.md`.

## Phase 0 Restaurant

- 2026-05-03 Phase 0 OTP transitional rule is locked in
  `docs/90-archive/phase0-restaurant/BENCHMARK_RESTAURANT_100.md`.
- 2026-05-03 Q11 R-003 expectedOutcomes use explicit spec broadening in
  `docs/90-archive/phase0-restaurant/BENCHMARK_RESTAURANT_100.md`.
- 2026-05-03 R-003 live smoke checklist and readiness preflight are tracked in
  `docs/90-archive/phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md`.
- 2026-05-03 OTP path D is warm session first, with Gmail OTP resume fallback.
  See `docs/90-archive/phase0-restaurant/WARM_SESSION_STRATEGY.md`.
- 2026-05-03 Phase 0B means Restaurant v1: Resy observed fixture coverage
  target plus OpenTable Phase 0 coverage. See
  `docs/00-start-here/PHASE_STATUS.md`.

## Phase 1 And Phase 1.5

- 2026-05-03 Phase 1 UI shipped to master via the Phase 1 plan and follow-up
  merges. See `docs/90-archive/phase1-demo/PHASE_1_PLAN.md`.
- 2026-05-03 Phase 1 #7 shipped through Path A, Path B, and safety hardening.
  See `docs/90-archive/phase1-demo/PHASE_1_7_SPEC.md`.
- 2026-05-03 Path B hardening landed with helper extraction and focused tests
  in `lib/profile-gap-decision.ts` and `lib/profile-gap-on-save.ts`.
- 2026-05-03 Audit Finding 5 is closed: cancel updates task state.
- 2026-05-03 Q14/Q15 are closed: backend emits canonical profile-gap payloads
  and the client consumes `payload.profile_gap`.
- 2026-05-03 Q13 is wontfix: CRLF drift was a Windows-only false positive.
- 2026-05-03 Phase 1 founder walkthrough has an automated no-token render
  smoke gate via `npm run smoke:phase1`.
- 2026-05-03 Founder E2E walkthrough has Quick and Full paths plus stop
  conditions in `docs/90-archive/phase1-demo/PHASE_1_FOUNDER_E2E.md`.
- 2026-05-04 Phase 1.5 uses two complementary surfaces: autonomous Quality
  Gate (`npm run gate:phase1`) and manual Founder E2E workbench
  (`/dev/founder-e2e`).
- 2026-05-04 Quality Gate verdict ladder is `pass`, `needs_polish`, `fail`,
  and `env_blocked` with CI-friendly exit codes.
- 2026-05-04 `--allow-known-drift` is the correct temporary response to known
  pre-existing Codex-domain drift on Track B branches.
- 2026-05-04 Quality Gate safety rails are non-negotiable: no live OpenAI, no
  provider execution, no payment, no OTP, no CAPTCHA, and no auto server start.
- 2026-05-04 `vitest:flight-time-filter` is a required Phase 1 founder-bug
  canary.

## Phase 2 And Later

- 2026-05-03 Phase 2 vertical expansion is frozen until Phase 0B and Phase 1
  are declared stable.
- 2026-05-03 Product positioning is hybrid: not pure infrastructure and not
  pure consumer-only.
- 2026-05-03 Inspire mode / Daydream Explorer belongs to Phase 3 with a
  curated template gallery, not open-ended free-form generation.
- 2026-05-03 Subscription gamification belongs to Phase 2-3, not the current
  stabilization track.
- 2026-05-03 Data flywheel Layer C waits for at least 100 real bookings.

## Infrastructure

- 2026-04-30 Browserbase Pro upgrade trigger is at least 500 paying users,
  at least $1500/month browser cost, a cofounder, or a seed round.
- 2026-05-03 Do not delete the old UI at the Phase 1 boundary. Use an explicit
  deprecation queue and removal criteria. See
  `docs/90-archive/phase1-demo/UI_MIGRATION_MAP.md`.

