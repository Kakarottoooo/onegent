# Provider Evidence And Closure

Last updated: 2026-05-10

This is the compact operator contract for provider evidence, closure, and
failure classification. It replaces the older split docs for live closure
evidence, closure acceptance, closure cockpit usage, and failure taxonomy.

Canonical path: `docs/30-provider-debug/PROVIDER_EVIDENCE_AND_CLOSURE.md`.

This document does not authorize a live provider run. A human must separately
approve one exact command before any live provider, OpenAI, Computer Use, or
browser automation is used.

## Read This First

Tooling passing is not provider closure passing.

- `npm run gate:phase1` passing means docs, no-live modules, and tests are
  healthy. It does not prove a provider was exercised.
- A synthetic closure report shows harness shape only. It is not live
  verification.
- A provider lane is not live verified unless this document records a real
  artifact bundle and accepted closure for that lane.
- The read-only cockpit at `/dev/provider-closure` mirrors this contract. It
  must not start, resume, retry, or execute live provider work.

## Hard Stops

Stop and record evidence before any of these:

- Payment submission or final purchase, reservation, booking, or ticket
  confirmation.
- CVV, CVC, security code, card number, or billing submission.
- OTP, one-time code, SMS code, phone verification, CAPTCHA, bot challenge, or
  provider account verification.
- Login bypass, credential guessing, or account creation.
- Seat selection or ticket quantity surfaces unless the approved task
  explicitly scopes a user handoff there.
- Any unclear button that could commit payment, reservation, or purchase.

## Evidence Bundle Order

Use this order before deciding whether a run is closed, failed, or
inconclusive:

1. Latest `booking_jobs` row and `steps[0].body.params`.
2. `steps[0].error`, `steps[0].decisionLog`, and task state.
3. Worker log excerpt bounded by job id.
4. Screenshot paths and latest visible page state.
5. Live snapshot paths, if the harness produced them.
6. Final URL or handoff URL.
7. Exact hard stop or safe boundary reached.
8. Operator note explaining why the evidence supports the classification.

Missing DB, log, screenshot, or URL evidence usually means
`inconclusive_or_insufficient_evidence`, not provider closure.

## Failure Taxonomy

Classify every controlled run into one of these categories before patching:

### Model / env transient

Planner, OpenAI, env, database, or local runtime failed before the provider was
meaningfully exercised.

Signals:

- OpenAI Responses API 500 or 403 `model_not_found`.
- Missing model access, wrong project, or env mismatch.
- Neon/DB transient that prevents reading terminal state.
- Harness or local browser disconnected before provider evidence was captured.

Action: fix or preflight the environment. Do not patch provider selectors from
this evidence.

### Provider network degraded

The provider was reached, but the page was unavailable or blocked by provider
infrastructure.

Signals:

- Provider 404, 5xx, maintenance, rate limit, or regional block.
- Page loads no actionable content after screenshots and logs confirm the
  provider state.

Action: mark degraded or retry only with explicit evidence-led approval.

### Provider logic failure

The provider rendered actionable content, but Onegent selected the wrong target,
missed a visible action, produced false success, or collected incomplete
evidence.

Signals:

- Wrong card, wrong date, wrong venue, wrong airline, wrong time.
- Visible candidate exists but runtime says no availability.
- Checkout or handoff claim lacks required fields or artifacts.

Action: write a no-live regression, patch the runtime or analyzer, then rerun
only the affected case.

### Safe boundary reached

The run reached the intended manual review, login, seat selection, payment, or
provider handoff boundary without crossing a hard stop.

Signals:

- Review or handoff screen visible with screenshot and final URL.
- Login or OTP required and user action is the next step.
- Seat selection or payment boundary visible, with no automated final action.

Action: record safe closure. Do not keep clicking.

## Terminal Outcome Vocabulary

The closure schema lives in `lib/provider-closure/schema.ts`. Current terminal
outcomes are:

- `safe_handoff`
- `login_otp_boundary`
- `no_availability`
- `provider_degraded`
- `selector_drift`
- `model_env_transient`
- `unsafe_blocked`
- `insufficient_evidence`

