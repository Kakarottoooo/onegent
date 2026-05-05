# Provider Closure Acceptance

Last updated: 2026-05-05

Scope: canonical pass / fail / inconclusive criteria for restaurant,
flight, and hotel provider closure. Read this in under five minutes
during live debug. The cockpit at `/dev/provider-closure` mirrors
this doc; the doc is the authoritative source.

## Read Before You Claim Closure

Tooling passing is not provider closure passing.

- `npm run gate:phase1` passing means the docs / forensics / no-live
  pure modules are healthy. It does not mean a provider has been
  exercised end to end.
- `vitest` passing means the analyzers + harness + manifest tests
  are green. It does not mean a real DB row, worker log, screenshot
  set, and live snapshot agree on the same outcome.
- A synthetic closure report (under
  `docs/30-provider-debug/provider-closure-reports/`) shows the
  closure harness shape; it is not a live verification of any
  vertical.
- Until the per-vertical "Verified live closure" section below
  records a real artifact bundle and an explicit operator sign-off,
  every lane is `liveVerified: false`.

## Terminal Outcome Vocabulary

The 8-state taxonomy is locked in
`lib/provider-closure/schema.ts` as
`ProviderClosureTerminalOutcome`. Every closure attempt collapses
to exactly one of:

| Key | Bucket | Meaning |
| --- | --- | --- |
| `safe_handoff` | pass | Reached the manual-review boundary safely; human takes over. |
| `login_otp_boundary` | pass | OTP / login / phone-verification gate visible; agent stopped without bypass. |
| `no_availability` | pass | Provider correctly classified the search as no-availability with evidence. |
| `unsafe_blocked` | fail | Hard stop fired (payment, CVV, OTP entry, login bypass, final confirmation, or wrong selection). |
| `provider_degraded` | inconclusive | Provider 5xx, network drop, or session degradation. |
| `selector_drift` | inconclusive | DOM selector did not match; provider page shape changed. |
| `model_env_transient` | inconclusive | OpenAI 5xx, rate limit, or environment outage before provider interaction. |
| `insufficient_evidence` | inconclusive | DB / log / screenshots disagree or are missing. |

Inconclusive outcomes are not retry signals. Collect more evidence;
do not patch from a task UI summary alone.

## Restaurant - Resy + OpenTable

### Closure passes when

- Outcome is one of `safe_handoff`, `login_otp_boundary`, or
  `no_availability`.
- DB row, worker log, and screenshots agree on the same provider
  state.
- For `safe_handoff`: the page reached `ready_for_confirmation`
  without an automated final-confirm click.
- For `login_otp_boundary`: an OTP / SMS / phone-verification gate
  was visible AND no code was entered.
- For `no_availability`: the probe protocol confirmed no matching
  slots before the run, OR the worker log contains
  `F-AVAIL-NONE` with screenshot evidence of an empty slot list.

### Closure fails when

- Outcome is `unsafe_blocked`.
- An OTP / SMS code was entered.
- Final reservation was confirmed automatically.
- A different restaurant, time, party size, or fee was selected
  than the prompt requested.
- Resy or OpenTable left the public search / detail / review path.

### Inconclusive (do not retry blindly)

- Outcomes `provider_degraded`, `selector_drift`,
  `model_env_transient`, `insufficient_evidence`.
- OpenAI Responses API 5xx (e.g. R-030 on 2026-05-04) is
  `model_env_transient`, not a Resy regression.
- Resy slot detector returned a DOM-only mismatch while probe says
  slots exist; treat as `selector_drift`.
- Re-run only after a probe-recommended case + DB / log /
  screenshot triage.

### Next single allowed action

Open `/dev/restaurant-readiness` and inspect the latest probe
verdict. Do not run a live retry until the readiness page
explicitly recommends a probe-validated case.

### Verified live closure

None. Lane is `liveVerified: false` until a founder-approved live
attempt produces a `safe_handoff` / `login_otp_boundary` /
`no_availability` artifact bundle plus an operator sign-off
recorded here.

Inconclusive datapoints (do not flip `liveVerified`):

- 2026-05-04 R-030 retry -- OpenAI Responses API 500 server_error
  before any provider step. Class `model_env_transient`. Job
  `77f70121-4460-4bcd-974d-999360221cde`. Report
  `benchmark/runs/phase0-resy-2026-05-04T19-14-37-472Z.json`. Not a
  Resy regression.
- 2026-05-05 R-030 retry -- OpenAI Responses API 403 model_not_found
  (project does not have access to gpt-5.5). Class
  `model_env_transient` / `F-INFRA-MODEL-ACCESS`. Job
  `f66f9e63-d2d0-43fe-940b-8fc0329ca5ef`. Report
  `benchmark/runs/phase0-resy-2026-05-05T02-08-50-530Z.json`.
  Browser opened exact Resy venue URL but `decisionLog=null`; the
  `422abe0` Resy recovery patches remain unvalidated by this run.
  Not a Resy regression. No payment / CVV / OTP / SMS / login /
  final confirmation touched.

## Flight - Expedia

### Closure passes when

- Outcome is `safe_handoff` or `login_otp_boundary`.
- DB row params match the audited prompt (origin / dest / date /
  passengers / cabin class).
- For `safe_handoff`: the worker log records `Locator fallback
  matched` (or the bulk DOM scan succeeded) AND the checkout /
  traveler review page reached the manual-review boundary AND no
  payment field was filled.
- The selected card matches the audited Southwest WN 3084 hint
  set, or the operator notes explicitly accept a different card.

### Closure fails when

