# Hotel Layered Recovery

Last updated: 2026-05-07

Scope: no-live design, artifact classification, and tests for hotel L1/L2
recovery. This document does not authorize live Booking.com, Hotels.com, or
Expedia hotel runs.

## Safety Boundary

- Do not automate payment, CVV/CVC/security-code entry, billing submission, or
  final booking confirmation.
- Do not bypass login, sign-in, OTP, SMS/email verification, CAPTCHA, phone
  verification, human checks, or account prompts.
- Stop at guest details, room selection, payment review, login/CAPTCHA, or any
  unclear final/action-sensitive control.
- Preserve DB, worker log, screenshot, live snapshot, URL, and visible-state
  evidence before patching.

## Current L1 Stages

Hotel L1 is the primary provider attempt. Today the expected stages are:

1. `provider_search`: provider search/listing page, result cards, property
   filters, or city-level results.
2. `hotel_detail`: exact hotel page or exact hotel result/card evidence.
3. `room_selection`: room/rate table, room quantity control, selected room,
   or reserve controls before guest details.
4. `guest_review`: guest/contact/traveler/reservation details page before
   payment or final confirmation.
5. `human_boundary`: payment/card/CVV/final control, login, CAPTCHA, OTP,
   verification, account wall, or unclear irreversible control.

L1 can stop successfully at `room_selection`, `guest_review`, or
`human_boundary` when no forbidden action was taken.

## No-Availability Evidence Contract

Do not classify `provider_no_availability` from generic search/listing copy
alone.

True hotel no-availability requires all of:

- Exact hotel evidence: visible/logged hotel name matches the requested hotel.
- Exact stay evidence: check-in, check-out, adult count, and room count match
  the requested stay.
- Exact budget evidence when the task included a budget.
- Scoped inventory evidence: the provider says the exact hotel/stay has no
  rooms, is sold out, fully booked, or unavailable for the selected dates.
- Artifact completeness: DB/job params, bounded worker log, screenshot path,
  live snapshot path, and operator note are present.

Weak no-availability examples:

- Search results say "no properties match your search" without exact hotel
  evidence.
- Search or property copy says "not available" or "nothing available" without
  exact hotel/date/stay proof.
- A city-level result page says "no availability" without the approved dates
  and room/guest counts.
- A worker error says "stuck at listing page" without a hotel detail or room
  evidence trail.
- Provider navigation failed before the target hotel/date/stay could be
  verified.

Weak evidence must be classified as provider/network degraded, selector drift,
or L2 fallback eligible. It must not close the hotel lane as true inventory
unavailable.

## Provider Degraded vs True No Availability

Provider degraded:

- Booking.com, Hotels.com, or Expedia returns 5xx, gateway timeout,
  `net::ERR_*`, blocked provider response, bot/human-check page, or unstable
  network/session behavior.
- Search results are empty but exact hotel/date/stay evidence is absent.
- The model/runtime could not inspect the page, so provider evidence is
  incomplete.

True no availability:

- The artifact shows the exact hotel.
- The artifact shows the exact check-in/check-out/adult/room count.
- The artifact shows scoped inventory copy for that hotel/stay.
- No available room/rate control is visible in screenshots or logs.

If both provider degraded and no-availability text appear, degraded wins unless
the no-availability evidence contract is complete.

## Booking.com to Expedia/Hotels.com Fallback Criteria

Booking.com can be L2-fallback eligible to Hotels.com, then Expedia hotel, only
when no human-only boundary is present and evidence shows one of:

- Weak no-availability evidence.
- Provider selector drift: target hotel visible but not selected, or hotel
  detail not reached.
- Room selection drift: room/rate card visible but selection/scan failed.
- Provider/network degraded: 5xx, timeout, blocked provider response, or
  search/session instability before exact inventory proof.

Hotels.com can fall back to Expedia hotel under the same evidence rules.
Expedia hotel has no further configured L2 provider in this lane.

L2 fallback must preserve the same target hotel, city, dates, adult count, room
count, budget when present, and safety hard stops. It must not be implemented as
an automatic live retry loop.

## Layered Benchmark Contract

`scripts/layered-benchmark.ts --vertical hotel --count 10 --mode no-live`
uses hotel-specific synthetic fixtures. The ten fixtures cover:

- L1 direct pass.
- Exact no-availability with strong evidence.
- Weak/generic no-availability that is provider-degraded and fallback eligible.
- Provider degraded.
- Fallback recommendation preserving hotel, city, check-in, check-out, adults,
  rooms, and budget.
- Room selection drift.
- Guest/review boundary.
- Account/session boundary.
- Artifact incomplete.
- Stale/mixed running evidence classified as insufficient evidence.

Benchmark L2 eligibility means Browser Harness recovery. Hotel provider
fallback eligibility is recorded separately in the hotel contract because weak
no-availability and provider-degraded outcomes can be provider-fallback
eligible while still being Browser Harness L2-ineligible.

## L2 Eligible Failures

- `provider_selector_drift`
- `room_selection_drift`
- `network_provider_failure`
- Weak no-availability evidence

These are eligible only when the artifact has no payment/CVV/final submission,
login bypass, OTP/CAPTCHA bypass, or account-sensitive interaction.

## Non-L2 Failures

- `provider_no_availability` with complete exact hotel/date/stay evidence.
- `room_selection_manual_review_reached`
- `guest_details_manual_review_reached`
- `payment_manual_review_reached`
- `login_or_captcha_boundary`
- `profile_gating`
- `model_env_transient`
- `safety_boundary_violation`
- `insufficient_evidence`

For insufficient evidence, collect the missing DB/log/screenshot/live snapshot
inputs before choosing L2 or a code patch.

## Artifact Checklist

Minimum no-live hotel artifact bundle:

- `job.id`, `job.provider`, `job.scenario=hotel`, `job.status`.
- Exact hotel name, city, check-in, check-out, adults, rooms, and budget when
  present in the task.
- Current provider URL or handoff URL.
- Bounded `workerLogExcerpt`.
- `workerLogPath`.
- At least one screenshot path.
- At least one live snapshot path.
- Operator notes confirming no payment, CVV/CVC, login bypass, OTP/CAPTCHA
  bypass, or final checkout action.

## Implementation Notes

The pure helper is:

```text
lib/runtime-forensics/hotel-layered-recovery.ts
```

It is no-live and artifact-only. It evaluates:

- L1 stage.
- No-availability evidence strength.
- Provider fallback eligibility.
- Artifact completeness.

`lib/runtime-forensics/hotel-retry-analysis.ts` uses the helper so weak
no-availability is not classified as true `provider_no_availability`.
