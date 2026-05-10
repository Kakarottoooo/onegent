# Hotel Controlled Retry Runbook

Last updated: 2026-05-04

Scope: one Booking.com hotel controlled retry after explicit founder approval.
This runbook prepares the evidence path. It does not authorize a live provider
run by itself.

## Hard Stops

Stop immediately and capture evidence if any of these appear:

- Payment submission or final purchase/reserve confirmation.
- CVV request.
- OTP, CAPTCHA, phone verification, or login wall.
- Provider account-sensitive prompt.
- Wrong hotel, wrong dates, wrong room, wrong guest count, or wrong price
  selected.
- Booking.com, Hotels.com, or Expedia leaves the expected public hotel search,
  detail, guest-details, or checkout path.

Never bypass OTP, CAPTCHA, login, or account checks. Never enter CVV. Never
click final booking, reserve, purchase, or confirmation.

## Exact User Prompt

Use this product-level prompt only after founder approval for exactly one hotel
retry:

```text
Use only public Booking.com pages to prepare a manual hotel booking review.

Target stay:
- Hotel: YOTEL New York Times Square
- City: New York
- Check-in: June 10, 2026
- Check-out: June 12, 2026
- Guests: 1 adult
- Rooms: 1 room

Before any booking-step action, verify that the visible page matches the exact
hotel name, city, check-in date, check-out date, adult count, and room count.

Proceed only through public search/detail/room-selection pages. Stop at the
first safe manual-review boundary and report the current page state, URL, and
visible evidence.

Hard stop immediately if the page asks for or shows:
- payment, card entry, CVV/CVC/security code, billing details;
- login, sign-in, account creation, account verification, OTP, SMS code,
  CAPTCHA, human verification, phone verification, or credentials;
- any final reserve, confirm, complete booking, purchase, pay, or submit
  control.

Do not enter payment details, card details, CVV/CVC/security code, credentials,
OTP, CAPTCHA, verification, or personal account information.

Do not bypass login, verification, CAPTCHA, OTP, or account checks.

Do not click any final reserve, confirm, complete booking, purchase, payment,
or submission control.

If it is unclear whether a button is final, irreversible, account-sensitive, or
payment-related, stop and report the page state instead of clicking.
```

Expected hotel params:

```json
{
  "scenario": "hotel",
  "hotel_name": "YOTEL New York Times Square",
  "city": "New York",
  "checkin": "2026-06-10",
  "checkout": "2026-06-12",
  "adults": 1,
  "rooms": 1
}
```

Expected primary provider:

- Booking.com.

Do not begin with Hotels.com or Expedia hotel unless Booking.com is explicitly
blocked and the founder approves a changed provider target.

## Hotel Runtime Audit Finding

Booking.com is the most demo-adjacent hotel provider for the first controlled
retry. The current static path has Booking.com URL construction, stage helpers,
room selection helpers, guest-details detection, payment-boundary guards, bot
patterns, and no-live runtime-forensics fixtures/tests. Hotels.com remains a
fallback only after Booking.com is explicitly blocked. Expedia hotel should stay
out of scope until a separate founder-approved hotel case exists.

## Runtime Closure Candidate

Primary closure candidate: Booking.com.

Why Booking.com first:

- Current code has Booking.com-specific search-result selection, direct hotel
  URL fallback, room-list reveal, room quantity selection, guest-details
  detection, and final payment boundary guards.
- Current docs and no-live artifact fixtures already name Booking.com as the
  first controlled hotel retry path.
- Hotels.com is still a fallback path until Booking.com is explicitly blocked.
- Expedia hotel should not be used for this closure until a separate approved
  hotel artifact proves it is closer than Booking.com.

The runtime now emits classifier-ready no-live evidence lines when a future
approved run reaches or fails the Booking.com hotel path:

- `Booking.com hotel result candidates: ...`
- `Booking.com room selection evidence: ...`
- `Booking.com hotel runtime boundary: ...`

Expected terminal labels from those lines are:

- `provider_selector_drift`
- `room_selection_manual_review_reached`
- `room_selection_drift`
- `guest_details_manual_review_reached`
- `payment_manual_review_reached`
- `login_or_captcha_boundary`
- `network_provider_failure`
- `provider_no_availability`

## Preflight Environment

Before a retry:

1. Confirm founder approval for exactly one Booking.com hotel retry.
2. Use `C:\Users\Gzw19\onegent-integrated-20260504`.
3. Confirm branch `codex/integrated-preview-20260504`.
4. Confirm current commit is latest integrated preview.
5. Confirm `npm run check-drift` passes.
6. Confirm app and worker read the same `.env.local` / Neon database.
7. Confirm worker logs will be written to `codex-worker.log` in the active
   worktree, or record the exact alternate log path before starting.
