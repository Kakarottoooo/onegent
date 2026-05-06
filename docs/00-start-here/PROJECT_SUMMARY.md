# Onegent Project Summary

Last updated: 2026-05-05

Onegent is an AI decision and execution agent for travel and high-consideration
consumer tasks. The current wedge is restaurant booking: prove one provider can
reach a safe human-confirmation point reliably, then expand.

## Current Product Direction

The product is not a generic browser bot. It is a user-facing agent that:

1. Understands a natural-language request.
2. Converts it into structured task parameters.
3. Uses provider-specific execution logic and, when needed, model-assisted
   browser control.
4. Stops before irreversible provider actions such as final booking, payment,
   OTP, CAPTCHA, or account-sensitive confirmation.
5. Shows the user a task surface with logs, screenshots, and safe next actions.

## Active Worktree

The current canonical code line is now `master` after the provider-closure
integration was folded into GitHub:

```text
C:\Users\Gzw19\onegent
branch: master
head: origin/master @ 19a14a9
```

The integration source worktree that produced the verified closure build was:

```text
C:\Users\Gzw19\onegent-provider-closure-integration-20260505
branch: codex/phase-closure-orchestration-20260505
head: 0394c8c
```

Other worktrees may contain stale agents, logs, or branch-local experiments.
Use `master` for the next product/performance pass unless the founder assigns a
specific lane worktree.

## Phase Snapshot

Read `docs/00-start-here/PHASE_STATUS.md` for the detailed table. Short version:

| Phase | Status | Notes |
|---|---|---|
| Phase 0A | Closed via OpenTable | Sirrah OpenTable live dogfood reached final review with phone filled and stopped before final confirmation. |
| Phase 0B | Deferred to batch coverage | Initial restaurant closure is enough for now. Multi-case OpenTable-first coverage comes after each scenario has a stable single-case path. |
| Phase 1 | Initial founder path accepted | Founder dogfood has covered restaurant, hotel, flight, and activity-shaped user prompts through the UI/task/log/screenshot surfaces. Remaining work is bug-fix and performance polish. |
| Phase 1.5 | OK | Quality gate and debug/readiness surfaces are integrated; use them as regression tools rather than blockers. |
| Phase 2 | Initial hotel + flight closure achieved | Booking.com hotel and Expedia flight have reached useful human-review boundaries in founder dogfood. Do not broaden until performance and multi-case coverage are measured. |

## Current Runtime Reality

- OpenTable uses mostly programmatic provider logic and has reached the
  `ready_for_confirmation` / final review boundary in live dogfood. It should
  not auto-submit final confirmation.
- Resy uses Computer Use and provider-specific logic. Availability and IP/network
  behavior can block useful live tests before code is involved; it no longer
  blocks Phase 0A now that OpenTable has closed the restaurant wedge.
- Expedia flight is now an initial closed lane for founder dogfood: worker
  routing, card selection, checkout progression, screenshot stream, and task
  status are good enough for the single-case path. Treat new failures as normal
  product bugs to patch from logs and screenshots.
- Booking.com hotel is now an initial closed lane for founder dogfood after the
  language, guest-form, and manual-review fixes. Treat new failures as normal
  product bugs to patch from current artifacts.
- Provider task cards intentionally compress logs. Debugging must use DB
  evidence, worker logs, and screenshots. See
  `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`.

## Agent Collaboration Model

Codex owns core runtime, provider execution, worker routing, auth/security, live
debugging, and final review/merge. Claude is best used for large UI, dashboard,
docs, testing, and observability surfaces.

The shared coordination home is `docs/10-coordination/`.

## Where To Look Next

- Next near-term priority: performance. The app is usable but page/session
  transitions feel slow in local dogfood. Profile `/`, `/tasks`, room/session
  switching, snapshot polling, and task history queries before adding more
  provider scope.
- Need to know what phase is blocked: `docs/00-start-here/PHASE_STATUS.md`
- Need the new agent read order: `docs/INDEX.md` § "New Agent Read Order"
- Need to continue restaurant execution: `docs/20-phase0-restaurant/RESTAURANT_PHASE0_HANDOFF.md`
- Need to debug provider runtime: `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
- Need to run founder checks: `docs/40-phase1/PHASE_1_FOUNDER_E2E.md`
- Need to operate / extend the demo surfaces:
  `docs/40-phase1/DEMO_CONTROL_ROOM.md`,
  `docs/40-phase1/YC_DEMO_RUNBOOK.md`,
  `docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md`
- Need to triage founder dogfood bugs:
  `docs/40-dogfood/BUG_INBOX.md`
- Need to expand no-live NLU / benchmark coverage:
  `scripts/eval-nlu-routing.ts`,
  `scripts/eval-live-extractor.ts --vertical all --count 120 --gate`,
  `scripts/internal-benchmark.ts --vertical all --mode no-live`, and
  `docs/40-dogfood/BUG_INBOX.md` fixture/case mappings.
- Need to plan a Phase 2 controlled retry:
  `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`,
  `docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md`,
  `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`
- Need cross-agent handoff context:
  `docs/10-coordination/HUDDLE.md`, `docs/10-coordination/codex.md`,
  `docs/10-coordination/claude.md`, `docs/10-coordination/track-c.md`,
  `docs/10-coordination/phase2.md`
- Need historical context: `docs/90-archive/history/PROJECT_SUMMARY_FULL_2026-05-03.md`
