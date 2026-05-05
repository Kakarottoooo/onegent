# Expedia Controlled Retry Runbook

Last updated: 2026-05-04

Scope: one Expedia flight controlled retry after explicit founder approval.
This runbook prepares the evidence path. It does not authorize a live provider
run by itself.

## Hard Stops

Stop immediately and capture evidence if any of these appear:

- Payment submission or final purchase confirmation.
- CVV request.
- OTP, CAPTCHA, phone verification, or login wall.
- Provider account-sensitive prompt.
- Wrong flight card selected.
- Expedia leaves the expected public flight search or checkout path.

Never bypass OTP, CAPTCHA, login, or account checks. Never enter CVV. Never
click final booking or purchase confirmation.

## Exact Controlled Retry Checklist

Use this exact product-level prompt only after founder approval for one retry:

```text
帮我订一个6月1号从奥兰多飞 Nashville 的机票，一个人
```

Date normalization: because this checklist is dated 2026-05-04, `6月1号`
means `2026-06-01`. The minimum normalized flight params must be:

```json
{
  "scenario": "flight",
  "origin": "MCO",
  "dest": "BNA",
  "date": "2026-06-01",
  "passengers": 1,
  "cabin_class": "economy"
}
```

If the retry is bound to the already-audited Expedia candidate, keep these
target-card hints on the flight step:

```json
{
  "targetAirline": "Southwest",
  "targetDepartureTime": "08:50",
  "targetFlightNumber": "WN 3084",
  "targetPrice": 152
}
```

Expected Expedia start URL shape:

```text
https://www.expedia.com/Flights-Search?trip=oneway&leg1=from:MCO,to:BNA,departure:2026-06-01TANYT&passengers=adults:1&options=cabinclass:coach&mode=search
```

Pre-start checks:

1. Confirm exact founder approval for one retry of the Chinese prompt above.
2. Confirm no hotel, restaurant, Booking.com, Hotels.com, broad provider suite,
   retry loop, cron, automation, or UI run button is involved.
3. Confirm the booking job step is a normalized flight step with source marker
   present at `steps[0].body.__source` or `step.__source`. Expected prefix:
   `lib/core/execution` or `lib/execution-v2`.
4. Confirm params include `origin=MCO`, `dest=BNA`, `date=2026-06-01`, and
   `passengers=1` before starting the worker.
5. Confirm the source marker and params are read from the DB row, not inferred
   from the task UI copy.
6. Confirm the operator has the DB query, worker log grep, and screenshot paths
   below ready before the retry starts.
7. Stop before payment, CVV, OTP, CAPTCHA, login bypass, or final booking
   confirmation.

No-live preflight guard for this checklist:

```powershell
npx vitest run lib/__tests__/expedia-controlled-retry-preflight.test.ts lib/__tests__/expedia-retry-analysis.test.ts lib/__tests__/expedia-flight-card-match.test.ts
```

Exact-task CLI guard:

```powershell
npx tsx scripts/preflight-expedia-controlled-flight.ts --confirm-one-controlled-retry --prompt "帮我订一个6月1号从奥兰多飞 Nashville 的机票，一个人" --start-url "https://www.expedia.com/Flights-Search?trip=oneway&leg1=from:MCO,to:BNA,departure:2026-06-01TANYT&passengers=adults:1&options=cabinclass:coach&mode=search"
```

The guard uses the pure module
`lib/runtime-forensics/expedia-flight-live-readiness.ts`. It validates only env
names, exact prompt/start URL, hard-stop labels, and expected artifact output
paths. It does not read `.env.local`, print env values, open Expedia, start a
worker, or call OpenAI. The CLI refuses broad-run flags such as `--all`,
`--provider`, `--kind`, or `--live`.

## Preflight Environment

Before a retry:

1. Confirm founder approval for exactly one Expedia retry.
2. Use `C:\Users\Gzw19\onegent-integrated-20260504`.
3. Confirm branch `codex/integrated-preview-20260504`.
4. Confirm current commit is at or after `5e6a246`.
5. Confirm `dd4b19f` and `d4eb8c7` are in history.
6. Confirm `npm run check-drift` passes.
7. Confirm the app and worker read the same `.env.local` / Neon database.
8. Confirm worker logs will be written to `codex-worker.log` in the active
   worktree, or record the exact alternate log path before starting.
9. Confirm `USE_WORKER_FOR` includes `flight` if that env var is present.
10. Confirm no broad provider suite, hotel run, Booking.com run, Hotels.com
    run, or retry loop is scheduled.

Required env names to check without printing values:

- `POSTGRES_URL`
- `OPENAI_API_KEY`

Conditional env-name checks:

