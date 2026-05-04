# Demo Freeze Acceptance

> Last updated: 2026-05-04
> Owner: Track C demo acceptance
> Scope: read-only acceptance checklist for the YC demo freeze.

This document is the final pre-demo acceptance pack. It does not approve
provider execution, production provider sessions, payment entry, OTP entry,
CAPTCHA solving, login shortcuts, or final confirmation.

For the one-page printable operator checklist, use
`docs/40-phase1/YC_DEMO_OPERATOR_CARD.md`.

## How To Read Latest Readiness

Use these in order:

1. `/dev/demo-readiness`
   - Use this as the compact go/no-go page.
   - `ready` means the latest known artifacts are acceptable for a demo.
   - `needs_attention` means inspect warnings before starting.
   - `blocked` means do not start the live demo path.
   - Confirm the hard stops and route order are visible.
2. `/dev/demo-control-room`
   - Use this as the full evidence cockpit and safe script.
   - Green or yellow evidence cards can be explained.
   - Red evidence cards stop the demo path and move to fallback.
3. `/dev/phase1-quality-gates`
   - Latest Phase 1 gate should be pass for a clean demo.
   - `fail` or `env_blocked` is a hard stop.
   - `needs_polish` is acceptable only if the warning is understood and named.
4. `/dev/founder-e2e`
   - Latest founder E2E should show no blocker or P0 issue.
   - Manual founder walkthrough remains the human acceptance gate.
5. `/dev/runtime-forensics`
   - Use only for artifact explanation if a provider/runtime path stalls.
   - Do not treat the task UI alone as the source of truth.

Phase 2 is not live-verified. Expedia is only a candidate with audit and
fallback evidence. Booking.com and Hotels.com still need fresh artifacts before
any demo promise.

## YC Demo 10-Minute Checklist

From the integrated preview worktree:

```powershell
cd C:\Users\Gzw19\onegent-integrated-20260504
git status --short --branch
npm run gate:phase1 -- --allow-known-drift --include-smoke
```

Then open:

1. `/dev/demo-readiness`
2. `/dev/demo-control-room`
3. `/dev/phase1-quality-gates`
4. `/dev/founder-e2e`
5. `/`
6. `/tasks?view=history`
7. `/dev/runtime-forensics`

Accept the freeze only when:

- The branch is the intended integrated preview.
- The latest Phase 1 gate is pass, or every warning is understood.
- Founder E2E has no blocker or P0 issue.
- `/dev/demo-readiness` is not blocked.
- `/dev/demo-control-room` shows the same Phase 2 posture you plan to say.
- No provider production session, payment entry, OTP entry, CAPTCHA solving,
  login shortcut, or final confirmation is started during preflight.

## Failure Fallback Script

If `/dev/demo-readiness` is blocked:

"The demo cockpit is showing a hard stop, so I am switching to the evidence
view instead of pretending the path is clean."

If the Phase 1 gate is red:

"The repeatable gate is red. I will not present this as a clean live path. The
safe thing to show is the artifact, the failure, and the next fix."

If founder E2E has a blocker:

"The founder walkthrough found a blocker. The task flow is not accepted until
that human check is clear."

If Phase 2 is asked about:

"Phase 2 is not live-verified. Expedia is the closest candidate, but tonight it
is an audited path, not a live promise."

If a provider boundary appears:

"This is the handoff boundary. Onegent stops here, and the human completes the
account, verification, payment, or final action manually."

If provider inventory changes:

"The provider state changed. Onegent should stop rather than choose the wrong
option."

## Hard Stops

Stop immediately if any of these appear:

- OTP, one-time code, SMS, phone verification, or email verification.
- CAPTCHA or bot challenge.
- Provider login or account-sensitive prompt.
- CVV, card number, payment review, or payment submit.
- Final booking, final purchase, final reservation, or irreversible confirm.
- Wrong flight, wrong date, wrong time, wrong restaurant, wrong party size, or
  wrong price selected.
- Any request to start a provider production session without explicit founder
  approval for that exact run.

## What Not To Claim

- Do not claim Phase 2 is revived.
- Do not claim Expedia, Booking.com, or Hotels.com is demo-ready.
- Do not claim Resy is fully closed.
- Do not claim payment automation is complete.
- Do not claim the human no longer confirms irreversible provider actions.

## Source Links

- `docs/40-phase1/YC_DEMO_RUNBOOK.md`
- `docs/40-phase1/YC_DEMO_OPERATOR_CARD.md`
- `docs/40-phase1/DEMO_CONTROL_ROOM.md`
- `/dev/demo-readiness`
- `/dev/demo-control-room`
- `/dev/phase1-quality-gates`
- `/dev/founder-e2e`
- `/dev/runtime-forensics`
