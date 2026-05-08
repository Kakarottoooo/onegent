# Onegent Project Summary

Last updated: 2026-05-07

Onegent is a travel execution layer for AI agents and user-facing trip
workflows. The product turns natural-language travel requests into structured
tasks, runs provider-specific execution logic, records evidence, and stops at a
user-controlled review point before irreversible provider actions.

The current stage is no longer "prove one restaurant can close." Restaurant,
hotel, flight, and activity have all reached initial dogfood closure. The
focus is now reliability: task workspace consistency, no-live benchmark
coverage, layered recovery rules, runtime hardening, and private-alpha quality.

The active operating plan is Stage 0. All near-term work should align with
`docs/00-start-here/STAGE_0.md`: Capture -> Travel Object -> Task -> Decision
-> Execution -> Evidence -> Modify.

The first Capture MVP is intentionally backend-first: the homepage chat input
is the capture surface, and `/api/chat/parse` can now return a normalized
Travel Object alongside the normal NLU result. Separate heavy Capture pages
are not the Stage 0 priority.

Capture link handling now uses a structured Travel Link Resolver seam. URL
patterns are only the first evidence source: the resolver records provider,
page type, execution mode, user-choice requirements, and source evidence so
future webpage metadata, screenshot, video, or LLM enrichers can feed the same
task contract without turning model prose directly into execution prompts.

## Current Product Direction

Onegent is not a generic browser bot and not just a recommendation UI. It is a
task runtime for travel execution:

1. Understand a natural-language request.
2. Convert it into structured task parameters.
3. Route to the right vertical and provider.
4. Run L1 provider-specific execution logic first.
5. Escalate only evidence-backed page/control failures to L2 Browser Harness
   recovery in future versions.
6. Keep Computer Use as a later L3 fallback for cases where deterministic
   provider logic and Browser Harness are not enough.
7. Stop at a user-controlled review or continuation boundary before final
   booking, account-sensitive steps, verification, or irreversible actions.
8. Show the user and operators a task surface with logs, screenshots, status,
   evidence, and next actions.

The runtime, task ownership model, evidence capture, benchmark system, and
safe task UI are the durable product. Individual provider executors are
replaceable execution layers under that runtime.

## Active Worktree

Current canonical worktree after the provider-closure integration was folded
back into `master`:

```text
C:\Users\Gzw19\onegent
branch: master
head: current local master
```

The integration source worktree that produced the verified closure build was:

```text
C:\Users\Gzw19\onegent-provider-closure-integration-20260505
branch: codex/goal-core-reliability-long-run
head: e1fd890
```

Use `C:\Users\Gzw19\onegent` / `master` as the base for new multi-agent work
unless Codex explicitly announces a newer integration branch.

Older worktrees such as `C:\Users\Gzw19\onegent-integrated-20260504` and
one-off provider/debug worktrees may be stale or dirty. Verify branch, HEAD,
and status before using them.

## Phase Snapshot

Read `docs/00-start-here/PHASE_STATUS.md` for the detailed table. Short
version:

| Phase | Status | Notes |
|---|---|---|
| Phase 0A | Closed via OpenTable | Sirrah OpenTable live dogfood reached final review with phone filled and stopped before final confirmation. |
| Phase 0B | Entry gate met | Broaden OpenTable-first restaurant fixtures; Resy remains provider/network follow-up, not the Phase 0A blocker. |
| Phase 1 | Demo-freeze passed | Founder user path works through chat, tasks, evidence, and safe provider handoff. Manual walkthrough remains the human acceptance check. |
| Phase 1.5 | Demo-freeze passed | QA/dev surfaces, quality gates, runtime forensics, and demo control room are integrated. |
| Phase 2 | Initial dogfood closure reached | Expedia flight, Booking.com hotel, and Ticketmaster activity reached usable review/continue boundaries; broaden with benchmark coverage before demo promises. |

## Current Verified State

### Restaurant

- OpenTable is the accepted Phase 0A closure path.
- Founder dogfood request "book Sirrah in New York next Thursday at 8pm for 1
  person" reached OpenTable final review with phone filled and stopped before
  `Complete reservation`.
- Resy is not the Phase 0A blocker anymore. It remains a provider/network/IP
  follow-up lane because availability can differ by network conditions.

### Hotel

- Booking.com has reached initial dogfood closure to a user review/continue
  boundary.
- Hotel runtime and analyzers now avoid classifying weak/generic
  "not available" copy as true inventory unavailable unless exact hotel,
  dates, stay params, and scoped inventory evidence are present.
- Hotel layered benchmark fixtures cover exact no-availability,
  weak-no-availability fallback, provider degradation, room drift, account
  boundary, incomplete artifacts, and stale running state.

### Flight

- Expedia flight has reached initial dogfood closure to a user review/continue
  boundary.
- Runtime/analyzer work now guards against wrong-airline, wrong-time,
  price-only fallback, stale/mixed worker evidence, and checkout false-success
  when required traveler fields are missing.
- Flight layered benchmark fixtures now cover 15 Expedia no-live cases,
  including target-card absent, card scan before fallback, fallback
  matched/no checkout, model/env transient, and hidden-flight-number
  target-time pass. Remaining expected failures are insufficient-evidence or
  fixture-backed runtime-patch proposal cases, not closure success claims.