- If `USE_WORKER_FOR` is present, it must include `flight`.
- If `BROWSERBASE_API_KEY` or `BROWSERBASE_PROJECT_ID` is present, both names
  must be present together. Values must not be printed in logs or handoffs.

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
   or trip_label ilike '%BNA%'
   or steps::text ilike '%MCO%'
   or steps::text ilike '%WN 3084%'
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
     or trip_label ilike '%BNA%'
     or steps::text ilike '%MCO%'
     or steps::text ilike '%WN 3084%'
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

Fallback path for older evidence only:

```powershell
C:\Users\Gzw19\onegent-e2e-20260503\codex-worker.log
```

Grep command:

```powershell
Select-String -Path C:\Users\Gzw19\onegent-integrated-20260504\codex-worker.log `
  -Pattern '<retry-job-id>|flight-rpa|Expedia|Flight-card DOM scan|Flight candidate evidence dump|Selected flight candidate evidence|DOM rescan flight click|Locator flight click retry|Trying locator fallback|Locator fallback matched|Flight match|Fare modal|Checkout reached|flight checkout was not reached|Login/OTP/CAPTCHA boundary|profile|payment|captcha|login|OTP|CVV|final' `
  -Context 2,3 |
  Select-Object -Last 200 |
  ForEach-Object { $_.ToString() }
```

High-value log signals:

- `[flight-rpa] Starting programmatic flight booking`
- `Expedia Flight detected: agent.execute disabled`
- `Trip type: one-way`
- `Searching for flight`
- `Flight-card DOM scan failed`
- `Trying locator fallback for flight-card scan`
- `Locator fallback matched flight card`
- `Flight candidate evidence dump`
- `Selected flight candidate evidence`
- `DOM rescan flight click`
- `Locator flight click retry`
- `Flight match`
- `Fare modal appeared`
- `Checkout reached`
- `Login/OTP/CAPTCHA boundary detected`
- `safe handoff`
- `manual review`
- `paused_payment`
- `flight checkout was not reached`
- `Local mode: flight checkout was not reached`
- Any login, CAPTCHA, OTP, CVV, payment, or final-confirmation signal.

## Screenshot Paths

Provider screenshots:

```text
C:\Users\Gzw19\onegent-integrated-20260504\worker\.debug-screenshots\flight-rpa-*
```

Live snapshots:

```text
C:\Users\Gzw19\onegent-integrated-20260504\.debug-screenshots\live\<retry-job-id>\*.json
```

Older evidence for the pre-fallback failure is in:

```text
C:\Users\Gzw19\onegent-e2e-20260503\worker\.debug-screenshots\flight-rpa-1777875646570\01-search-results.jpg
C:\Users\Gzw19\onegent-e2e-20260503\.debug-screenshots\live\dfa54219-dd3d-447a-9231-a9dd13edf0cb\1777875646269-aeca84.json
```

When inspecting screenshots, answer these questions:

1. Is the target Southwest card visible?
2. Is there a blocking sign-in, member-prices, CAPTCHA, or OTP panel?
3. Did the worker believe it matched and clicked a card?
4. Did Expedia navigate to fare selection, review, checkout, login, or error?
5. Did the page state match the terminal error?

## Post-Retry Analyzer

Use the analyzer only after the single founder-approved retry has already
completed and the DB/log/screenshot evidence has been collected. The analyzer
does not run a provider, read the database, open Expedia, or click anything.
It classifies an artifact bundle that the operator assembled from the evidence
above.

Create this local artifact bundle from the DB row, worker log grep output, and
artifact paths:

Template with fake data:

```text
docs/50-product-areas/EXPEDIA_RETRY_ARTIFACT_TEMPLATE.json
```

