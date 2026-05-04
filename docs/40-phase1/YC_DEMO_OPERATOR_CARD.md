# YC Demo Operator Card

> Last updated: 2026-05-04
> Owner: Track C demo operator polish
> Print target: one page, read-only checklist.

Before the demo, run the no-live freeze checker:

```powershell
npx tsx scripts/check-demo-freeze.ts
```

The checker reads local artifacts and docs only. It does not start providers,
workers, payment, OTP, CAPTCHA, login, retry, or final confirmation flows.

## 30-Second Product Pitch

"Onegent turns a messy travel or restaurant request into a tracked task with
profile checks, provider evidence, and safe handoff boundaries. The user starts
in plain language, the system creates an auditable task, and the operator can
see exactly what is verified, what is only audited, and where a human must take
over before irreversible provider actions."

## Exact Route Order

1. `/dev/demo-readiness`
2. `/dev/demo-control-room`
3. `/dev/phase1-quality-gates`
4. `/dev/founder-e2e`
5. `/`
6. `/tasks?view=history`
7. `/dev/runtime-forensics`

## Five Fallback Lines

1. "The readiness page is blocked, so I am switching to the evidence view."
2. "This provider boundary involves real account, verification, or payment risk."
3. "Phase 2 is audited, not live-verified; Expedia is a candidate, not a demo promise."
4. "The provider state changed, so the correct behavior is to stop."
5. "The repeatable gate is the source of truth; I will show the artifact."

## Hard Stops

- OTP, one-time code, SMS, phone verification, or email verification.
- CAPTCHA or bot challenge.
- Provider login or account-sensitive prompt.
- CVV, card number, payment review, or payment submit.
- Final booking, final purchase, final reservation, or irreversible confirm.
- Wrong provider option, wrong date, wrong time, wrong party size, or wrong price.

## Phase 2 Words

"Phase 2 is audited and not live-verified. Expedia has the closest evidence
path, but it still needs a controlled founder-approved check before any live
demo promise. Booking.com and Hotels.com need fresh artifacts first."
