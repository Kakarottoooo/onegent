# Track C - demo readiness coordination

> Last updated: 2026-05-04
> Branches: `codex/track-c-demo-readiness-v2`,
> `codex/track-c-demo-acceptance-pack`
> Owner: demo readiness sidecar / Codex integration

Track C owns read-only demo readiness docs, static guard tests, and light
founder-facing demo surface polish. It does not own provider/runtime/live code.

## Current Status

Latest integrated work:

- Branch `codex/track-c-demo-readiness-v2` adds a pure markdown export helper
  for `lib/demo-evidence`, renders a read-only markdown export block on
  `/dev/demo-readiness`, and expands demo-evidence tests for markdown export
  plus hard-stop coverage.
- Added `docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md` as the pre-demo acceptance
  pack: latest gate/founder/readiness interpretation, YC 10-minute checklist,
  fallback script, hard stops, and explicit Phase 2 not-live-verified posture.
- Extended the docs static guard around active demo docs for mojibake, unsafe
  live-action/boundary copy, and key runbook existence.
- Lightly polished `/dev/demo-readiness` with the acceptance doc path and an
  explicit Phase 2 not-live-verified notice. No run, retry, live, provider,
  payment, OTP, CAPTCHA, or final-confirmation controls were added.
- Added `docs/40-phase1/YC_DEMO_RUNBOOK.md` as the YC-style five-minute
  preflight and demo script.
- Added a static docs guard test so future agents do not accidentally drop key
  Phase 1 docs or regress developer docs path wiring after the docs reorg.
- Linked the YC runbook from `/dev/demo-control-room` and the Demo Control Room
  runbook.
- Integrated Agent3 `codex/track-c-demo-readiness @ f3c44b3` selectively:
  kept the compact `/dev/demo-readiness` page, `lib/demo-evidence/**`,
  `lib/__tests__/demo-evidence.test.ts`, and the `/dev` landing link. Skipped
  duplicate runbook/static-guard files already present in integrated preview.
  Removed the production-only page gate so the read-only route works in
  production preview.

## Read First

1. `docs/INDEX.md`
2. `docs/00-start-here/PHASE_STATUS.md`
3. `docs/10-coordination/HUDDLE.md`
4. `docs/40-phase1/DEMO_CONTROL_ROOM.md`
5. `docs/40-phase1/YC_DEMO_RUNBOOK.md`
6. `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`

## Allowed Work

- Demo runbooks and founder-facing demo scripts.
- Read-only `/dev` demo surface polish.
- Static documentation guard tests.
- Coordination doc updates under `docs/10-coordination/`.

## Forbidden Work

- No provider/runtime/live implementation changes.
- No live provider runs.
- No payment, CVV, OTP, CAPTCHA, login bypass, or final confirmation.
- No run/retry/live buttons in demo pages.
- No direct edits to stale `C:\Users\Gzw19\onegent` main worktree.

## Handoff Protocol

When Track C finishes a task:

1. Push the branch.
2. Update this file and `docs/10-coordination/HUDDLE.md`.
3. Report only branch + commit hash unless there is a blocker or direction
   question.

Full pasted reports are only needed when the branch is not pushed or Codex
needs to judge a design direction immediately.
