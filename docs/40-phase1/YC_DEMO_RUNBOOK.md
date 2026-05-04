# YC Demo Runbook

Last updated: 2026-05-04

Scope: founder-facing YC demo prep and fallback script. This runbook is
read-only. It does not authorize live provider runs.

## 5-Minute Preflight

Target: finish this before opening the call or recording.

1. Confirm branch and build posture:
   - Worktree: `C:\Users\Gzw19\onegent-integrated-20260504` or the current
     reviewed demo branch.
   - Branch: `codex/integrated-preview-20260504` or the reviewed demo branch.
   - Run: `npm run gate:phase1 -- --allow-known-drift`.
   - If you want a smoke verdict in the dashboard, run:
     `npm run gate:phase1 -- --include-smoke --allow-known-drift`.
2. Open `/dev/demo-readiness`.
   - `blocked` means stop.
   - `needs_attention` means read the warnings and decide whether to show
     fixtures only.
   - `ready` means proceed with the route order below.
3. Open `/dev/demo-control-room`.
   - Confirm Phase 1 gate, founder E2E, and smoke are green or yellow.
   - Copy the safe demo script if you need a speaking outline.
4. Open `/dev/runtime-forensics` in a background tab.
   - Use it only if a provider or runtime artifact needs explanation.
5. State the safety boundary before any live-looking step:
   - "Onegent can fill the path up to a safe handoff. I handle OTP, CAPTCHA,
     payment, login, and the final irreversible confirmation myself."

## Exact Demo Route Order

Use this order. Do not improvise live provider paths unless the founder has
approved that exact live run.

1. `/dev/demo-readiness`
   - Show compact readiness, hard stops, and route order.
2. `/dev/demo-control-room`
   - Show the full evidence dashboard and safe script.
3. `/dev/phase1-quality-gates`
   - Open only if someone asks what the gate actually ran.
4. `/dev/founder-e2e`
   - Open only if someone asks how the founder walkthrough is recorded.
5. `/`
   - Start the product demo from homepage chat.
6. `/tasks?view=history`
   - Show prior task status and auditability.
7. `/dev/runtime-forensics`
   - Fallback route if a provider/runtime artifact needs explanation.

Optional fixture route order when live provider work is not approved:

1. `/tasks/demo-awaiting-profile`
2. `/tasks/demo-awaiting-otp`
3. `/tasks/demo-ready-for-confirmation`
4. `/tasks/demo-failed`

## Fallback Script

Use this if the live route is not approved, provider inventory changes, or the
demo needs to stay fully local.

1. "I am going to show the product path with fixtures first. These fixtures use
   the same task surface and safety copy, but do not touch a live provider."
2. Open `/tasks/demo-awaiting-profile`.
   - Say: "This is the profile gap step. Onegent asks for missing details
     before touching the provider."
3. Open `/tasks/demo-awaiting-otp`.
   - Say: "This is a hard handoff. The agent stops because an OTP belongs to
     the human."
4. Open `/tasks/demo-ready-for-confirmation`.
   - Say: "This is the last-click boundary. The agent has prepared the path,
     but I click the irreversible confirmation."
5. Open `/dev/runtime-forensics`.
   - Say: "When a provider changes or fails, we classify the artifact instead
     of guessing from a compressed task card."
6. Close with:
   - "Tonight's main proof is the user-facing loop plus no-token evidence. Live
     provider retries are separate, explicit, single-run approvals."

## Hard Stops

Stop immediately if any of these appear:

- Payment, CVV, card form, or purchase review.
- OTP, SMS, phone verification, or email code.
- CAPTCHA or bot-check.
- Provider login or account-sensitive wall.
- Final booking, reserve, purchase, or irreversible confirmation.
- Wrong provider card, wrong venue, wrong flight, wrong time, or wrong price.
- Any urge to run a retry loop or broad provider suite.

What to say:

- OTP: "This is the OTP wall. I take over here; the agent does not bypass it."
- Payment: "This is the payment boundary. I handle the card; Onegent does not
  store or submit it."
- CAPTCHA: "This is a provider anti-bot boundary. We do not bypass it."
- Login: "This provider wants a human session. I would log in off-camera, then
  rerun against that warm session."
- Final confirmation: "This is the irreversible click. I click it, not the
  agent."
- Wrong result: "The agent stops rather than booking the wrong thing."

## What Not To Demo

Do not demo these unless a separate owner explicitly approves the exact scope:

- Live Resy provider run.
- Live Expedia controlled retry.
- Broad hotel, flight, restaurant, or activity suite.
- Payment automation or CVV entry.
- OTP, CAPTCHA, or login bypass.
- Final booking or purchase confirmation.
- Worker controls, retry buttons, cron, or one-click live dashboard actions.
- Provider/runtime/core changes from this Track C sidecar branch.

## If Resy Live Is Not Approved

Say:

"Resy live closure is a separate Phase 0A controlled run. For this demo, I am
not spending live provider or OpenAI tokens. I will show the Phase 1 user
surface, the profile gap, the safe OTP/final-confirm handoff, and the current
readiness evidence. If the founder approves a single Resy run later, Codex owns
that exact run and we classify it from DB, worker logs, and screenshots."

Then use fixture route order:

1. `/tasks/demo-awaiting-profile`
2. `/tasks/demo-awaiting-otp`
3. `/tasks/demo-ready-for-confirmation`
4. `/dev/runtime-forensics`

## If Expedia Live Is Not Approved

Say:

"Expedia Flight is a candidate, not live-verified. The controlled retry runbook
exists, but it is not approval to run live. I will not promise flights work live
tonight without that exact founder approval. Booking.com and Hotels.com need
fresh artifacts before any live promise."

Then show:

1. `/dev/demo-readiness`
2. `/dev/demo-control-room`
3. `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`
4. `docs/10-coordination/phase2.md`

## Verification Boundary

Allowed checks:

- `npx tsc --noEmit --pretty false`
- Relevant Vitest suites
- `npm run gate:phase1 -- --allow-known-drift`
- `npm run build` when app/dev or build-sensitive code changes
- `git diff --check`

Not allowed from this runbook:

- Live provider navigation.
- Live OpenAI or Computer Use token spend.
- Payment, OTP, CAPTCHA, or final confirmation.
- Database mutation or booking job creation.