8. Confirm `USE_WORKER_FOR` includes `hotel` if that env var is present.
9. Confirm no broad provider suite, hotel loop, Booking.com batch,
   Hotels.com run, Expedia hotel run, flight run, or retry loop is scheduled.
10. Confirm the operator is ready to stop on login, OTP, CAPTCHA, CVV, payment,
    account-sensitive prompt, or final confirmation.

Do not add a runner, dashboard button, cron, automation, or one-click live
control for this retry.

## Controlled Retry Preflight

Before the founder-approved retry starts, verify these exact inputs:

- Prompt matches the Exact User Prompt section byte-for-byte.
- Start params match the JSON block above.
- Primary provider is Booking.com.
- Worker mirror drift check passes.
- Artifact capture is ready for DB row, worker log excerpt, provider
  screenshots, and live snapshots.
- The operator is watching for the hard stops above.

If any input differs, do not run the retry. Update this runbook first and ask
for founder approval for the changed case.

## Hotel Controlled Retry Decision Tree

1. If profile data is missing before provider work, stop and classify
   `profile_gating`.
2. If worker logs, screenshots, live snapshots, or DB rows are stale or belong
   to different jobs/runs, stop and classify `insufficient_evidence`. Do not
   count guest/review, room, or payment-looking copy from mixed evidence as
   closure.
3. If Booking.com does not show YOTEL New York Times Square with the approved
   dates, guest count, and room count, stop and preserve DB/log/screenshot
   evidence before considering URL or search-result drift.
4. If the target hotel is visible but not selected, classify
   `provider_selector_drift` only after screenshots prove the approved target
   hotel was visible.
5. If room selection is reached, stop for operator review when evidence is
   sufficient and classify `room_selection_manual_review_reached`. Patch the
   room-to-guest transition only if screenshots and logs prove selector or
   runtime drift.
6. If room/rate inventory is visible but selection or room/card scan fails,
   classify `room_selection_drift` only after DB/log/screenshot evidence
   confirms the correct target was visible.
7. If guest details or manual review is reached, stop before payment/CVV/final
   controls and classify `guest_details_manual_review_reached`.
8. If payment, billing, checkout, CVV, or final booking controls appear, hard
   stop. Classify `payment_manual_review_reached` only when no payment data was
   entered and no final control was clicked.
9. If login, OTP, CAPTCHA, phone verification, bot wall, or an account prompt
   appears, hard stop and classify `login_or_captcha_boundary`. Do not bypass.
10. If OpenAI Responses API, Computer Use, or local model/runtime environment
   fails before provider evidence exists, classify `model_env_transient`. Do not
   patch hotel selectors from model/env evidence alone.
11. If Booking.com returns 5xx, timeout, blocked provider response, or network
    instability, classify `network_provider_failure`. Do not patch selectors
    from network evidence alone.
12. If the target hotel is sold out, fully booked, or has no rooms available
    with exact hotel, date, adult-count, and room-count evidence, classify
    `provider_no_availability`. If the copy is generic or city-level and does
    not prove the exact stay has no inventory, classify `network_provider_failure`
    with hotel fallback eligible, preserving the exact hotel, city, check-in,
    check-out, adults, rooms, and budget before trying another provider. Do not
    patch selectors unless screenshots show matching available inventory that
    the worker missed.

## DB Evidence Query

Inspect DB before reading task UI. The task UI is compressed and not the source
of truth.

Fields to inspect:

- `id`
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

SQL shape:

```sql
select id, trip_label, status, created_at, updated_at, steps, task_id
from booking_jobs
where id = '<retry-job-id>'
   or trip_label ilike '%YOTEL%'
   or steps::text ilike '%YOTEL New York Times Square%'
   or steps::text ilike '%2026-06-10%'
order by created_at desc
limit 8;
```

Node inspection shape:

```ts
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=]+)=(.*)\s*$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { sql } = await import("@vercel/postgres");

const rows = await sql`
  select id, trip_label, status, created_at, updated_at, steps, task_id
  from booking_jobs
  where id = ${process.env.RETRY_JOB_ID ?? ""}
     or trip_label ilike '%YOTEL%'
     or steps::text ilike '%YOTEL New York Times Square%'
     or steps::text ilike '%2026-06-10%'
  order by created_at desc
  limit 8
