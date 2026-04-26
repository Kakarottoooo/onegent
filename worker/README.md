# @onegent/worker

Booking-autopilot worker — runs Playwright on Railway, polls Postgres for queued jobs.

Lifts the booking execution path off Vercel serverless (5-min timeout, 250MB lambda cap incompatible with chromium binary).

## Architecture

```
Vercel (next/api)            Railway (this worker)
─────────────────            ──────────────────────
POST /api/v1/execution-jobs  while (true) {
  → INSERT booking_jobs        const job = SELECT ... WHERE status='queued'
    (status='queued')                FOR UPDATE SKIP LOCKED
  → return jobId               UPDATE status='running'
                               runBrowserTask(job)        ← real Playwright/Stagehand
                               UPDATE status='done'|'failed'
                             }
```

Postgres `booking_jobs` table is the queue. No Redis/SQS/Inngest.

## Local development

```bash
cd worker
npm install
cp ../.env.local .env       # need POSTGRES_URL, ANTHROPIC_API_KEY, etc.
npm run dev                 # tsx watch — auto-reloads on changes
```

Or via Docker:

```bash
cd worker
docker build -t onegent-worker .
docker run --rm --env-file ../.env.local onegent-worker
```

## Required env vars

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_URL` | yes | Neon connection string (same as Vercel) |
| `ANTHROPIC_API_KEY` | yes | Claude — used by Stagehand AI agent |
| `OPENAI_API_KEY` | yes | OpenAI — used by ai-loop perceive/extractor |
| `BOOKING_ENCRYPTION_KEY` | yes | Decrypts card fields from booking_profiles |
| `USE_REAL_CHROME_FOR` | no | Comma-separated provider list (`expedia,booking,hotels,seatgeek,ticketmaster`). Empty → all sites use Browserbase. |
| `PLAYWRIGHT_HEADLESS` | no | `true` in prod, `false` for visual debugging |
| `BROWSERBASE_API_KEY` | no | Required only if any provider goes through Browserbase |
| `BROWSERBASE_PROJECT_ID` | no | "" |
| `WORKER_INSTANCE_ID` | no | Logged on each job claim — useful when scaling >1 worker (default: hostname) |

## Source layout

The `src/` tree intentionally **duplicates** `lib/booking-autopilot/`, `lib/core/`, `lib/db.ts`, `lib/autonomy.ts`, `lib/agent/planners/booking-links.ts`, and `lib/encryption.ts` from the Next.js app. This is a deliberate 30-day fork while we de-risk the Vercel→Railway migration via the `USE_WORKER` feature flag in the API. Once we delete the legacy `/api/booking-jobs/[id]/start/route.ts` Vercel path, the duplication collapses (the worker becomes the single source of truth and we remove the duplicates from `lib/`).

**DELETE_BY: 2026-05-26** — kill the duplicates after 30 days of stable Railway prod traffic.