`lib/provider-closure-room/lanes.ts` partitions these outcomes per vertical into
safe, failure, and inconclusive buckets.

## Restaurant

### Closure passes when

- OpenTable or Resy reaches safe handoff, manual review, login/OTP boundary, or
  correct no availability with evidence.

### Closure fails when

- The runtime selects the wrong venue, date, time, party size, or claims success
  without evidence.

### Inconclusive (do not retry blindly)

- Model/env, DB, screenshot, or worker-log evidence is missing.

### Next single allowed action

Inspect the evidence bundle in `/dev/provider-closure` and compare the DB row,
worker log, screenshot, and handoff URL before deciding on a patch.

### Verified live closure

- OpenTable Sirrah safe handoff accepted closure is recorded in the current
  lane manifest.

## Flight

### Closure passes when

- Expedia reaches checkout manual review on the audited target flight card.

### Closure fails when

- Wrong airline, wrong time, price-only fallback, or incomplete traveler fields
  are promoted to success.

### Inconclusive (do not retry blindly)

- Target card or checkout evidence is stale, mixed, or artifact-incomplete.

### Next single allowed action

Inspect the Expedia artifact bundle and classify the visible card, checkout, and
traveler-field evidence before making any provider runtime patch.

### Verified live closure

- None.

## Hotel

### Closure passes when

- Booking.com, Expedia, or Hotels.com reaches room selection, guest details, or
  payment manual review with scoped stay evidence.

### Closure fails when

- Generic no-availability copy is treated as stay-specific proof, room drift is
  ignored, or stale running evidence is promoted to terminal closure.

### Inconclusive (do not retry blindly)

- DB, worker log, screenshot, current URL, or handoff URL evidence is missing.

### Next single allowed action

Inspect current URL, handoff URL, screenshot, DB row, and stale-running evidence
before assigning the failure to provider-runtime or task-workspace.

### Verified live closure

- None.

## Cockpit And CLI

Use `/dev/provider-closure` for read-only triage. The cockpit is allowed to
refresh and display evidence only. It must not contain run/retry/live/start/
resume/execute/submit controls.

Do not add run/retry/live buttons to provider closure docs or dev surfaces.

Useful no-live commands:

```powershell
npx tsx scripts/provider-closure.ts --help
npx tsx scripts/provider-closure-war-room.ts preflight --vertical restaurant
npx tsx scripts/provider-closure-war-room.ts preflight --vertical flight
npx tsx scripts/provider-closure-war-room.ts preflight --vertical hotel
npx tsx scripts/provider-closure-war-room.ts analyze --vertical <restaurant|flight|hotel> --bundle .tmp\<bundle>.json --markdown
npx tsx scripts/provider-closure-war-room.ts summarize --all
npx tsx scripts/provider-closure-war-room.ts demo-verdict
```

Synthetic report examples are historical references under
`docs/90-archive/provider-debug/provider-closure-reports/` and
`docs/90-archive/provider-debug/provider-closure-war-room/`.

War-room verdict labels used by generated reports:

- `live_closed_safe_boundary`
- `live_blocked_provider_or_network`
- `live_blocked_selector_or_dom`
- `live_blocked_model_or_env`
- `not_live_verified`
- `unsafe_or_disallowed_boundary`

## Worked Example

R-030 on 2026-05-04 is the canonical model/env transient example:

```text
Task id: 9ca2a595-09cd-4f03-bb19-2b59c474089b
Job id: 77f70121-4460-4bcd-974d-999360221cde
Request id: req_ce42a48137424a938a7893b131416d28
Report: benchmark/runs/phase0-resy-2026-05-04T19-14-37-472Z.json
Failure: OpenAI Responses API 500 server_error
Classification: model/env transient, not as a provider 5xx
```

The provider was not meaningfully exercised, so provider selector patches would
have been unsupported.

## Historical Sources

The long source docs that fed this compact contract are archived under
`docs/90-archive/provider-debug/`:

- `FAILURE_TAXONOMY.md`
- `LIVE_CLOSURE_EVIDENCE_PROTOCOL.md`
- `PROVIDER_CLOSURE_ACCEPTANCE.md`
- `PROVIDER_CLOSURE_OPERATOR_ROOM.md`
