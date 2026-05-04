# YC Demo Runbook

> Last updated: 2026-05-04
> Owner: Track C demo readiness
> Scope: five-minute preflight and live-demo script for Phase 0, Phase 1,
> Phase 1.5, and Phase 2 posture.

This is the short operator runbook for a YC-style demo. It assumes the
integrated preview worktree:

```text
C:\Users\Gzw19\onegent-integrated-20260504
```

Do not use this document as approval to start provider production sessions.
Any Expedia, Resy, OpenTable, hotel, payment, OTP, CAPTCHA, login, or
final-confirmation flow still needs explicit founder approval and must stop at
the safe boundary.

## Five-Minute Preflight

Run these checks from the integrated preview worktree:

```powershell
cd C:\Users\Gzw19\onegent-integrated-20260504
git status --short --branch
npm run gate:phase1 -- --allow-known-drift
```

If time allows and a dev server is already available, open:

```text
/dev/demo-readiness
/dev/demo-control-room
/dev/phase1-quality-gates
/dev/founder-e2e
/dev/runtime-forensics
/tasks
/
```

Preflight acceptance:

- `git status` is clean or only contains an intentional current task.
- Phase 1 gate passes.
- `/dev/demo-readiness` opens and gives the compact readiness verdict,
  hard stops, route order, acceptance doc link, and copyable markdown export.
- `/dev/demo-control-room` opens and shows green or yellow cards, not red.
- The Phase 2 panel says Expedia is not live verified.
- No provider production session, payment entry, OTP entry, CAPTCHA solving,
  login shortcut, or final confirmation is launched during preflight.

If any required check is red, do not improvise a live provider demo. Use the
fallback lines below.

## Route-By-Route Demo Order

Use this order when showing the product:

1. `/dev/demo-readiness`
   - Show the compact verdict, blockers/warnings, hard stops, and route order.
   - Open the markdown export if you need a copyable handoff summary.
   - Say: "This is my quick go/no-go page. It does not run anything live."
2. `/dev/demo-control-room`
   - Show the gate cards and hard stops first.
   - Say: "This is my demo cockpit. It tells me what is verified, what is
     only audited, and where the agent must hand control back to me."
3. `/`
   - Start from the chat surface.
   - Prompt with a restaurant or trip request that does not require payment
     on stage unless explicitly approved.
   - Say: "The user describes intent in plain language; Onegent turns it into
     a concrete task with profile and safety checks."
4. `/tasks`
   - Show task history and task lifecycle.
   - Say: "Tasks are not hidden chat magic. Each one has status, evidence,
     and a recoverable audit trail."
5. `/tasks/<taskId>` if a current safe task exists.
   - Show timeline, safe boundary, and handoff state.
   - Do not click final provider confirmation.
6. `/dev/phase1-quality-gates`
   - Show the latest gate artifact.
   - Say: "This keeps us honest. The demo surface is backed by a repeatable
     quality gate, not a manually curated page."
7. `/dev/founder-e2e`
   - Show the manual founder checklist.
   - Say: "This is the human acceptance layer for surfaces automation cannot
     judge well."
8. `/dev/runtime-forensics`
   - Show failure classification and paste-ready reports.
   - Say: "When a provider breaks, we classify it from DB, worker log, and
     screenshots instead of guessing from the UI card."
9. `/dev/restaurant-readiness` or `/dev/resy-run-analysis` only if Phase 0
   restaurant context is needed.
   - Say: "Restaurant live work is probe-first. We do not burn tokens on
     cases that the provider has already made unavailable."

## What To Say By Phase

### Phase 0 - Restaurant Provider Closure

Say:

"Phase 0 is the provider closure layer. OpenTable can already reach safe
contact or confirmation boundaries. Resy is probe-first because the provider
can degrade by network or session. The agent never submits final booking,
payment, OTP, CAPTCHA, or account-sensitive actions."

Do not claim:

- Resy is fully closed.
- Every restaurant provider is production reliable.
- The agent can automatically handle OTP, CAPTCHA, login, or payment.

### Phase 1 - First Paying User Path

Say:

"Phase 1 is the user-facing path: natural language request, profile gap
handling, task creation, task timeline, and safe provider handoff. The current
gate and founder E2E checks are passing in the integrated preview."

Do not claim:

- Every provider path is live verified.
- Payment automation is complete.
- The human no longer needs to confirm irreversible actions.

### Phase 1.5 - Quality And Observability

Say:

"Phase 1.5 is about keeping the system demo-safe: quality gates, founder E2E,
runtime forensics, restaurant readiness, and demo control room. This is what
lets us keep moving without losing state across agents."

Do not claim:

- The dashboards are the source of truth. The artifacts, logs, DB rows, and
  screenshots are the source of truth.

### Phase 2 - Vertical Expansion

Say:

"Phase 2 is frozen for promises, but under audit. Expedia flight is the closest
candidate because the old flow exists and the latest issue has a focused
selector/card-scan evidence path. It is not live verified tonight unless we
explicitly run and classify one controlled retry."

Do not claim:

- Hotel or flight is broadly revived.
- Booking.com or Hotels.com are demo-ready.
- Expedia checkout is verified after the latest fallback without a controlled
  retry artifact.

## Safe Hard Stops

Stop and take over manually if any of these appear:

- OTP, one-time code, SMS, phone verification, or email verification.
- CAPTCHA or bot challenge.
- Login wall or account-sensitive prompt.
- CVV, card number, payment review, or payment submit.
- Final booking, final purchase, final reservation, or irreversible confirm.
- Wrong flight, wrong date, wrong time, wrong restaurant, wrong party size, or
  wrong price selected.

The correct on-stage behavior is to stop, explain the boundary, and either
take over manually or switch to artifact-based explanation.

## Fallback Lines

If provider live is not approved:

"I am not going to run a live provider now because the boundary includes real
accounts and payments. I can show the verified task flow and the artifacts that
tell us exactly where the provider path stopped."

If Resy is degraded:

"This is a provider/session state issue, not a reason to keep clicking. We use
probe and readiness artifacts before spending tokens on another live case."

If Expedia controlled check is not approved:

"Expedia is the closest Phase 2 candidate, but it is not live verified in this
build. The next step is one controlled retry, then classification from DB,
worker log, and screenshots."

If the demo hits OTP, CAPTCHA, login, or payment:

"This is the safe handoff boundary. The agent stops here; I complete the
account or payment step manually."

If the target provider option disappears:

"The provider inventory changed. The agent should stop rather than book the
wrong option."

If the system cannot reach the provider:

"That is a provider or network failure. We classify it separately from a
selector bug before patching."

## Post-Demo Evidence

After a demo, update the closest coordination file:

- `docs/10-coordination/HUDDLE.md` for cross-agent state.
- `docs/10-coordination/track-c.md` for demo readiness work.
- `docs/10-coordination/phase2.md` for Expedia/vertical evidence.

If a provider flow failed, use:

- `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
- `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`
- `/dev/runtime-forensics`

Do not patch from the task UI alone.
