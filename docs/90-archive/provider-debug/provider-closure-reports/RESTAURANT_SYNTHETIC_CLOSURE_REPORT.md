# Provider Closure Report

Generated from synthetic fixture:
`lib/runtime-forensics/__fixtures__/restaurant-artifact-analysis/opentable-phone-otp-handoff.json`

- **Kind**: `restaurant`
- **Outcome**: `login_otp_boundary` (Login/OTP boundary reached)
- **Confidence**: `high`
- **Provider state**: `opentable_phone_otp_handoff`
- **Runtime class**: `otp_or_login_required`
- **Job id**: `fixture-restaurant-opentable-phone-otp`
- **Provider**: `opentable`
- **Scenario**: `OT-PHONE`
- **Status**: `safe_handoff`

## Summary

Restaurant closure outcome is login/OTP boundary reached. The fixture shows
OpenTable phone verification at a safe handoff boundary, with no final
confirmation click.

## Exact Next Step

Stop at the provider boundary. A human may handle phone verification manually,
but the agent must not bypass or automate login, OTP, CAPTCHA, phone
verification, payment, or final confirmation.

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

- OpenTable phone verification gate reached.
- Phone input was visible beside the Complete Reservation boundary.
- Worker log states no final confirmation click.

## Runtime Signals

- `otp_or_login_required`
- phone verification

## Artifact Paths

- Worker log: `codex-worker.log`
- Screenshot: `worker/.debug-screenshots/opentable-fixture-phone-otp/03-phone-gate.jpg`
- Live snapshot: `.debug-screenshots/live/fixture-restaurant-opentable-phone-otp/snapshot.json`

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
npx tsx scripts/provider-closure.ts report --kind restaurant --artifact lib/runtime-forensics/__fixtures__/restaurant-artifact-analysis/opentable-phone-otp-handoff.json --markdown
```
