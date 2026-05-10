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
6. **Classify against the four-way operator taxonomy in
   `docs/30-provider-debug/FAILURE_TAXONOMY.md`** (model_env_transient /
   provider_network_degraded / provider_logic_failure /
   safe_boundary_reached) before deciding to patch. A model/env transient
   or network-degraded run is not a provider regression.
   For hotel no-availability and fallback decisions, also apply
   `docs/30-provider-debug/HOTEL_LAYERED_RECOVERY.md` before marking
   inventory unavailable.
7. Only then decide whether to patch selectors, strategy ordering, or runtime
   state handling.

Do not diagnose from the task UI alone. The UI intentionally compresses provider
runtime logs for normal users.

## 1.5 Where to look (canonical evidence sources)

There is no single dashboard that holds the truth. Use this exact order:

| Source | Path / surface | What it gives you |
|---|---|---|
| **Database** | `booking_jobs` row → `steps[0].error`, `steps[0].decisionLog`, `steps[0].body.params`, `steps[0].body.__source`, `terminalReason`, `terminalCode` | Authoritative job + step + decision-log content |
| **Worker log** | `C:\Users\Gzw19\onegent-e2e-20260503\codex-worker.log` (Codex's worktree) — override locally with `WORKER_LOG_PATH` env, default `./codex-worker.log` | Step-by-step execution narrative, strategy ladder hits, frame-aware probe results |
| **Debug screenshots** | `worker/.debug-screenshots/<provider>/<run>/` (page.png + page.html + summary.json) | Visual ground truth of what the provider site looked like at terminal failure |
| **Benchmark report** | `benchmark/runs/*.json` (no `phase1-quality-gate-` / `founder-e2e-` prefix) | Phase 0 acceptance suite per-case outcomes |
| **Task UI** | `/tasks/<taskId>` | Customer-facing summary; **not** ground truth (compressed) |

**Triage rule**: the task UI is the lowest-fidelity source. Do not draw a
conclusion from it alone. The forensics workbench (next section) re-renders
the same evidence after pre-classification, but is still **not** authoritative —
the artifact files + DB are.

## 1.6 Forensics workbench (`/dev/runtime-forensics`)

Read-only triage helper that pre-classifies provider failures across 8
categories. Reads filesystem artifacts (V1):

- `benchmark/runs/*.json` (excluding quality-gate / founder-e2e prefixes)
- `worker/.debug-screenshots/<provider>/<run>/summary.json`
- `./codex-worker.log` (or `$WORKER_LOG_PATH`) — graceful empty if missing

Failure classifications:

| Class | Severity | What it means |
|---|---|---|
| `legacy_shape_missing_source` | **P0** | Worker received a step without `__source` — M5 force-gate at `app/api/booking-jobs/[id]/start/route.ts` failed to stamp. Worker-gating regression. |
| `provider_no_availability` | INFO | Provider returned no slots in the target window. Not a fill failure. |
| `provider_form_incomplete` | P1 | Guest form not fully filled / required field empty / `auditAndRefill` gave up. |
| `otp_or_login_required` | INFO | OTP / phone-verify / login wall reached. Expected boundary. |
| `checkout_reached_manual_review` | INFO | Reached final-confirm / payment / CVV. Safe handoff success boundary. |
| `model_or_env_blocked` | P1 | OpenAI rate-limit / Computer Use unavailable / chromium missing / token-guard hit. |
| `network_or_provider_5xx` | P2 | 5xx, ECONNRESET, gateway timeout, `net::ERR_*`. Often transient. |
| `unknown` | P2 | No signals matched. Needs human triage. |

How to use:

1. Open `/dev/runtime-forensics` (dev-gated; requires
   `NODE_ENV !== "production"` or `ENABLE_DEV_BENCHMARK_API=1`).
2. Filter by provider / status / classification.
3. Click a job row → the detail drawer shows raw terminal fields + matched
   signals + step shape audit + decision log + cross-references + a
   paste-ready markdown bug-report block.
4. Triple-click the markdown textarea, copy, paste into the Codex / Claude
   chat for triage.

Hard rules:

- The page never starts a worker, never invokes a provider, never
  retries a job. It is read-only.
- The page must render an empty state cleanly when no benchmark runs
  exist and the worker log is missing. **Test this**: delete
  `./benchmark/runs/*.json` and `./codex-worker.log`, refresh; you
  should see the empty state with `WORKER_LOG_PATH` hint.
- V1 is artifact-based. DB live lookup is a future source (Codex domain
  if/when added; pure parser already accepts duck-typed input).

**The workbench is a triage tool, not source of truth.** When the
classification disagrees with what the worker actually did, trust the
worker log + screenshots, not this page.

### Operating procedure (UX v2)

Use this when you open `/dev/runtime-forensics` for a real triage:

1. **Land on the dashboard** with no query string. The list shows real
   benchmark/runs rows. If empty, the empty-state suggests two paths:
   place benchmark JSON files at `benchmark/runs/`, or click *Show
   `[FIXTURE]` example rows* to see synthetic demo data tagged
   `[FIXTURE]`.
2. **Narrow the list** with multi-select chip filters. Provider /
   classification / severity all stack additively. The two toggles
   (*hide unknown* + *show fixtures*) are persistent across reloads
   because they round-trip through the URL.
3. **Sort** by clicking a column header. Severity defaults to
   descending (P0 first); subsequent clicks toggle direction. Sort
   state is preserved in the URL.
4. **Copy a share URL** to send the same view to a teammate via the
   *Copy filter URL* button next to the chips.
5. **Open a row** with *Inspect*. The detail drawer renders, top to
   bottom:
   - **Source of truth** reminder (4-step verification ladder).
   - **Recommended next evidence** — a numbered checklist tailored
     to the failure class, plus per-class file/doc/db pointers, plus
     ready-to-paste PowerShell `Select-String` commands keyed to the
     job's id, scenario, and top matched signals.
   - **Signals grouped by source** — `step_shape_audit` / `error_message`
     / `terminal_reason` / `step_error` / `decision_log` /
     `raw_worker_log`. Helps you see whether the verdict came from one
     loud field or several converging hints.
   - **Step shape audit** table with rows missing `__source` outlined
     in red and a `[!]` marker.
   - **Raw terminal fields** + **Decision log** + **Cross references**.
   - **Paste-ready markdown bug report** — same text the API returns,
     with a Copy button.
6. **Verify against ground truth** before filing or fixing. The drawer
   nudges this in the green "Source of truth" block — open the worker
   log, screenshot dir, and DB row referenced there.

### Hard rules (operator)

- The dashboard NEVER triggers a live run, retry, payment, OTP, or
  worker action. If you see a button that suggests otherwise, it's a
  bug — file under Track B.
- `[FIXTURE]` rows are SYNTHETIC. Do not file bugs against them, do
  not screenshot them as evidence, do not reference them in retros.
- Generated `Select-String` commands sanitize signal text before
  embedding (strips `;` `&` `|` `<` `>` `$` `(` `)` backtick `\`),
  but you should still review before pasting into a privileged shell.
- The PowerShell path the commands target is read from
  `WORKER_LOG_PATH` (env override) or defaults to
  `./codex-worker.log`. Codex's canonical path is
  `C:\Users\Gzw19\onegent-e2e-20260503\codex-worker.log`.

### URL parameters reference

| Param | Type | Purpose |
|---|---|---|
| `providers` | comma list | multi-select provider filter |
| `classes` | comma list | multi-select classification filter |
| `severities` | comma list | multi-select severity filter |
| `hideUnknown` | `1` | drop rows where `primaryClass=unknown` |
| `showFixtures` / `examples` | `1` | merge `[FIXTURE]` example rows |
| `sort` | `key:dir` | `severity:desc` / `updatedAt:asc` / etc |
| `provider` | string | single-value back-compat (v1) |
| `status` | string | single-value status filter |
| `taskId` | string | filter by task |
| `sessionId` | string | filter by session |
| `jobId` | string | filter by job (server-side) |
| `id` | string | single-job lookup mode |
| `primaryClass` | enum | single-value back-compat (folds into classes) |

The parser is tolerant: empty segments drop, duplicates dedup, unknown
enum values are dropped with warnings (surfaced as the orange "URL
filter warnings" banner). Default values are omitted from the
serialized URL so canonical share-links stay short.

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
- Fix branch: `codex/expedia-flight-card-fallback`.
  - Adds a visible-text locator fallback when the bulk flight-card DOM scan
    throws.
  - The fallback iterates visible `button, [role="button"]` nodes, scores each
    label/context against airline, price, time, and flight number, then returns
    the selected locator bounding-box center for the existing click path.
  - Keeps the safety boundary unchanged: no payment, OTP, CAPTCHA, login bypass,
    or final booking confirmation automation.
  - Verified with targeted Expedia/flight Vitest, TypeScript, and drift check.

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

## 6.5 Stuck job recovery (manual, founder approval required)

A Phase 0 retry can leave a `booking_jobs` row stuck in
`status='running' / steps[0].status='pending'` when the in-process
executor finishes but the terminal DB write hits a transient Neon
`ConnectTimeoutError`, or when the runner's polling GET hits a 5xx
mid-flight and gives up before the executor finalizes. The runner
now classifies this case as `F-INFRA-DB-TRANSIENT` /
`model_env_transient`, but the DB row still needs manual
reconciliation if it never receives a terminal write.

This section is the **read-only diagnostic + exact UPDATE template**
for that case. The audit reads artifacts only; the UPDATE must be
run by the founder (or someone with explicit founder approval) after
confirming the screenshots show the run reached a safe boundary or
never reached the provider.

### 1. No-live audit first

Run the artifact-side audit:

```ts
import { auditStuckJobsInDir, renderStuckJobAuditMarkdown } from "@/lib/runtime-forensics/stuck-job-audit";

const result = await auditStuckJobsInDir("benchmark/runs");
console.log(renderStuckJobAuditMarkdown(result));
```

The audit returns each `phase0-resy-*.json` report whose case
matches the DB-transient pattern (failed_unknown + transient infra
signature, or explicit `F-INFRA-DB-*` taxonomy code). It does NOT
read the database, open a browser, or call OpenAI.

### 2. Confirm safety boundary from screenshots

For each matched case, open the per-job screenshot directory under
`.debug-screenshots/live/<job-id>/` and walk the screenshot trail.
Required confirmations before proceeding:

- The browser stayed on the public provider URL or never opened.
- No payment / CVV / OTP / SMS / phone-verification / CAPTCHA /
  login-bypass / final-confirm page was reached.
- The screenshot status field never shows `safety_violation_detected`
  in the corresponding benchmark report.

If any of these fail, do NOT run the manual cleanup; escalate to
provider runtime debug instead.

### 3. Confirm the row is actually stuck

Read-only DB query (does not mutate):

```ts
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=]+)=(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { sql } = await import("@vercel/postgres");
const rows = await sql`
  select id, status, created_at, updated_at, steps, task_id
  from booking_jobs
  where id = '<job-id>'
  limit 1
`;
console.log(JSON.stringify(rows.rows[0], null, 2));
```

The row is stuck when:

- `status === 'running'`
- `steps[0].status === 'pending'`
- `updated_at` was last set close to `created_at` (no later writes)
- `steps[0].error`, `terminalReason`, `terminalCode`, `decisionLog`
  are all null
- The corresponding benchmark report shows the run actually
  finished or aborted (so the row is genuinely abandoned).

### 4. Manual cleanup SQL (DO NOT run without founder approval)

The exact UPDATE to mark a confirmed-stuck row terminal:

```sql
-- Manual stuck-job recovery for DB-transient infra blip.
-- Founder must approve this exact statement before execution.
-- Replace <job-id> with the confirmed stuck job id.
update booking_jobs
set status = 'failed',
    updated_at = now(),
    steps = jsonb_set(
      jsonb_set(
        jsonb_set(
          steps,
          '{0,status}',
          '"error"'::jsonb
        ),
        '{0,terminalCode}',
        '"infra_db_transient_lost_terminal_write"'::jsonb
      ),
      '{0,terminalReason}',
      '"Phase 0 stuck job recovery: in-process executor finished but terminal DB write was lost to a transient Neon ConnectTimeoutError. Reconciled manually after artifact audit."'::jsonb
    )
where id = '<job-id>'
  and status = 'running'
  and (steps -> 0 ->> 'status') = 'pending';
```

After running:

- Re-query the row to confirm `status='failed'` and `steps[0].error`
  populated.
- Add the cleanup timestamp + reviewer name to the matching
  benchmark report's `notes` field, or create a sidecar note in
  `.tmp/<job-id>-cleanup-note.txt` (gitignored) for the audit
  trail.

### 5. Do NOT

- Do NOT run the UPDATE on a row that lacks artifact evidence the
  run reached a safe boundary or never reached the provider.
- Do NOT mutate `task_id`, `current_booking_job_id`, `created_at`,
  or any non-step column.
- Do NOT batch-update multiple rows; one job at a time.
- Do NOT skip the audit step. The audit is the only no-live record
  that the row really is stuck on a DB-transient infra blip.
- Do NOT classify the recovered row as `no_availability` or any
  Resy / OpenTable provider state. The recovered terminalCode is
  always `infra_db_transient_lost_terminal_write`.

## 7. Handoff Prompt For A New Agent Session

Use this if context is too long and a new agent needs to continue:

```text
Continue Onegent provider runtime debugging in:
C:\Users\Gzw19\onegent-e2e-20260503
Branch: codex/openai-chat-model-env

Read first:
- docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md
- docs/00-start-here/PHASE_STATUS.md
- docs/90-archive/phase1-demo/PHASE_1_FOUNDER_E2E.md
- docs/90-archive/phase0-restaurant/R003_LIVE_SMOKE_RUNBOOK.md
- docs/10-coordination/HUDDLE.md if present

Do not rely on task UI logs only. For each external-provider failure, inspect:
- booking_jobs.steps[0].error / decisionLog / params
- C:\Users\Gzw19\onegent-e2e-20260503\codex-worker.log
- C:\Users\Gzw19\onegent-e2e-20260503\worker\.debug-screenshots\

Current flight issue:
- Legacy-shape worker error was fixed in commit f1341ee.
- Latest Expedia failure has correct core marker and params.
- Screenshot shows Southwest 8:50am MCO->BNA $152 visible.
- Worker log says flight-card DOM scan failed.
- Current fix branch: `codex/expedia-flight-card-fallback` hardens Expedia
  card matching with a locator fallback after `StagehandEvalError`.

Rules:
- Do not automate payment, OTP, CAPTCHA, or final provider confirmation.
- Stage only files you intentionally changed.
- Existing dirty Resy files may be unrelated; do not revert them.
- Run tsc and targeted tests before commit.
```
