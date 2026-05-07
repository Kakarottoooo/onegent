# Layered Benchmark Dogfood Plan

Last updated: 2026-05-07

This plan defines how Onegent should move from initial founder dogfood closure
to measured reliability without burning effort on blind retries. It is a
planning and evidence document only.

## Goal

Measure each vertical as a layered execution system:

```text
L1 provider runtime
-> evidence-backed failure classification
-> L2 Browser Harness recovery when eligible
-> optional L1 patch proposal
-> final benchmark verdict
```

The benchmark should answer:

- How many cases pass with existing deterministic/provider runtime?
- How many cases fail for page/control drift that L2 could recover?
- How many cases are real provider boundaries or true unavailability?
- How often do task UI status, logs, and screenshots tell the same story?
- Which failures should become durable L1 provider patches?

## What Counts As A Pass

A case passes when it reaches a useful user-controlled review/continue point
or a correct terminal classification with evidence:

- Target provider/location/date/item selected correctly.
- Task status lands in the correct queue/live/history bucket.
- Logs, decision entries, screenshots, and current URL are present or the
  absence is explicitly explained.
- Final irreversible provider action remains user-controlled.
- No stale `running/loading` task remains after the browser or worker exits.

## Layer Classifications

### L1 Direct Pass

Existing provider runtime completes the path to the review/continue boundary
or correct terminal classification.

### L2 Eligible

Escalate only when evidence shows the page shape or control model changed:

- `selector_drift`
- `click_miss`
- `iframe_miss`
- `field_fill_miss`
- `progress_stall`
- `unknown_page_mutation`

### Not L2 Eligible

Do not escalate when the right outcome is a product/provider boundary:

- true no availability with exact evidence
- provider/network degradation
- account/session checkpoint
- user-only seat or option choice
- final confirmation checkpoint
- insufficient evidence
- local model/env/DB issue

## First Measurement Ladder

Run in this order:

1. No-live benchmark corpus, all verticals, 50 cases.
2. No-live benchmark corpus, all verticals, 200 cases.
3. Small founder dogfood benchmark, 5 cases per vertical.
4. Expanded founder dogfood benchmark, 10 cases per stable vertical.
5. Only after steps 1-4: consider 20-case vertical batches.

Do not jump directly to 20 or 50 live-like runs. Fix the top repeated failure
class between batches.

## Per-Vertical Starting Point

| Vertical | Current status | First benchmark focus |
| --- | --- | --- |
| Restaurant | OpenTable initial closure reached; Resy is network/IP-sensitive follow-up | OpenTable-first 5/10 cases, with Resy treated as non-blocking fallback data |
| Hotel | Initial dogfood closure reached for Booking.com/Expedia-style review path | false no-availability guard, provider fallback, guest/review boundary |
| Flight | Expedia initial dogfood closure reached | card match, overlay handling, checkout/review continuation, stale-worker evidence |
| Activity | Ticketmaster initial dogfood closure reached | ad tab suppression, event/date selection, seat-selection checkpoint, stale-run recovery |

## Required Report Columns

Every benchmark report should include:

```text
case_id
vertical
provider
input_utterance
normalized_intent
target
L1_result
failure_class
L2_eligible
L2_result
final_verdict
artifact_completeness
task_status_correct
owner
dogfood_bug_id
patch_proposal
notes
```

## Merge Discipline

The shared benchmark schema should come from Goal's Layered Benchmark V2
branch. Vertical agents should add fixtures and recovery rules that plug into
that shape. If a vertical branch invents its own incompatible schema, treat it
as a draft and send it back before merge.

## Initial Success Targets

For the first no-live batch:

- routing mismatch: 0
- artifact completeness: at least 0.90
- unknown failure rate: below 0.10
- owner assigned for every failure class

For the first 5-case-per-vertical dogfood batch:

- no wrong target selection
- no stale `running/loading` terminal state
- no missing evidence stream when a task ran
- clear user-controlled checkpoint when the provider needs a user choice

## Follow-Up After Each Batch

After each batch, do not immediately run a larger batch. First:

1. Group failures by class.
2. Pick the top repeated failure.
3. Decide whether it is L1 patch, L2 recovery, product boundary, or data issue.
4. Add a regression fixture.
5. Re-run the smallest affected benchmark batch.
