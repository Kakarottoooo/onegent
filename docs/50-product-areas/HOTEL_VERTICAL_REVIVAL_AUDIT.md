# Hotel Vertical Revival Audit

Last updated: 2026-05-04

Scope: no-live audit of Booking.com, Hotels.com, and Expedia hotel readiness
from latest `origin/codex/integrated-preview-20260504`. This audit uses only
existing docs, tests, fixture data, and static code/log-string search. It does
not authorize a live provider run.

## Safety Boundary

- Do not submit payment.
- Do not enter CVV.
- Do not bypass OTP, CAPTCHA, login, phone verification, or provider account
  checks.
- Do not click final booking, reserve, purchase, or confirmation controls.
- Do not run live Booking.com, Hotels.com, or Expedia hotel without explicit
  founder approval for exactly one controlled retry.

## Executive Summary

Hotel architecture exists, but the hotel vertical is not demo-verified.

- Booking.com is the primary hotel provider path.
- Hotels.com exists as an Expedia Group checkout-compatible fallback path.
- Expedia hotel support exists inside the Expedia provider and URL builder,
  but there is no current fresh artifact proving it reaches checkout.
- Current Phase 2 posture remains `needs fresh artifacts before live promises`
  for Booking.com and Hotels.com.
- No hotel live run was executed for this audit.

## Evidence Sources

Read-only sources used:

- `docs/50-product-areas/PHASE2_VERTICAL_REVIVAL_AUDIT.md`
- `docs/10-coordination/phase2.md`
- `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
- `lib/agent/planners/booking-links.ts`
- `lib/__tests__/booking-links.test.ts`
- `lib/core/__tests__/cend-adapter.test.ts`
- `lib/__tests__/demo-control-room-phase2-status.test.ts`
- `lib/__tests__/final-outcome-signals.test.ts`
- `lib/booking-autopilot/providers/booking-com.ts`
- `lib/booking-autopilot/providers/hotels-com.ts`
- `lib/booking-autopilot/providers/expedia.ts`
- `lib/booking-autopilot/stagehand-executor.ts`
- `worker/src/booking-autopilot/providers/booking-com.ts`
- `worker/src/booking-autopilot/providers/hotels-com.ts`
- `worker/src/booking-autopilot/providers/expedia.ts`

Current artifact check in this clean branch worktree:

- `codex-worker.log`: not present.
- `benchmark/runs`: no current hotel run artifact found.
- `worker/.debug-screenshots`: no current hotel screenshot artifact found.
- `.debug-screenshots/live`: no current hotel live snapshot artifact found.

## Current Static Readiness

### Booking.com

Status: architecture present; needs fresh artifact.

Static support found:

- `buildBookingComUrl` builds `booking.com/searchresults.html` with
  check-in/check-out date parts, adults, rooms, and hotel-name search text.
- `lib/core/__tests__/cend-adapter.test.ts` covers hotel step reshaping and
  `scenario=hotel` source-marker behavior.
- `booking-com.ts` contains Booking.com URL/stage helpers for search results,
  hotel detail pages, guest details, payment boundary, room reveal, room
  quantity, guest form fill, payment field discovery, and bot patterns.
- `stagehand-executor.ts` contains Booking.com-specific direct hotel URL
  normalization and guest-details/payment final-state guards.
- `final-outcome-signals.test.ts` pins Booking.com no-availability text:
  `sold out` and `fully booked`.
- Demo-control-room Phase 2 tests lock Booking.com status as
  `needs_fresh_artifacts`.

Most likely failure classes before a live retry:

- `profile_gating`: hotel billing/profile fields missing before provider work.
- `provider_no_availability`: target hotel sold out or fully booked.
- `room_selection_drift`: room reveal, selected-date, or room quantity controls
  changed.
- `guest_details_incomplete`: Booking.com stays on guest-details step and
  payment/card fill is correctly blocked.
- `payment_boundary_reached`: safe handoff at final details/payment/CVV.
- `login_captcha_bot_wall`: sign-in, CAPTCHA, bot wall, or phone verification.
- `network_provider_failure`: 5xx, `net::ERR_*`, gateway timeout, blocked
  provider response.

### Hotels.com

Status: fallback path present; needs Booking.com baseline first.

Static support found:

- Provider id is `hotels-com`.
- URL match excludes Expedia even though Hotels.com later redirects through
  Expedia Group checkout/session surfaces.
- Stage signals detect `/search`, `/hotel-search`, hotel detail paths
  (`/ho<digits>` or `/h<digits>`), checkout, guest details, and payment step.
- Guest form fill delegates to Expedia Group guest form helpers.
- Payment form fill delegates to Expedia Group payment helpers.
- Bot patterns include `show us your human side`, `bot or not`, and related
  human-check copy.
- Demo-control-room Phase 2 tests lock Hotels.com status as
  `needs_fresh_artifacts`.

Most likely failure classes before a live retry:

- Search URL drift or Hotels.com result filtering not selecting the intended
  hotel.
- Hotels.com-to-Expedia checkout redirect drift.
- Expedia Group guest/payment helper drift.
- Bot/human-check wall.
- Login/account prompt.
- Provider/network failure.

### Expedia Hotel

Status: provider code path exists; no current hotel artifact.

Static support found:

- `buildExpediaHotelUrl` exists in hotel link generation.
- Expedia provider matches `expedia.com` while excluding Hotels.com.
- Expedia provider detects hotel search, hotel detail, checkout,
  `/checkout/session`, guest details, and payment step.
- Expedia Group guest/payment helpers are shared with Hotels.com.

Most likely failure classes before a live retry:

- Expedia hotel search/detail selectors drifted.
- Checkout session/guest detail detection drifted.
- Shared Expedia Group payment helper drift.
- Member-prices, login, CAPTCHA, or account-sensitive prompt.
- Provider/network failure.

## No-Live Forensics Addition

This branch adds one synthetic Booking.com hotel runtime-forensics fixture:

- `lib/runtime-forensics/__fixtures__/booking-hotel-guest-form-incomplete.json`

It models a safe failure where Booking.com remains on the guest-details step
and the runtime must not proceed to payment/card fill. Expected class:

- `provider_form_incomplete`

This fixture is synthetic only. It is not live evidence.

## Revival Recommendation

Do not live-demo hotel yet.

Minimal hotel revival order:

1. Keep Expedia flight as the only current Phase 2 candidate until its
   controlled retry evidence is read.
2. Prepare Booking.com hotel artifact bundle shape and grep commands.
3. After founder approval, run exactly one Booking.com hotel retry to a safe
   boundary.
4. Classify the retry from DB, worker log, screenshots, and live snapshots
   before patching.
5. Only consider Hotels.com after Booking.com has a current artifact baseline.
6. Treat Expedia hotel as a later Expedia Group checkout compatibility check,
   not as a separate demo promise today.

## Patch Rule

Do not patch provider/runtime from static audit alone.

Patch only after comparing:

1. DB row and step shape.
2. Worker log lines.
3. Provider screenshots.
4. Live snapshot JSON when present.
5. Runtime-forensics classification.

Keep fixes hotel-provider scoped and avoid Booking.com/Hotels.com/Expedia hotel
scope expansion unless the retry evidence clearly points there.
