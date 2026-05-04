# YC Demo Operator Card

> Last updated: 2026-05-04
> Owner: Track C demo operator polish
> Print target: one page, read-only checklist.

This card is for the person driving the demo. It is not approval to start
provider production sessions, enter payment details, enter OTP codes, solve
CAPTCHA, shortcut login, or click final confirmation.

## 30-Second Product Pitch

"Onegent turns a messy travel or restaurant request into a tracked task with
profile checks, provider evidence, and safe handoff boundaries. The user starts
in plain language, the system creates an auditable task, and the operator can
see exactly what is verified, what is only audited, and where a human must take
over before irreversible provider actions."

## Exact Route Order

1. `/dev/demo-readiness`
   - Compact go/no-go, hard stops, route order, useful docs.
2. `/dev/demo-control-room`
   - Full evidence cockpit, safe script, Phase 2 posture.
3. `/dev/phase1-quality-gates`
   - Latest repeatable Phase 1 gate.
4. `/dev/founder-e2e`
   - Founder walkthrough and human acceptance layer.
5. `/`
   - User-facing chat start.
6. `/tasks?view=history`
   - Task history and audit trail.
7. `/dev/runtime-forensics`
   - Artifact explanation if a provider/runtime path stalls.

## Before Opening The Demo

- Branch is the intended integrated preview.
- `npm run gate:phase1 -- --allow-known-drift` passed.
- `/dev/demo-readiness` is not blocked.
- `/dev/demo-control-room` has no unexplained red card.
- Phase 2 wording is "audited / not live-verified."
- No provider production session has been started for preflight.

## Five Fallback Lines

1. "The readiness page is blocked, so I am switching to the evidence view
   instead of pretending this is clean."
2. "This provider boundary involves real account, verification, or payment
   risk, so Onegent stops and the human takes over."
3. "Phase 2 is audited, not live-verified; Expedia is a candidate, not a demo
   promise."
4. "The provider state changed, so the correct behavior is to stop rather than
   choose the wrong option."
5. "The repeatable gate is the source of truth here; I will show the artifact
   and the next fix instead of improvising."

## Hard Stops

Stop immediately if any of these appear:

- OTP, one-time code, SMS, phone verification, or email verification.
- CAPTCHA or bot challenge.
- Provider login or account-sensitive prompt.
- CVV, card number, payment review, or payment submit.
- Final booking, final purchase, final reservation, or irreversible confirm.
- Wrong provider option, wrong date, wrong time, wrong party size, or wrong
  price.
- Any request to start a provider production session without explicit founder
  approval for that exact run.

## Phase 2 Words

Use:

"Phase 2 is audited and not live-verified. Expedia has the closest evidence
path, but it still needs a controlled founder-approved check before any live
demo promise. Booking.com and Hotels.com need fresh artifacts first."

Avoid:

- "Phase 2 is revived."
- "Expedia is demo-ready."
- "Hotels and flights are live-verified."
- "The checkout path is verified."