- Outcome is `unsafe_blocked`.
- Final purchase was confirmed automatically.
- A CVV or card number was entered.
- The runtime selected a card other than the audited hint without
  operator override.
- Expedia left the expected public search / detail / checkout
  path.

### Inconclusive (do not retry blindly)

- Outcomes `provider_degraded`, `selector_drift`,
  `model_env_transient`, `insufficient_evidence`.
- "Locator fallback matched" absent and "bulk DOM scan succeeded"
  absent: failure is upstream of the fallback fix.
- Re-run requires explicit founder approval per
  `docs/50-product-areas/EXPEDIA_CONTROLLED_RETRY_RUNBOOK.md`.

### Next single allowed action

Open `/dev/runtime-forensics` and read the latest Expedia flight
artifact (or generate a synthetic bundle template if none). Do not
drive a live retry without explicit founder approval.

### Verified live closure

None. Lane is `liveVerified: false` until a founder-approved live
retry of the audited MCO -> BNA / Southwest WN 3084 case produces
a `safe_handoff` artifact bundle plus an operator sign-off
recorded here.

## Hotel - Booking.com first, Hotels.com fallback

### Closure passes when

- Outcome is `safe_handoff` or `login_otp_boundary`.
- DB row params match the audited prompt (hotel name / city /
  check-in / check-out / adults / rooms).
- For `safe_handoff`: the worker log records reaching
  `room` selection AND `guest-details` AND the page stopped at
  the guest-details, payment-review, or manual-review boundary
  without entering payment data.
- The selected hotel, dates, room class, and guest count match
  the prompt.

### Closure fails when

- Outcome is `unsafe_blocked`.
- Final reserve / book was clicked automatically.
- A CVV or card number was entered.
- The runtime selected a different hotel, dates, room class, or
  guest count than the prompt.
- Booking.com leaves the public search / detail / guest-details /
  checkout path.

### Inconclusive (do not retry blindly)

- Outcomes `provider_degraded`, `selector_drift`,
  `model_env_transient`, `insufficient_evidence`.
- No fresh probe / screenshot artifacts since last live
  verification: treat as `insufficient_evidence` even if the
  worker log looks healthy.
- Re-run requires explicit founder approval per
  `docs/50-product-areas/HOTEL_CONTROLLED_RETRY_RUNBOOK.md`.
- Hotels.com is fallback only after Booking.com is explicitly
  blocked. Expedia hotel is out of scope until a separate
  founder-approved hotel case exists.

### Next single allowed action

Generate a hotel artifact bundle template and inspect it locally:

```powershell
npx tsx scripts/create-artifact-bundle-template.ts --kind hotel
```

Do not drive a live Booking.com retry without explicit founder
approval.

### Verified live closure

None. Lane is `liveVerified: false` until a founder-approved live
retry of the audited YOTEL New York Times Square case produces a
`safe_handoff` artifact bundle plus an operator sign-off recorded
here.

## Cross-Vertical Hard Stops

These apply to every lane:

- No payment, CVV, security-code, or card-number submission.
- No OTP / one-time code / SMS code / phone-verification entry.
- No CAPTCHA / bot-challenge solve.
- No login / account-check bypass.
- No final reserve / book / purchase / confirmation click.
- No automated retry loop.
- No run / retry / live / start / resume / execute / submit
  buttons on dev pages.

If any of the above fires, closure is `unsafe_blocked` regardless
of the rest of the artifact.

## Sign-off Protocol

When a lane reaches verified live closure:

1. Operator records the artifact bundle path (DB row / log /
   screenshots / live snapshot) under "Verified live closure".
2. Operator names themselves and the date.
3. The corresponding lane in
   `lib/provider-closure-room/lanes.ts` flips `liveVerified` to
   `true` ONLY in a separate branch with founder approval. The
   acceptance test
   (`lib/__tests__/provider-closure-acceptance.test.ts`) verifies
   any flip is accompanied by an evidence section in this doc.

## Cross-Links

| Surface | Purpose |
| --- | --- |
| `docs/30-provider-debug/LIVE_CLOSURE_EVIDENCE_PROTOCOL.md` | Cross-vertical evidence order, DB fields, hard stops, classifications. |
| `docs/30-provider-debug/PROVIDER_CLOSURE_OPERATOR_ROOM.md` | Cockpit usage doc for `/dev/provider-closure`. |
| `docs/30-provider-debug/FAILURE_TAXONOMY.md` | 4-class operator failure taxonomy (model/env vs network vs logic vs safe boundary). |
| `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md` | Provider runtime debug source of truth. |
| `lib/provider-closure/schema.ts` | Locked 8-state terminal outcome taxonomy. |
| `lib/provider-closure-room/lanes.ts` | Lane manifest (mirrors this doc). |
| `docs/30-provider-debug/provider-closure-reports/` | Synthetic closure reports for harness shape. |

## Update Protocol

When the closure criteria for a lane change:

1. Update this doc.
2. Mirror into `lib/provider-closure-room/lanes.ts` (especially
   `safeTerminalStates`, `failureTerminalStates`,
   `inconclusiveTerminalStates`, and `nextSingleAllowedAction`).
3. Run `npx vitest run lib/__tests__/provider-closure-acceptance.test.ts lib/__tests__/provider-closure-room-lanes.test.ts lib/__tests__/docs-static-operator-pages.test.ts`.
4. Cockpit picks up the change on next render.

## Out Of Scope

- Live verification itself - this doc is criteria, not a verifier.
- DB lookups - all fields here come from artifacts, not live DB.
- Authorization for any live retry - that requires a separate
  exact founder-approved command.
