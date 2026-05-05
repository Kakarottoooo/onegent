# Provider Closure Report

Generated from synthetic fixture:
`lib/runtime-forensics/__fixtures__/expedia-retry-analysis/checkout-manual-review-reached.json`

- **Kind**: `expedia-flight`
- **Outcome**: `safe_handoff` (Safe handoff reached)
- **Confidence**: `high`
- **Provider state**: `checkout_manual_review_reached`
- **Runtime class**: `checkout_reached_manual_review`
- **Job id**: `fixture-expedia-checkout-manual-review-reached`
- **Provider**: `expedia`
- **Scenario**: `flight`
- **Status**: `ready_for_confirmation`

## Summary

Expedia flight closure outcome is safe handoff. The fixture shows the locator
fallback matched the target Southwest flight and reached traveler review before
payment.

## Exact Next Step

Record this as safe closure progress, preserve the artifact bundle, and do not
run another live attempt for the same evidence.

## Recommended Controlled Run

No immediate controlled live run is recommended from this artifact; it already
reached an acceptable safe boundary.

## Evidence Sources

- `job_json`: present
- `worker_log_excerpt`: present
- `worker_log_path`: present
- `screenshot_paths`: present
- `live_snapshot_paths`: present
- `analyzer_fixture`: present

## Provider Signals

- Locator fallback matched the target flight card.
- Checkout/traveler review was reached.
- Worker log records a safe handoff before payment.

## Runtime Signals

- `checkout_reached_manual_review`
- safe handoff

## Artifact Paths

- Worker log: `codex-worker.log`
- Screenshot: `worker/.debug-screenshots/flight-rpa-fixture-checkout/03-checkout-review.jpg`
- Live snapshot: `.debug-screenshots/live/fixture-expedia-checkout-manual-review-reached/snapshot.json`

## Hard Stops

- No live provider run from this harness.
- No live OpenAI call from this harness.
- No provider browser automation from this harness.
- No payment, CVV/CVC/security-code, or card-number submission.
- No OTP, CAPTCHA, phone-verification, login, or account-check bypass.
- No final booking, reserve, purchase, or confirmation click.
- No run/retry/live buttons, retry loops, cron jobs, or one-click live controls.

## Re-run This Report

```powershell
npx tsx scripts/provider-closure.ts report --kind flight --artifact lib/runtime-forensics/__fixtures__/expedia-retry-analysis/checkout-manual-review-reached.json --markdown
```
