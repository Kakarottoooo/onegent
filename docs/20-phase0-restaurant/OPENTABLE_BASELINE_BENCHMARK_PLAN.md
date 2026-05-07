# OpenTable Baseline Benchmark Plan

Last updated: 2026-05-07

This plan defines the restaurant lane for the first layered benchmark batch.
It uses OpenTable-first cases because Phase 0A closed through OpenTable, while
Resy remains a provider/network follow-up lane.

## Purpose

Prove that the restaurant flow is repeatable beyond the Sirrah dogfood case:

```text
restaurant request
-> provider search/detail page
-> correct venue/date/time/party
-> contact/review boundary
-> task evidence and status
```

Do not treat this plan as approval to run broad live provider workflows. It is
the case design and scoring layer for future benchmark runs.

## Current Positive Evidence

Sirrah / OpenTable founder dogfood:

```text
job: 3bbe2ac4-c4cd-409f-8c11-6a83d2f81485
venue: Sirrah
city: New York
date: 2026-05-14
time: 20:00
party: 1
outcome: ready_for_confirmation / safe handoff
```

The task reached OpenTable booking details with the phone field filled and the
final provider action visible for the user. It did not click the final provider
action.

## First 5 OpenTable-First Cases

Use these as the first restaurant layer-1 baseline candidates. Replace or skip
any case whose availability probe/search evidence is weak at run time.

| Case | Input | Venue hint | City | Date/time | Party | Expected provider path |
| --- | --- | --- | --- | --- | ---: | --- |
| `ot-nyc-sirrah-001` | book Sirrah in New York next Thursday at 8pm for 1 | Sirrah | New York | relative next Thu 20:00 | 1 | OpenTable direct/detail |
| `ot-nyc-french-001` | book a French restaurant in New York tomorrow at 7pm for 2 | cuisine French | New York | tomorrow 19:00 | 2 | OpenTable search/listing |
| `ot-nyc-italian-001` | book an Italian restaurant in New York Friday at 7:30pm for 2 | cuisine Italian | New York | Friday 19:30 | 2 | OpenTable search/listing |
| `ot-nyc-japanese-001` | book a Japanese restaurant in New York Saturday at 6:30pm for 2 | cuisine Japanese | New York | Saturday 18:30 | 2 | OpenTable search/listing with cuisine respected |
| `ot-nyc-steak-001` | reserve a steakhouse in New York at 8pm for 2 | cuisine steakhouse | New York | target date from app context | 2 | OpenTable search/listing |

## Expand To 10 Cases

After the first five cases produce evidence:

- Add 3 named-venue cases with known OpenTable pages.
- Add 2 cuisine-only cases that stress reranking.
- Keep all cases in New York until task UI/evidence is stable.

Do not mix Resy into the first 10 cases unless the run is explicitly marked as
provider/network follow-up. The goal is to measure repeatable restaurant
runtime behavior, not desktop/IP-specific Resy availability.

## Pass Criteria

A case passes when all of the following are true:

- Correct city/date/time/party were preserved.
- Venue or cuisine constraint was respected.
- Provider page reached the expected venue/search context.
- If a booking details/review page exists, the task stops there for user
  review.
- Task status is not stuck in `running` / `loading`.
- Screenshots and logs are available, or the missing artifact reason is
  explicit.
- No wrong venue is selected as a false positive.

## Failure Classes

Use these restaurant-specific classes until the shared Layered Benchmark V2
schema lands:

| Class | Meaning | L2 eligible? |
| --- | --- | --- |
| `restaurant_target_mismatch` | Wrong venue or cuisine selected | yes, if page evidence shows selector/rerank drift |
| `restaurant_slot_click_miss` | Correct venue/time visible but not clicked | yes |
| `restaurant_listing_stall` | Search/listing page reached but no defensible next action | yes |
| `restaurant_true_no_availability` | Exact target has no available slot with evidence | no |
| `restaurant_provider_degraded` | Provider/network/session prevents reliable classification | no |
| `restaurant_task_state_stale` | Browser/worker ended but task stayed running/loading | product/runtime fix |
| `restaurant_artifact_incomplete` | Task ran but evidence stream is absent or unclear | product/runtime fix |

## Evidence Contract

For each case, capture:

```text
job_id
session_id
input_utterance
normalized_intent
provider
start_url
current_url
task_status
step_status
decision_log_summary
worker_log_path
screenshot_count
final_provider_state
failure_class
```

## How This Plugs Into Layered Benchmark V2

When Goal's shared runner lands, map these restaurant fields:

- `case_id` -> table Case
- `vertical` -> `restaurant`
- `provider` -> `opentable`
- `L1_result` -> pass/failure class from v1 provider runtime
- `L2_eligible` -> true only for selector/click/listing drift
- `dogfood_bug_id` -> `DOG-009` for cuisine/rerank issues, `DOG-004` for
  artifact gaps, or a new row if a new product issue appears

## Stop Conditions

Stop a restaurant batch early if:

- two consecutive cases produce stale task state;
- screenshots/logs are unavailable for tasks that clearly ran;
- cuisine/rerank misses dominate named-venue or cuisine-only cases;
- provider network/session behavior makes OpenTable evidence unreliable.

Fix the repeated failure class before expanding from 5 to 10 cases.
