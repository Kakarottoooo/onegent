# Onegent Project Summary

Last updated: 2026-05-04

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

Most recent active debugging has used:

```text
C:\Users\Gzw19\onegent-e2e-20260503
branch: codex/openai-chat-model-env
```

The older root worktree `C:\Users\Gzw19\onegent` may be stale or dirty. Verify
before using it for tests.

## Phase Snapshot

Read `docs/00-start-here/PHASE_STATUS.md` for the detailed table. Short version:

| Phase | Status | Notes |
|---|---|---|
| Phase 0A | In flight | Resy + Computer Use still needs a live slot case to close fill/OTP-safe handoff. |
| Phase 0B | Gated | Restaurant v1 requires Resy suite + OpenTable coverage after 0A. |
| Phase 1 | Mostly shipped | Task UI, profile gap, smoke tests exist; founder/user E2E still drives polish. |
| Phase 1.5 | Starting | Observability, automated QA, and provider debug tooling. |
| Phase 2+ | Frozen | Do not expand verticals until Phase 0/1 are stable. |

## Current Runtime Reality

- OpenTable uses mostly programmatic provider logic and can reach review/OTP
  states. It should not auto-submit final confirmation.
- Resy uses Computer Use and provider-specific logic. Availability and IP/network
  behavior can block useful live tests before code is involved.
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
- Need to continue restaurant execution: `docs/20-phase0-restaurant/RESTAURANT_PHASE0_HANDOFF.md`
- Need to debug provider runtime: `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
- Need to run founder checks: `docs/40-phase1/PHASE_1_FOUNDER_E2E.md`
- Need historical context: `docs/90-archive/history/PROJECT_SUMMARY_FULL_2026-05-03.md`
