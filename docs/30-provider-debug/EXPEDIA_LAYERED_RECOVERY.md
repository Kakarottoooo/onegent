# Expedia Flight Layered Recovery

Scope: Expedia flight runtime closure for the controlled MCO to BNA case. This
is a no-live recovery design and regression pack. Do not run provider workflows,
browser booking agents, live OpenAI calls, payment, login, OTP, CAPTCHA,
verification, CVV/security-code, or final confirmation flows from this doc.

## Current L1 Stages

1. Job shape and source marker preflight
   - Required source marker: the booking step must include the modern
     `__source` marker.
   - Required params: origin `MCO`, destination `BNA`, date `2026-06-01`,
     one adult, economy cabin.
   - Failure class: missing marker or wrong params is routing/job shape, not
     Expedia selector drift.

2. Expedia search URL and trip UI
   - Confirm public Expedia flight-search URL has one-way MCO to BNA params.
   - Confirm the date rail is on Monday, June 1, and the trip UI shows one
     traveler/economy.
   - Failure class: wrong URL/date/passenger state is routing or page setup.

3. Soft overlay handling
   - Dismissable member-price, bundle, sign-in promo, and car upsell overlays
     can block card scan.
   - True login-to-continue, OTP, CAPTCHA, payment, CVV, verification, or final
     purchase screens are hard stops.

4. Flight card candidate capture
   - Capture visible candidates before clicking. Each candidate should preserve
     airline, departure/arrival time, route, price, flight number when visible,
     match mode, time delta, price delta, and text fallback.
   - Price is supporting evidence only. It must not select a wrong-time or
     explicit wrong-airline card.

5. Flight card selection/click
   - Strict match: target airline plus flight number or target departure time.
   - Same-airline fallback: target airline plus near target time or flight
     number, with price as tie-breaker.
   - Hidden-airline fallback: allowed only when no explicit different airline is
     present and target time or flight number is defensible.
   - Explicit different-airline cards are not eligible for exact or fallback
     selection, even if time and price match.

6. Fare modal and bundle/review transition
   - After card click, confirm fare modal or review page progress.
   - Bundle/car popup is not checkout. It must be dismissed or classified as a
     blocker with screenshot evidence.

7. Review page continuation
   - `Flight-Information` or `Review your trip` with `Next: Checkout` is still
     review stage, not success.
   - Runtime may continue only to the safe checkout/manual-review boundary.

8. Checkout/manual-review boundary
   - Checkout is reached only when the URL or visible traveler fields match the
     checkout classifier.
   - Traveler form, payment review, login wall, OTP/CAPTCHA, CVV/security-code,
     or final confirmation all stop the automation and require manual review.

9. Artifact closure classification
   - DB row, decision log, worker log, screenshots, current URL, live snapshots,
     and provider closure report are the source of truth.
   - Task UI status is secondary and cannot prove closure by itself.

## Evidence Required For A Correct Flight-Card Match

The minimum defensible match evidence is:

- `booking_jobs.id`, `status`, `provider`, `scenario`, `params`, `steps`,
  `decisionLog`, and source marker.
- Expedia current URL and screenshot before card click.
- Target hints: Southwest, WN 3084, 08:50, MCO to BNA, June 1, one adult,
  economy. Price may drift and is only a supporting signal.
- Candidate evidence dump with at least the top visible candidates.
- Selected candidate evidence showing airline, departure time, route, price,
  flight number or `hidden`, `timeDelta`, `priceDelta`, `fallbackScore`, and
  `differentAirline`.
- Click mode and selector path: DOM rescan, locator fallback, or coordinate
  click.

Correct selection requires target airline evidence, or no explicit different
airline plus exact/near target time or target flight number. A card that matches
only price, or matches time/price while naming another airline, is not a correct
match.

## L2 Eligible Failures

L2 recovery can propose a narrow selector/runtime patch only when L1 evidence is
clean and single-job:

- Card scan throws before fallback while screenshot shows the target card.
- Locator fallback attempts but no match while screenshot shows the target card.
- Fallback matched a defensible card but did not open fare modal, review page,
  checkout, or a hard-stop boundary.
- Bundle/member-price/sign-in promo overlay blocks scan or click and is not a
  true login/verification/payment boundary.
- Review/checkout stage is misclassified, such as `Review your trip` being
  marked as checkout success.
- Candidate dump proves selector drift with clean DB params and no mixed worker
  evidence.

## Non-L2 Failures

Do not run L2 recovery or patch selectors from these states:

- Missing `__source` marker, legacy-shape step, wrong origin/destination/date,
  or wrong passenger/cabin params.
- Mixed worker evidence, multiple worker instances, stale claimed job ids, or
  screenshots/logs from different jobs.
- OpenAI/model/env errors, including local project mismatch, quota, 5xx, or
  missing env names.
- Provider/network 5xx, browser network errors, or Expedia unavailable states.
- No availability, sold-out fare, or target card absent from screenshot.
- Login wall, OTP/CAPTCHA, verification, payment, CVV/security-code, or final
  purchase/confirmation boundary.
- Missing required traveler/profile data that must be supplied by the user.

## Artifact Requirements

Every controlled retry artifact bundle must be single-run and source-of-truth
complete:

- DB row fields: `id`, `task_id`, `provider`, `scenario`, `status`, `params`,
  `steps`, `decisionLog`, `terminalCode`, `terminalReason`, `errorMessage`,
  `created_at`, `updated_at`.
- Worker log excerpt: one worker instance, one claimed job id, Expedia
  `flight-rpa` lines, source marker, candidate dump, selected candidate, current
  URL, and terminal reason.
- Screenshots: search results before click, after scroll, after click,
  fare/review/checkout boundary, and any overlay or hard-stop screen.
- Live snapshots: `.debug-screenshots/live/<job-id>/*.json` when available.
- Provider closure report: `scripts/provider-closure.ts report --kind flight`
  output or equivalent war-room report.
- Sanitization: no credentials, API keys, payment data, CVV, OTP, CAPTCHA, or
  account-sensitive values.

If a bundle contains multiple worker instance IDs or claimed job IDs, classify
it as insufficient evidence and clean worker topology before drawing provider
runtime conclusions.

## Patch Proposal Shape

An L2 selector-drift patch proposal should be small and evidence backed:

```json
{
  "failureClass": "selector_drift",
  "l1Stage": "flight_card_selection",
  "evidenceBundle": ".tmp/expedia-retry-artifact-bundle.json",
  "observed": "visible Southwest card was not selected",
  "expected": "select only a defensible Southwest MCO to BNA candidate",
  "candidateEvidence": [
    "airline=Southwest departure=8:50am route=MCO to BNA price=$241 flightNumber=hidden timeDelta=0 differentAirline=no"
  ],
  "selectorHypothesis": "Expedia hid flight number and price drifted; match should prefer target time over price",
  "files": [
    "lib/booking-autopilot/providers/expedia.ts",
    "worker/src/booking-autopilot/providers/expedia.ts",
    "lib/__tests__/expedia-flight-card-match.test.ts"
  ],
  "tests": [
    "npx vitest run lib/__tests__/expedia-flight-card-match.test.ts"
  ],
  "safetyReview": "No payment, login, OTP/CAPTCHA, CVV, or final confirmation path touched"
}
```

The patch must keep lib/worker mirrors drift-clean, add focused no-live
regression tests, and stop after no-live validation. Any further live retry
requires separate founder approval.