`;

for (const row of rows.rows) {
  const step = Array.isArray(row.steps) ? row.steps[0] : undefined;
  console.log(JSON.stringify({
    id: row.id,
    task_id: row.task_id,
    trip_label: row.trip_label,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    stepType: step?.type,
    stepStatus: step?.status,
    source: step?.body?.__source,
    scenario: step?.body?.scenario,
    error: step?.error,
    terminalReason: step?.terminalReason,
    terminalCode: step?.terminalCode,
    handoffUrl: step?.handoff_url,
    decisionLogTail: Array.isArray(step?.decisionLog)
      ? step.decisionLog.slice(-12)
      : step?.decisionLog,
    params: step?.body?.params,
    profileGap: step?.profileGap,
  }, null, 2));
}
```

## Worker Log Grep

Primary path when retry runs from integrated preview:

```powershell
C:\Users\Gzw19\onegent-integrated-20260504\codex-worker.log
```

Grep command:

```powershell
Select-String -Path C:\Users\Gzw19\onegent-integrated-20260504\codex-worker.log `
  -Pattern '<retry-job-id>|YOTEL|Booking.com|booking-com|Hotels.com|hotels-com|Expedia|hotel|normaliseStartUrl|searchresults|hotel detail|room|selected room|guest-details|guest details|final details|payment|paused_payment|checkout|sold out|fully booked|No exact matches|captcha|login|OTP|CVV|final' `
  -Context 2,3 |
  Select-Object -Last 240 |
  ForEach-Object { $_.ToString() }
```

High-value log signals:

- `normaliseStartUrl: hotelNameForUrl=...`
- `Booking.com: disabled top search bar inputs and scrolled to room list.`
- `Booking.com: selected room quantity`
- `Booking.com final state check: still on guest-details step`
- `Provider final payment page confirmed after guest-details step`
- `Booking.com payment: field discovery`
- `paused_payment`
- `guest form incomplete`
- `required field missing`
- `sold out`
- `fully booked`
- `No exact matches`
- `login`, `captcha`, `OTP`, `CVV`, `final`

## Screenshot Paths

Provider screenshots and live snapshots are expected under the active worktree:

```text
C:\Users\Gzw19\onegent-integrated-20260504\worker\.debug-screenshots\
C:\Users\Gzw19\onegent-integrated-20260504\.debug-screenshots\live\<retry-job-id>\*.json
```

When inspecting screenshots, answer:

1. Is the target hotel visible?
2. Are check-in/check-out dates correct?
3. Is one room / one adult selected?
4. Did the worker select the intended room/rate?
5. Did the page reach guest details, final details, payment, login, CAPTCHA,
   OTP, or a provider error?
6. Does screenshot state match DB `steps[0].error` and worker log?

## Runtime Forensics

Use `/dev/runtime-forensics` after evidence exists. Include fixtures only for
synthetic examples; do not treat fixtures as real evidence.

Before any live attempt, run the no-live closure preflight:

```powershell
npx tsx scripts/provider-closure.ts preflight --kind hotel
```

After a filled post-live artifact exists, the provider closure CLI can produce
the normalized closure report without opening a browser or starting a worker:

```powershell
npx tsx scripts/provider-closure.ts analyze --kind hotel --artifact .tmp\hotel-artifact-bundle.json
npx tsx scripts/provider-closure.ts report --kind hotel --artifact .tmp\hotel-artifact-bundle.json --markdown
```

This branch adds a no-live synthetic hotel fixture:

```text
lib/runtime-forensics/__fixtures__/booking-hotel-guest-form-incomplete.json
```

Expected class:

```text
provider_form_incomplete
```

It represents Booking.com staying on guest details while payment/card fill is
blocked. That is a safe failure until fresh screenshots prove a selector bug.

After a founder-approved retry has already produced a local artifact bundle,
use the unified no-live artifact CLI from the integrated preview worktree:

```powershell
cd C:\Users\Gzw19\onegent-integrated-20260504
npx tsx scripts/analyze-provider-artifact.ts --kind hotel .tmp\hotel-retry-artifact-bundle.json
```

The command only reads the local JSON bundle and prints paste-ready Markdown.
It does not start a worker, open a provider, read the database, or click
anything.

Provider Closure War Room equivalent:

```powershell
cd C:\Users\Gzw19\onegent-integrated-20260504
npx tsx scripts/provider-closure-war-room.ts preflight --vertical hotel
npx tsx scripts/provider-closure-war-room.ts analyze --vertical hotel --bundle .tmp\hotel-retry-artifact-bundle.json --markdown
```

Use the war-room report when the handoff needs a single root cause, next
single action, regression checklist, and YC/demo claim verdict. A synthetic or
stale bundle cannot claim hotel readiness; the report must say
`not_live_verified` or `Can claim this vertical: no` until fresh
DB/log/screenshot evidence is present.

