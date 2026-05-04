# Provider Runtime Debug Playbook

Last updated: 2026-05-04

Use this when an external-provider task fails and the UI only shows a short
message such as "Failed", "checkout was not reached", or "no longer shows that
exact option". The task card is not the source of truth. The source of truth is
the database step payload, worker logs, and debug artifacts.

Safety boundary:

- Debug public booking flows only.
- Do not automate payment submission.
- Do not bypass OTP, CAPTCHA, login, or provider account checks.
- Stop before final booking/payment confirmation unless the user explicitly
  performs the final provider-side action.

## 1. Fast Triage Order

1. Identify the latest job in `booking_jobs`.
2. Read `steps[0].body.params`, `steps[0].error`, and `steps[0].decisionLog`.
3. Search the worker log for the job id, provider marker, or trip label.
4. Open the latest provider debug screenshot folder.
5. Compare the visible page state against what the worker believed.
6. Only then decide whether to patch selectors, strategy ordering, or runtime
   state handling.

Do not diagnose from the task UI alone. The UI intentionally compresses provider
runtime logs for normal users.

## 2. Database Evidence

The useful table is usually `booking_jobs`.

Columns known useful:

- `id`
- `trip_label`
- `status`
- `steps`
- `created_at`
- `updated_at`
- `task_id`

Minimal query pattern:

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
  where trip_label ilike '%BNA%'
     or trip_label ilike '%MCO%'
     or steps::text ilike '%BNA%'
     or steps::text ilike '%MCO%'
  order by created_at desc
  limit 5
`;

for (const row of rows.rows) {
  const step = Array.isArray(row.steps) ? row.steps[0] : undefined;
  console.log(JSON.stringify({
    id: row.id,
    task_id: row.task_id,
    trip_label: row.trip_label,
    status: row.status,
    stepStatus: step?.status,
    source: step?.body?.__source,
    scenario: step?.body?.scenario,
    error: step?.error,
    terminalReason: step?.terminalReason,
    decisionLogTail: Array.isArray(step?.decisionLog)
      ? step.decisionLog.slice(-8)
      : step?.decisionLog,
    params: step?.body?.params,
  }, null, 2));
}
```

Run it from the active worktree:

```powershell
cd C:\Users\Gzw19\onegent-e2e-20260503
@'
// paste script body here
'@ | node --input-type=module -
```

Important interpretation:

- `source` must be a core marker such as
  `lib/core/execution-local-<hash>` for worker-routable local tasks.
- If the UI still shows an old error, verify whether `steps[0].error` is stale.
- If `params` are correct but provider click/scan fails, the bug is provider
  runtime, not NLU.

## 3. Worker Log Evidence

Common local log files:

- `C:\Users\Gzw19\onegent-e2e-20260503\codex-worker.log`
- Visible worker terminal output if user started worker manually.

Search examples:

```powershell
Select-String -Path C:\Users\Gzw19\onegent-e2e-20260503\codex-worker.log `
  -Pattern 'dfa54219|Southwest|flight-rpa|matching outbound|Expedia' `
  -Context 2,3 |
  Select-Object -Last 80 |
  ForEach-Object { $_.ToString() }
```

Provider-specific patterns:

- Flight: `[flight-rpa]`
- Expedia setup: `[expedia] setup`
- OpenTable: `[opentable]`
- Resy: `[resy]`

If logs are mojibaked on Windows, focus on ASCII markers, job ids, timestamps,
and provider tags.

## 4. Debug Screenshots And Artifacts

Provider artifacts normally land under:

```text
C:\Users\Gzw19\onegent-e2e-20260503\worker\.debug-screenshots\
```

Useful examples:

```powershell
Get-ChildItem -Path C:\Users\Gzw19\onegent-e2e-20260503\worker\.debug-screenshots `
  -Recurse -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 20 FullName,LastWriteTime,Length |
  Format-Table -AutoSize
```

For Expedia flight failures, open the latest:

```text
worker\.debug-screenshots\flight-rpa-<run-id>\01-search-results.jpg
```

What to compare:

- Does the screenshot show the target card?
- Does the worker log say the DOM scan failed?
- Was there a sign-in/member-prices popup covering the page?
- Did the worker reach checkout, guest form, OTP, or only search results?

Example from 2026-05-04 flight failure:

- UI showed: `Found a matching outbound earlier, but Expedia no longer shows
  that exact option`.
- DB showed correct params:
  `Southwest`, `08:50`, `WN 3084`, `$152`, `MCO -> BNA`, `2026-06-01`.
- Worker log showed: `Flight-card DOM scan failed: StagehandEvalError:
  Uncaught`.
- Screenshot showed the target Southwest card visibly present.
- Conclusion: provider runtime selector/DOM scan failed. NLU and core marker
  were not the root cause.

## 5. Provider-Specific Notes

### Expedia Flights

Current likely failure classes:

- Sign-in/member-prices popup blocks scan or click.
- Flight card visible in screenshot but DOM scan throws.
- Exact target changes during retry, causing stale price/time assumptions.
- Checkout not reached; browser kept open for manual review.

Preferred fix order:

1. Dismiss obstructing popups deterministically.
2. Use Playwright locators/text fallbacks for visible card matching.
3. Add screenshot and DOM evidence when card match fails.
4. Treat "exact option changed" separately from "scan crashed".

### OpenTable

OpenTable currently uses programmatic flow, not Computer Use as the primary
executor. The correct product behavior is usually to pause for user review or
OTP/payment input, not to auto-submit final confirmation.

### Resy

Resy can fail before automation due to provider API instability, rate limits, or
network/IP differences. If browser Network shows repeated `api.resy.com` 500s
or missing slots on desktop Wi-Fi while mobile data works, treat it as a
provider/network availability issue before burning model tokens.

## 6. What To Ask The User For

Only ask for user artifacts when local artifacts are insufficient.

High-value user artifacts:

- Screenshot of the provider page at failure.
- Network row details for failed provider API calls:
  status, request URL, response body, and timing.
- DOM snippet around the specific input/button when provider selectors fail.
- Whether the same provider page works on mobile data vs desktop Wi-Fi.

Low-value requests:

- Asking the user to paste the short task-card message again.
- Asking for full terminal logs when the local log file is accessible.
- Asking the user to manually rerun a command Codex can run.

## 7. Handoff Prompt For A New Agent Session

Use this if context is too long and a new agent needs to continue:

```text
Continue Onegent provider runtime debugging in:
C:\Users\Gzw19\onegent-e2e-20260503
Branch: codex/openai-chat-model-env

Read first:
- PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md
- PHASE_STATUS.md
- PHASE_1_FOUNDER_E2E.md
- R003_LIVE_SMOKE_RUNBOOK.md
- .coordination/HUDDLE.md if present

Do not rely on task UI logs only. For each external-provider failure, inspect:
- booking_jobs.steps[0].error / decisionLog / params
- C:\Users\Gzw19\onegent-e2e-20260503\codex-worker.log
- C:\Users\Gzw19\onegent-e2e-20260503\worker\.debug-screenshots\

Current flight issue:
- Legacy-shape worker error was fixed in commit f1341ee.
- Latest Expedia failure has correct core marker and params.
- Screenshot shows Southwest 8:50am MCO->BNA $152 visible.
- Worker log says flight-card DOM scan failed.
- Next likely fix: harden Expedia card matching and popup dismissal.

Rules:
- Do not automate payment, OTP, CAPTCHA, or final provider confirmation.
- Stage only files you intentionally changed.
- Existing dirty Resy files may be unrelated; do not revert them.
- Run tsc and targeted tests before commit.
```
