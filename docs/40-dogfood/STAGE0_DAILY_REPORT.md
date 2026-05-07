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
Dogfood links: DOG-005, DOG-009, DOG-010

## Internal Benchmark

Cases: 200
Success rate: 72.5%
Artifact completeness: 95%
Routing mismatch: 0

## Layered Benchmark

Cases: 50
Artifact completeness: 96%
Unknown failure: 4%
L1 direct pass: 20%
L1 + L2 recovered pass: 40%

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
Medium risk: 1
Findings: 10

## Top Failure Classes

| Failure class | Count |
| --- | ---: |
| `internal:planner_missing_required_field` | 20 |
| `internal:task_workspace_artifact_incomplete` | 10 |
| `layered:selector_drift` | 7 |
| `internal:manual_boundary_expected` | 5 |
| `internal:performance_budget_exceeded` | 5 |
| `internal:provider_simulated_block` | 5 |
| `internal:stale_session_or_provider_degraded` | 5 |
| `internal:unsupported_request` | 5 |
| `layered:insufficient_evidence` | 5 |
| `layered:provider_degraded` | 5 |

## Owner Summary

| Owner | Failures | Signals |
| --- | ---: | --- |
| `planner` | 20 | internal benchmark failures 20/53 |
| `task-workspace` | 19 | internal benchmark failures 16/16; layered benchmark failures 3/3 |
| `provider-runtime` | 18 | internal benchmark failures 9/9; layered benchmark failures 9/11 |
| `product/manual-boundary` | 10 | internal benchmark failures 10/10 |
| `browser-harness` | 2 | layered benchmark failures 2/10 |

## Top Blockers By Owner

| Priority | Owner | Blocker | Evidence |
| --- | --- | --- | --- |
| `p0` | `alpha-ops` | Private alpha is not green from real supervised submissions. | 3 intake sample(s), readiness yellow, 0 safe-miss seed(s). |
| `p1` | `provider-runtime` | Provider-runtime no-live failures need fixture-backed patches before more live attempts. | 4% layered unknown failures, 5 simulated provider blockers. |
| `p2` | `codex` | App-shell performance risks must stay out of route-level payloads. | 0 high-risk and 1 medium-risk endpoint(s). |
| `p1` | `codex` | Returned agent branches need metadata triage before merge validation. | 3 ready, 1 follow-up, 0 rebase, 1 reject. |
| `p2` | `planner` | Benchmark failures remain for this owner. | 20 failure(s): internal benchmark failures 20/53. |
| `p2` | `task-workspace` | Benchmark failures remain for this owner. | 19 failure(s): internal benchmark failures 16/16. |
| `p2` | `product/manual-boundary` | Benchmark failures remain for this owner. | 10 failure(s): internal benchmark failures 10/10. |
| `p2` | `browser-harness` | Benchmark failures remain for this owner. | 2 failure(s): layered benchmark failures 2/10. |

## Next 5 Actions

| Priority | Owner | Action | Reason |
| --- | --- | --- | --- |
| `p1` | `provider-runtime` | Use layered benchmark failures to pick the next fixture-backed provider hardening branch. | 5 simulated provider blockers remain in the no-live corpus. |
| `p1` | `provider-runtime` | Prioritize L1 runtime patches over claiming L2 recovery readiness. | Layered L1+L2 recovered pass rate is 40%. |
| `p0` | `alpha-ops` | Collect supervised private-alpha submissions and score them through the intake gate. | Private alpha readiness is yellow; synthetic fixtures cannot make it green. |
| `p1` | `codex` | Use agent intake results to block unsafe branches and ask follow-up only where metadata is incomplete. | 1 branch(es) need follow-up and 1 are rejected. |
| `p1` | `alpha-ops` | Start private-alpha intake only as supervised dogfood and convert failures into capture fixtures. | No-live gates can support intake, but green alpha readiness requires real submissions and value scoring. |

## Top 10 Next Engineering Actions

| Priority | Owner | Action | Reason |
| --- | --- | --- | --- |
| `p1` | `provider-runtime` | Use layered benchmark failures to pick the next fixture-backed provider hardening branch. | 5 simulated provider blockers remain in the no-live corpus. |
| `p1` | `provider-runtime` | Prioritize L1 runtime patches over claiming L2 recovery readiness. | Layered L1+L2 recovered pass rate is 40%. |
| `p0` | `alpha-ops` | Collect supervised private-alpha submissions and score them through the intake gate. | Private alpha readiness is yellow; synthetic fixtures cannot make it green. |
| `p1` | `codex` | Use agent intake results to block unsafe branches and ask follow-up only where metadata is incomplete. | 1 branch(es) need follow-up and 1 are rejected. |
| `p1` | `alpha-ops` | Start private-alpha intake only as supervised dogfood and convert failures into capture fixtures. | No-live gates can support intake, but green alpha readiness requires real submissions and value scoring. |
| `p2` | `codex` | Keep agent branches flowing through Stage 0 intake before merge validation. | Returned branches should be triaged by metadata so independent agents can start the next bounded task. |
| `p2` | `planner` | Review the highest-volume planner failure class in the benchmark report. | internal benchmark failures 20/53 |
| `p2` | `task-workspace` | Review the highest-volume task-workspace failure class in the benchmark report. | internal benchmark failures 16/16 |
| `p2` | `product/manual-boundary` | Review the highest-volume product/manual-boundary failure class in the benchmark report. | internal benchmark failures 10/10 |
| `p2` | `browser-harness` | Review the highest-volume browser-harness failure class in the benchmark report. | layered benchmark failures 2/10 |

## Notes

- Stage 0 operator report is no-live and reads deterministic benchmark fixtures only.
- yellow can still be the correct verdict when benchmark gates pass but private-alpha submissions have not been collected yet.
- green requires real private-alpha evidence, not docs, fixtures, or tooling alone.
- Private alpha synthetic samples are useful for gate smoke tests but cannot make the Stage 0 verdict green.
- The report never starts providers, workers, browser agents, OpenAI calls, payments, logins, verification, or final confirmations.
- deferred: no previous Stage 0 daily report snapshot was supplied.