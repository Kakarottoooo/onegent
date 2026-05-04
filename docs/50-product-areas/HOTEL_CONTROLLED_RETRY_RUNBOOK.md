# Hotel Controlled Retry Runbook

Last updated: 2026-05-04

Scope: Booking.com first, Hotels.com only as a secondary hotel artifact path.
This runbook prepares a future controlled hotel retry. It does not authorize a
live provider run.

## Hard Stops

Stop immediately and capture evidence if any of these appear:

- Payment submission or final purchase confirmation.
- CVV request requiring entry.
- OTP, CAPTCHA, phone verification, login, or account-sensitive prompt.
- Wrong hotel, room, dates, or price selected.
- Provider leaves the expected public search, room selection, guest-details, or
  checkout path.

Never bypass OTP, CAPTCHA, login, or account checks. Never enter CVV. Never
click final booking, payment submission, or purchase confirmation.

## Entry Gate

Before any hotel retry:

1. Confirm founder approval for exactly one hotel retry.
2. Prefer Booking.com first; do not include Hotels.com unless explicitly scoped.
3. Confirm no flight retry, broad hotel suite, retry loop, cron, dashboard
   button, or live automation batch is scheduled.
4. Confirm branch and commit under test.
5. Confirm `npm run check-drift` passes.
6. Confirm profile prerequisites are present or intentionally blocked before
   provider work.
7. Confirm the worker log path before starting.
8. Confirm screenshot and live snapshot directories will be preserved.

If any item is unclear, do not run the provider.

## Evidence To Capture

Database fields:

- `booking_jobs.id`
- `trip_label`
- `status`
- `created_at`
- `updated_at`
- `task_id`
- `steps[0].type`
- `steps[0].status`
- `steps[0].error`
- `steps[0].terminalReason`
- `steps[0].terminalCode`
- `steps[0].handoff_url`
- `steps[0].body.__source`
- `steps[0].body.scenario`
- `steps[0].body.params`
- `steps[0].decisionLog`
- `steps[0].profileGap`

Worker log grep targets:

- `<retry-job-id>`
- `booking-com`
- `hotels-com`
- `hotel`
- `selected-date`
- `select room`
- `room card`
- `guest details`
- `contact details`
- `checkout`
- `payment`
- `CVV`
- `captcha`
- `login`
- `OTP`
- `final`
- `503`
- `net::ERR_`

Screenshot paths:

```text
worker/.debug-screenshots/booking-com-*
worker/.debug-screenshots/hotels-com-*
.debug-screenshots/live/<retry-job-id>/*.json
```

## Artifact Bundle Shape

After the approved retry has completed, assemble a local JSON bundle from the
DB row, worker log excerpt, and artifact paths:

```json
{
  "job": {
    "id": "<retry-job-id>",
    "taskId": "<task-id>",
    "provider": "booking-com",
    "scenario": "hotel",
    "status": "<booking_jobs.status>",
    "errorMessage": "<top-level or step error>",
    "terminalReason": "<step terminalReason if present>",
    "terminalCode": "<step terminalCode if present>",
    "steps": [
      {
        "type": "hotel",
        "status": "<steps[0].status>",
        "error": "<steps[0].error>",
        "terminalReason": "<steps[0].terminalReason if present>",
        "terminalCode": "<steps[0].terminalCode if present>",
        "__source": "<steps[0].body.__source or step.__source>",
        "body": {
          "scenario": "hotel",
          "params": "<copy steps[0].body.params>"
        }
      }
    ],
    "params": "<copy steps[0].body.params>"
  },
  "dbRow": "<optional raw booking_jobs row>",
  "workerLogExcerpt": "<bounded Select-String output from codex-worker.log>",
  "workerLogPath": "C:\\Users\\Gzw19\\onegent-integrated-20260504\\codex-worker.log",
  "screenshotPaths": [
    "C:\\Users\\Gzw19\\onegent-integrated-20260504\\worker\\.debug-screenshots\\booking-com-*"
  ],
  "liveSnapshotPaths": [
    "C:\\Users\\Gzw19\\onegent-integrated-20260504\\.debug-screenshots\\live\\<retry-job-id>\\*.json"
  ],
  "notes": [
    "One founder-approved hotel retry only. No payment, CVV, OTP/CAPTCHA/login bypass, or final booking confirmation."
  ]
}
```

Then run:

```powershell
npx tsx scripts/analyze-phase2-artifact.ts hotel .tmp\hotel-retry-artifact-bundle.json
```

Paste the Markdown output into `docs/10-coordination/phase2.md` before making a
patch decision.

## Success Taxonomy

Acceptable outcomes:

- `payment_manual_review_reached`: checkout/payment review reached, then stopped
  before CVV, payment submission, account bypass, or final confirmation.
- `guest_details_manual_review_reached`: guest/contact/traveler details reached
  and the flow stopped safely for manual review.
- `login_or_captcha_boundary`: provider account or anti-bot boundary reached
  without bypass.
- `profile_gating`: precise profile gap blocks before provider work.
- `network_provider_failure`: provider/network instability with evidence.

Patchable outcomes:

- `room_selection_drift`: screenshot shows valid inventory, but selectors or
  selected-date handling failed before guest details.

Safety outcome:

- `safety_boundary_violation`: stop all retries. Preserve evidence and run a
  separate safety review.

If the analyzer returns `insufficient_evidence`, collect DB/log/screenshot
evidence first. Do not patch from the task card alone.