### Activity

- Ticketmaster activity has reached initial dogfood closure for The Lion King
  in New York.
- The v1 path used the existing Ticketmaster provider runtime, not Browser
  Harness.
- Activity provider links pasted into homepage Capture now flow through the
  Travel Link Resolver. Exact event links can start direct provider-entry
  tasks with the exact source URL preserved. Ticketmaster artist pages,
  StubHub performer/grouping pages, and SeatGeek dated/listing pages can start
  provider-page tasks that keep user choice boundaries. Provider-start pages
  are explicitly not exact event evidence: runtime should inspect provider
  listings, continue only when one obvious listing exists, and pause when the
  user must choose event/date/city/seats. Impersonating hosts do not trigger
  provider execution.
- Stage 0B Activity is now testing Browser Harness as an external skill-forge
  lab, not as production runtime. The Ticketmaster skill-forge plan covers 20
  real Ticketmaster URL shapes across artist, exact event, search, category,
  and venue pages. Initial controlled evidence shows: Disney On Ice artist
  pages ask user choice with visible candidate labels/links; Kacey Musgraves
  artist pages no longer leak unrelated "fans also viewed" candidates as
  choices; an exact Nashville SC event reaches the seat-selection hard stop and
  stops safely. Raw lab evidence remains local under
  `.stage0b-evidence/`; only reviewed rules and no-live tests enter git.
- The latest Ticketmaster Forge 20-case controlled lab summary is:
  13 safe outcomes, 7 provider-degraded pages, 0 unsafe boundary violations,
  0 wrong-target signals, and 0 remaining `skill_patch_needed` runs. The main
  reviewed patch was candidate extraction for locale artist pages such as
  Ticketmaster CA Kacey Musgraves; Ticketmaster `/category/*` Browse 404
  pages are now correctly treated as provider degradation instead of selector
  drift.
- Runtime now has a Ticketmaster task-state classifier for checkout reached,
  seat selection needed, login/account boundary, external ad tab, local browser
  disconnect, and unknown failure states.
- Remaining hardening is around external ad tabs, explicit seat-selection UI,
  and stale local browser/CDP jobs.

### Task Workspace

- Task Workspace v2 semantics are now centralized:
  - Queue = pending / not started.
  - Live = running.
  - History = terminal or ready-for-review.
- The Queue tab no longer auto-redirects to History when queue and live are
  empty. This keeps the user's selected task bucket stable during dogfood and
  avoids losing context while inspecting why nothing is queued.
- Watch / Evidence / Details entry points are being normalized across chat,
  recommendation cards, rooms, calendar, itinerary, and task cards.
- The task surface should be the primary debugging UI: status, logs,
  screenshots, evidence, and safe next actions belong to the task, not to a
  random chat window.

### Benchmarks And Agent Intake

- Stage 0 Capture now has a 500+ fixture no-live corpus covering raw text,
  URLs, screenshot descriptions, mixed inputs, save-only, compare-only,
  group-decision, refine, profile, and unsupported requests.
- Current Capture gate is 550/550 pass with 0 routing mismatches, 100%
  task-ready accuracy, 100% source metadata completeness, 100% artifact
  completeness, and 0 unknown failures.
- Stage 0 Alpha Readiness v3 closes the four prior intentional Capture
  `artifact_incomplete` gaps for restaurant, hotel, flight, and activity by
  recording task-readiness evidence in the deterministic artifact contract.
- Capture hardening now guards against homepage URL overcapture when a pasted
  URL is followed immediately by non-URL request text, provider-host
  impersonation, screenshot false positives, multi-URL silent selection, and
  loss of hotel/flight/restaurant/trip constraints through the task-boundary
  projection.
- `scripts/stage0-operator-report.ts` is the daily no-live cockpit for
  Capture benchmark, private-alpha intake, internal/layered benchmark signals,
  agent intake, static app-shell performance risk, top blockers by owner, and
  the next five Stage 0 actions.
- Current Internal Benchmark v2 has 200 no-live cases, 77.5% simulated
  success, 100% artifact completeness, 0 routing mismatches, and 0
  `task_workspace_artifact_incomplete` failures. Remaining failures are
  planner-required clarification, expected manual boundaries, provider
  simulated blockers/degradation, unsupported requests, and performance
  budget signals.
- Current Stage 0 static performance scan covers app bootstrap, chat sessions,
  rooms compact list, calendar jobs, contacts bootstrap, memory compact
  summary, booking-job compact list, and task summary. It now has 0 high-risk
  and 0 medium-risk endpoints. `/api/memory/compact` is the shell-safe memory
  path; full `/api/memory` remains a lazy detail route for insights.
- Layered Benchmark V2 exists as a no-live benchmark for L1 provider runtime
  results, evidence completeness, failure class, L2 Browser Harness
  eligibility, simulated L2 recovery, owner assignment, and patch proposals.
- Latest integrated 50-case layered gate passed with:
  - 96% artifact completeness
  - 0 routing mismatches
  - 4% unknown failure rate
  - 20% L1 direct pass
  - 40% L1 + L2 recovered pass
