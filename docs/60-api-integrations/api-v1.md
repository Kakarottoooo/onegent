# Onegent Execution API · v1

> **Status: Alpha.** Breaking changes possible before v1 leaves alpha. Contact `api@onegent.ai` for a key.

The Onegent Execution API lets external agents (Claude MCP connectors, ChatGPT custom GPTs, your own app) ask Onegent to book restaurants, hotels, flights, or activities on behalf of an end-user. Onegent drives a real browser on your behalf, handles provider fallbacks automatically, and hands back a payment URL when it hits the PCI boundary — your user completes checkout.

Base URL: `https://<your-onegent-host>/api/v1`

## Contents

- [Authentication](#authentication)
- [Endpoints](#endpoints)
  - [POST /execution-jobs](#post-execution-jobs) — create a booking job
  - [GET /execution-jobs/{jobId}](#get-execution-jobsjobid) — poll status
  - [GET /execution-jobs/{jobId}/audit](#get-execution-jobsjobidaudit) — decision audit trail
  - [GET /metrics/providers/{providerId}](#get-metricsprovidersproviderid) — provider success rate
- [Job lifecycle](#job-lifecycle)
- [Error codes](#error-codes)
- [Quickstart — end-to-end curl](#quickstart--end-to-end-curl)

---

## Authentication

All `/api/v1/*` endpoints require an API key via `Authorization: Bearer <key>`.

```
Authorization: Bearer ogk_live_<32 base64url chars>
```

Keys come in two flavors:

- `ogk_live_...` — production keys, count against rate limits (when enforced).
- `ogk_test_...` — test keys for local/staging use.

Key format: `ogk_(live|test)_[A-Za-z0-9_-]{16,}`. Malformed keys fail fast (401 before any DB lookup).

### Getting a key (self-hosted / dev)

Run the admin CLI against your Postgres:

```bash
POSTGRES_URL=postgres://... node scripts/admin/create-api-key.mjs \
  --org "Acme Travel" \
  --env live \
  --scenarios restaurant,hotel,flight,activity
```

The plaintext key is printed **once**. Save it into your secret store — only the sha256 hash is persisted, so it can't be recovered later.

---

## Endpoints

### `POST /execution-jobs`

Create a new booking job and start the autopilot asynchronously.

**Request**

```http
POST /api/v1/execution-jobs
Authorization: Bearer ogk_live_xxx
Content-Type: application/json
```

Body: `ExecutionJobRequest`

```json
{
  "request": {
    "scenario": "restaurant",
    "params": {
      "restaurant_name": "Le Bernardin",
      "city": "New York",
      "date": "2026-05-01",
      "time": "19:00",
      "covers": 2,
      "cuisine": "French",
      "neighborhood": "Midtown"
    }
  },
  "profile": {
    "first_name": "Alex",
    "last_name": "Traveler",
    "email": "alex@example.com",
    "phone": "+15551234567"
  },
  "consent": {
    "allowTimeAdjustment": true,
    "maxTimeAdjustmentMinutes": 90,
    "maxRetries": 3,
    "blockedProviders": []
  },
  "clientMetadata": {
    "agentId": "acme-travel-bot",
    "userId": "end-user-abc123",
    "sessionId": "sess-xyz789",
    "idempotencyKey": "unique-key-for-retry-safety"
  }
}
```

#### `request.scenario` and `request.params` shapes

| scenario | required fields | optional fields |
|---|---|---|
| `restaurant` | `restaurant_name`, `city`, `date` (YYYY-MM-DD), `time` (HH:MM 24h), `covers` | `cuisine`, `neighborhood`, `budget_per_person` |
| `hotel` | `hotel_name`, `city`, `checkin` (YYYY-MM-DD), `checkout` (YYYY-MM-DD), `adults` | `star_rating`, `neighborhood`, `budget_max_per_night`, `room_preference` |
| `flight` | `origin`, `dest`, `date` (YYYY-MM-DD), `passengers` | `return_date`, `cabin_class`, `targetAirline`, `targetPrice`, `targetDepartureTime`, `targetFlightNumber` |
| `activity` | `event_name`, `city`, `event_date` (YYYY-MM-DD), `num_tickets` | `seat_type`, `budget_max_per_ticket` |

#### Profile options

Exactly one of:

- `profileId` (number) — reference to a `booking_profiles` row on the Onegent side (for self-hosted / integrated use cases).
- `profile` (object) — inline profile when you're bringing your own user data.

Inline `profile` requires at least `first_name`, `last_name`, `email`, `phone`. For flights also provide `dob`, `passport_number`, `passport_country`, optional `known_traveler_number`.

#### Consent policy (all optional)

| field | default | description |
|---|---|---|
| `allowTimeAdjustment` | `true` | Allow ±N-minute time shifts if the exact time isn't bookable |
| `maxTimeAdjustmentMinutes` | `90` | Upper bound for time shifts |
| `allowVenueSwitch` | `true` | Allow switching to alternate venues (not used by B 端 fallback today) |
| `maxRetries` | `3` | Retries for transient errors |
| `paymentPolicy` | `"stop_before_cvc"` | Always stops before card entry — no other value supported |
| `allowedProviders` | null | If set, only these provider IDs may be used |
| `blockedProviders` | `[]` | Provider IDs to skip in fallback chain |
| `maxJobDurationSeconds` | `420` | Soft cap on total execution time |

#### Response — `202 Accepted`

```json
{
  "jobId": "7c6a9f8b-3d2e-4e1a-8b5c-0f1e2d3c4b5a",
  "status": "pending",
  "scenario": "restaurant",
  "organizationName": "Acme Travel",
  "_links": {
    "self": "/api/v1/execution-jobs/7c6a9f8b-3d2e-4e1a-8b5c-0f1e2d3c4b5a",
    "audit": "/api/v1/execution-jobs/7c6a9f8b-3d2e-4e1a-8b5c-0f1e2d3c4b5a/audit"
  }
}
```

The executor runs asynchronously. Poll `GET /execution-jobs/{jobId}` for status.

#### Errors

- `400 invalid_json` — body isn't valid JSON.
- `400 invalid_request` — body fails zod validation; `error.details` has issue list.
- `401 *` — missing / malformed / revoked API key (see [Error codes](#error-codes)).
- `403 scenario_not_allowed` — this key's `allowed_job_types` doesn't include the requested scenario.
- `500 job_create_failed` — DB write failed; retry with the same `idempotencyKey`.

---

### `GET /execution-jobs/{jobId}`

Poll for the current state of a job.

**Response — `200 OK`**

```json
{
  "jobId": "7c6a9f8b-...",
  "status": "paused_payment",
  "handoffUrl": "https://www.opentable.com/booking/details?...",
  "sessionUrl": null,
  "summary": "Paused at payment gate for Le Bernardin",
  "decisionLog": [
    {
      "timestamp": "2026-04-24T14:02:11Z",
      "type": "time_adjusted",
      "message": "No slot at 19:00, switching to 19:30"
    }
  ],
  "attemptCount": 1,
  "usedFallback": false,
  "createdAt": "2026-04-24T14:01:02Z",
  "updatedAt": "2026-04-24T14:02:30Z",
  "completedAt": "2026-04-24T14:02:30Z"
}
```

#### `status` values

| value | meaning | next step |
|---|---|---|
| `pending` | Job created, executor not yet started | Keep polling |
| `running` | Executor is working | Keep polling (typical total: 1–5 minutes) |
| `paused_payment` | **Success path.** Autopilot drove the whole flow, stopped at CVC. Your user opens `handoffUrl` to complete payment | Terminal |
| `completed` | Fully booked (rare — sites without a card gate) | Terminal |
| `no_availability` | Confirmed nothing matches the request | Terminal |
| `needs_login` | Site required login the executor couldn't bypass | Terminal |
| `captcha` | Hard-blocked by CAPTCHA | Terminal |
| `error` | Unexpected failure (`error` field has details) | Terminal |

#### Errors

- `400 missing_job_id`
- `404 job_not_found`
- `401 *` — auth failures

---

### `GET /execution-jobs/{jobId}/audit`

Returns the structured decision log — one entry per autonomous decision Onegent made.

**Query params**

- `limit` (optional, default `500`, clamped `[1, 2000]`)

**Response — `200 OK`**

```json
{
  "jobId": "7c6a9f8b-...",
  "count": 7,
  "events": [
    {
      "jobId": "7c6a9f8b-...",
      "stepIndex": 0,
      "type": "job_started",
      "timestamp": "2026-04-24T14:01:02Z",
      "message": "Executing restaurant booking"
    },
    {
      "jobId": "7c6a9f8b-...",
      "stepIndex": 0,
      "type": "time_adjusted",
      "timestamp": "2026-04-24T14:02:11Z",
      "message": "Time shifted 19:00 → 19:30 (no slot at requested time)",
      "fromTime": "19:00",
      "toTime": "19:30"
    },
    { "type": "paused_payment", "timestamp": "...", "handoffUrl": "..." }
  ]
}
```

#### Event types

Lifecycle: `job_created`, `job_started`, `step_started`, `paused_payment`, `job_completed`, `job_failed`, `job_aborted`.

Decision: `step_attempt`, `action_allowed`, `action_denied`, `time_adjusted`, `venue_switched`, `provider_fallback`.

#### Errors

- `404 job_not_found` — the job itself doesn't exist (not just: it has no events)
- `401 *` — auth failures

---

### `GET /metrics/providers/{providerId}`

Per-provider success-rate metrics. Use this before committing to a booking to decide whether to accept Onegent's auto-provider selection, or to compare providers for your own routing logic.

**Query params**

- `timeRangeDays` (optional, default `30`, clamped `[1, 365]`)

**Response — `200 OK`**

```json
{
  "providerId": "opentable-com",
  "successRate": 0.87,
  "totalAttempts": 142,
  "acceptedCount": 124,
  "manualOverrideCount": 12,
  "failedCount": 6,
  "lastEventAt": "2026-04-23T22:14:03Z",
  "timeRangeDays": 30
}
```

**Empty data is not a 404** — if no events match, you get `successRate: 0, totalAttempts: 0`. Gate on `totalAttempts > N` before using `successRate` as evidence (N=5 is a reasonable floor).

#### Error codes

- `400 missing_provider_id`
- `401 *` — auth failures

---

## Job lifecycle

```
POST /execution-jobs           -> 202 { status: "pending" }
    |
    | (executor kicks off async, typical 30s–5min)
    v
GET /execution-jobs/{id}       -> status: "running"
    |
    v
GET /execution-jobs/{id}       -> status: one of
                                  - paused_payment  ← success path
                                  - completed
                                  - no_availability
                                  - needs_login | captcha | error
    |
    v
(terminal. poll once more after 30s to confirm, then stop)
```

Typical client loop: poll every 3–5 seconds until status becomes terminal, with a 10-minute ceiling.

---

## Error codes

Every error response is JSON:

```json
{ "error": { "code": "<snake_case>", "message": "<human-readable>" } }
```

### 401 Unauthorized (auth failures)

| code | when |
|---|---|
| `missing_authorization` | No `Authorization` header |
| `invalid_auth_scheme` | Header present but not `Bearer` |
| `empty_api_key` | `Bearer ` with nothing after |
| `malformed_api_key` | Doesn't match `ogk_(live\|test)_[A-Za-z0-9_-]{16,}` |
| `invalid_api_key` | Hash not found / key revoked |

### 400 / 403

| code | status | when |
|---|---|---|
| `invalid_json` | 400 | Body isn't valid JSON |
| `invalid_request` | 400 | Body fails zod validation (see `error.details`) |
| `missing_job_id` | 400 | Path param missing |
| `missing_provider_id` | 400 | Path param missing |
| `scenario_not_allowed` | 403 | Key's `allowed_job_types` doesn't include this scenario |

### 404 / 500 / 503

| code | status | when |
|---|---|---|
| `job_not_found` | 404 | jobId doesn't exist |
| `job_create_failed` | 500 | DB insert failed — retry with same `idempotencyKey` |
| `auth_backend_unavailable` | 503 | Auth DB is down (fail closed) |

---

## Quickstart — end-to-end curl

Assuming dev server at `localhost:3000` and a key you just minted:

```bash
KEY="ogk_live_xxx..."

# 1. Create a restaurant booking job
RESP=$(curl -s -X POST http://localhost:3000/api/v1/execution-jobs \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "request": {
      "scenario": "restaurant",
      "params": {
        "restaurant_name": "Le Bernardin",
        "city": "New York",
        "date": "2026-05-01",
        "time": "19:00",
        "covers": 2
      }
    },
    "profile": {
      "first_name": "Alex",
      "last_name": "Traveler",
      "email": "alex@example.com",
      "phone": "+15551234567"
    }
  }')

echo "$RESP"
JOB_ID=$(echo "$RESP" | python -c "import sys, json; print(json.load(sys.stdin)['jobId'])")
echo "Job ID: $JOB_ID"

# 2. Poll status (repeat every few seconds until terminal)
curl -s http://localhost:3000/api/v1/execution-jobs/$JOB_ID \
  -H "Authorization: Bearer $KEY" | python -m json.tool

# 3. View decision audit log
curl -s http://localhost:3000/api/v1/execution-jobs/$JOB_ID/audit \
  -H "Authorization: Bearer $KEY" | python -m json.tool

# 4. Check provider metrics
curl -s "http://localhost:3000/api/v1/metrics/providers/opentable-com?timeRangeDays=7" \
  -H "Authorization: Bearer $KEY" | python -m json.tool
```

---

## What's NOT in v1 yet (roadmap)

- **Webhooks** — today you poll. Webhook delivery on terminal status is Week 4+.
- **Pagination** — audit endpoint caps at 2000; cursor-based paging is Week 4+.
- **Rate limit enforcement** — `rate_limit_per_day` is only stored today, not enforced.
- **Multi-tenant read isolation** — currently any valid API key can read any jobId. Week 4 adds `organization_id` filtering.
- **Self-service key management** — no `/api/v1/api-keys` endpoint yet. Mint via CLI.
- **Activity scenario execution** — the shape is accepted but `runExecutionJob` throws `NOT_IMPLEMENTED` for `activity` (restaurant/hotel/flight work fully).
