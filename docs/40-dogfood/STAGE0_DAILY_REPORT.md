# Stage 0 Operator Report

Generated: 2026-05-07T12:00:00.000Z
Verdict: yellow
Reason: Dogfood-only: no-live benchmark gates pass, but private alpha cannot be called green until real submissions and user value scores are collected.

## Capture Benchmark

Fixtures: 550
Routing mismatch: 0
Task-ready accuracy: 100%
Artifact completeness: 100%
Unknown failure: 0%
Artifact gap closures: 4/4
Dogfood links: DOG-005, DOG-009, DOG-010, DOG-activity-provider-url

## Internal Benchmark

Cases: 200
Success rate: 77.5%
Artifact completeness: 100%
Routing mismatch: 0

## Layered Benchmark

Cases: 50
Artifact completeness: 96%
Unknown failure: 4%
L1 direct pass: 20%
L1 + L2 recovered pass: 40%

## Activity Skill Runtime

Readiness: yellow
No-live gate: PASS
Provider coverage: 5/5
URL fixtures: 145
Exact-event ready: 32
Listing needs choice: 79
Unsafe boundary: 0
Wrong target: 0
Host impersonation escapes: 0
Patch proposal candidates: 97
Controlled lab runs: 0

## Activity Skill Lab Evidence

Evidence root: .stage0b-evidence
Total runs: 0
Result files: 0
Invalid files: 0
Safe outcomes: 0
Unsafe boundary violations: 0
Wrong target / candidate signals: 0
Provider degraded: 0
Skill patch needed: 0
Patch proposals: 0

| Provider | Runs |
| --- | ---: |
| `ticketmaster` | 0 |
| `seatgeek` | 0 |

| Classification | Runs |
| --- | ---: |
| `exact_event_ready` | 0 |
| `provider_listing_needs_choice` | 0 |
| `single_candidate_ready` | 0 |
| `safe_handoff_reached` | 0 |
| `user_seat_selection_required` | 0 |
| `account_session_required` | 0 |
| `payment_or_final_action_required` | 0 |
| `provider_degraded` | 0 |
| `insufficient_evidence` | 0 |
| `skill_patch_needed` | 0 |

## Private Alpha Intake

Readiness: yellow
Gate: PASS
Fixture seeds: 3
Sensitive submissions: 0

## Agent Intake

Ready to merge: 3
Needs follow-up: 1
Reject: 1
Blocked branches: claude/activity-runtime-stage0-followup, codex/unsafe-stage0-branch

## Performance Measurement

Mode: stage0-static
Endpoints: 8
High risk: 0
Medium risk: 0
Findings: 0

| Endpoint | Owner | Risk | Findings | Suggested next patch |
| --- | --- | --- | ---: | --- |
| `/api/app/bootstrap` | `app-shell` | `low` | 0 | Keep bootstrap to compact sidebar/session rows and move task/history detail behind lazy endpoints. |
| `/api/chat/sessions` | `app-shell` | `low` | 0 | Return compact session rows by default; fetch message history only for the selected session. |
| `/api/rooms/compact-list` | `rooms` | `low` | 0 | Keep room cards compact and lazy-load member/message/proposal detail after room open. |
| `/api/calendar/jobs` | `calendar` | `low` | 0 | Keep calendar jobs as shell metadata and load Google month/status independently. |
| `/api/contacts/bootstrap` | `contacts` | `low` | 0 | Keep contacts bootstrap to compact cards; lazy-load suggestions, blocks, and relationship detail. |
| `/api/memory/compact` | `memory` | `low` | 0 | Keep memory compact summary bounded; load full memory detail only after the user opens insights. |
| `/api/booking-jobs/compact-list` | `task-workspace` | `low` | 0 | Keep task list free of steps, logs, screenshots, and decision logs; detail remains per selected task. |
| `/api/booking-jobs/summary` | `task-workspace` | `low` | 0 | Keep counters cheap and avoid loading job detail or evidence for collapsed tasks. |

## Top Failure Classes

| Failure class | Count |
| --- | ---: |
| `internal:planner_missing_required_field` | 20 |
| `layered:selector_drift` | 7 |
| `internal:manual_boundary_expected` | 5 |
| `internal:performance_budget_exceeded` | 5 |
| `internal:provider_simulated_block` | 5 |
| `internal:stale_session_or_provider_degraded` | 5 |
| `internal:unsupported_request` | 5 |
| `layered:insufficient_evidence` | 5 |
| `layered:provider_degraded` | 5 |
| `layered:account_checkpoint` | 4 |

## Owner Summary

| Owner | Failures | Signals |
| --- | ---: | --- |
| `planner` | 20 | internal benchmark failures 20/53 |
| `provider-runtime` | 18 | internal benchmark failures 9/9; layered benchmark failures 9/11 |
| `product/manual-boundary` | 10 | internal benchmark failures 10/10 |
| `task-workspace` | 9 | internal benchmark failures 6/16; layered benchmark failures 3/3 |
| `browser-harness` | 2 | layered benchmark failures 2/10 |