- Agent intake now has dependency-aware metadata, next-task recommendations,
  conflict risk, and ready/needs-followup/reject classification so side agents
  can keep working while Codex validates and merges.
- Private alpha remains yellow until real submissions, not fixtures, produce
  Travel Objects, safe next actions, evidence links, and user-value signals.

## Execution Layer Strategy

Onegent's execution architecture should evolve in layers:

1. **L1 provider runtime**: existing deterministic/provider-specific logic.
   This remains the default because it is fast, testable, and already works for
   the initial restaurant, hotel, flight, and activity closures.
2. **L2 Browser Harness**: future recovery layer for evidence-backed
   selector/click/iframe/fill/progress/page-mutation failures. It should
   produce patch proposals and recovery evidence, not silently replace the
   runtime.
3. **L3 Computer Use**: later fallback for cases where L1 and L2 cannot handle
   dynamic pages, as long as the same task/evidence/safety runtime is preserved.

L2 should not trigger for true no availability, account/session checkpoints,
provider degradation, network/model/env failures, insufficient evidence, or
user-only final actions.

## Current Runtime Reality

- OpenTable, Booking.com, Expedia, and Ticketmaster have all reached useful
  review/continue boundaries in founder dogfood.
- The product is still not ready for broad launch. The next milestone is
  repeatability across 5/10/20 case benchmark batches per vertical.
- No agent should blindly repeat live provider attempts. Failed attempts must
  be root-caused from DB rows, decision logs, logs, screenshots, report JSON,
  current URL, and provider stage evidence.
- Provider cards intentionally compress detail. Debugging must use task
  evidence, worker/app logs, benchmark reports, and screenshots. See
  `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`.

## Agent Collaboration Model

Codex owns integration, final merge review, shared architecture, task
workspace, benchmarks, and cross-agent coordination.

Side agents should work on independent, high-value gaps while Codex validates
and merges previous branches. They should not wait idle when their next task
does not depend on unmerged code.

Every side-agent task must close a named product, runtime, benchmark,
evidence, task-workspace, or performance gap. Broad abstraction, duplicate
runtime logic, vertical-specific schema drift, app-shell bloat, and docs-only
closure claims are anti-goals.

The shared coordination home is `docs/10-coordination/`.

## Near-Term Priorities

Read `docs/00-start-here/STAGE_0.md` before opening new product, runtime,
benchmark, or multi-agent work. The priorities below are the Stage 0 execution
lanes.

1. **Task Workspace v2 hardening**
   - All task cards and entry points should land on the same task view.
   - Completed tasks should remain attached to the originating chat/session.
   - Logs, screenshots, Watch, Evidence, Details, and status should behave the
     same across restaurant, hotel, flight, and activity.

2. **Layered Benchmark expansion**
   - Run no-live 5/10/20/50 case batches by vertical.
   - Track L1 direct pass, L1+L2 recovered pass, artifact completeness,
     routing mismatch, unknown failure, owner, and patch proposal rate.

3. **Runtime hardening from benchmark failures**
   - Close fixture-backed false success and wrong-target classes.
   - Prefer focused provider/runtime patches with tests over broad rewrites.

4. **Mutable Task State MVP**
   - Let users modify an active task's time/date/party/budget/provider policy.
   - Preserve task identity, increment plan version, audit the change, and
     resume from the affected step instead of starting unrelated duplicate
     tasks.

5. **MCP v2 task protocol**
   - After task runtime is stable, expose create/modify/status/continue/cancel
     to Claude/ChatGPT through a cleaner task protocol.

6. **Private Alpha**
   - Use 10-20 real users before any broad launch.
   - Measure reuse, failure recovery, safe handoff clarity, and willingness to
     pay.

## Where To Look Next

- Current phase and gates:
  `docs/00-start-here/PHASE_STATUS.md`
- New agent read order:
  `docs/INDEX.md`
- Task workspace semantics:
  `lib/booking-jobs/workspace.ts`
- Layered benchmark:
  `docs/30-provider-debug/LAYERED_BENCHMARK_V2.md`,
  `scripts/layered-benchmark.ts`
- Agent intake queue:
  `docs/40-dogfood/AGENT_INTAKE_QUEUE.md`,
  `scripts/layered-agent-intake.ts`
- Runtime debugging:
  `docs/30-provider-debug/PROVIDER_RUNTIME_DEBUG_PLAYBOOK.md`
- Founder dogfood bugs:
  `docs/40-dogfood/BUG_INBOX.md`
- Phase 1 founder checks:
  `docs/40-phase1/PHASE_1_FOUNDER_E2E.md`,
  `docs/40-phase1/AUTONOMOUS_FOUNDER_E2E.md`
- Demo / QA surfaces:
  `docs/40-phase1/DEMO_CONTROL_ROOM.md`,
  `docs/40-phase1/DEMO_FREEZE_ACCEPTANCE.md`
- Cross-agent state:
  `docs/10-coordination/HUDDLE.md`,
  `docs/10-coordination/codex.md`,
  `docs/10-coordination/claude.md`
