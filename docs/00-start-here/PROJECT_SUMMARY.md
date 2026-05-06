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

Most recent canonical worktree is the integrated preview:

```text
C:\Users\Gzw19\onegent-integrated-20260504
branch: codex/integrated-preview-20260504
```

Older worktrees (`C:\Users\Gzw19\onegent` root, `onegent-e2e-20260503` for
provider/runtime debugging) may be stale or dirty. Verify before using any of
them for tests.

## Phase Snapshot

Read `docs/00-start-here/PHASE_STATUS.md` for the detailed table. Short version:

| Phase | Status | Notes |
|---|---|---|
| Phase 0A | Closed via OpenTable | Sirrah OpenTable live dogfood reached final review with phone filled and stopped before final confirmation. |
| Phase 0B | Entry gate met | Broaden OpenTable-first restaurant fixtures; keep Resy as a provider/network follow-up lane. |
| Phase 1 | Demo-freeze passed | Phase 1 gate with smoke + autonomous founder E2E is 12/12; production build is clean; production route probe is 13/13. Founder manual walkthrough is the remaining human acceptance gate. |
| Phase 1.5 | Demo-freeze passed | Quality gate, Founder E2E, Runtime Forensics, Demo Control Room, and Track C Demo Readiness are all read-only and integrated. |
| Phase 2 | Frozen, under audit | Expedia flight is the only candidate, not live verified. Booking.com / Hotels.com need fresh artifacts before any live promise. |

## Current Runtime Reality

- OpenTable uses mostly programmatic provider logic and has reached the
  `ready_for_confirmation` / final review boundary in live dogfood. It should
  not auto-submit final confirmation.
- Resy uses Computer Use and provider-specific logic. Availability and IP/network
  behavior can block useful live tests before code is involved; it no longer
  blocks Phase 0A now that OpenTable has closed the restaurant wedge.
- Expedia flight provider is now worker-routed correctly, but flight card
  matching still needs runtime hardening when visible cards are not clicked.
- Provider task cards intentionally compress logs. Debugging must use DB
  evidence, worker logs, and screenshots. See
  `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`.

## Agent Collaboration Model

Codex owns core runtime, provider execution, worker routing, auth/security, live
debugging, and final review/merge. Claude is best used for large UI, dashboard,
docs, testing, and observability surfaces.

The shared coordination home is `docs/10-coordination/`.

## Where To Look Next

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
- Need to plan a Phase 2 controlled retry:
  `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`,
  `docs/50-product-areas/HOTEL_VERTICAL_REVIVAL_AUDIT.md`,
  `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`
- Need cross-agent handoff context:
  `docs/10-coordination/HUDDLE.md`, `docs/10-coordination/codex.md`,
  `docs/10-coordination/claude.md`, `docs/10-coordination/track-c.md`,
  `docs/10-coordination/phase2.md`
- Need historical context: `docs/90-archive/history/PROJECT_SUMMARY_FULL_2026-05-03.md`