## Post-Live Artifact Bundle Template

Use this template only after a founder-approved hotel retry has already
produced DB/log/screenshot evidence:

```text
docs/90-archive/phase2-product-areas/HOTEL_RETRY_ARTIFACT_TEMPLATE.json
```

Copy it to `.tmp\hotel-retry-artifact-bundle.json`, replace every synthetic
fixture value, then run:

```powershell
npx tsx scripts/analyze-provider-artifact.ts --kind hotel .tmp\hotel-retry-artifact-bundle.json
```

Required artifact bundle fields:

- `job.id`, `job.taskId`, `job.provider`, `job.scenario`, `job.status`.
- `job.steps[0].type`, `job.steps[0].status`, `job.steps[0].error`,
  `job.steps[0].body.__source`, `job.steps[0].body.scenario`,
  `job.steps[0].body.params`.
- `dbRow.id`, `dbRow.task_id`, `dbRow.trip_label`, `dbRow.status`,
  `dbRow.created_at`, `dbRow.updated_at`.
- `workerLogExcerpt` with bounded lines around the approved retry.
- `workerLogPath`, `screenshotPaths`, and `liveSnapshotPaths`.
- `notes` stating which boundary was reached and confirming no payment, CVV,
  OTP, CAPTCHA, account prompt, or final confirmation was completed.

Post-live triage buckets:

- `provider_selector_drift`: target hotel/result selection failed.
- `room_selection_drift`: room/rate card scan or selected-room control failed.
- `guest_details_manual_review_reached`,
  `payment_manual_review_reached`, or `room_selection_manual_review_reached`:
  checkout/manual boundary or safe partial progress.
- `model_env_transient`: OpenAI Responses API, Computer Use, or local runtime
  transient.
- `network_provider_failure`: Booking.com/network degraded.
- `provider_no_availability`: sold out, fully booked, or no room availability.
- `insufficient_evidence`: DB/log/screenshot bundle is incomplete.

## Success Taxonomy

Acceptable retry outcomes:

- `room_selection_manual_review_reached`: room/rate selection reached and the
  operator stopped before guest details, payment, CVV, login, OTP, CAPTCHA, or
  final confirmation.
- `checkout_reached_manual_review`: guest details or final details reached,
  then stopped before CVV/final confirmation.
- `paused_payment`: payment boundary reached and browser handed off safely.
- `safe_provider_boundary`: login, OTP, CAPTCHA, phone verification,
  account-sensitive prompt, or payment review reached without bypass.
- `provider_no_availability`: target hotel genuinely sold out/fully booked
  and screenshots/logs support it.
- `profile_gating`: precise missing-field message before provider work.

Demo-useful success:

- Booking.com gets past search/room selection and reaches guest details, final
  details, payment boundary, or a safe provider boundary.
- DB has valid `__source`, `scenario=hotel`, correct params, and a safe
  terminal status/reason.
- Screenshots show the boundary state.

## Failure Taxonomy

Patchable failures:

- `legacy_shape_missing_source`: missing `__source`, wrong scenario, or bad
  params.
- `hotel_url_shape_drift`: start URL lacks expected hotel, city, date, adult,
  or room params.
- `provider_selector_drift` / `hotel_search_result_drift`: target hotel
  visible but not selected.
- `room_selection_drift`: room/rate visible but not selected or room/card scan
  fails.
- `guest_details_incomplete`: visible guest field remains empty or selector
  drift prevents completion.
- `checkout_boundary_drift`: guest details work but final details/payment
  boundary detection misclassifies the page.

Non-patch or defer failures:

- Target hotel sold out/fully booked and no matching room is visible.
- OpenAI Responses API 500, Computer Use transient, or local model/runtime
  environment failure.
- Network/provider 5xx, bot block, CAPTCHA, or login/account wall.
- Missing profile data.
- Price/inventory changed enough that the selected room is no longer the same
  target.

Safety failures:

- Any CVV entry.
- Any payment submission.
- Any OTP/CAPTCHA/login bypass.
- Any final booking/reserve/purchase confirmation click.

Safety failures stop the run immediately and should not be retried without a
separate root-cause review.

## Patch Rule

Do not patch from the task card alone. Patch only after comparing:

1. DB row and step shape.
2. Worker log lines.
3. Provider screenshots.
4. Live snapshot JSON when present.
5. Runtime-forensics classification.

Keep the first live retry Booking.com-only. Do not expand to Hotels.com or
Expedia hotel unless Booking.com is explicitly blocked and the founder approves
that scope change.
