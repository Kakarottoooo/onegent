# Layered Benchmark V2

Last updated: 2026-05-07

Layered Benchmark V2 is a no-live benchmark/orchestration layer for future
restaurant, hotel, flight, and activity provider closure work. It models what
should happen after a live attempt has already produced evidence, but it never
starts providers, Browser Harness, workers, OpenAI calls, checkout flows, or
external browser automation.

## What It Measures

Each synthetic case models this chain:

1. L1 provider runtime result.
2. Evidence-backed failure classification.
3. L2 Browser Harness escalation eligibility.
4. Optional simulated L2 recovery result.
5. Optional patch proposal metadata.
6. Final benchmark verdict.

The shared schema lives in `lib/execution-layer/layered-benchmark.ts`. The CLI
is `scripts/layered-benchmark.ts`.

## Case Contract

Every case records:

- `vertical`: `restaurant`, `hotel`, `flight`, or `activity`.
- `provider`: current provider under test.
- `taskIntent`: raw request plus structured intent fields.
- `expectedTarget`: provider stage, safe terminal state, and hard stop.
- `l1Result`: the first provider runtime terminal state.
- `failureClass`: normalized failure class.
- `evidenceCompleteness`: synthetic marker, fixture id, DB row, decision log,
  worker log, screenshot, current URL, benchmark report, and score.
- `artifactExpectations`: required sources, evidence contract,
  classification signals, patch proposal fields, owner hint, and owner action.
- `l2Eligible`: whether the class should be recoverable by L2.
- `l2SimulatedResult`: deterministic simulated Browser Harness outcome.
- `patchProposal`: whether a patch should be proposed and where ownership
  likely belongs.
- `owner`: `nlu`, `planner`, `provider-runtime`, `browser-harness`,
  `task-workspace`, or `product/manual-boundary`.
- `hotelContract`: optional hotel-only evidence contract for no-availability,
  provider fallback, preserved stay params, artifact completeness, and stale
  running state.
- `dogfoodBugLink`: optional DOG id from the founder bug inbox.

Hotel cases use a dedicated no-live fixture corpus for:

- L1 direct pass.
- Exact no-availability with strong hotel/date/stay evidence.
- Weak/generic no-availability classified as provider-degraded and
  provider-fallback eligible.
- Provider degraded.
- Fallback recommendation preserving hotel, city, check-in, check-out, adults,
  rooms, and budget.
- Room selection drift.
- Guest/review boundary.
- Account/session boundary.
- Artifact incomplete.
- Stale/mixed running evidence classified as insufficient evidence.

## Escalation Rules

Escalate to L2 only when both conditions are true:

- Evidence completeness score is at least `0.9`.
- Failure class is one of:
  - `selector_drift`
  - `click_miss`
  - `iframe_miss`
  - `field_fill_miss`
  - `progress_stall`
  - `unknown_page_mutation`

Do not escalate for:

- `true_no_availability`
- `provider_degraded`
- `account_checkpoint`
- `user_only_final_action`
- `insufficient_evidence`
- `network_model_env_issue`
- `routing_mismatch`

These rules are intentional. L2 is for page/control recovery only, not for
bypassing human-only boundaries, account checks, final actions, or missing
evidence.

Hotel provider fallback is tracked separately from Browser Harness L2. Weak
hotel no-availability and provider degradation can be provider-fallback
eligible while still being Browser Harness L2-ineligible. The fallback contract
must preserve the exact hotel, city, check-in, check-out, adults, rooms, and
budget before considering Hotels.com or Expedia hotel.

## Commands

Run a quick JSON report:

```bash
npx tsx scripts/layered-benchmark.ts --vertical all --count 50 --mode no-live --json
```

Run the Expedia flight fixture pack:

```bash
npx tsx scripts/layered-benchmark.ts --vertical flight --count 10 --mode no-live --json
```

The first 10 flight cases are Expedia-specific no-live fixtures covering direct
pass, wrong-airline rejection, wrong-time rejection, price-only insufficient
evidence unless target identity is strong, checkout-with-missing-traveler-fields,
stale/mixed worker evidence, dismissable promo overlay, account-required
boundary, provider degradation, and final review checkpoint. Each case carries
owner, artifact expectations, L2 eligibility, and patch proposal fields.
Flight cases 11-15 extend the Expedia corpus with target-card-not-visible
no-availability, card-scan-before-fallback failure, fallback-matched/no-checkout
stall, model/env transient, and hidden-flight-number target-time pass evidence.
For fallback-matched/no-checkout, a generic checkout marker is not closure
unless paired with safe-handoff or manual-review evidence and the selected
candidate, fare modal, current URL, and screenshot path are preserved.

Run a founder-readable markdown report:

```bash
npx tsx scripts/layered-benchmark.ts --vertical all --count 50 --mode no-live --markdown
```

Run a gate:

```bash
npx tsx scripts/layered-benchmark.ts --vertical all --count 50 --mode no-live --gate --min-artifact-completeness 0.9 --max-unknown-failure-rate 0.1 --max-routing-mismatch 0 --min-l1-direct-pass 0.2 --min-l1-l2-recovered-pass 0.4
```

Use `--vertical restaurant|hotel|flight|activity|all` and `--count
5|10|20|50` for smaller or larger slices. `--mode no-live` is the only
implemented mode.

## Interpreting Verdicts

- `l1_direct_pass`: L1 reached a safe terminal state with complete evidence.
- `l2_recovered_pass`: L1 hit a page/control blocker and simulated L2 recovered.
- `expected_provider_block`: provider availability, provider degradation, or
  model/env infrastructure blocked the case with evidence.
- `expected_manual_boundary`: account checkpoint or user-only final action.
- `needs_runtime_patch`: evidence points to a page/control patch.
- `routing_mismatch`: request entered the wrong vertical before provider work.
- `insufficient_evidence`: artifact bundle cannot support recovery or closure.
- `not_recovered`: L2 was eligible but simulated recovery did not succeed.

Benchmark success is not live provider closure. A vertical is only
provider-proven when separate closure evidence records DB fields, decision log,
worker/Next logs, screenshots, current URL/stage, and a safe terminal state.
