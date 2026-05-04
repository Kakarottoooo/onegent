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
Book one room at YOTEL New York Times Square in New York from June 10, 2026
to June 12, 2026 for 1 adult. Stop before payment, CVV, login, OTP, CAPTCHA,
or final booking confirmation.
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

## Success Taxonomy

Acceptable retry outcomes:

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
- `hotel_search_result_drift`: target hotel visible but not selected.
- `room_selection_drift`: room/rate visible but not selected.
- `guest_details_incomplete`: visible guest field remains empty or selector
  drift prevents completion.
- `checkout_boundary_drift`: guest details work but final details/payment
  boundary detection misclassifies the page.

Non-patch or defer failures:

- Target hotel sold out/fully booked and no matching room is visible.
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