```json
{
  "job": {
    "id": "<retry-job-id>",
    "taskId": "<task-id>",
    "provider": "expedia",
    "scenario": "flight",
    "status": "<booking_jobs.status>",
    "errorMessage": "<top-level or step error>",
    "terminalReason": "<step terminalReason if present>",
    "terminalCode": "<step terminalCode if present>",
    "steps": [
      {
        "type": "flight",
        "status": "<steps[0].status>",
        "error": "<steps[0].error>",
        "terminalReason": "<steps[0].terminalReason if present>",
        "terminalCode": "<steps[0].terminalCode if present>",
        "__source": "<steps[0].body.__source or step.__source>",
        "body": {
          "scenario": "flight",
          "params": "<copy steps[0].body.params>"
        }
      }
    ],
    "params": {
      "origin": "MCO",
      "dest": "BNA",
      "date": "2026-06-01",
      "passengers": 1,
      "cabin_class": "economy",
      "targetAirline": "Southwest",
      "targetDepartureTime": "08:50",
      "targetFlightNumber": "WN 3084",
      "targetPrice": 152
    }
  },
  "dbRow": "<optional raw booking_jobs row>",
  "workerLogExcerpt": "<bounded Select-String output from codex-worker.log>",
  "workerLogPath": "C:\\Users\\Gzw19\\onegent-integrated-20260504\\codex-worker.log",
  "benchmarkReportPath": "C:\\Users\\Gzw19\\onegent-integrated-20260504\\benchmark\\runs\\<retry-run-id>.json",
  "screenshotPaths": [
    "C:\\Users\\Gzw19\\onegent-integrated-20260504\\worker\\.debug-screenshots\\flight-rpa-*"
  ],
  "liveSnapshotPaths": [
    "C:\\Users\\Gzw19\\onegent-integrated-20260504\\.debug-screenshots\\live\\<retry-job-id>\\*.json"
  ],
  "expectedClassificationTaxonomy": [
    "card_scan_failed_before_fallback",
    "fallback_attempted_no_match",
    "fallback_matched_no_checkout",
    "checkout_manual_review_reached",
    "model_or_env_transient",
    "network_provider_failure",
    "provider_no_availability",
    "insufficient_evidence"
  ],
  "notes": [
    "One founder-approved retry only. No payment, CVV, OTP/CAPTCHA/login bypass, or final booking confirmation."
  ]
}
```

Save it as:

```powershell
C:\Users\Gzw19\onegent-integrated-20260504\.tmp\expedia-retry-artifact-bundle.json
```

Then run the pure analyzer from the integrated preview worktree:

```powershell
cd C:\Users\Gzw19\onegent-integrated-20260504
npx tsx scripts/analyze-expedia-retry-artifact.ts .tmp\expedia-retry-artifact-bundle.json
```

Unified artifact CLI equivalent:

```powershell
cd C:\Users\Gzw19\onegent-integrated-20260504
npx tsx scripts/analyze-provider-artifact.ts --kind expedia .tmp\expedia-retry-artifact-bundle.json
```

The output is paste-ready Markdown. Paste it into the Phase 2 handoff before
deciding whether a patch is justified.

CLI validation behavior:

- Missing file: exits non-zero and reports the missing artifact path.
- Invalid JSON: exits non-zero and reports a parse error.
- Empty JSON object: exits non-zero and reports `Artifact bundle is empty`.
- Unknown but valid bundle: prints Markdown with `insufficient_evidence`.

Analyzer states:

- `card_scan_failed_before_fallback`: `Flight-card DOM scan failed` appears
  and no `Trying locator fallback for flight-card scan` signal follows.
- `fallback_attempted_no_match`: fallback attempted, but no
  `Locator fallback matched flight card` signal appears.
- `fallback_matched_no_checkout`: fallback matched a flight card, but checkout
  or manual review was not reached.
- `checkout_manual_review_reached`: checkout, safe handoff, manual review,
  payment wall, or confirmation boundary was reached without crossing a hard
  stop.
- `login_or_otp_boundary`: login, OTP, CAPTCHA, or authentication boundary was
  reached. Stop for manual intervention; do not bypass it.
- `model_or_env_transient`: OpenAI Responses API 5xx, model quota/rate limit,
  missing model env, or Computer Use unavailable. Do not patch provider
  selectors from this state alone.
- `network_provider_failure`: provider/network failure such as 5xx,
  `net::ERR_*`, TCP errors, gateway timeout, or Expedia unavailable.
- `provider_no_availability`: explicit artifact evidence that the target card
  is absent or provider inventory changed. Do not infer this from task UI copy
  alone.

If the analyzer returns `insufficient_evidence`, do not patch. Collect the DB
row, worker log excerpt, provider screenshots, and live snapshot paths first.

If a later founder-approved retry runs, the source of truth is DB row plus
worker log plus screenshots. Do not patch provider selectors from task UI copy
or from analyzer output alone; patch only when those artifacts prove the
selector/runtime root cause.

## Latest Controlled Retry Evidence

Run:

- Branch: `codex/flight-live-closure-final`
- Base: `origin/codex/integrated-preview-20260504 @ bcd2895`
- One founder-authorized Expedia MCO -> BNA retry ran on
  2026-05-04 America/Chicago / 2026-05-05 UTC.
- Job id: `2c5065b2-c5e2-4822-83f1-125af645d3cd`.
- Session id: `codex-flight-live-closure-final-20260504-203055`.

Source-of-truth checks:

- DB/API step shape had source marker `lib/core/execution-local-c2110aa34d`,
  `scenario=flight`, and params `MCO/BNA/2026-06-01/1/economy` with target
  hints `Southwest`, `08:50`, `WN 3084`, `$152`.