## Top Blockers By Owner

| Priority | Owner | Blocker | Evidence |
| --- | --- | --- | --- |
| `p0` | `alpha-ops` | Private alpha is not green from real supervised submissions. | 3 intake sample(s), readiness yellow, 0 safe-miss seed(s). |
| `p1` | `activity-skill-runtime` | Activity Skill Runtime needs controlled Browser Harness lab evidence before production runtime wiring. | 145 no-live fixture(s), 0 controlled lab run(s), no-live gate PASS. |
| `p1` | `provider-runtime` | Provider-runtime no-live failures need fixture-backed patches before more live attempts. | 4% layered unknown failures, 5 simulated provider blockers. |
| `p1` | `codex` | Returned agent branches need metadata triage before merge validation. | 3 ready, 1 follow-up, 0 rebase, 1 reject. |
| `p2` | `planner` | Benchmark failures remain for this owner. | 20 failure(s): internal benchmark failures 20/53. |
| `p2` | `product/manual-boundary` | Benchmark failures remain for this owner. | 10 failure(s): internal benchmark failures 10/10. |
| `p2` | `task-workspace` | Benchmark failures remain for this owner. | 9 failure(s): internal benchmark failures 6/16. |
| `p2` | `browser-harness` | Benchmark failures remain for this owner. | 2 failure(s): layered benchmark failures 2/10. |

## Next 5 Actions

| Priority | Owner | Action | Reason |
| --- | --- | --- | --- |
| `p1` | `provider-runtime` | Use layered benchmark failures to pick the next fixture-backed provider hardening branch. | 5 simulated provider blockers remain in the no-live corpus. |
| `p1` | `provider-runtime` | Prioritize L1 runtime patches over claiming L2 recovery readiness. | Layered L1+L2 recovered pass rate is 40%. |
| `p0` | `alpha-ops` | Collect supervised private-alpha submissions and score them through the intake gate. | Private alpha readiness is yellow; synthetic fixtures cannot make it green. |
| `p1` | `activity-skill-runtime` | Run the 20-case controlled Activity Provider Skill Runtime lab and convert failures into reviewed patch proposals. | 145 no-live fixtures pass the registry gate, but controlled lab runs are 0/20. |
| `p1` | `codex` | Use agent intake results to block unsafe branches and ask follow-up only where metadata is incomplete. | 1 branch(es) need follow-up and 1 are rejected. |

## Top 10 Next Engineering Actions

| Priority | Owner | Action | Reason |
| --- | --- | --- | --- |
| `p1` | `provider-runtime` | Use layered benchmark failures to pick the next fixture-backed provider hardening branch. | 5 simulated provider blockers remain in the no-live corpus. |
| `p1` | `provider-runtime` | Prioritize L1 runtime patches over claiming L2 recovery readiness. | Layered L1+L2 recovered pass rate is 40%. |
| `p0` | `alpha-ops` | Collect supervised private-alpha submissions and score them through the intake gate. | Private alpha readiness is yellow; synthetic fixtures cannot make it green. |
| `p1` | `activity-skill-runtime` | Run the 20-case controlled Activity Provider Skill Runtime lab and convert failures into reviewed patch proposals. | 145 no-live fixtures pass the registry gate, but controlled lab runs are 0/20. |
| `p1` | `codex` | Use agent intake results to block unsafe branches and ask follow-up only where metadata is incomplete. | 1 branch(es) need follow-up and 1 are rejected. |
| `p1` | `alpha-ops` | Start private-alpha intake only as supervised dogfood and convert failures into capture fixtures. | No-live gates can support intake, but green alpha readiness requires real submissions and value scoring. |
| `p2` | `codex` | Keep agent branches flowing through Stage 0 intake before merge validation. | Returned branches should be triaged by metadata so independent agents can start the next bounded task. |
| `p2` | `planner` | Review the highest-volume planner failure class in the benchmark report. | internal benchmark failures 20/53 |
| `p2` | `product/manual-boundary` | Review the highest-volume product/manual-boundary failure class in the benchmark report. | internal benchmark failures 10/10 |
| `p2` | `task-workspace` | Review the highest-volume task-workspace failure class in the benchmark report. | internal benchmark failures 6/16 |

## Notes

- Stage 0 operator report is no-live and reads deterministic benchmark fixtures only.
- yellow can still be the correct verdict when benchmark gates pass but private-alpha submissions have not been collected yet.
- green requires real private-alpha evidence, not docs, fixtures, or tooling alone.
- Private alpha synthetic samples are useful for gate smoke tests but cannot make the Stage 0 verdict green.
- Activity Skill Lab evidence ingestion reads local result.json summaries only; screenshots and JSONL stay local under .stage0b-evidence.
- The report never starts providers, workers, browser agents, OpenAI calls, payments, logins, verification, or final confirmations.
- deferred: no previous Stage 0 daily report snapshot was supplied.