- Worker log entered the Expedia programmatic flight path, captured
  `01-search-results`, logged `Flight-card DOM scan failed:
  StagehandEvalError: Uncaught`, attempted locator fallback, then failed with
  `item.evaluate is not a function`.
- Screenshot evidence exists under:
  `C:\Users\Gzw19\onegent-integrated-20260504\worker\.debug-screenshots\flight-rpa-1777944673127`,
  `...\flight-rpa-1777944711935`,
  `...\flight-rpa-1777944747504`.
- Live snapshot evidence exists under:
  `C:\Users\Gzw19\onegent-integrated-20260504\.debug-screenshots\live\2c5065b2-c5e2-4822-83f1-125af645d3cd\*.json`.
- Sanitized local analyzer bundle:
  `C:\Users\Gzw19\onegent-integrated-20260504\.tmp\flight-live-closure-final-evidence-bundle.json`.

Provider closure report:

```powershell
npx tsx scripts/provider-closure.ts report --kind flight --artifact .tmp\flight-live-closure-final-evidence-bundle.json --markdown
```

Result:

- Outcome: `selector_drift`.
- Provider state: `fallback_attempted_no_match`.
- Root cause: Expedia flight locator fallback assumed `item.evaluate(...)` was
  available after primary DOM scan failure. The live Stagehand locator wrapper
  did not expose that method.
- The failure is not routing/job shape because source marker, scenario, params,
  start URL, and worker routing were correct.
- No payment, CVV/security-code, OTP/CAPTCHA/login bypass, or final
  booking/purchase confirmation occurred.

Patch status:

- Runtime now reads locator fallback text by capability: `evaluate` when
  present, then `aria-label`, text/innerText, and nearby ancestor text.
- Runtime no longer treats price alone as an eligible fallback when the
  controlled task has a target departure time. This avoids selecting a visible
  Southwest `$152` card at a wrong time when `08:50` / `WN 3084` is the target.
- Analyzer ignores hard-stop checklist notes such as "no OTP/CAPTCHA/login
  bypass" when deciding whether an observed login/OTP/CAPTCHA boundary was
  reached.

Next retry:

- Do not rerun live without a new explicit founder approval.
- If approved, run exactly one Expedia MCO -> BNA controlled retry. The next
  retry should either reach a safe checkout/manual-review/login/OTP boundary,
  classify no availability/provider degradation, or produce candidate evidence
  without the `item.evaluate` crash.

## Success Taxonomy

Acceptable retry outcomes:

- `checkout_reached_manual_review`: checkout or traveler/payment review reached,
  then stopped before CVV/final confirmation.
- `login_or_otp_boundary`: login, OTP, CAPTCHA, or authentication boundary
  reached and stopped without bypass.
- `safe_provider_boundary`: login, OTP, CAPTCHA, account-sensitive prompt, or
  payment review reached without bypass.
- `profile_gating`: precise missing-field message before provider work.
- `provider_inventory_changed`: target fare genuinely gone and screenshots/logs
  support that the card is no longer visible.

Demo-useful success:

- Gets past card scan and reaches checkout or safe provider boundary.
- DB has valid `__source`, `scenario=flight`, correct params, and a safe
  terminal status or safe terminal reason.
- Screenshots show the boundary state.

## Failure Taxonomy

Patchable failures:

- `legacy_shape_missing_source`: missing `__source`, wrong scenario, or bad
  params. This is routing/job shape, not provider selector.
- `card_scan_fallback_not_reached`: `Flight-card DOM scan failed` appears and
  no `Trying locator fallback` log follows.
- `card_scan_fallback_too_narrow`: locator fallback runs, screenshot still
  shows the target card, but no candidate is selected.
- `wrong_card_selected`: wrong airline, time, price, or route selected.
- `fare_modal_drift`: card clicked but fare selection controls are not found.
- `checkout_boundary_drift`: fare flow works but checkout/review boundary
  detection misclassifies the page.

Non-patch or defer failures:

- Expedia inventory changed and the target card is not visible.
- Network/provider 5xx, bot block, or CAPTCHA.
- Login/OTP/account-sensitive wall.
- Missing profile data.

Safety failures:

- Any CVV entry.
- Any payment submission.
- Any OTP/CAPTCHA/login bypass.
- Any final booking or purchase confirmation click.

Safety failures stop the run immediately and should not be retried without a
separate root-cause review.

## Patch Rule

Do not patch from the task card alone. Patch only after comparing:

1. DB row and step shape.
2. Worker log lines.
3. Provider screenshots.
4. Live snapshot JSON when present.

Keep changes Expedia-flight scoped. Do not expand to Booking.com or Hotels.com
unless Expedia is explicitly blocked and the founder approves that scope change.
